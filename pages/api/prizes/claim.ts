// pages/api/prizes/claim.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function claimKey(id: string) {
  return `ra:claim:${id}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const claimId = String(body.claimId || "").trim();
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const prizeIn = body.prize ?? null;

    const wallet = String(body.wallet || "").trim();
    const shipping = body.shipping ?? null;

    if (!claimId || !playerId || !prizeIn) {
      return res.status(400).json({ ok: false, error: "Missing claimId/playerId/prize" });
    }

    // idempotency guard (prevents double-claim)
    const existing = await redis.get<string>(claimKey(claimId));
    if (existing) {
      return res.status(200).json({ ok: true, already: true });
    }

    let prize = prizeIn;

    // ✅ If NFT prize: reserve an actual token from inventory NOW
    if (String(prize?.type || "").toLowerCase() === "nft") {
      const invKey = String(prize?.meta?.inventoryKey || "").trim();

      if (!invKey) {
        return res.status(400).json({ ok: false, error: "NFT prize missing meta.inventoryKey" });
      }

      // pop 1 inventory item (atomic reservation)
      const rawItem = await redis.rpop(invKey);

      if (!rawItem) {
        // no NFT left -> fail claim (caller should fall back to points on next roll)
        return res.status(409).json({ ok: false, error: "No NFT inventory available" });
      }

      // inventory item should be JSON like:
      // {"chain":"eth","contract":"0x...","tokenId":"123"}
      let token: any = null;
      try {
        token = JSON.parse(String(rawItem));
      } catch {
        // if it was stored as a plain string, keep it as-is
        token = { raw: String(rawItem) };
      }

      prize = {
        ...prize,
        label: prize?.label || "NFT Prize",
        meta: {
          ...(prize?.meta || {}),
          ...token,
        },
      };

      // require wallet for NFT claims
      if (!wallet || !wallet.startsWith("0x") || wallet.length < 10) {
        return res.status(400).json({ ok: false, error: "Missing/invalid recipient wallet" });
      }
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
