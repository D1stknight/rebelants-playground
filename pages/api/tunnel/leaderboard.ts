import type { NextApiRequest, NextApiResponse } from "next";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const LAYOUT_NAMES = ["Split Path","Narrow Spine","Broken Cross","Double Fork","Ring Cut","Maze Teeth","Cracked Chamber","Death Lanes","Twin Corridors","Spiral Trap","Pincer","Catacomb","River","Fortress","Zipper","Labyrinth","Cross Fire","The Trap","Checkers","Spine","Corridor Wars","Diamond","Snake Pit","Pillars","Archipelago","Cascade","Honeycomb","Staircase","Vortex","Final Boss"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const playerId = String(req.query.playerId || "").trim();
  const top = Math.min(10, Math.max(1, Number(req.query.top || 5)));

  try {
    // Top scores
    const topScoreRaw = await redis.zrange("tunnel:top:score", 0, top - 1, { rev: true, withScores: true });
    const topScore = [];
    for (let i = 0; i < topScoreRaw.length; i += 2) {
      const member = String(topScoreRaw[i]);
      const score = Number(topScoreRaw[i + 1]);
      const parts = member.split("|");
      topScore.push({ rank: topScore.length + 1, playerId: parts[0] || "", playerName: parts[1] || parts[0] || "", layoutName: parts[2] || "", score });
    }

    // Fastest clears
    const fastestRaw = await redis.zrange("tunnel:top:clear", 0, top - 1, { withScores: true });
    const fastestClear = [];
    for (let i = 0; i < fastestRaw.length; i += 2) {
      const member = String(fastestRaw[i]);
      const clearTimeMs = Number(fastestRaw[i + 1]);
      const parts = member.split("|");
      fastestClear.push({ rank: fastestClear.length + 1, playerId: parts[0] || "", playerName: parts[1] || parts[0] || "", layoutName: parts[2] || "", clearTimeMs });
    }

    // Personal stats
    let personalStats = null;
    if (playerId) {
      try {
        const raw = await redis.hgetall(`tunnel:player:${playerId}:stats`);
        if (raw) {
          personalStats = {
            playerId,
            playerName: String(raw.playerName || ""),
            bestScore: Number(raw.bestScore || 0),
            bestClearTimeMs: Number(raw.bestClearTimeMs || 0),
            totalRuns: Number(raw.totalRuns || 0),
            totalCrystals: Number(raw.totalCrystals || 0),
          };
        }
      } catch {}
    }

    // Layouts explored
    let layoutsExplored = 0;
    if (playerId) {
      try {
        const explored = await redis.smembers(`tunnel:player:${playerId}:explored`);
        layoutsExplored = Array.isArray(explored) ? explored.length : 0;
      } catch {}
    }

    // Layout champions — #1 score holder per layout
    const layoutChampions: Array<{layoutIndex:number;layoutName:string;playerId:string;playerName:string;score:number}> = [];
    try {
      for (let idx = 0; idx < 30; idx++) {
        const top1 = await redis.zrange(`tunnel:layout:${idx}:scores`, 0, 0, { rev: true, withScores: true });
        if (Array.isArray(top1) && top1.length >= 2) {
          const parts = String(top1[0]).split("|");
          layoutChampions.push({ layoutIndex: idx, layoutName: LAYOUT_NAMES[idx] || `Layout ${idx+1}`, playerId: parts[0] || "", playerName: parts[1] || parts[0] || "", score: Number(top1[1]) });
        } else {
          layoutChampions.push({ layoutIndex: idx, layoutName: LAYOUT_NAMES[idx] || `Layout ${idx+1}`, playerId: "", playerName: "", score: 0 });
        }
      }
    } catch {}

    return res.status(200).json({ ok: true, topScore, fastestClear, personalStats, layoutsExplored, layoutChampions });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
