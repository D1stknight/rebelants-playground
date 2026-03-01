// pages/api/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../lib/server/redis";
import { pointsConfig as DEFAULTS } from "../../lib/pointsConfig";

const KEY = "ra:config:economy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
   // 🚫 never cache config fetches (prevents stale UI)
res.setHeader("Cache-Control", "no-store, max-age=0");
res.setHeader("Pragma", "no-cache");
res.setHeader("Expires", "0");

if (req.method !== "GET") {
  res.setHeader("Allow", "GET");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
    
    const raw = await redis.get(KEY);
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;

const merged = {
  ...DEFAULTS,
  ...(parsed || {}),
  rewards: {
    ...DEFAULTS.rewards,
    ...(parsed?.rewards || {}),
  },
  // ✅ IMPORTANT: do NOT append arrays (that keeps old default prizes like 50)
  // If admin saved a pool, that pool is the source of truth.
  prizePools: {
    none: Array.isArray((parsed as any)?.prizePools?.none)
      ? (parsed as any).prizePools.none
      : ((DEFAULTS as any).prizePools?.none ?? []),

    common: Array.isArray((parsed as any)?.prizePools?.common)
      ? (parsed as any).prizePools.common
      : ((DEFAULTS as any).prizePools?.common ?? []),

    rare: Array.isArray((parsed as any)?.prizePools?.rare)
      ? (parsed as any).prizePools.rare
      : ((DEFAULTS as any).prizePools?.rare ?? []),

    ultra: Array.isArray((parsed as any)?.prizePools?.ultra)
      ? (parsed as any).prizePools.ultra
      : ((DEFAULTS as any).prizePools?.ultra ?? []),
  },
};
    return res.status(200).json({ ok: true, pointsConfig: merged });
  } catch (e: any) {
    console.error("config error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
