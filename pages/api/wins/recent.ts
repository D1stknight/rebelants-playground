// pages/api/wins/recent.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const RECENT_WINS_ZSET = "ra:lb:recentWins";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = 20;

  const raw = await redis.zrange(
    RECENT_WINS_ZSET,
    0,
    limit - 1,
    { rev: true }
  );

  const wins =
    (raw || []).map((s: any) => {
      try {
        return JSON.parse(String(s));
      } catch {
        return null;
      }
    }).filter(Boolean);

  return res.status(200).json({ wins });
}
