// pages/api/admin/inventory/nft/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../../lib/server/redis";

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

const ULTRA_NFT_INVENTORY_KEY = "ra:inv:ultra:nft";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});

    const chain = String(body.chain || "ETH").trim().toUpperCase();
    const contract = String(body.contract || "").trim();
    const tokenIdsRaw = Array.isArray(body.tokenIds) ? body.tokenIds : [];

// ✅ De-dupe tokenIds (prevents accidental duplicates in inventory)
const tokenIds = Array.from(
  new Set(
    tokenIdsRaw
      .map((t: any) => String(t ?? "").trim())
      .filter(Boolean)
  )
);
    const label = String(body.label || "NFT Prize").trim();

    if (!contract || !contract.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Missing/invalid contract" });
    }
    if (!tokenIds.length) {
      return res.status(400).json({ ok: false, error: "Missing tokenIds[]" });
    }

    let added = 0;

        // ✅ We use LPUSH so newest added is used first (roll uses RPOP)
    // If you prefer FIFO, switch to RPUSH + LPOP later.
    const seen = new Set<string>();

    for (const tid of tokenIds) {
      const tokenId = String(tid ?? "").trim();
      if (!tokenId) continue;

      // ✅ prevent duplicates in same request
      if (seen.has(tokenId)) continue;
      seen.add(tokenId);

      const payload = {
        type: "NFT",
        label,
        meta: {
          chain,
          contract,
          tokenId,
          label,
          inventoryKey: `ultra:${chain}:${contract}:${tokenId}`,
        },
      };

      await redis.lpush(ULTRA_NFT_INVENTORY_KEY, JSON.stringify(payload));
      added++;
    }

    return res.status(200).json({ ok: true, added });
  } catch (e: any) {
    console.error("admin inventory add error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
