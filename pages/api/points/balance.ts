// pages/api/points/balance.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { etDay } from "../../../lib/server/day";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultPointsConfig } from "../../../lib/pointsConfig";
import { resolveByPlayerId } from "../../../lib/economy";
import { actingPlayer, isAdminRequest } from "../../../lib/server/player-auth";
import { syncPurchasedPlays } from "../../../lib/server/purchasedPlays";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function capBankKey(playerId: string) {
  return `ra:points:capbank:${playerId}`;
}

// ✅ Match spend.ts EXACTLY: daily spent key is date-based
function todayKey(playerId: string) {
  return `ra:points:spent:${playerId}:${etDay()}`;
}

// ✅ get LIVE config (Admin -> Redis) via /api/config, fallback to defaults
async function getLivePointsConfig(req: NextApiRequest) {
  try {
    const proto = (req.headers["x-forwarded-proto"] as string) || "http";
    const host = req.headers.host;
    const url = `${proto}://${host}/api/config`;

    const r = await fetch(url, {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });
    const j: any = await r.json().catch(() => null);

    if (r.ok && j?.pointsConfig) {
      return { ...defaultPointsConfig, ...j.pointsConfig };
    }
  } catch {
    // ignore
  }
  return defaultPointsConfig;
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

    const claimed = String(req.query.playerId || "guest").trim().slice(0, 64) || "guest";

        // Balance now comes from the central economy ledger (shared with
    // After Dark + Discord). Signed-in Discord users get their real
    // economy balance; guests (no Discord) see 0 until they sign in.
    // Only for the player a signed session proves (the admin page may look anyone up);
    // anyone else gets 0 and the sign-in that id needs.
    const admin = isAdminRequest(req);
    const who = admin ? null : await actingPlayer(req, claimed);
    const economyUser = admin ? await resolveByPlayerId(claimed) : who && who.ok ? who.user : null;
    const pid = who && who.ok ? who.playerId : claimed;
    const signIn = who && !who.ok ? who.signIn : null;
    const balance = economyUser ? economyUser.balance : 0;

    // points bought in the Rebel Economy shop add bonus plays here (like the old APE packs did)
    if (economyUser) await syncPurchasedPlays(pid, economyUser.userId).catch((e) => console.warn("bonus plays sync", e?.message || e));

       // ✅ Read the SAME key spend.ts writes to (nothing for a player no session proves)
    const spentRaw = economyUser ? await redis.get<number>(todayKey(pid)) : 0;
    const spentToday = Number(spentRaw || 0);

    const capBankRaw = economyUser ? await redis.get<number>(capBankKey(pid)) : 0;
    const capBank = Number(capBankRaw || 0);

    const liveCfg = await getLivePointsConfig(req);
    const dailyCap = Number((liveCfg as any).dailyEarnCap || 0);
    const remainingDaily = Math.max(0, dailyCap - spentToday);
    const totalPlayRoom = remainingDaily + capBank;

    return res.status(200).json({
      playerId: pid,
      balance,
      earnedToday: spentToday,
      spentToday,
      capBank,
      dailyCap,
      remainingDaily,
      totalPlayRoom,
      totalEarnRoom: totalPlayRoom,
      ...(signIn ? { signIn } : {}),
    });
  } catch (err: any) {
    console.error("balance error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
