// pages/api/prizes/claim.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

const ULTRA_NFT_INVENTORY_KEY = "ra:inv:ultra:nft";

function claimKey(id: string) {
  return `ra:claim:${id}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const rawBody = req.body;
    const body =
      typeof rawBody === "string"
        ? (rawBody.trim() ? JSON.parse(rawBody) : {})
        : (rawBody ?? {});

    const claimId = String(body.claimId || "").trim();
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const prize = body.prize ?? null;

    const wallet = String(body.wallet || "").trim();
    const shipping = body.shipping ?? null;

    if (!claimId || !playerId || !prize) {
      return res.status(400).json({ ok: false, error: "Missing claimId/playerId/prize" });
    }

    // idempotency guard (prevents double-claim)
    const existing = await redis.get<string>(claimKey(claimId));
    if (existing) {
      return res.status(200).json({ ok: true, already: true });
    }

    // ✅ If it's an NFT prize, consume 1 inventory item now (so roll doesn't burn inventory)
    if (String(prize?.type || "").toLowerCase() === "nft") {
      const invKey = String(prize?.meta?.inventoryKey || "").trim();
      if (!invKey) {
        return res.status(400).json({ ok: false, error: "NFT prize missing meta.inventoryKey" });
      }

      // require wallet for NFT claims
      if (!wallet || !wallet.startsWith("0x") || wallet.length < 10) {
        return res.status(400).json({ ok: false, error: "Missing/invalid recipient wallet" });
      }

      // Find the exact raw item in the inventory list and remove it (consume once)
      const items = await redis.lrange(ULTRA_NFT_INVENTORY_KEY, 0, 250);
      const rawMatch = (items || []).find((s: any) => {
        try {
          const obj = JSON.parse(String(s));
          const chain = String(obj?.chain || "").toUpperCase();
          const contract = String(obj?.contract || "").trim();
          const tokenId = String(obj?.tokenId ?? "").trim();
          const k =
            String(obj?.inventoryKey || "").trim() ||
            `ultra:${chain}:${contract}:${tokenId}`;
          return k === invKey;
        } catch {
          return false;
        }
      });

      if (!rawMatch) {
        return res.status(409).json({ ok: false, error: "No NFT inventory available" });
      }

      // Remove just ONE matching entry
      await redis.lrem(ULTRA_NFT_INVENTORY_KEY, 1, rawMatch);
    }

    // ✅ If merch prize: require shipping info
    if (String(prize?.type || "").toLowerCase() === "merch") {
      if (!shipping) {
        return res.status(400).json({ ok: false, error: "Missing shipping for merch claim" });
      }
    }

    // store claim
    const payload = {
      claimId,
      ts: Date.now(),
      playerId,
      prize,
      wallet: wallet || null,
      shipping,
      status: "PENDING",
    };

    await redis.set(claimKey(claimId), JSON.stringify(payload));
    await redis.expire(claimKey(claimId), 60 * 60 * 24 * 90); // 90 days

    return res.status(200).json({ ok: true, claim: payload });
  } catch (e: any) {
    console.error("prizes/claim error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
