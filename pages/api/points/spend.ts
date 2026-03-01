// pages/api/points/spend.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

// ✅ Reads the SAME live config that Admin saves, with safe fallbacks
async function getLivePointsConfig() {
  // ✅ Try a few likely keys + handle wrapped shapes { pointsConfig: {...} }
  const keysToTry = [
    "ra:points:config",
    "ra:config:points",
    "ra:pointsConfig",
    "ra:config", // some setups store everything here
  ];

  for (const k of keysToTry) {
    const v = await redis.get<any>(k);
    if (!v || typeof v !== "object") continue;

    // ✅ If stored as wrapper: { ok:true, pointsConfig:{...} }
    const cfg = (v as any).pointsConfig && typeof (v as any).pointsConfig === "object"
      ? (v as any).pointsConfig
      : v;

    const merged = { ...defaultPointsConfig, ...cfg };

    // ✅ Only accept if it actually contains a valid shuffleCost
    const sc = Number((merged as any).shuffleCost);
    if (Number.isFinite(sc) && sc > 0) return merged;
  }

  return defaultPointsConfig;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const amountRaw = body.amount;
    const reason = String(body.reason || "").trim();

    const liveCfg = await getLivePointsConfig();
    const expectedShuffleCost = Number(liveCfg.shuffleCost || 0);

    // ✅ If this is a shuffle spend, enforce live configured cost
    if (reason === "shuffle") {
      const got = Number(amountRaw || 0);
      if (!Number.isFinite(expectedShuffleCost) || expectedShuffleCost <= 0) {
        return res.status(500).json({ ok: false, error: "Invalid server shuffleCost config" });
      }
      if (!Number.isFinite(got) || got !== expectedShuffleCost) {
        return res.status(400).json({
          ok: false,
          error: `Invalid shuffle cost. Expected ${expectedShuffleCost}, got ${got}`,
          expected: expectedShuffleCost,
          got,
        });
      }
    }

    const amt = Number(amountRaw || 0);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // Current balance
    const balRaw = await redis.get<number>(balKey(playerId));
    const bal = Number(balRaw || 0);

    if (bal < amt) {
      return res.status(400).json({ ok: false, error: "Insufficient balance", balance: bal });
    }

    // Deduct
    const newBal = await redis.incrby(balKey(playerId), -amt);

    return res.status(200).json({
      ok: true,
      playerId,
      spent: amt,
      reason: reason || undefined,
      balance: Number(newBal || 0),
    });
  } catch (err: any) {
    console.error("spend error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
