import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const PLAYER_NAMES = "ra:player_names_v1";
const TUNNEL_LB_SCORE = "tunnel:top:score";
const TUNNEL_LB_FASTEST_CLEAR = "tunnel:top:clear";

function tunnelStatsKey(playerId: string) { return `ra:tunnel:stats:${playerId}`; }
function cleanPlayerId(v: any) { return String(v || "guest").trim().slice(0, 64) || "guest"; }

function parseZRows(z: any[]) {
  if (!Array.isArray(z)) return [];
  if (z.length && typeof z[0] === "object" && z[0]?.member != null) {
    return z.map((x: any) => ({ playerId: String(x.member), score: Number(x.score || 0) }));
  }
  const out: Array<{ playerId: string; score: number }> = [];
  for (let i = 0; i < z.length; i += 2) {
    out.push({ playerId: String(z[i]), score: Number(z[i + 1] || 0) });
  }
  return out;
}

function parseMember(raw: string) {
  const parts = raw.split("|");
  return { playerId: parts[0] || "guest", playerName: parts[1] || "guest", layoutName: parts[2] || "" };
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
    const statsRaw = await redis.hgetall<Record<string, string>>(tunnelStatsKey(playerId));

    // Layout names — 30 named + 1 bonus unnamed (#31)
    const LNAMES: string[] = [
      "Split Path","Narrow Spine","Broken Cross","Double Fork","Ring Cut","Maze Teeth",
      "Cracked Chamber","Death Lanes","Twin Corridors","Spiral Trap","Pincer","Catacomb",
      "River","Fortress","Zipper","Labyrinth","Cross Fire","The Trap","Checkers","Spine",
      "Corridor Wars","Diamond","Snake Pit","Pillars","Archipelago","Cascade","Honeycomb",
      "Staircase","Vortex","Final Boss"
    ];

    // For each layout fetch top 3 scores AND top 3 fastest clears
    const TOTAL_LAYOUTS = 31;
    const layoutChampions: {
      layoutIndex: number;
      layoutName: string;
      topScores: { rank: number; playerId: string; playerName: string; score: number }[];
      fastestClears: { rank: number; playerId: string; playerName: string; clearTimeMs: number }[];
    }[] = [];

    for (let idx = 0; idx < TOTAL_LAYOUTS; idx++) {
      const layoutName = LNAMES[idx] || "";
      const [scoresRaw, clearsRaw] = await Promise.all([
        redis.zrange(`tunnel:layout:${idx}:scores`, 0, 2, { rev: true, withScores: true }),
        redis.zrange(`tunnel:layout:${idx}:clears`, 0, 2, { rev: true, withScores: true }),
      ]);

      const scores = parseZRows(scoresRaw).map((row, i) => {
        const m = parseMember(row.playerId);
        return { rank: i + 1, playerId: m.playerId, playerName: m.playerName, score: Number(row.score) };
      });

      const clears = parseZRows(clearsRaw).map((row, i) => {
        const m = parseMember(row.playerId);
        return { rank: i + 1, playerId: m.playerId, playerName: m.playerName, clearTimeMs: Math.abs(Number(row.score)) };
      });

      layoutChampions.push({ layoutIndex: idx, layoutName, topScores: scores, fastestClears: clears });
    }

    // Layouts explored by current player
    let layoutsExplored = 0;
    if (playerId) {
      try {
        const explored = await redis.smembers(`tunnel:player:${playerId}:explored`);
        layoutsExplored = Array.isArray(explored) ? explored.length : 0;
      } catch {}
    }

    const personalStats = {
      playerId,
      playerName: String(statsRaw?.playerName || "guest"),
      bestScore: Number(statsRaw?.bestScore || 0),
      bestClearTimeMs: Number(statsRaw?.bestClearTimeMs || 0),
      totalRuns: Number(statsRaw?.totalRuns || 0),
      totalCrystals: Number(statsRaw?.totalCrystals || 0),
    };

    return res.status(200).json({ ok: true, layoutChampions, layoutsExplored, personalStats });
  } catch (e: any) {
    console.error("tunnel leaderboard error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
