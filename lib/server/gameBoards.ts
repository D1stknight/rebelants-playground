// lib/server/gameBoards.ts
// Per-game stats + leaderboards for Hive Descent, Bounty Hunters, Rebel Grand Prix and The Siege.
//
// A board entry comes from a finished run, once:
//   - descent / bounty / gp: the run the player's account paid the entry for (lib/server/gameRuns.ts),
//     with the points the server paid in it (never the request's);
//   - siege (free to play): a session the server opened for the signed-in account when the defence began
//     (/api/boards/siege-start), with the result checked against what the waves can give.
// Every board is a sorted set; the player's own numbers live in one hash per game.
import { randomBytes } from "crypto";
import { redis } from "./redis";

export type BoardGame = "descent" | "bounty" | "gp" | "siege";
export const BOARD_GAMES: BoardGame[] = ["descent", "bounty", "gp", "siege"];
export const isBoardGame = (g: unknown): g is BoardGame => typeof g === "string" && (BOARD_GAMES as string[]).includes(g);

// "best": keep the player's highest (or lowest, for times) result; "sum": add every run
export type BoardDef = { id: string; label: string; unit: string; kind: "best" | "sum"; low?: boolean; time?: boolean };
export const BOARDS: Record<BoardGame, BoardDef[]> = {
  descent: [
    { id: "floor", label: "Deepest Descent", unit: "floor", kind: "best" },
    { id: "slain", label: "Queen Slayers", unit: "kills of the Queen", kind: "sum" },
    { id: "kills", label: "Hive Purgers", unit: "enemies slain", kind: "sum" },
    { id: "earned", label: "Richest Delvers", unit: "REBEL", kind: "sum" },
  ],
  bounty: [
    { id: "board", label: "Most Wanted", unit: "board cleared", kind: "best" },
    { id: "bounties", label: "Bounties Claimed", unit: "boards cleared", kind: "sum" },
    { id: "kills", label: "Exterminators", unit: "kills", kind: "sum" },
    { id: "earned", label: "Top Earners", unit: "REBEL", kind: "sum" },
  ],
  gp: [
    { id: "wins", label: "Race Winners", unit: "wins", kind: "sum" },
    { id: "podiums", label: "Podium Kings", unit: "podiums", kind: "sum" },
    { id: "earned", label: "Prize Money", unit: "REBEL", kind: "sum" },
    { id: "races", label: "Most Races", unit: "races", kind: "sum" },
  ],
  siege: [
    { id: "score", label: "High Score", unit: "points", kind: "best" },
    { id: "wave", label: "Furthest Wave", unit: "wave", kind: "best" },
    { id: "kills", label: "Spider Slayers", unit: "spiders", kind: "sum" },
    { id: "held", label: "Gate Holders", unit: "victories", kind: "sum" },
  ],
};

const K = {
  board: (g: BoardGame, b: string) => `ra:gb:${g}:${b}`,
  track: (trackId: string) => `ra:gb:gp:track:${trackId}`, // fastest race per track (ms, lower is better)
  stats: (g: BoardGame, pid: string) => `ra:gb:${g}:stats:${pid}`,
  names: "ra:gb:names",
  recent: (g: BoardGame) => `ra:gb:${g}:recent`,
  siege: (id: string) => `ra:gb:siege:sess:${id}`,
};

const clampInt = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

