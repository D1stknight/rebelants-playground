// pages/api/leaderboard/summary.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { LB_BALANCE, LB_EARNED, LB_WINS, LB_RECENT_WINS } from "../../../lib/server/leaderboards";

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
      redis.zrange("ra:lb:recentWins", 0, 24, { rev: true }),
    ]);

    const parseZ = (z: any[]) => {
      // Upstash returns [{member,score}] in some clients, or [member, score, member, score] in others.
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

    const safeJson = (s: string) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };

    return res.status(200).json({
      ok: true,
      balance: parseZ(bal),
      earned: parseZ(earned),
      wins: parseZ(wins),
      recentWins: (recent || []).map((x: any) => safeJson(String(x))).filter(Boolean),
    });
  } catch (e: any) {
    console.error("leaderboard summary error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
