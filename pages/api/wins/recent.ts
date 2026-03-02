// pages/api/wins/recent.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const RECENT_WINS_KEY = "ra:wins:recent";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limitRaw = Array.isArray(req.query.limit)
    ? req.query.limit[0]
    : req.query.limit;

  const limit = Math.max(1, Math.min(100, Number(limitRaw ?? 20) || 20));

  const list = await redis.lrange(RECENT_WINS_KEY, 0, limit - 1);

  const wins = (list ?? [])
    .map((s) => {
      try {
        return JSON.parse(String(s));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return res.status(200).json({ wins });
}
