import type { NextApiRequest, NextApiResponse } from "next";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const playerName = String(body.playerName || "guest").trim().slice(0, 40) || "guest";
    const score = Math.max(0, Number(body.score || 0));
    const fullClear = !!body.fullClear;
    const clearTimeMs = Math.max(0, Number(body.clearTimeMs || 0));
    const crystalsCollected = Math.max(0, Number(body.crystalsCollected || 0));
    const layoutIndex = typeof body.layoutIndex === "number" ? body.layoutIndex : null;
    const layoutName = typeof body.layoutName === "string" ? body.layoutName : "";

    // Member string includes layoutName for display in leaderboards
    const member = `${playerId}|${playerName}|${layoutName}`;

    // Update personal stats
    await redis.hset(`tunnel:player:${playerId}:stats`, { playerName, totalRuns: 0 });
    await redis.hincrby(`tunnel:player:${playerId}:stats`, "totalRuns", 1);
    await redis.hincrby(`tunnel:player:${playerId}:stats`, "totalCrystals", crystalsCollected);
    if (score > 0) {
      const prevBest = Number(await redis.hget(`tunnel:player:${playerId}:stats`, "bestScore") || 0);
      if (score > prevBest) {
        await redis.hset(`tunnel:player:${playerId}:stats`, { bestScore: score });
      }
    }

    // Global top score leaderboard
    if (score > 0) {
      await redis.zadd("tunnel:top:score", { score, member });
    }

    // Fastest clear leaderboard
    if (fullClear && clearTimeMs > 0) {
      // Lower time = better, so store as negative
      const prevFastest = await redis.zscore("tunnel:top:clear", member);
      if (prevFastest === null || clearTimeMs < -prevFastest) {
        await redis.zadd("tunnel:top:clear", { score: -clearTimeMs, member });
        await redis.hset(`tunnel:player:${playerId}:stats`, { bestClearTimeMs: clearTimeMs });
      }
    }

    // Layout-specific top score
    if (layoutIndex !== null && score > 0) {
      await redis.zadd(`tunnel:layout:${layoutIndex}:scores`, { score, member });
    }

    // Track layouts explored by this player
    if (layoutIndex !== null) {
      await redis.sadd(`tunnel:player:${playerId}:explored`, String(layoutIndex));
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
