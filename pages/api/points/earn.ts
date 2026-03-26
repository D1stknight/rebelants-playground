// pages/api/points/earn.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";
import { addToEarnedTotal, updateBalanceLeaderboard } from "../../../lib/server/leaderboards";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function capBankKey(playerId: string) {
  return `ra:points:capbank:${playerId}`;
}

function spentTodayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:spent:${playerId}:${yyyy}-${mm}-${dd}`;
}

// ✅ get LIVE config (Admin -> Redis) via /api/config, fallback to defaults
async function getLivePointsConfig(req: NextApiRequest) {
  try {
    const proto = (req.headers["x-forwarded-proto"] as string) || "http";
    const host = req.headers.host;
    const url = `${proto}://${host}/api/config`;

    const r = await fetch(url, {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });
    const j: any = await r.json().catch(() => null);

    if (r.ok && j?.pointsConfig) {
      return { ...defaultPointsConfig, ...j.pointsConfig };
    }
  } catch {
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

    // ✅ Rewards only increase BALANCE now
    const newBalance = await redis.incrby(balKey(pid), amt);

    // ✅ Keep lifetime earned leaderboard accurate
    await addToEarnedTotal(pid, amt);

    // ✅ Keep balance leaderboard accurate
    await updateBalanceLeaderboard(pid, Number(newBalance || 0));

    // ✅ Return play-cap info WITHOUT modifying it
    const spentRaw = await redis.get<number>(spentTodayKey(pid));
    const spentToday = Number(spentRaw || 0);

    const capBankRaw = await redis.get<number>(capBankKey(pid));
    const capBank = Number(capBankRaw || 0);

    const liveCfg = await getLivePointsConfig(req);
    const dailyCap = Number((liveCfg as any).dailyEarnCap || 0);
    const remainingDaily = Math.max(0, dailyCap - spentToday);
    const totalPlayRoom = remainingDaily + capBank;

    return res.status(200).json({
      ok: true,
      playerId: pid,
      added: amt,
      capped: false,
      balance: Number(newBalance || 0),
      earnedToday: spentToday,
      spentToday,
      dailyCap,
      remainingDaily,
      capBank,
      totalPlayRoom,
      totalEarnRoom: totalPlayRoom,
    });
  } catch (err: any) {
    console.error("earn error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
