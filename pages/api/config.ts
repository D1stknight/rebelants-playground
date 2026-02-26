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
  prizePools: {
    ...(DEFAULTS as any).prizePools,
    ...(parsed?.prizePools || {}),
    none: [
      ...(((DEFAULTS as any).prizePools?.none ?? []) as any[]),
      ...(((parsed as any)?.prizePools?.none ?? []) as any[]),
    ],
    common: [
      ...(((DEFAULTS as any).prizePools?.common ?? []) as any[]),
      ...(((parsed as any)?.prizePools?.common ?? []) as any[]),
    ],
    rare: [
      ...(((DEFAULTS as any).prizePools?.rare ?? []) as any[]),
      ...(((parsed as any)?.prizePools?.rare ?? []) as any[]),
    ],
    ultra: [
      ...(((DEFAULTS as any).prizePools?.ultra ?? []) as any[]),
      ...(((parsed as any)?.prizePools?.ultra ?? []) as any[]),
    ],
  },
};

    return res.status(200).json({ ok: true, pointsConfig: merged });
  } catch (e: any) {
    console.error("config error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
