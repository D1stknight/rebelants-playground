// pages/api/identity/nonce.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function normalizeWallet(w: any) {
  const s = String(w || "").trim().toLowerCase();
  if (!s.startsWith("0x")) return "";
  if (s.length < 10) return "";
  return s;
}

function nonceKey(guestId: string, wallet: string) {
  return `ra:identity:nonce:${guestId}:${wallet}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const guestId = String(req.query.guestId || "").trim().slice(0, 64);
    const wallet = normalizeWallet(req.query.walletAddress);

    if (!guestId) return res.status(400).json({ ok: false, error: "Missing guestId" });
    if (!wallet) return res.status(400).json({ ok: false, error: "Invalid walletAddress" });

    const nonce = Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);

    await redis.set(nonceKey(guestId, wallet), nonce);
    await redis.expire(nonceKey(guestId, wallet), 60 * 10); // 10 minutes

    return res.status(200).json({ ok: true, nonce });
  } catch (e: any) {
    console.error("nonce error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
