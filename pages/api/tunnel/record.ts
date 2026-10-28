import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { actingPlayer } from "../../../lib/server/player-auth";
import { firstRecord, readRun } from "../../../lib/server/gameRuns";
import { TUNNEL_LAYOUT_COUNT, tunnelSlot } from "../../../lib/server/tunnelLayouts";
import { resultEvent, sendBadges, type BadgeOp } from "../../../lib/server/badges";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const body = req.body || {};
  let playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
  const playerName = String(body.playerName || "guest").trim().slice(0, 40) || "guest";
  let score = Math.max(0, Math.floor(Number(body.score || 0)) || 0);
  const fullClear = !!body.fullClear;
  let clearTimeMs = Math.max(0, Number(body.clearTimeMs || 0));

  // ✅ A run goes on the Tunnel boards once, from a Tunnel run the player's account paid the entry for: its
  // score no more than that run can pay, its clear time no shorter than the run itself.
  const who = await actingPlayer(req, playerId);
  if (!who.ok) return res.status(401).json({ ok: false, error: "Sign in again to record your run.", signIn: who.signIn });
  const run = await readRun(body.runId);
  if (!run || run.game !== "tunnel" || run.userId !== who.user.userId || !(await firstRecord("tunnel", run.id))) return res.status(200).json({ ok: true, recorded: false });
  playerId = who.playerId;
  score = Math.min(score, run.max);
  if (clearTimeMs > 0) clearTimeMs = Math.max(clearTimeMs, Date.now() - run.startedAt - 4000);
  const crystalsCollected = Math.max(0, Number(body.crystalsCollected || 0));
  const rawLayout = typeof body.layoutIndex === "number" ? Math.floor(body.layoutIndex) : null;
  // stored in the server's slot numbering (see tunnelLayouts.ts)
  const layoutIndex = rawLayout !== null && rawLayout >= 0 && rawLayout < TUNNEL_LAYOUT_COUNT ? tunnelSlot(rawLayout) : null;
  const layoutName = typeof body.layoutName === "string" ? String(body.layoutName) : "";
  const member = playerId + "|" + playerName + "|" + layoutName;
  try {
    await redis.hset("tunnel:player:" + playerId + ":stats", { playerName });
    await redis.hincrby("tunnel:player:" + playerId + ":stats", "totalRuns", 1);
    await redis.hincrby("tunnel:player:" + playerId + ":stats", "totalCrystals", crystalsCollected);
    if (score > 0) {
      const prev = Number(await redis.hget("tunnel:player:" + playerId + ":stats", "bestScore") || 0);
      if (score > prev) await redis.hset("tunnel:player:" + playerId + ":stats", { bestScore: score });
      await redis.zadd("tunnel:top:score", { gt: true }, { score: Number(score), member });
      if (layoutIndex !== null) await redis.zadd("tunnel:layout:" + layoutIndex + ":scores", { gt: true }, { score: Number(score), member });
    }
    if (fullClear && clearTimeMs > 0) {
      const pf = await redis.zscore("tunnel:top:clear", member);
      if (pf === null || clearTimeMs < -Number(pf)) {
        await redis.zadd("tunnel:top:clear", { score: -clearTimeMs, member });
        await redis.hset("tunnel:player:" + playerId + ":stats", { bestClearTimeMs: clearTimeMs });
      if (layoutIndex !== null) {
        const prevLayout = await redis.zscore("tunnel:layout:" + layoutIndex + ":clears", member);
        if (prevLayout === null || clearTimeMs < -Number(prevLayout)) {
          await redis.zadd("tunnel:layout:" + layoutIndex + ":clears", { gt: true }, { score: -clearTimeMs, member });
        }
      }
      }
    }
    if (layoutIndex !== null) await redis.sadd("tunnel:player:" + playerId + ":explored", String(layoutIndex));
    await tunnelBadges(who.user.userId, playerId, { score, fullClear, clearTimeMs, crystals: crystalsCollected, slot: layoutIndex, raw: rawLayout, member }).catch(() => undefined);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "error" });
  }
}

/** Badges from a recorded Tunnel run (score capped to what the run paid, clear time checked against the run). */
async function tunnelBadges(userId: string, pid: string, r: { score: number; fullClear: boolean; clearTimeMs: number; crystals: number; slot: number | null; raw: number | null; member: string }) {
  const award: string[] = [];
  const counters: BadgeOp[] = [{ key: "tunnel.runs", op: "add" }, { key: "tunnel.crystals", op: "add", by: Math.min(200, Math.max(0, Math.floor(r.crystals))) }];
  if (r.slot !== null) counters.push({ key: "tunnel.layouts", op: "distinct", item: String(r.slot) });
  if (r.fullClear) {
    award.push("tunnel.clear");
    if (r.clearTimeMs > 0 && r.clearTimeMs < 40_000) award.push("tunnel.swift");
    if (r.clearTimeMs > 0 && r.clearTimeMs < 25_000) award.push("tunnel.lightning");
    if (r.raw === TUNNEL_LAYOUT_COUNT - 1) award.push("tunnel.boss");
  }
  if (r.score >= 250) award.push("tunnel.crumb");
  if (r.score >= 1000) award.push("tunnel.sugar");
  if (r.score >= 3000) award.push("tunnel.crystal");
  if (r.score >= 4500) award.push("tunnel.emperor");
  if (r.score >= 5000) award.push("tunnel.perfect");
  if (r.slot !== null && r.score > 0 && (await redis.zrevrank("tunnel:layout:" + r.slot + ":scores", r.member).catch(() => null)) === 0) {
    const topKey = "ra:badge:tunneltops:" + userId;
    await redis.sadd(topKey, String(r.slot));
    counters.push({ key: "tunnel.tops", op: "max", by: Number(await redis.scard(topKey)) || 1 });
  }
  await sendBadges([resultEvent(userId, "tunnel", { award, counters, context: { score: r.score } })]);
}
