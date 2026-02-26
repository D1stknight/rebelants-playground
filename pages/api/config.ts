// pages/api/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../lib/server/redis";
import { pointsConfig as defaults } from "../../lib/pointsConfig";

const CONFIG_KEY = "ra:config:points";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const raw = await redis.get<string>(CONFIG_KEY);
    const override = raw ? JSON.parse(raw) : null;

    // “override wins”, fallback to defaults
    const pointsConfig = override && typeof override === "object" ? override : defaults;

    return res.status(200).json({ ok: true, pointsConfig });
  } catch (err: any) {
    console.error("config error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