// ── The Siege: a session per defence ───────────────────────────────────────────────
export type SiegeSession = { id: string; userId: string; playerId: string; faction: string; startedAt: number };
export async function openSiegeSession(o: { userId: string; playerId: string; faction: string }): Promise<SiegeSession> {
  const s: SiegeSession = { id: `s${Date.now().toString(36)}${randomBytes(9).toString("hex")}`, userId: o.userId, playerId: o.playerId, faction: String(o.faction || "").slice(0, 24), startedAt: Date.now() };
  await redis.set(K.siege(s.id), JSON.stringify(s), { ex: 4 * 60 * 60 });
  return s;
}
export async function readSiegeSession(id: unknown): Promise<SiegeSession | null> {
  const s = String(id || "");
  if (!/^s[0-9a-z]{6,14}[0-9a-f]{18}$/.test(s)) return null;
  const raw = await redis.get(K.siege(s));
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as SiegeSession;
  } catch {
    return null;
  }
}
// the most a Siege can honestly show: 12 waves, ~45 s of play a wave, ~1,400 points and ~60 kills a wave at the outside
export const SIEGE_WAVES = 12;
export function checkSiege(stats: any, sess: SiegeSession) {
  const secs = Math.max(0, (Date.now() - sess.startedAt) / 1000);
  const wavesByTime = Math.floor(secs / 15) + 1; // nobody clears a wave in under 15 s
  const wave = clampInt(stats.wave, 0, Math.min(SIEGE_WAVES, wavesByTime));
  const score = clampInt(stats.score, 0, wave * 1400 + 1000);
  const kills = clampInt(stats.kills, 0, wave * 60);
  const held = !!stats.won && wave >= SIEGE_WAVES;
  return { wave, score, kills, held };
}

// ── Recording a finished run ─────────────────────────────────────────────────────────
type Entry = { game: BoardGame; playerId: string; playerName: string; values: Record<string, number>; best: Record<string, number>; extra?: { trackId?: string; trackMs?: number }; summary: string };

