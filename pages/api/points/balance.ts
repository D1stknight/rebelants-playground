// pages/api/points/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const playerId = String(req.query.playerId || "guest").trim() || "guest";
    const balRaw = await redis.get<number>(balKey(playerId));
    const balance = Number(balRaw || 0);

    return res.status(200).json({ playerId, balance });
  } catch (err: any) {
    console.error("balance error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
