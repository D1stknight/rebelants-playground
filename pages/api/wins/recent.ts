// pages/api/wins/recent.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { LB_RECENT_WINS } from "../../../lib/server/leaderboards";

function safeWin(x: any) {
  // Upstash can return list entries as:
  // - string JSON
  // - already-parsed object
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
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Math.max(1, Math.min(100, Number(limitRaw ?? 20) || 20));

  const list = await redis.lrange(LB_RECENT_WINS, 0, limit - 1);

  const wins = (list ?? []).map(safeWin).filter(Boolean);

  return res.status(200).json({ wins });
}
