import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

type Body = { playerId?: string; amount?: number };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const body = (req.body || {}) as Body;

    const playerId = (body.playerId || "guest").slice(0, 64);
    const amount = Number(body.amount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "bad_amount" });
    }

    const key = `points:balance:${playerId}`;
    const newBal = await redis.incrby(key, amount);

// Update global leaderboard (total earned)
await redis.zincrby("lb:earn", amount, playerId);

    res.status(200).json({ playerId, balance: newBal, delta: amount });
  } catch (e: any) {
    res.status(500).json({ error: "earn_failed", message: e?.message || "unknown" });
  }
}
