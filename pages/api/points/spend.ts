// pages/api/points/spend.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";

// IMPORTANT:
// This must match whatever key your /api/config + /api/admin/config use.
// If your /api/config reads a different key, change this ONE constant to match it.
const CONFIG_KEY = "ra:points:config";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

async function getLivePointsConfig() {
  // Start with defaults, then override from Redis (Admin saved config)
  const saved = await redis.get<any>(CONFIG_KEY);
  if (!saved) return defaultPointsConfig;

  // saved might be { shuffleCost, rewards, ... } etc.
  return {
    ...defaultPointsConfig,
    ...saved,
    rewards: {
      ...defaultPointsConfig.rewards,
      ...(saved.rewards || {}),
    },
    prizePools: saved.prizePools || (defaultPointsConfig as any).prizePools,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 🚫 never cache
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const amount = Number(body.amount || 0);

    // optional: tell server WHY we are spending (lets us enforce rules safely)
    const reason = String(body.reason || "").trim(); // ex: "shuffle"

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // ✅ LIVE config (Admin overrides)
    const liveCfg = await getLivePointsConfig();

    // ✅ Server-side enforcement (prevents client cheating)
    // If this spend is for shuffle, amount MUST equal live shuffleCost.
    if (reason === "shuffle") {
      const liveCost = Number(liveCfg.shuffleCost || 0);
      if (!Number.isFinite(liveCost) || liveCost <= 0) {
        return res.status(500).json({ ok: false, error: "Invalid live shuffleCost config" });
      }
      if (amount !== liveCost) {
        return res.status(400).json({
          ok: false,
          error: `Invalid shuffle cost. Expected ${liveCost}, got ${amount}`,
          expected: liveCost,
          got: amount,
        });
      }
    }

    const key = balKey(playerId);
    const balRaw = await redis.get<number>(key);
    const bal = Number(balRaw || 0);

    if (bal < amount) {
      return res.status(400).json({
        ok: false,
        error: "Insufficient balance",
        balance: bal,
        need: amount,
      });
    }

    const newBalance = await redis.incrby(key, -amount);

    return res.status(200).json({
      ok: true,
      playerId,
      spent: amount,
      balance: Number(newBalance || 0),
    });
  } catch (err: any) {
    console.error("spend error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
