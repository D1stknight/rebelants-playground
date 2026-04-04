import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const PLAYER_NAMES = "ra:player_names_v1";

// Tunnel-only leaderboard keys
const TUNNEL_LB_SCORE = "ra:tunnel:lb:score:alltime";
const TUNNEL_LB_FASTEST_CLEAR = "ra:tunnel:lb:fastest_clear";

function tunnelStatsKey(playerId: string) {
  return `ra:tunnel:stats:${playerId}`;
}

function cleanPlayerId(v: any) {
  return String(v || "guest").trim().slice(0, 64) || "guest";
}

function parseZRows(z: any[]) {
  if (!Array.isArray(z)) return [];

  if (z.length && typeof z[0] === "object" && z[0]?.member != null) {
    return z.map((x: any) => ({
      playerId: String(x.member),
      score: Number(x.score || 0),
    }));
  }

  const out: Array<{ playerId: string; score: number }> = [];
  for (let i = 0; i < z.length; i += 2) {
    out.push({
      playerId: String(z[i]),
      score: Number(z[i + 1] || 0),
    });
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const playerId = cleanPlayerId(req.query.playerId);
    const topN = Math.min(25, Math.max(5, Number(req.query.top || 5)));

    const [scoreRowsRaw, fastestRowsRaw, statsRaw] = await Promise.all([
      redis.zrange(TUNNEL_LB_SCORE, 0, topN - 1, { rev: true, withScores: true }),
      redis.zrange(TUNNEL_LB_FASTEST_CLEAR, 0, topN - 1, { rev: true, withScores: true }),
      redis.hgetall<Record<string, string>>(tunnelStatsKey(playerId)),
    ]);

    const scoreRows = parseZRows(scoreRowsRaw);
    const fastestRows = parseZRows(fastestRowsRaw);

    const allIds = Array.from(
      new Set(
        [...scoreRows, ...fastestRows]
          .map((x) => String(x.playerId || "").trim())
          .filter(Boolean)
      )
    );

    const namePairs = await Promise.all(
      allIds.map(async (id) => {
        try {
          const n = await redis.hget(PLAYER_NAMES, id);
          return [id, n ? String(n) : "guest"] as const;
        } catch {
          return [id, "guest"] as const;
        }
      })
    );

    const nameMap = Object.fromEntries(namePairs) as Record<string, string>;

    const topScore = scoreRows.map((row, idx) => ({
      rank: idx + 1,
      playerId: row.playerId,
      playerName: nameMap[row.playerId] || "guest",
      score: Number(row.score || 0),
    }));

    const fastestClear = fastestRows.map((row, idx) => ({
      rank: idx + 1,
      playerId: row.playerId,
      playerName: nameMap[row.playerId] || "guest",
      clearTimeMs: Math.abs(Number(row.score || 0)),
    }));

    const personalStats = {
      playerId,
      playerName: String(statsRaw?.playerName || nameMap[playerId] || "guest"),
      bestScore: Number(statsRaw?.bestScore || 0),
      bestClearTimeMs: Number(statsRaw?.bestClearTimeMs || 0),
      totalRuns: Number(statsRaw?.totalRuns || 0),
      totalCrystals: Number(statsRaw?.totalCrystals || 0),
    };

    // Layout champions — #1 score per layout
  const layoutChampions: {layoutIndex:number;layoutName:string;playerId:string;playerName:string;score:number}[] = [];
  try {
    const LN: string[] = ["Split Path","Narrow Spine","Broken Cross","Double Fork","Ring Cut","Maze Teeth","Cracked Chamber","Death Lanes","Twin Corridors","Spiral Trap","Pincer","Catacomb","River","Fortress","Zipper","Labyrinth","Cross Fire","The Trap","Checkers","Spine","Corridor Wars","Diamond","Snake Pit","Pillars","Archipelago","Cascade","Honeycomb","Staircase","Vortex","Final Boss"];
    for (let idx = 0; idx < 30; idx++) {
      const top = await redis.zrange(`tunnel:layout:${idx}:scores`, 0, 0, { rev: true, withScores: true });
      if (Array.isArray(top) && top.length >= 2) {
        const [pid, pname] = String(top[0]).split('|');
        layoutChampions.push({ layoutIndex: idx, layoutName: LN[idx]||'Layout '+(idx+1), playerId: pid||'', playerName: pname||pid||'', score: Number(top[1]) });
      } else {
        layoutChampions.push({ layoutIndex: idx, layoutName: LN[idx]||'Layout '+(idx+1), playerId: '', playerName: '', score: 0 });
      }
    }
  } catch {}

  return res.status(200).json({
      ok: true,
      topScore,
      fastestClear,
      personalStats,
    });
  } catch (e: any) {
    console.error("tunnel leaderboard error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
