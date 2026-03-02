// pages/api/wins/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { recordWinForLeaderboards } from "../../../lib/server/leaderboards";

// ✅ keep your existing keys (do not break anything)
const LB_TOTAL_EARNED = "ra:lb:totalEarned";
const RECENT_WINS = "ra:wins:recent";

// ✅ ALSO write to the keys /api/leaderboard/summary is using
const LB_WINS = "ra:lb:wins";
const RECENT_WINS_LB = "ra:lb:recentWins";

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
    const playerName = String(body.playerName || "guest").trim().slice(0, 32) || "guest";
    const game = String(body.game || "shuffle").trim().slice(0, 32) || "shuffle";
    const rarity = String(body.rarity || "none").trim().slice(0, 16) || "none";

    const pointsAwardedRaw = Number(body.pointsAwarded || 0);
    const pointsAwarded = Number.isFinite(pointsAwardedRaw) ? pointsAwardedRaw : 0;

    const prize = body.prize ?? null;

    const evt = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      game,
      playerId,
      playerName,
      rarity,
      pointsAwarded,
      prize,
    };

    // ✅ 1) Recent wins (your existing list)
    await redis.lpush(RECENT_WINS, JSON.stringify(evt));
    await redis.ltrim(RECENT_WINS, 0, 49);

    // ✅ 2) Recent wins (leaderboard summary expects THIS key)
    await redis.lpush(RECENT_WINS_LB, JSON.stringify(evt));
    await redis.ltrim(RECENT_WINS_LB, 0, 59);

    // ✅ 3) Wins leaderboard (leaderboard summary expects THIS zset)
    await redis.zincrby(LB_WINS, 1, playerId);

    // ✅ keep existing helper (in case other screens depend on it)
    // NOTE: pass evt so it uses the sanitized IDs (not raw body)
    await recordWinForLeaderboards(evt as any);

    // ✅ total earned leaderboard (only if points > 0) (keep your existing behavior)
    if (evt.pointsAwarded > 0) {
      await redis.zincrby(LB_TOTAL_EARNED, evt.pointsAwarded, playerId);
    }

    return res.status(200).json({ ok: true, event: evt });
  } catch (err: any) {
    console.error("wins/add error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
