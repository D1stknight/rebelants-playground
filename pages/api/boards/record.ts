// pages/api/boards/record.ts — a finished run goes on its game's boards, once (lib/server/gameBoards.ts)
import type { NextApiRequest, NextApiResponse } from "next";
import { actingPlayer } from "../../../lib/server/player-auth";
import { firstRecord, runOutcome } from "../../../lib/server/gameRuns";
import { checkSiege, entryFor, isBoardGame, readSiegeSession, recordBoards } from "../../../lib/server/gameBoards";
import { redis } from "../../../lib/server/redis";
import { TRACKS } from "../../../lib/rgpConfig";
import { resultEvent, runEvent, sendBadges, type BadgeOp } from "../../../lib/server/badges";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    const game = body.game;
    if (!isBoardGame(game)) return res.status(400).json({ ok: false, error: "Unknown game" });
    const who = await actingPlayer(req, body.playerId);
    if (!who.ok) return res.status(401).json({ ok: false, error: "Sign in to get on the boards.", signIn: who.signIn });
    const playerName = String(body.playerName || who.playerId).trim().slice(0, 40) || "player";
    const stats = body.stats && typeof body.stats === "object" ? body.stats : {};

    if (game === "siege") {
      const sess = await readSiegeSession(body.session);
      if (!sess || sess.userId !== who.user.userId || !(await firstRecord("gb-siege", sess.id))) return res.status(200).json({ ok: true, recorded: false });
      const checked = checkSiege(stats, sess);
      const e = entryFor("siege", checked, 0);
      await recordBoards({ game, playerId: who.playerId, playerName, ...e });
      await boardBadges("siege", who.user.userId, who.playerId, checked, 0).catch(() => undefined);
      return res.status(200).json({ ok: true, recorded: true });
    }
    const out = await runOutcome({ runId: body.runId, userId: who.user.userId });
    if (!out || out.game !== game || !(await firstRecord(`gb-${game}`, out.id))) return res.status(200).json({ ok: true, recorded: false });
    // a race can't be quicker than the run that paid for it
    if (game === "gp" && out.run && Number(stats.timeMs) > 0) stats.timeMs = Math.max(Number(stats.timeMs || 0), Date.now() - out.run.startedAt - 30000);
    const e = entryFor(game, stats, out.points);
    await recordBoards({ game, playerId: who.playerId, playerName, ...e });
    await boardBadges(game, who.user.userId, who.playerId, stats, out.points).catch(() => undefined);
    return res.status(200).json({ ok: true, recorded: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed" });
  }
}

const isTop = async (key: string, pid: string) => (await redis.zrevrank(key, pid).catch(() => null)) === 0;

/** Badges from a recorded run: what the server checked (and capped) above, plus what it paid. */
async function boardBadges(game: "siege" | "descent" | "bounty" | "gp", userId: string, pid: string, s: any, paid: number) {
  const award: string[] = [];
  const counters: BadgeOp[] = [];
  const n = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
  if (game === "descent") {
    const floor = n(s.floor, 0, 10);
    counters.push({ key: "descent.runs", op: "add" }, { key: "descent.days", op: "dayCount" }, { key: "descent.kills", op: "add", by: n(s.kills, 0, 80) });
    if (floor >= 5) award.push("descent.brood");
    if (floor >= 7) award.push("descent.deep");
    if (floor >= 9) award.push("descent.twins");
    if (s.victory && floor >= 10) counters.push({ key: "descent.queens", op: "add" });
    if (paid >= 2000) award.push("descent.greedy");
    if (paid >= 4000) award.push("descent.hoard");
    if (floor > 0 && (await isTop("ra:gb:descent:floor", pid))) award.push("descent.top");
  } else if (game === "bounty") {
    const board = n(s.boardN, 1, 12);
    counters.push({ key: "bounty.runs", op: "add" }, { key: "bounty.kills", op: "add", by: n(s.kills, 0, 400) });
    if (s.cleared) {
      counters.push({ key: "bounty.boards", op: "distinct", item: String(board) });
      if (board >= 3) award.push("bounty.grub");
      if (board >= 6) award.push("bounty.sludge");
      if (board >= 9) award.push("bounty.warden");
      if (board === 12) counters.push({ key: "bounty.headsman", op: "add" });
      if (await isTop("ra:gb:bounty:board", pid)) award.push("bounty.top");
    }
    if (paid >= 1500) award.push("bounty.king");
    if (paid >= 2400) award.push("bounty.emperor");
  } else if (game === "gp") {
    const place = n(s.place, 1, 8);
    const track = String(s.trackId || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
    const meta = TRACKS.find((t) => t.id === track);
    counters.push({ key: "gp.races", op: "add" });
    if (meta) counters.push({ key: "gp.tracks", op: "distinct", item: track });
    if (place <= 3) counters.push({ key: "gp.podiums", op: "add" });
    if (place === 1) {
      counters.push({ key: "gp.wins", op: "add" });
      if (meta && (meta.cup === 4 || meta.cup === 5)) award.push("gp.throne");
      if (meta) {
        const wonKey = "ra:badge:gpwins:" + userId;
        await redis.sadd(wonKey, track);
        const won = new Set(((await redis.smembers(wonKey)) as string[]) || []);
        if (TRACKS.filter((t) => t.cup === meta.cup).every((t) => won.has(t.id))) award.push("gp.cup");
        if (TRACKS.every((t) => won.has(t.id))) award.push("gp.slam");
      }
    }
    if (meta && (await isTop("ra:gb:gp:track:" + track, pid))) {
      const recKey = "ra:badge:gprecords:" + userId;
      await redis.sadd(recKey, track);
      counters.push({ key: "gp.records", op: "max", by: Number(await redis.scard(recKey)) || 1 });
    }
  } else {
    const wave = n(s.wave, 0, 12);
    counters.push({ key: "siege.runs", op: "add" }, { key: "siege.kills", op: "add", by: n(s.kills, 0, 2000) });
    if (wave >= 5) award.push("siege.ram");
    if (wave >= 8) award.push("siege.towers");
    if (wave >= 11) award.push("siege.push");
    if (s.held) counters.push({ key: "siege.held", op: "add" }, { key: "siege.helddays", op: "day" });
    if (Number(s.score) >= 15000) award.push("siege.score15k");
    if (Number(s.score) > 0 && (await isTop("ra:gb:siege:score", pid))) award.push("siege.top");
  }
  const g = game === "gp" ? "grand-prix" : game;
  // the Siege is free (no paid run): its defence counts as a Playground run here
  await sendBadges([game === "siege" ? runEvent(userId, "siege", { award, counters }) : resultEvent(userId, g, { award, counters })]);
}
