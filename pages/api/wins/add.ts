// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { recordWinForLeaderboards } from "../../../lib/server/leaderboards";

const LB_TOTAL_EARNED = "ra:lb:totalEarned";
const RECENT_WINS = "ra:wins:recent";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = (req.body ?? {}) as any;

    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const playerName = String(body.playerName || "guest").trim().slice(0, 32) || "guest";
    const game = String(body.game || "shuffle").trim().slice(0, 32) || "shuffle";
    const rarity = String(body.rarity || "none").trim().slice(0, 16) || "none";
    const pointsAwardedRaw = Number(body.pointsAwarded || 0);
    const pointsAwarded = Number.isFinite(pointsAwardedRaw) ? pointsAwardedRaw : 0;
    const prize = body.prize ?? null; // optional: { type, label, ... }
    
   const evt = {
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  ts: Date.now(),
  game,
  playerId,
  playerName,
  rarity,
  pointsAwarded,
  prize, // ✅ optional (NFT/APE/merch/none)
};

    // recent wins (keep last 50)
    await redis.lpush(RECENT_WINS, JSON.stringify(evt));
    await redis.ltrim(RECENT_WINS, 0, 49);
    await recordWinForLeaderboards(body);
    
    // total earned leaderboard (only if points > 0)
    if (evt.pointsAwarded > 0) {
      await redis.zincrby(LB_TOTAL_EARNED, evt.pointsAwarded, playerId);
    }

    return res.status(200).json({ ok: true, event: evt });
  } catch (err: any) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
