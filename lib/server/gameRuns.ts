// lib/server/gameRuns.ts
// Paid game runs: the server decides what a game pays.
//
// A game's entry fee (points/spend with the game's reason) opens a run for the
// player's Rebel Economy account. A payout (points/earn) is paid only within an
// open run of that account and game: never more than the run can pay (the game's
// own payout table, or an admin limit for the games whose score the browser
// keeps), not sooner than the game allows after the entry, and only as many
// payouts as the game makes. The browser can no longer name an amount and be
// paid it.
//
// Admin settings (ra:config:economy):
//   payoutGuard         "enforce" (default) | "watch": watch pays what the game
//                       asks, as before, and only logs what enforce would do
//   <game>MaxPayout     the most one run pays (Descent, Bounty Hunters, Tunnel,
//                       Faction Wars); Rebel GP pays its place table (3x entry)
//   gameDailyCaps       { <game>: REBEL per account per UTC day } (0 / none = no cap)
//   gameDailyCapMode    "watch" (default: over-cap payouts are paid and logged)
//                       | "enforce"
// Every refused, cut or over-cap payout goes to the payout log (admin page).
import { randomBytes } from "crypto";
import { etDay } from "./day";
import { redis } from "./redis";
import { pointsConfig as DEFAULTS } from "../pointsConfig";
import { GP_PAYOUT } from "../rgpConfig";

export const ECON_KEY = "ra:config:economy";

// The live config the admin page saves, over the defaults (as /api/config serves it).
export async function loadLiveConfig(): Promise<any> {
  let saved: any = null;
  try {
    const raw = await redis.get(ECON_KEY);
    saved = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  } catch {
    saved = null;
  }
  return {
    ...(DEFAULTS as any),
    ...(saved || {}),
    rewards: { ...(DEFAULTS as any).rewards, ...(saved?.rewards || {}) },
    rarityWeights: { ...(DEFAULTS as any).rarityWeights, ...(saved?.rarityWeights || {}) },
  };
}

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export type RunGame = "shuffle" | "tunnel" | "gp" | "descent" | "bounty" | "faction-wars";

type Rule = {
  label: string;
  // the entry fees the game takes (Faction Wars: with and without the Ashigaru discount)
  entries: (cfg: any) => number[];
  // the most one run pays (shuffle: the prize roll pays itself, no payouts here)
  maxPayout: (cfg: any, entry: number) => number;
  // a payout sooner than this after the entry is refused (no real run is that short)
  minSeconds: number;
  // payouts one run makes (Faction Wars pays its bonuses during the battle, then the reward)
  payouts: number;
};

export const DEFAULT_MAX_PAYOUT = { descent: 5000, bounty: 2500, tunnel: 5000, "faction-wars": 1000 } as const;

export const RUN_RULES: Record<RunGame, Rule> = {
  shuffle: { label: "Queen's Egg Shuffle", entries: (c) => [num(c.shuffleCost, 500)], maxPayout: () => 0, minSeconds: 0, payouts: 0 },
  gp: {
    label: "Rebel Grand Prix",
    entries: (c) => [num(c.gpCost, 100)],
    // the place table: 1st pays 3x the entry
    maxPayout: (_c, entry) => Math.round(entry * Math.max(...GP_PAYOUT)),
    minSeconds: 20,
    payouts: 1,
  },
  descent: { label: "Hive Descent", entries: (c) => [num(c.descentCost, 300)], maxPayout: (c) => num(c.descentMaxPayout, DEFAULT_MAX_PAYOUT.descent), minSeconds: 10, payouts: 1 },
  bounty: { label: "Bounty Hunters", entries: (c) => [num(c.bountyCost, 100)], maxPayout: (c) => num(c.bountyMaxPayout, DEFAULT_MAX_PAYOUT.bounty), minSeconds: 5, payouts: 1 },
  tunnel: { label: "Ant Tunnel", entries: (c) => [num(c.tunnelCost, 50)], maxPayout: (c) => num(c.tunnelMaxPayout, DEFAULT_MAX_PAYOUT.tunnel), minSeconds: 5, payouts: 1 },
  "faction-wars": {
    label: "Faction Wars",
    entries: (c) => {
      const f = num(c.factionWarsCost, 150);
      return [f, Math.max(0, f - 25)];
    },
    maxPayout: (c) => num(c.factionWarsMaxPayout, DEFAULT_MAX_PAYOUT["faction-wars"]),
    // a Cutlass Raid bonus can come in the first round
    minSeconds: 3,
    payouts: 80,
  },
};

export const isRunGame = (g: unknown): g is RunGame => typeof g === "string" && Object.prototype.hasOwnProperty.call(RUN_RULES, g);

