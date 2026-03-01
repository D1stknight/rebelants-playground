// pages/api/admin/grant.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAdmin(req: NextApiRequest) {
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";

  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  if (!expected) return false;
  return !!provided && provided === expected;
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function lbBalanceKey() {
  return `ra:lb:balance`;
}

function walletToPlayerKey(wallet: string) {
  return `ra:shop:walletToPlayer:${wallet.toLowerCase()}`;
}

function cleanWallet(v: any) {
  return String(v || "").trim().toLowerCase();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { playerId, walletAddress, amount } = (body ?? {}) as {
      playerId?: string;
      walletAddress?: string;
      amount?: number;
    };

    const amt = Number(amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // ✅ Choose target: walletAddress > playerId
    let pid = (playerId || "").trim().slice(0, 64);

    const w = cleanWallet(walletAddress);
    if (w) {
      const mapped = await redis.get<string>(walletToPlayerKey(w));
      if (!mapped) {
        return res.status(400).json({
          ok: false,
          error: "Wallet is not linked to a player yet (no purchases claimed).",
        });
      }
      pid = String(mapped).trim().slice(0, 64);
    }

    pid = pid || "guest";

    const newBalance = await redis.incrby(balKey(pid), amt);

    // balance leaderboard (visibility only; NOT top earners)
    await redis.zadd(lbBalanceKey(), { score: Number(newBalance || 0), member: pid });

    return res.status(200).json({
      ok: true,
      playerId: pid,
      walletAddress: w || undefined,
      added: amt,
      balance: Number(newBalance || 0),
      note: "Grant affects balance. Top Earners uses total earned from gameplay, not grants.",
    });
  } catch (err: any) {
    console.error("admin grant error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
