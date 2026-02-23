import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

type Row = { playerId: string; totalEarned: number };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Math.max(1, Math.min(100, Number(limitRaw ?? 20) || 20));

  // Sorted set: lb:earn (member = playerId, score = total earned)
  const raw = await redis.zrange("lb:earn", 0, limit - 1, { rev: true, withScores: true });

  // Upstash can return tuples or flat arrays depending on runtime/config.
  const rows: Row[] = [];

  if (Array.isArray(raw)) {
    // tuple form: [ [member, score], [member, score] ... ]
    if (raw.length > 0 && Array.isArray(raw[0])) {
      for (const pair of raw as any[]) {
        const playerId = String(pair?.[0] ?? "");
        const totalEarned = Number(pair?.[1] ?? 0);
        if (playerId) rows.push({ playerId, totalEarned });
      }
    } else {
      // flat form: [member, score, member, score...]
      for (let i = 0; i < raw.length; i += 2) {
        const playerId = String((raw as any[])[i] ?? "");
        const totalEarned = Number((raw as any[])[i + 1] ?? 0);
        if (playerId) rows.push({ playerId, totalEarned });
      }
    }
  }

  return res.status(200).json({ rows });
}