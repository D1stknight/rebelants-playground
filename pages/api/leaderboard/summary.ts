// pages/api/leaderboard/summary.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { LB_BALANCE, LB_EARNED, LB_WINS, LB_RECENT_WINS } from "../../../lib/server/leaderboards";

const PLAYER_NAMES = "ra:player_names_v1"; // playerId -> last known display name

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const topN = Math.min(50, Math.max(5, Number(req.query.top || 15)));

    const [bal, earned, wins, recent] = await Promise.all([
      redis.zrange(LB_BALANCE, 0, topN - 1, { rev: true, withScores: true }),
      redis.zrange(LB_EARNED, 0, topN - 1, { rev: true, withScores: true }),
      redis.zrange(LB_WINS, 0, topN - 1, { rev: true, withScores: true }),
      redis.lrange(LB_RECENT_WINS, 0, 24),
    ]);

    const parseZ = (z: any[]) => {
      if (!Array.isArray(z)) return [];
      if (z.length && typeof z[0] === "object" && z[0]?.member != null) {
        return z.map((x: any) => ({ playerId: String(x.member), score: Number(x.score || 0) }));
      }
      const out: any[] = [];
      for (let i = 0; i < z.length; i += 2) {
        out.push({ playerId: String(z[i]), score: Number(z[i + 1] || 0) });
      }
      return out;
    };

    const safeWin = (x: any) => {
      // Upstash can return list entries as object already
      if (x == null) return null;
      if (typeof x === "object") return x;
      if (typeof x === "string") {
        try {
          return JSON.parse(x);
        } catch {
          return null;
        }
      }
      try {
        return JSON.parse(String(x));
      } catch {
        return null;
      }
    };

        const balanceRows = parseZ(bal);
    const earnedRows = parseZ(earned);
    const winsRows = parseZ(wins);

    // ✅ attach stored names (so we can show Discord names even after disconnect)
    const allIds = Array.from(
      new Set(
        [...balanceRows, ...earnedRows, ...winsRows]
          .map((x: any) => String(x?.playerId || "").trim())
          .filter(Boolean)
      )
    );

    const namePairs = await Promise.all(
      allIds.map(async (id) => {
        try {
          const n = await redis.hget(PLAYER_NAMES, id);
          return [id, n ? String(n) : ""] as const;
        } catch {
          return [id, ""] as const;
        }
      })
    );

    const nameMap = Object.fromEntries(namePairs) as Record<string, string>;

    const withNames = (rows: any[]) =>
      rows.map((r: any) => ({
        ...r,
        playerName: nameMap[String(r.playerId)] || undefined,
      }));

    return res.status(200).json({
      ok: true,
      balance: withNames(balanceRows),
      earned: withNames(earnedRows),
      wins: withNames(winsRows),
      recentWins: (recent || []).map(safeWin).filter(Boolean),
    });
  } catch (e: any) {
    console.error("leaderboard summary error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
