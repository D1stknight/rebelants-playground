import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

type Win = {
  id: string;
  ts: number;
  game: string;
  playerId: string;
  playerName: string;
  rarity?: string;
  pointsAwarded?: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let win: Win | null = null;

  try {
    win = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  if (!win?.id || !win?.playerId || !win?.playerName) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Keep a rolling list of recent wins
  await redis.lpush("wins:recent", JSON.stringify(win));
  await redis.ltrim("wins:recent", 0, 99); // keep last 100

  return res.status(200).json({ ok: true });
}