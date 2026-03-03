// pages/api/admin/inventory/nft/clear.ts
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

    // delete the list entirely
    await redis.del(ULTRA_NFT_INVENTORY_KEY);

    return res.status(200).json({ ok: true, key: ULTRA_NFT_INVENTORY_KEY });
  } catch (e: any) {
    console.error("admin inventory clear error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
