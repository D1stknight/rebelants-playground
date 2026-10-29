// pages/api/admin/inventory/nft/debug.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../../lib/server/redis";
import { nftHoldKey } from "../../../../../lib/server/prizeTable";

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

function safeParse(v: any) {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const len = Number((await redis.llen(ULTRA_NFT_INVENTORY_KEY)) || 0);
    const items = await redis.lrange(ULTRA_NFT_INVENTORY_KEY, 0, -1);

    const out = (items || []).map((it: any) => {
      // If Upstash returns objects, show them as JSON not "[object Object]"
      const raw = typeof it === "string" ? it : JSON.stringify(it);
      const parsed = safeParse(raw) ?? (typeof it === "object" ? it : null);

      return {
        raw,
        parsed,
      };
    });

    // won but not claimed yet: held for the winner for 7 days (lib/server/prizeTable.ts)
    const invKeys = out.map((o: any) => {
      const p = o.parsed || {};
      const m = p.meta || p;
      return String(m.inventoryKey || "").trim() || `ultra:${String(m.chain || "ETH").toUpperCase()}:${String(m.contract || "").trim()}:${String(m.tokenId ?? "").trim()}`;
    });
    const holds = invKeys.length ? await redis.mget<unknown[]>(...invKeys.map(nftHoldKey)) : [];
    out.forEach((o: any, i: number) => { o.heldSince = holds[i] ? Number(holds[i]) || null : null; });

    return res.status(200).json({
      ok: true,
      key: ULTRA_NFT_INVENTORY_KEY,
      len,
      items: out,
    });
  } catch (e: any) {
    console.error("inv nft debug error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
