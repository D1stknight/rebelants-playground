// pages/api/points/spend.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function capBankKey(playerId: string) {
  return `ra:points:capbank:${playerId}`;
}

function spentTodayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:spent:${playerId}:${yyyy}-${mm}-${dd}`;
}

// ✅ Reads the SAME live config that Admin saves, with safe fallbacks
async function getLivePointsConfig() {
 const keysToTry = [
  "ra:config:economy", // ✅ the key Admin actually writes
  "ra:points:config",
  "ra:config:points",
  "ra:pointsConfig",
  "ra:config",
];

  const normalize = (raw: any) => {
    // ✅ If redis returns JSON as a string, parse it
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    // ✅ If it's already an object, use it
    if (raw && typeof raw === "object") return raw;

    return null;
  };

  for (const k of keysToTry) {
    const raw = await redis.get<any>(k);
    const v = normalize(raw);
    if (!v) continue;

    // ✅ If stored as wrapper: { ok:true, pointsConfig:{...} }
    const cfg =
      (v as any).pointsConfig && typeof (v as any).pointsConfig === "object"
        ? (v as any).pointsConfig
        : v;

    const merged = { ...defaultPointsConfig, ...cfg };

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
    const expectedTunnelCost = 200;

    // ✅ Shuffle uses live configured cost
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

    // ✅ Tunnel uses fixed cost for now
    if (reason === "tunnel") {
      const got = Number(amountRaw || 0);
      if (!Number.isFinite(got) || got !== expectedTunnelCost) {
        return res.status(400).json({
          ok: false,
          error: `Invalid tunnel cost. Expected ${expectedTunnelCost}, got ${got}`,
          expected: expectedTunnelCost,
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

       // ✅ Shared play-cap enforcement for all gameplay spends
    let spentToday = 0;
    let capBank = 0;
    let dailyCap = Number(liveCfg.dailyEarnCap || 0);
    let remainingDaily = dailyCap;
    let totalPlayRoom = dailyCap;

    if (reason === "shuffle" || reason === "tunnel") {
      const spentRaw = await redis.get<number>(spentTodayKey(playerId));
      spentToday = Number(spentRaw || 0);

      const capBankRaw = await redis.get<number>(capBankKey(playerId));
      capBank = Number(capBankRaw || 0);

      remainingDaily = Math.max(0, dailyCap - spentToday);
      totalPlayRoom = remainingDaily + capBank;

      if (amt > totalPlayRoom) {
        return res.status(400).json({
          ok: false,
          error: "No play room left today",
          balance: bal,
          spentToday,
          dailyCap,
          remainingDaily,
          capBank,
          totalPlayRoom,
        });
      }

      const useFromDaily = Math.min(amt, remainingDaily);
      const useFromBank = Math.max(0, amt - useFromDaily);

      if (useFromDaily > 0) {
        await redis.incrby(spentTodayKey(playerId), useFromDaily);
        await redis.expire(spentTodayKey(playerId), 60 * 60 * 48);
      }

      if (useFromBank > 0) {
        await redis.decrby(capBankKey(playerId), useFromBank);
      }

      const updatedSpentRaw = await redis.get<number>(spentTodayKey(playerId));
      spentToday = Number(updatedSpentRaw || 0);

      const updatedCapBankRaw = await redis.get<number>(capBankKey(playerId));
      capBank = Number(updatedCapBankRaw || 0);

      remainingDaily = Math.max(0, dailyCap - spentToday);
      totalPlayRoom = remainingDaily + capBank;
    }

    // Deduct balance
    const newBal = await redis.incrby(balKey(playerId), -amt);

       return res.status(200).json({
      ok: true,
      playerId,
      spent: amt,
      reason: reason || undefined,
      balance: Number(newBal || 0),
      spentToday,
      dailyCap,
      remainingDaily,
      capBank,
      totalPlayRoom,
      totalEarnRoom: totalPlayRoom,
    });
  } catch (err: any) {
    console.error("spend error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
