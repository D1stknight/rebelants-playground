// pages/api/points/spend.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

// Try a few possible keys (since your project evolved)
// This makes it robust even if the key name changed.
const CONFIG_KEYS = ["ra:points:config", "ra:config:points", "ra:pointsConfig", "ra:config"];

async function loadLivePointsConfig(): Promise<any> {
  for (const k of CONFIG_KEYS) {
    const v = await redis.get<any>(k);
    if (!v) continue;

    // Upstash can store objects or JSON strings depending on how it was saved
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        // might be {pointsConfig:{...}} or just {...}
        return parsed?.pointsConfig ?? parsed;
      } catch {
        // ignore parse failures
      }
    }

    if (typeof v === "object") {
      return (v as any)?.pointsConfig ?? v;
    }
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const amount = Number(body.amount || 0);
    const reason = String(body.reason || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // ✅ Load LIVE config from Redis, fallback to defaults
    const live = await loadLivePointsConfig();
    const pointsConfig = { ...defaultPointsConfig, ...(live || {}) };

    // ✅ Enforce live shuffle cost if reason=shuffle
    if (reason === "shuffle") {
      const expected = Number(pointsConfig.shuffleCost || 0);
      if (!Number.isFinite(expected) || expected <= 0) {
        return res.status(500).json({ ok: false, error: "Invalid shuffleCost config on server" });
      }
      if (amount !== expected) {
        return res.status(400).json({
          ok: false,
          error: `Invalid shuffle cost. Expected ${expected}, got ${amount}`,
          expected,
          got: amount,
        });
      }
    }

    // ✅ Check balance first
    const balNowRaw = await redis.get<number>(balKey(playerId));
    const balNow = Number(balNowRaw || 0);

    if (balNow < amount) {
      return res.status(400).json({ ok: false, error: "Insufficient balance", balance: balNow });
    }

    // ✅ Deduct
    const newBalance = await redis.incrby(balKey(playerId), -amount);

    return res.status(200).json({
      ok: true,
      playerId,
      balance: Number(newBalance || 0),
      spent: amount,
      reason: reason || undefined,
    });
  } catch (err: any) {
    console.error("spend error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
