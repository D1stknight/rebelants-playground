// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { LB_WINS, LB_RECENT_WINS } from "../../../lib/server/leaderboards";

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

    // Keep prize safe (optional)
    const prize = body?.prize && typeof body.prize === "object"
      ? {
          type: typeof body.prize.type === "string" ? body.prize.type : undefined,
          label: typeof body.prize.label === "string" ? body.prize.label : undefined,
          sku: typeof body.prize.sku === "string" ? body.prize.sku : undefined,
          tokenId:
            typeof body.prize.tokenId === "string" || typeof body.prize.tokenId === "number"
              ? String(body.prize.tokenId)
              : undefined,
          qty: typeof body.prize.qty === "number" ? body.prize.qty : undefined,
        }
      : null;

    const evt = {
      id: String(body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      ts: Number(body.ts || Date.now()),
      game,
      playerId,
      playerName,
      rarity,
      pointsAwarded,
      prize,
    };

    // ✅ 1) Wins leaderboard (counts ALL plays that call wins/add — even 0 pts)
    await redis.zincrby(LB_WINS, 1, playerId);

    // ✅ 2) Recent wins feed (THIS is what /api/leaderboard/summary reads)
    await redis.lpush(LB_RECENT_WINS, JSON.stringify(evt));
    await redis.ltrim(LB_RECENT_WINS, 0, 49);

    // 🚫 IMPORTANT: DO NOT update totalEarned here.
    // Total earned must ONLY come from /api/points/earn (and claim if you decide).

    return res.status(200).json({ ok: true, event: evt });
  } catch (err: any) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
