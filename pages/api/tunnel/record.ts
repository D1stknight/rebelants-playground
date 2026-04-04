import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const PLAYER_NAMES = "ra:player_names_v1";

// Tunnel-only leaderboard keys
const TUNNEL_LB_SCORE = "ra:tunnel:lb:score:alltime";
const TUNNEL_LB_FASTEST_CLEAR = "ra:tunnel:lb:fastest_clear";

// Tunnel-only personal stats
function tunnelStatsKey(playerId: string) {
  return `ra:tunnel:stats:${playerId}`;
}

function cleanPlayerId(v: any) {
  return String(v || "guest").trim().slice(0, 64) || "guest";
}

function cleanPlayerName(v: any) {
  return String(v || "guest").trim().slice(0, 32) || "guest";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const playerId = cleanPlayerId(body?.playerId);
    const playerName = cleanPlayerName(body?.playerName);

    const score = Math.max(0, Number(body?.score || 0));
    const fullClear = !!body?.fullClear;
    const clearTimeMs = Number(body?.clearTimeMs || 0);
    const crystalsCollected = Math.max(0, Number(body?.crystalsCollected || 0));
    const layoutIndex = typeof body.layoutIndex === "number" ? body.layoutIndex : null;
    const layoutName = typeof body.layoutName === "string" ? String(body.layoutName) : "";

    if (!Number.isFinite(score)) {
      return res.status(400).json({ ok: false, error: "Invalid score" });
    }

    if (!Number.isFinite(clearTimeMs)) {
      return res.status(400).json({ ok: false, error: "Invalid clearTimeMs" });
    }

    if (!Number.isFinite(crystalsCollected)) {
      return res.status(400).json({ ok: false, error: "Invalid crystalsCollected" });
    }

    // save latest display name
    await redis.hset(PLAYER_NAMES, { [playerId]: playerName });

    const statsKey = tunnelStatsKey(playerId);

    // current personal stats
    const current = await redis.hgetall<Record<string, string>>(statsKey);

    const prevBestScore = Number(current?.bestScore || 0);
    const prevBestClearTimeMs = Number(current?.bestClearTimeMs || 0);
    const prevTotalRuns = Number(current?.totalRuns || 0);
    const prevTotalCrystals = Number(current?.totalCrystals || 0);

    const nextBestScore = Math.max(prevBestScore, score);

    let nextBestClearTimeMs = prevBestClearTimeMs;
    if (fullClear && clearTimeMs > 0) {
      if (prevBestClearTimeMs <= 0 || clearTimeMs < prevBestClearTimeMs) {
        nextBestClearTimeMs = clearTimeMs;
      }
    }

    const nextTotalRuns = prevTotalRuns + 1;
    const nextTotalCrystals = prevTotalCrystals + crystalsCollected;

    await redis.hset(statsKey, {
      playerId,
      playerName,
      bestScore: String(nextBestScore),
      bestClearTimeMs: String(nextBestClearTimeMs),
      totalRuns: String(nextTotalRuns),
      totalCrystals: String(nextTotalCrystals),
      updatedAt: String(Date.now()),
    });

    // all-time top score leaderboard
    await redis.zadd(TUNNEL_LB_SCORE, {
      score,
      member: playerId,
    });

    // fastest clear leaderboard (lower time is better, so store negative ms and sort desc later)
    if (fullClear && clearTimeMs > 0) {
      await redis.zadd(TUNNEL_LB_FASTEST_CLEAR, {
        score: -clearTimeMs,
        member: playerId,
      });
    }

    return res.status(200).json({
      ok: true,
      playerId,
      playerName,
      saved: true,
      score,
      fullClear,
      clearTimeMs,
      crystalsCollected,
      stats: {
        bestScore: nextBestScore,
        bestClearTimeMs: nextBestClearTimeMs,
        totalRuns: nextTotalRuns,
        totalCrystals: nextTotalCrystals,
      },
    });
  } catch (e: any) {
    console.error("tunnel record error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
    // Layout champion tracking
    if (layoutIndex !== null && score > 0) {
    const lMember = playerId + "|" + playerName + "|" + layoutName;
    await redis.zadd("tunnel:layout:" + layoutIndex + ":scores", { score: Number(score), member: lMember }).catch(() => {});
    }
    // Track layouts explored
    if (layoutIndex !== null) {
    await redis.sadd("tunnel:player:" + playerId + ":explored", String(layoutIndex)).catch(() => {});
    }


