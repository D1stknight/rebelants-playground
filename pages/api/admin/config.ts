// pages/api/admin/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const KEY = "ra:config:economy";

function isAuthed(req: NextApiRequest) {
  const key = req.headers["x-admin-key"];
  const provided = Array.isArray(key) ? key[0] : key;
  return !!provided && !!process.env.ADMIN_KEY && provided === process.env.ADMIN_KEY;
}

const DEFAULTS = {
  shuffleCost: 500,
  dailyClaim: 200,
  dailyEarnCap: 500,
  currency: "REBEL",
  rewards: { none: 0, common: 50, rare: 100, ultra: 200 },
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
        shuffleCost: safeNum(src.shuffleCost, DEFAULTS.shuffleCost),
        dailyClaim: safeNum(src.dailyClaim, DEFAULTS.dailyClaim),
        dailyEarnCap: safeNum(src.dailyEarnCap, DEFAULTS.dailyEarnCap),
        currency: String(src.currency ?? DEFAULTS.currency),
        rewards: {
          none: safeNum(src.rewards?.none, DEFAULTS.rewards.none),
          common: safeNum(src.rewards?.common, DEFAULTS.rewards.common),
          rare: safeNum(src.rewards?.rare, DEFAULTS.rewards.rare),
          ultra: safeNum(src.rewards?.ultra, DEFAULTS.rewards.ultra),
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
