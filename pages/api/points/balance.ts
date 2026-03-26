// pages/api/points/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function capBankKey(playerId: string) {
  return `ra:points:capbank:${playerId}`;
}

function capBankKey(playerId: string) {
  return `ra:points:capbank:${playerId}`;
}

// ✅ Match spend.ts EXACTLY: daily spent key is date-based
function todayKey(playerId: string) {
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
    // ignore
  }
  return defaultPointsConfig;
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

       // ✅ Read the SAME key spend.ts writes to
    const spentRaw = await redis.get<number>(todayKey(pid));
    const spentToday = Number(spentRaw || 0);

    const capBankRaw = await redis.get<number>(capBankKey(pid));
    const capBank = Number(capBankRaw || 0);

    const liveCfg = await getLivePointsConfig(req);
    const dailyCap = Number((liveCfg as any).dailyEarnCap || 0);
    const remainingDaily = Math.max(0, dailyCap - spentToday);
    const totalPlayRoom = remainingDaily + capBank;

    return res.status(200).json({
      playerId: pid,
      balance,
      earnedToday: spentToday,
      spentToday,
      capBank,
      dailyCap,
      remainingDaily,
      totalPlayRoom,
      totalEarnRoom: totalPlayRoom,
    });
  } catch (err: any) {
    console.error("balance error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
