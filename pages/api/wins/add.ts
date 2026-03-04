// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { LB_WINS, LB_RECENT_WINS } from "../../../lib/server/leaderboards";

const PLAYER_NAMES = "ra:player_names_v1"; // playerId -> last known display name

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});

    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const playerName = String(body.playerName || "guest").trim().slice(0, 64) || "guest";
    const game = String(body.game || "shuffle").trim().slice(0, 32) || "shuffle";
    const rarity = String(body.rarity || "none").trim().slice(0, 16) || "none";
    const pointsAwardedRaw = Number(body.pointsAwarded || 0);
    const pointsAwarded = Number.isFinite(pointsAwardedRaw) ? pointsAwardedRaw : 0;

        const evt = {
      id: String(body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      ts: Number(body.ts || Date.now()),
      game,
      playerId,
      playerName,
      rarity,
      pointsAwarded,
      prize: body.prize ?? null,
    };

    // ✅ store last known display name for this playerId
    // (lets leaderboards show Discord names even after disconnect)
    await redis.hset(PLAYER_NAMES, { [playerId]: playerName });

       // ✅ Only record/count REAL wins (points or prize)
    const isRealWin = pointsAwarded > 0 || !!evt.prize;

    // ✅ wins count
    if (isRealWin) {
      await redis.zincrby(LB_WINS, 1, playerId);
    }

    // ✅ recent wins feed (skip 0 points + no prize)
    if (isRealWin) {
      await redis.lpush(LB_RECENT_WINS, JSON.stringify(evt));
      await redis.ltrim(LB_RECENT_WINS, 0, 49);
    }

    // ✅ notifications (Rule Set 1: ULTRA or real prize)
    try {
      const { notifyWinIfNeeded } = await import("../../../lib/server/notifyWins");
      await notifyWinIfNeeded(evt as any);
    } catch (e) {
      console.warn("notify failed:", e);
    }

    // 🔎 DEBUG: verify Redis sees it immediately
    const len = await redis.llen(LB_RECENT_WINS);
    const head = await redis.lrange(LB_RECENT_WINS, 0, 0);

    return res.status(200).json({
      ok: true,
      event: evt,
      debug: {
        LB_RECENT_WINS,
        recentLen: Number(len || 0),
        recentHead: head?.[0] ? String(head[0]).slice(0, 180) : null,
      },
    });
  } catch (err: any) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
