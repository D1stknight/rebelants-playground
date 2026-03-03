// pages/api/admin/inventory/nft/list.ts
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

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
    const raw = await redis.lrange(ULTRA_NFT_INVENTORY_KEY, 0, limit - 1);

    const items = (raw || [])
      .map((s: any) => {
        try {
          return JSON.parse(String(s));
        } catch {
          return { raw: String(s) };
        }
      });

    const len = await redis.llen(ULTRA_NFT_INVENTORY_KEY);

    return res.status(200).json({ ok: true, key: ULTRA_NFT_INVENTORY_KEY, len: Number(len || 0), items });
  } catch (e: any) {
    console.error("admin inventory list error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
