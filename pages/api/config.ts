// pages/api/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../lib/server/redis";
import { pointsConfig as DEFAULTS } from "../../lib/pointsConfig";

const KEY = "ra:config:economy";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
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
    };

    return res.status(200).json({ ok: true, pointsConfig: merged });
  } catch (e: any) {
    console.error("config error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