export type Run = {
  id: string;
  game: RunGame;
  userId: string;
  playerId: string;
  entry: number;
  max: number;
  startedAt: number;
};

const RUN_TTL = 6 * 60 * 60;
const runKey = (id: string) => `ra:run:${id}`;
const paidKey = (id: string) => `ra:run:${id}:paid`;
const countKey = (id: string) => `ra:run:${id}:n`;
const LOG_KEY = "ra:payouts:log";
const dayOf = (t = Date.now()) => etDay(t); // Eastern time (lib/server/day.ts)
const dayKey = (game: string, day: string) => `ra:payouts:day:${day}:${game}`;

export const guardMode = (cfg: any): "enforce" | "watch" => (cfg?.payoutGuard === "watch" ? "watch" : "enforce");

export async function openRun(o: { game: RunGame; userId: string; playerId: string; entry: number; cfg: any }): Promise<Run> {
  const run: Run = {
    id: `r${Date.now().toString(36)}${randomBytes(9).toString("hex")}`,
    game: o.game,
    userId: o.userId,
    playerId: o.playerId,
    entry: o.entry,
    max: Math.max(0, Math.floor(RUN_RULES[o.game].maxPayout(o.cfg, o.entry))),
    startedAt: Date.now(),
  };
  await redis.set(runKey(run.id), JSON.stringify(run), { ex: RUN_TTL });
  return run;
}

export async function readRun(id: unknown): Promise<Run | null> {
  const s = String(id || "");
  if (!/^r[0-9a-z]{6,14}[0-9a-f]{18}$/.test(s)) return null;
  const raw = await redis.get(runKey(s));
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Run;
  } catch {
    return null;
  }
}

export type PayoutEvent = {
  at: number;
  game: string;
  playerId: string;
  userId: string;
  runId: string | null;
  asked: number;
  paid: number;
  why: string; // no_run | not_yours | wrong_game | too_soon | run_done | cut | over_cap | over_cap_watch (joined by +)
  mode: "enforce" | "watch"; // watch: paid what was asked
};

export async function logPayout(e: PayoutEvent) {
  try {
    await redis.lpush(LOG_KEY, JSON.stringify(e));
    await redis.ltrim(LOG_KEY, 0, 299);
  } catch {
    /* the log is for the admin page only */
  }
}

