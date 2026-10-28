// pages/api/admin/grant.ts
//
// Admin grant: adds points to a player's Rebel Economy account (the real ledger), not the old
// Playground Redis balance (ra:points:bal), which nothing reads any more.
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { economyCredit, resolveByPlayerId } from "../../../lib/economy";

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
    const { playerId, walletAddress, amount, requestId } = (body ?? {}) as {
      playerId?: string;
      walletAddress?: string;
      amount?: number;
      requestId?: string;
    };

    const amt = Math.floor(Number(amount || 0));
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // Target: walletAddress > playerId
    let pid = (playerId || "").trim().slice(0, 64);
    const w = cleanWallet(walletAddress);
    if (w) {
      const mapped = await redis.get<string>(walletToPlayerKey(w));
      pid = mapped ? String(mapped).trim().slice(0, 64) : "wallet:" + w;
    }
    if (!pid || pid.startsWith("guest")) {
      return res.status(400).json({ ok: false, error: "Pick a signed-in player (Discord, wallet or commander name)." });
    }

    const user = await resolveByPlayerId(pid);
    if (!user) return res.status(400).json({ ok: false, error: "That player has no Rebel Economy account yet." });

    const rid = String(requestId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || Date.now().toString(36);
    const r = await economyCredit({
      userId: user.userId,
      amount: amt,
      type: "earn",
      reason: "Playground admin grant",
      metadata: { playerId: pid, by: "playground-admin" },
      idempotencyKey: "pg:admingrant:" + user.userId + ":" + rid,
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: "The economy did not take the grant: " + (r.error || "unknown") });

    return res.status(200).json({
      ok: true,
      playerId: pid,
      userId: user.userId,
      walletAddress: w || undefined,
      added: amt,
      balance: r.balance,
      note: "Added to the player's Rebel Economy account (ledger).",
    });
  } catch (err: any) {
    console.error("admin grant error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
