// pages/api/points/spend.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { playerId, amount } = (req.body ?? {}) as {
      playerId?: string;
      amount?: number;
    };

    const pid = (playerId || "guest").trim() || "guest";
    const amt = Number(amount || 0);

    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const key = balKey(pid);
    const balRaw = await redis.get<number>(key);
    const balance = Number(balRaw || 0);

    if (balance < amt) {
      return res.status(200).json({ ok: false, playerId: pid, balance, spent: 0 });
    }

    const newBalance = await redis.incrby(key, -amt);
    return res.status(200).json({ ok: true, playerId: pid, balance: Number(newBalance || 0), spent: amt });
  } catch (err: any) {
    console.error("spend error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
