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
};

function normalizeIncoming(body: any) {
  // accept either {pointsConfig:{...}} or flat {...}
  const src = body?.pointsConfig ?? body ?? {};

  return {
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
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method === "GET") {
      const raw = await redis.get(KEY);

      let parsed: any = null;
      if (raw) {
        try {
          parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          parsed = null;
        }
      }

      const merged = { ...DEFAULTS, ...(parsed || {}) };
      return res.status(200).json({ ok: true, pointsConfig: merged });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const next = normalizeIncoming(body);

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
