// pages/api/claims/create.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { actingPlayer, isAdminRequest } from "../../../lib/server/player-auth";
import { markClaimed, readWonPrize, unmarkClaimed, wonBy } from "../../../lib/server/prizesWon";

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

    let prize = body?.prize || null;
    const wallet = String(body?.wallet || "").trim();

    // Optional context (nice for admin UI / debugging)
    const rarity = String(body?.rarity || "").trim();
    let game = String(body?.game || "shuffle").trim().slice(0, 32);
    let playerId = String(body?.playerId || "").trim().slice(0, 64);
    const playerName = String(body?.playerName || "").trim().slice(0, 64);

    // Basic validation
    if (!prize || !prize?.type) {
      return res.status(400).json({ ok: false, error: "Missing prize" });
    }

    const claimId = makeId();

    // ✅ A player claims a prize the server rolled for their account (lib/server/prizesWon.ts), once: the
    // prize is the one saved at the roll, never the request's. (The admin page is trusted.)
    let wonId = "";
    if (!isAdminRequest(req)) {
      const who = await actingPlayer(req, playerId);
      if (!who.ok) return res.status(401).json({ ok: false, error: who.signIn ? "Sign in again to claim your prize." : "Sign in to claim your prize.", signIn: who.signIn });
      const won = await readWonPrize(prize?.wonId ?? body?.wonId);
      if (!won || !wonBy(won, { playerId: who.playerId, userId: who.user.userId })) {
        return res.status(403).json({ ok: false, error: "This prize was not won by this account." });
      }
      if (!(await markClaimed(won.wonId, claimId))) return res.status(409).json({ ok: false, error: "This prize has been claimed already." });
      wonId = won.wonId;
      playerId = who.playerId;
      game = won.game;
      prize = { ...won.prize, wonId: won.wonId };
    }

   // For NFT claims, wallet is required
if (String(prize?.type).toLowerCase() === "nft") {
  if (!wallet || !wallet.startsWith("0x") || wallet.length < 40) {
    if (wonId) await unmarkClaimed(wonId);
    return res.status(400).json({ ok: false, error: wallet ? "Invalid wallet" : "Missing wallet" });
  }

  // ✅ Consume the NFT from inventory so it cannot be claimed twice
  const ULTRA_NFT_INVENTORY_KEY = "ra:inv:ultra:nft";
  const invKey = String(prize?.meta?.inventoryKey || "").trim();

  if (!invKey) {
    if (wonId) await unmarkClaimed(wonId);
    return res.status(400).json({ ok: false, error: "NFT prize missing meta.inventoryKey" });
  }

  const items = await redis.lrange<any>(ULTRA_NFT_INVENTORY_KEY, 0, 500);

  let rawMatch: any = null;
  let parsedMatch: any = null;

  for (const it of items || []) {
    const obj =
      typeof it === "string"
        ? (() => {
            try {
              return JSON.parse(it);
            } catch {
              return null;
            }
          })()
        : it;

    if (!obj) continue;

    const meta = obj?.meta || obj;

    const chain = String(meta?.chain || "").toUpperCase();
    const contract = String(meta?.contract || "").trim();
    const tokenId = String(meta?.tokenId ?? "").trim();

    const k =
      String(meta?.inventoryKey || "").trim() ||
      `ultra:${chain}:${contract}:${tokenId}`;

    if (k === invKey) {
      rawMatch = it;
      parsedMatch = meta;
      break;
    }
  }

  if (!rawMatch || !parsedMatch) {
    if (wonId) await unmarkClaimed(wonId);
    return res.status(409).json({ ok: false, error: "No NFT inventory available" });
  }

  const removeValue =
    typeof rawMatch === "string" ? rawMatch : JSON.stringify(parsedMatch);

  await redis.lrem(ULTRA_NFT_INVENTORY_KEY, 1, removeValue);

  // ensure prize meta contains correct token data
  prize = {
    ...prize,
    meta: {
      ...(prize?.meta || {}),
      chain: parsedMatch.chain,
      contract: parsedMatch.contract,
      tokenId: parsedMatch.tokenId,
      inventoryKey: invKey,
    },
  };
}

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
