// pages/api/admin/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const KEY = "ra:config:economy";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAuthed(req: NextApiRequest) {
  // accept either header name
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";

  // accept either env var name
  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";

  if (!expected) return false;
  return !!provided && provided === expected;
}

const DEFAULTS = {
  shuffleCost: 500,
  dailyClaim: 200,
  dailyEarnCap: 500,
  currency: "REBEL",
  rewards: { none: 0, common: 50, rare: 100, ultra: 200 },

  // ✅ Pro Odds (weights) — Admin editable
  // NOTE: these do NOT have to add to 100
  rarityWeights: { none: 45, common: 37, rare: 15, ultra: 3 },

  // ✅ Rare merch chance (decimal) — 0.01 = 1%
  rareMerchChance: 0.01,

  // ✅ Prize pools per rarity (future use)
  prizePools: {
    none: [{ type: "NONE", label: "Nothing this time", points: 0 }],
    common: [{ type: "POINTS", label: "50 REBEL", points: 50 }],
    rare: [{ type: "POINTS", label: "100 REBEL", points: 100 }],
    ultra: [{ type: "POINTS", label: "200 REBEL", points: 200 }],
  },

  // ✅ Ultra min reward fallback
  ultraMinReward: 50,
};

function safeNum(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (req.method === "GET") {
  const raw = await redis.get(KEY);
  const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};

   const merged = {
    ...DEFAULTS,
    ...(parsed || {}),
    rewards: {
      ...DEFAULTS.rewards,
      ...(parsed as any)?.rewards,
    },

    // ✅ keep Pro Odds + Rare merch chance if saved
    rarityWeights: {
      ...DEFAULTS.rarityWeights,
      ...(parsed as any)?.rarityWeights,
    },
    rareMerchChance: safeNum((parsed as any)?.rareMerchChance, DEFAULTS.rareMerchChance),

    prizePools: {
      ...DEFAULTS.prizePools,
      ...(parsed as any)?.prizePools,
      none: Array.isArray((parsed as any)?.prizePools?.none) ? (parsed as any).prizePools.none : DEFAULTS.prizePools.none,
      common: Array.isArray((parsed as any)?.prizePools?.common) ? (parsed as any).prizePools.common : DEFAULTS.prizePools.common,
      rare: Array.isArray((parsed as any)?.prizePools?.rare) ? (parsed as any).prizePools.rare : DEFAULTS.prizePools.rare,
      ultra: Array.isArray((parsed as any)?.prizePools?.ultra) ? (parsed as any).prizePools.ultra : DEFAULTS.prizePools.ultra,
    },
  };

  return res.status(200).json({ ok: true, pointsConfig: merged });
}
   if (req.method === "POST") {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  // ✅ accept BOTH shapes:
  // 1) { pointsConfig: {...} }  (admin.tsx sends this)
  // 2) { shuffleCost, dailyClaim, ... } (flat)
  const src = body?.pointsConfig ?? body ?? {};

const rawRareMerch = Number(src?.rareMerchChance ?? DEFAULTS.rareMerchChance);
const rareMerchDecimal = Number.isFinite(rawRareMerch)
  ? (rawRareMerch > 1 ? rawRareMerch / 100 : rawRareMerch) // if 100 => 1.0
  : DEFAULTS.rareMerchChance;

 const next = {
  shuffleCost: Number(src?.shuffleCost ?? DEFAULTS.shuffleCost),
  dailyClaim: Number(src?.dailyClaim ?? DEFAULTS.dailyClaim),
  dailyEarnCap: Number(src?.dailyEarnCap ?? DEFAULTS.dailyEarnCap),
  currency: String(src?.currency ?? DEFAULTS.currency),

  rewards: {
    none: Number(src?.rewards?.none ?? DEFAULTS.rewards.none),
    common: Number(src?.rewards?.common ?? DEFAULTS.rewards.common),
    rare: Number(src?.rewards?.rare ?? DEFAULTS.rewards.rare),
    ultra: Number(src?.rewards?.ultra ?? DEFAULTS.rewards.ultra),
  },

  // ✅ Pro Odds (weights) — SAVE THEM
  rarityWeights: {
    none: safeNum(src?.rarityWeights?.none, DEFAULTS.rarityWeights.none),
    common: safeNum(src?.rarityWeights?.common, DEFAULTS.rarityWeights.common),
    rare: safeNum(src?.rarityWeights?.rare, DEFAULTS.rarityWeights.rare),
    ultra: safeNum(src?.rarityWeights?.ultra, DEFAULTS.rarityWeights.ultra),
  },

  // ✅ Rare merch chance — SAVE IT (clamp 0..1)
  rareMerchChance: clamp(
    safeNum(src?.rareMerchChance, DEFAULTS.rareMerchChance),
    0,
    1
  ),

  // ✅ ultraMinReward (must be >= 1)
  ultraMinReward: Math.max(
    1,
    Number(src?.ultraMinReward ?? DEFAULTS.ultraMinReward ?? 50)
  ),

  prizePools: {
    none: Array.isArray(src?.prizePools?.none) ? src.prizePools.none : DEFAULTS.prizePools.none,
    common: Array.isArray(src?.prizePools?.common) ? src.prizePools.common : DEFAULTS.prizePools.common,
    rare: Array.isArray(src?.prizePools?.rare) ? src.prizePools.rare : DEFAULTS.prizePools.rare,
    ultra: Array.isArray(src?.prizePools?.ultra) ? src.prizePools.ultra : DEFAULTS.prizePools.ultra,
  },
};
  await redis.set(KEY, JSON.stringify(next));
  return res.status(200).json({ ok: true, pointsConfig: next });
}

    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    console.error("admin/config error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
