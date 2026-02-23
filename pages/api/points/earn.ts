// pages/api/points/earn.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig } from "../../../lib/pointsConfig";

function todayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:earned:${playerId}:${yyyy}-${mm}-${dd}`;
}

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

    // Enforce daily earn cap
    const cap = Number(pointsConfig.dailyEarnCap || 0);
    const earnedKey = todayKey(pid);

    const earnedTodayRaw = await redis.get<number>(earnedKey);
    const earnedToday = Number(earnedTodayRaw || 0);

    const remaining = Math.max(0, cap - earnedToday);
    const toAdd = Math.max(0, Math.min(amt, remaining));

    if (toAdd <= 0) {
      const balNowRaw = await redis.get<number>(balKey(pid));
      const balNow = Number(balNowRaw || 0);
      return res.status(200).json({
        ok: true,
        playerId: pid,
        added: 0,
        capped: true,
        earnedToday,
        cap,
        balance: balNow,
      });
    }

    // Update earned today + balance
    const newEarnedToday = await redis.incrby(earnedKey, toAdd);
    // keep the daily key around ~2 days so it naturally rotates
    await redis.expire(earnedKey, 60 * 60 * 48);

    const newBalance = await redis.incrby(balKey(pid), toAdd);

    return res.status(200).json({
      ok: true,
      playerId: pid,
      added: toAdd,
      capped: toAdd < amt,
      earnedToday: Number(newEarnedToday || 0),
      cap,
      balance: Number(newBalance || 0),
    });
  } catch (err: any) {
    console.error("earn error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