export async function readPayoutLog(limit = 300): Promise<PayoutEvent[]> {
  const rows = (await redis.lrange<any>(LOG_KEY, 0, Math.max(0, Math.min(299, limit - 1)))) || [];
  return rows
    .map((r) => {
      try {
        return typeof r === "string" ? JSON.parse(r) : r;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Today's payouts per account for one game (the admin page's "top today").
export async function topToday(game: string, n = 10): Promise<{ userId: string; paid: number }[]> {
  const flat = ((await redis.zrange(dayKey(game, dayOf()), 0, n - 1, { rev: true, withScores: true })) || []) as any[];
  const out: { userId: string; paid: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ userId: String(flat[i]), paid: Number(flat[i + 1]) });
  return out;
}

export type PayDecision =
  | { ok: true; run: Run | null; amount: number; key: string; cut: boolean; release: () => Promise<void> }
  | { ok: false; status: number; error: string; code: string };

// Decide one payout for a run (points/earn). On ok the caller credits `amount` with
// idempotency key `key`; if the credit fails it calls release().
export async function decidePayout(o: {
  cfg: any;
  game: unknown;
  runId: unknown;
  userId: string;
  playerId: string;
  asked: number;
}): Promise<PayDecision> {
  const mode = guardMode(o.cfg);
  const asked = Math.max(0, Math.floor(o.asked));
  const game = isRunGame(o.game) ? o.game : null;
  const base = { at: Date.now(), playerId: o.playerId, userId: o.userId, asked, mode };
  // watch: pay what is asked (the old rule), log what enforce would have done
  const refuse = async (status: number, code: string, error: string, run: Run | null): Promise<PayDecision> => {
    await logPayout({ ...base, game: String(o.game || "?").slice(0, 24), runId: run?.id || (o.runId ? String(o.runId).slice(0, 40) : null), paid: mode === "watch" ? asked : 0, why: code });
    if (mode === "watch") return { ok: true, run, amount: asked, key: `earn:${o.userId}:${Date.now()}:${asked}`, cut: false, release: async () => {} };
    return { ok: false, status, error, code };
  };

  if (!game || game === "shuffle") return refuse(403, "no_run", "This game's reward comes from a game run: reload the page and play again.", null);
  const run = await readRun(o.runId);
  if (!run) return refuse(403, "no_run", "This run has ended or was never started: reload the page and play again.", null);
  if (run.userId !== o.userId) return refuse(403, "not_yours", "This run belongs to another account.", run);
  if (run.game !== game) return refuse(403, "wrong_game", "This run is for another game.", run);
  const rule = RUN_RULES[game];
  if (Date.now() - run.startedAt < rule.minSeconds * 1000) return refuse(403, "too_soon", "That was quicker than this game can be played.", run);

  const n = Number(await redis.incr(countKey(run.id)));
  await redis.expire(countKey(run.id), RUN_TTL).catch(() => 0);
  if (n > rule.payouts) {
    await redis.decr(countKey(run.id)).catch(() => 0);
    return refuse(409, "run_done", "This run has already paid out.", run);
  }
  // the run's budget: reserve what is asked, then hand back what the run can't pay
  const total = Number(await redis.incrby(paidKey(run.id), asked));
  await redis.expire(paidKey(run.id), RUN_TTL).catch(() => 0);
  let amount = Math.max(0, Math.min(asked, run.max - (total - asked)));
  let why = amount < asked ? "cut" : "";

  // the account's daily total for this game, and its cap when one is set
  const day = dayOf();
  const caps = o.cfg?.gameDailyCaps && typeof o.cfg.gameDailyCaps === "object" ? o.cfg.gameDailyCaps : {};
  const cap = num(caps[game], 0);
  const before = Number((await redis.zscore(dayKey(game, day), o.userId)) || 0);
  if (cap > 0 && before + amount > cap) {
    if (o.cfg?.gameDailyCapMode === "enforce") {
      amount = Math.max(0, cap - before);
      why = "over_cap";
    } else why = why ? why + "+over_cap_watch" : "over_cap_watch";
  }

  const paid = mode === "watch" ? asked : amount;
  if (paid < asked) await redis.decrby(paidKey(run.id), asked - paid);
  if (paid > 0) {
    await redis.zincrby(dayKey(game, day), paid, o.userId);
    await redis.expire(dayKey(game, day), 3 * 86400).catch(() => 0);
  }
  const release = async () => {
    await Promise.all([
      paid > 0 ? redis.decrby(paidKey(run.id), paid).catch(() => 0) : null,
      redis.decr(countKey(run.id)).catch(() => 0),
      paid > 0 ? redis.zincrby(dayKey(game, day), -paid, o.userId).catch(() => 0) : null,
    ]);
  };
  // watch: paid as asked; the log says what enforce would have paid
  if (why) await logPayout({ ...base, game, runId: run.id, paid, why });
  return { ok: true, run, amount: paid, key: `run:${run.id}:${n}`, cut: paid < asked, release };
}

// ── What a finished run (or Raid) paid, for the wins feed and the game boards ─────────────────────────────
// A board entry comes from a run the player's account paid the entry for, once per run, with the points the
// server paid (not the request's). The Shuffle's run keeps its roll; the Raid keeps its result.
export type RunOutcome = { id: string; game: string; points: number; prize: any | null; rarity: string | null; run: Run | null };

export async function runOutcome(o: { runId?: unknown; raidId?: unknown; userId: string }): Promise<RunOutcome | null> {
  if (o.raidId) {
    const raw = await redis.get(`ra:raid:result:${String(o.raidId).slice(0, 40)}`);
    const r: any = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    if (!r || r.userId !== o.userId) return null;
    const real = r.prize?.type === "nft" || r.prize?.type === "merch";
    return { id: String(r.raidId), game: "expedition", points: r.prize?.type === "points" ? Number(r.prize.points || 0) : 0, prize: real ? r.prize : null, rarity: r.rarity || null, run: null };
  }
  const run = await readRun(o.runId);
  if (!run || run.userId !== o.userId) return null;
  if (run.game === "shuffle") {
    const raw = await redis.get(`ra:run:${run.id}:roll`);
    const r: any = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
    if (!r) return null;
    const real = r.prize?.type === "nft" || r.prize?.type === "merch";
    return { id: run.id, game: "shuffle", points: r.prize?.type === "points" ? Number(r.prize.points || 0) : 0, prize: real ? r.prize : null, rarity: r.rarity || null, run };
  }
  return { id: run.id, game: run.game, points: Math.max(0, Number((await redis.get(paidKey(run.id))) || 0)), prize: null, rarity: null, run };
}

// The first board entry of a run (or Raid) for `board` (true); later ones get false.
export async function firstRecord(board: string, id: string): Promise<boolean> {
  return !!(await redis.set(`ra:run:${id}:board:${board}`, "1", { nx: true, ex: RUN_TTL }));
}
