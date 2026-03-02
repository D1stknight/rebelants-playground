// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { LB_WINS } from "../../../lib/server/leaderboards";

const RECENT_WINS_ZSET = "ra:lb:recentWins";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});

    const playerId = String(body.playerId || "guest");
    const playerName = String(body.playerName || "guest");
    const game = String(body.game || "shuffle");
    const rarity = String(body.rarity || "none");
    const pointsAwarded = Number(body.pointsAwarded || 0) || 0;

    const evt = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      game,
      playerId,
      playerName,
      rarity,
      pointsAwarded,
      prize: body.prize ?? null,
    };

    // ✅ Wins leaderboard (this already works)
    await redis.zincrby(LB_WINS, 1, playerId);

    // ✅ Recent wins as ZSET (replace LIST completely)
    await redis.zadd(RECENT_WINS_ZSET, {
      score: evt.ts,
      member: JSON.stringify(evt),
    });

    // keep only latest 50 (remove oldest)
    await redis.zremrangebyrank(RECENT_WINS_ZSET, 0, -51);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false });
  }
}
