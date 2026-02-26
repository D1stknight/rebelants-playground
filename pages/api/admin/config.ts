// pages/api/admin/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const KEY = "ra:config:economy";

function isAuthed(req: NextApiRequest) {
  const key = req.headers["x-admin-key"];
  const provided = Array.isArray(key) ? key[0] : key;
  return provided && process.env.ADMIN_KEY && provided === process.env.ADMIN_KEY;
}

const DEFAULTS = {
  shuffleCost: 500,
  dailyClaim: 200,
  dailyEarnCap: 500,
  currency: "REBEL",
  rewards: { none: 0, common: 50, rare: 100, ultra: 200 },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method === "GET") {
      const raw = await redis.get(KEY);
      if (!raw) return res.status(200).json({ ok: true, config: DEFAULTS });

      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return res.status(200).json({ ok: true, config: { ...DEFAULTS, ...parsed } });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

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
      };

      await redis.set(KEY, JSON.stringify(next));
      return res.status(200).json({ ok: true, config: next });
    }

    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    console.error("admin/config error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
