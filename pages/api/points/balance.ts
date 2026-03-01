// pages/api/points/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

// ✅ Match earn.ts EXACTLY: daily earned key is date-based
function todayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:earned:${playerId}:${yyyy}-${mm}-${dd}`;
}

// ✅ Back-compat fallback (older key if it exists)
function legacyEarnedTodayKey(playerId: string) {
  return `ra:points:earnedToday:${playerId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 🚫 IMPORTANT: never cache balances (prevents “random 30000”)
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const pid = String(req.query.playerId || "guest").trim().slice(0, 64) || "guest";

    const balRaw = await redis.get<number>(balKey(pid));
    const balance = Number(balRaw || 0);

    // ✅ Read the SAME key earn.ts writes to
    const earnedRaw = await redis.get<number>(todayKey(pid));
    let earnedToday = Number(earnedRaw || 0);

    // ✅ If nothing there, fall back to legacy key (just in case)
    if (!earnedToday) {
      const legacyRaw = await redis.get<number>(legacyEarnedTodayKey(pid));
      const legacyVal = Number(legacyRaw || 0);
      if (legacyVal > 0) earnedToday = legacyVal;
    }

    return res.status(200).json({ playerId: pid, balance, earnedToday });
  } catch (err: any) {
    console.error("balance error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
