// pages/api/points/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function earnedTodayKey(playerId: string) {
  return `ra:points:earnedToday:${playerId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 🚫 IMPORTANT: never cache balances (prevents “random 30000”)
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const pid = String(req.query.playerId || "guest").trim().slice(0, 64) || "guest";

    const balRaw = await redis.get<number>(balKey(pid));
    const balance = Number(balRaw || 0);

    const earnedRaw = await redis.get<number>(earnedTodayKey(pid));
    const earnedToday = Number(earnedRaw || 0);

    return res.status(200).json({ playerId: pid, balance, earnedToday });
  } catch (err: any) {
    console.error("balance error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
