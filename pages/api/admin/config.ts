import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig } from "../../../lib/pointsConfig";

function assertAdmin(req: NextApiRequest) {
  const key = req.headers["x-admin-key"];
  return typeof key === "string" && key.length > 0 && key === process.env.ADMIN_KEY;
}

const CONFIG_KEY = "ra:config:points";

type EconomyConfig = {
  shuffleCost: number;
  dailyClaim: number;
  dailyEarnCap: number;
  currency: string;
  rewards: {
    none: number;
    common: number;
    rare: number;
    ultra: number;
  };
};

function defaultConfig(): EconomyConfig {
  return {
    shuffleCost: pointsConfig.shuffleCost,
    dailyClaim: pointsConfig.dailyClaim,
    dailyEarnCap: pointsConfig.dailyEarnCap,
    currency: pointsConfig.currency,
    rewards: {
      none: pointsConfig.rewards.none,
      common: pointsConfig.rewards.common,
      rare: pointsConfig.rewards.rare,
      ultra: pointsConfig.rewards.ultra,
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!assertAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method === "GET") {
      const raw = await redis.get(CONFIG_KEY);
      if (!raw) return res.status(200).json({ ok: true, config: defaultConfig() });

      try {
        const parsed = JSON.parse(String(raw));
        return res.status(200).json({ ok: true, config: parsed });
      } catch {
        // if Redis got bad data somehow, fall back safely
        return res.status(200).json({ ok: true, config: defaultConfig(), warning: "Bad config in Redis; using defaults" });
      }
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const cfg: EconomyConfig = {
        shuffleCost: Number(body?.shuffleCost ?? pointsConfig.shuffleCost),
        dailyClaim: Number(body?.dailyClaim ?? pointsConfig.dailyClaim),
        dailyEarnCap: Number(body?.dailyEarnCap ?? pointsConfig.dailyEarnCap),
        currency: String(body?.currency ?? pointsConfig.currency),
        rewards: {
          none: Number(body?.rewards?.none ?? pointsConfig.rewards.none),
          common: Number(body?.rewards?.common ?? pointsConfig.rewards.common),
          rare: Number(body?.rewards?.rare ?? pointsConfig.rewards.rare),
          ultra: Number(body?.rewards?.ultra ?? pointsConfig.rewards.ultra),
        },
      };

      await redis.set(CONFIG_KEY, JSON.stringify(cfg));
      return res.status(200).json({ ok: true, config: cfg });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    console.error("admin/config error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
