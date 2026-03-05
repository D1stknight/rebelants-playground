// pages/api/claims/create.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function makeId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeJson(v: any) {
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return v;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = safeJson(req.body) || {};

    const prize = body?.prize || null;
    const wallet = String(body?.wallet || "").trim();

    // Optional context (nice for admin UI / debugging)
    const rarity = String(body?.rarity || "").trim();
    const game = String(body?.game || "shuffle").trim();
    const playerId = String(body?.playerId || "").trim();
    const playerName = String(body?.playerName || "").trim();

    // Basic validation
    if (!prize || !prize?.type) {
      return res.status(400).json({ ok: false, error: "Missing prize" });
    }

    // For NFT claims, wallet is required
    if (String(prize?.type).toLowerCase() === "nft") {
      if (!wallet) return res.status(400).json({ ok: false, error: "Missing wallet" });
      if (!wallet.startsWith("0x") || wallet.length < 40) {
        return res.status(400).json({ ok: false, error: "Invalid wallet" });
      }
    }

    const claimId = makeId();
    const key = `ra:claim:${claimId}`;

    const claim = {
      claimId,
      createdAt: Date.now(),
      game,
      rarity,

      // who
      playerId,
      playerName,

      // where to send (NFT only; merch uses shipping elsewhere)
      wallet,

      // what they won (store full object so Admin can display)
      prize,

      // lifecycle
      status: "PENDING",
      txHash: "",
    };

    // Store the claim
    await redis.set(key, claim);

   // ✅ Do NOT create transferLock here.
// The transfer endpoint sets a short lock while it runs to prevent double-sends.
return res.status(200).json({ ok: true, claimId, claim });
  } catch (e: any) {
    console.error("claims/create error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
