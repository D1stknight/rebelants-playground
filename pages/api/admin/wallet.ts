// pages/api/admin/wallet.ts
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

function walletToPlayerKey(wallet: string) {
  return `ra:shop:walletToPlayer:${wallet.toLowerCase()}`;
}

function playerToWalletKey(playerId: string) {
  return `ra:shop:playerToWallet:${playerId}`;
}

function cleanWallet(v: any) {
  return String(v || "").trim().toLowerCase();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const walletAddress = cleanWallet(req.query.walletAddress);
    if (!walletAddress) {
      return res.status(400).json({ ok: false, error: "Missing walletAddress" });
    }

    const playerId = await redis.get<string>(walletToPlayerKey(walletAddress));
    if (!playerId) {
      return res.status(404).json({
        ok: false,
        error: "No player linked to this wallet yet (no claimed purchase).",
      });
    }

    const pid = String(playerId).trim().slice(0, 64) || "guest";
    const balanceRaw = await redis.get<number>(balKey(pid));
    const balance = Number(balanceRaw || 0);

    const walletBack = await redis.get<string>(playerToWalletKey(pid));

    return res.status(200).json({
      ok: true,
      walletAddress,
      playerId: pid,
      balance,
      walletOnRecord: walletBack || walletAddress,
    });
  } catch (err: any) {
    console.error("admin wallet lookup error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
