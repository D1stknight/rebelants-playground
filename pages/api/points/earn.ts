// pages/api/points/earn.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";
import { addToEarnedTotal, updateBalanceLeaderboard } from "../../../lib/server/leaderboards";

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

// ✅ get LIVE config (Admin -> Redis) via /api/config, fallback to defaults
async function getLivePointsConfig(req: NextApiRequest) {
  try {
    const proto = (req.headers["x-forwarded-proto"] as string) || "http";
    const host = req.headers.host;
    const url = `${proto}://${host}/api/config`;

    const r = await fetch(url, { method: "GET", headers: { "Cache-Control": "no-store" } });
    const j: any = await r.json().catch(() => null);

    if (r.ok && j?.pointsConfig) {
      return { ...defaultPointsConfig, ...j.pointsConfig };
    }
  } catch (e) {
    // ignore; fallback below
  }
  return defaultPointsConfig;
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

    // ✅ Use LIVE cap from Admin/Redis
    const liveCfg = await getLivePointsConfig(req);
    const cap = Number((liveCfg as any).dailyEarnCap || 0);

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

    const newEarnedToday = await redis.incrby(earnedKey, toAdd);
    await redis.expire(earnedKey, 60 * 60 * 48);

    const newBalance = await redis.incrby(balKey(pid), toAdd);

// ✅ lifetime earned leaderboard (gameplay only)
await addToEarnedTotal(pid, toAdd);

// ✅ keep balance leaderboard accurate
await updateBalanceLeaderboard(pid, Number(newBalance || 0));
    
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
