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

  // ✅ NEW: prize pools per rarity (can be points, merch, NFT, APE, or nothing)
  prizePools: {
    none: [{ type: "NONE", label: "Nothing this time", points: 0 }],
    common: [{ type: "POINTS", label: "50 REBEL", points: 50 }],
    rare: [{ type: "POINTS", label: "100 REBEL", points: 100 }],
    ultra: [{ type: "POINTS", label: "200 REBEL", points: 200 }],
  },
};

function safeNum(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method === "GET") {
      const raw = await redis.get(KEY);
      const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      const merged = { ...DEFAULTS, ...(parsed || {}) };

      return res.status(200).json({ ok: true, pointsConfig: merged });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      // ✅ accept BOTH shapes:
      // 1) { pointsConfig: {...} }  (admin.tsx sends this)
      // 2) { shuffleCost, dailyClaim, ... } (flat)
      const src = body?.pointsConfig ?? body ?? {};

      const next = {
  shuffleCost: Number(body?.shuffleCost ?? DEFAULTS.shuffleCost),
  dailyClaim: Number(body?.dailyClaim ?? DEFAULTS.dailyClaim),
  dailyEarnCap: Number(body?.dailyEarnCap ?? DEFAULTS.dailyEarnCap),
  currency: String(body?.currency ?? DEFAULTS.currency),
  rewards: {
    none: Number(body?.rewards?.none ?? DEFAULTS.rewards.none),
    common: Number(body?.rewards?.common ?? DEFAULTS.rewards.common),
    rare: Number(body?.rewards?.rare ?? DEFAULTS.rewards.rare),
    ultra: Number(body?.rewards?.ultra ?? DEFAULTS.rewards.ultra),
  },

  // ✅ NEW: keep prize pools editable from admin
  prizePools: {
    none: Array.isArray(body?.prizePools?.none) ? body.prizePools.none : DEFAULTS.prizePools.none,
    common: Array.isArray(body?.prizePools?.common) ? body.prizePools.common : DEFAULTS.prizePools.common,
    rare: Array.isArray(body?.prizePools?.rare) ? body.prizePools.rare : DEFAULTS.prizePools.rare,
    ultra: Array.isArray(body?.prizePools?.ultra) ? body.prizePools.ultra : DEFAULTS.prizePools.ultra,
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