// What each game's result adds (only numbers the server has checked or capped).
export function entryFor(game: BoardGame, s: any, paid: number): { values: Record<string, number>; best: Record<string, number>; extra?: Entry["extra"]; summary: string } {
  if (game === "descent") {
    const floor = clampInt(s.floor, 0, 10);
    const won = !!s.victory && floor >= 10;
    const kills = clampInt(s.kills, 0, 80);
    return { values: { slain: won ? 1 : 0, kills, earned: paid }, best: { floor }, summary: won ? "slew the Queen" : `reached floor ${floor}` };
  }
  if (game === "bounty") {
    const board = clampInt(s.boardN, 1, 12);
    const cleared = !!s.cleared;
    const kills = clampInt(s.kills, 0, 400);
    return { values: { bounties: cleared ? 1 : 0, kills, earned: paid }, best: cleared ? { board } : {}, summary: cleared ? `cleared board ${board}` : `fell on board ${board}` };
  }
  if (game === "gp") {
    const place = clampInt(s.place, 1, 8);
    const ms = clampInt(s.timeMs, 0, 60 * 60 * 1000);
    const trackId = String(s.trackId || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
    return {
      values: { wins: place === 1 ? 1 : 0, podiums: place <= 3 ? 1 : 0, earned: paid, races: 1 },
      best: {},
      extra: trackId && ms > 10000 && place <= 8 ? { trackId, trackMs: ms } : { trackId },
      summary: `finished P${place}`,
    };
  }
  // siege: already checked by checkSiege
  return { values: { kills: s.kills, held: s.held ? 1 : 0 }, best: { score: s.score, wave: s.wave }, summary: s.held ? "held the gate" : `fell on wave ${s.wave}` };
}

export async function recordBoards(e: Entry) {
  const { game, playerId: pid } = e;
  const defs = BOARDS[game];
  const st = K.stats(game, pid);
  await redis.hset(K.names, { [pid]: e.playerName });
  await redis.hset(st, { name: e.playerName, last: Date.now() });
  await redis.hincrby(st, "runs", 1);
  for (const d of defs) {
    if (d.kind === "sum") {
      const v = Math.max(0, Number(e.values[d.id] || 0));
      if (v > 0) {
        await redis.zincrby(K.board(game, d.id), v, pid);
        await redis.hincrby(st, d.id, v);
      }
    } else {
      const v = Math.max(0, Number(e.best[d.id] || 0));
      if (v > 0) {
        await redis.zadd(K.board(game, d.id), { gt: true }, { score: v, member: pid });
        const prev = Number((await redis.hget(st, d.id)) || 0);
        if (v > prev) await redis.hset(st, { [d.id]: v });
      }
    }
  }
  if (game === "gp" && e.extra?.trackId && e.extra.trackMs) {
    // fastest race per track: stored negated so the highest score is the quickest time
    await redis.zadd(K.track(e.extra.trackId), { gt: true }, { score: -e.extra.trackMs, member: pid });
    const key = `t:${e.extra.trackId}`;
    const prev = Number((await redis.hget(st, key)) || 0);
    if (!prev || e.extra.trackMs < prev) await redis.hset(st, { [key]: e.extra.trackMs });
  }
  await redis.lpush(K.recent(game), JSON.stringify({ ts: Date.now(), playerId: pid, playerName: e.playerName, summary: e.summary }));
  await redis.ltrim(K.recent(game), 0, 19);
}

// ── Reading ───────────────────────────────────────────────────────────────────────────
function pairs(z: any): { member: string; score: number }[] {
  if (!Array.isArray(z)) return [];
  if (z.length && typeof z[0] === "object" && z[0] && "member" in z[0]) return z.map((x: any) => ({ member: String(x.member), score: Number(x.score || 0) }));
  const out: { member: string; score: number }[] = [];
  for (let i = 0; i + 1 < z.length; i += 2) out.push({ member: String(z[i]), score: Number(z[i + 1] || 0) });
  return out;
}

export type Row = { rank: number; playerId: string; playerName: string; value: number };
async function top(key: string, n: number, neg = false): Promise<{ member: string; score: number }[]> {
  const z = await redis.zrange(key, 0, n - 1, { rev: true, withScores: true }).catch(() => []);
  return pairs(z).map((p) => ({ member: p.member, score: neg ? -p.score : p.score }));
}

export async function readBoards(game: BoardGame, opts: { playerId?: string; trackIds?: string[]; n?: number }) {
  const n = Math.max(3, Math.min(25, opts.n || 10));
  const defs = BOARDS[game];
  const lists = await Promise.all(defs.map((d) => top(K.board(game, d.id), n)));
  const tracks = game === "gp" && opts.trackIds?.length ? await Promise.all(opts.trackIds.map((t) => top(K.track(t), 3, true))) : [];
  const ids = new Set<string>();
  for (const l of [...lists, ...tracks]) for (const r of l) ids.add(r.member);
  const pid = String(opts.playerId || "");
  if (pid) ids.add(pid);
  const idArr = [...ids];
  const nameArr = idArr.length ? ((await redis.hmget(K.names, ...idArr).catch(() => null)) as any) : null;
  const names: Record<string, string> = {};
  idArr.forEach((id, i) => {
    const v = Array.isArray(nameArr) ? nameArr[i] : nameArr ? nameArr[id] : null;
    names[id] = v ? String(v) : id.replace(/^(discord|name|wallet):/, "").slice(0, 18);
  });
  const rows = (l: { member: string; score: number }[]): Row[] => l.map((r, i) => ({ rank: i + 1, playerId: r.member, playerName: names[r.member], value: r.score }));
  const boards = defs.map((d, i) => ({ ...d, rows: rows(lists[i]) }));
  const trackBoards = (opts.trackIds || []).map((t, i) => ({ trackId: t, rows: rows(tracks[i] || []) }));

  let me: null | { stats: Record<string, number | string>; ranks: Record<string, number | null> } = null;
  if (pid) {
    const raw = ((await redis.hgetall(K.stats(game, pid)).catch(() => null)) || {}) as Record<string, any>;
    const stats: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(raw)) stats[k] = k === "name" ? String(v) : Number(v);
    const ranks: Record<string, number | null> = {};
    await Promise.all(
      defs.map(async (d) => {
        const r = await redis.zrevrank(K.board(game, d.id), pid).catch(() => null);
        ranks[d.id] = r === null || r === undefined ? null : Number(r) + 1;
      })
    );
    me = { stats, ranks };
  }
  const recentRaw = ((await redis.lrange(K.recent(game), 0, 7).catch(() => [])) || []) as any[];
  const recent = recentRaw.map((x) => { try { return typeof x === "string" ? JSON.parse(x) : x; } catch { return null; } }).filter(Boolean);
  return { boards, trackBoards, me, recent };
}
