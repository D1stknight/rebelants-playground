// /api/admin/merch-stock — how many of each crate merch item (by SKU) are left (lib/server/prizeTable.ts).
// GET ?skus=a,b → { stock: { sku: number | null } }  (null = no limit)
// POST { sku, stock: number | null }  → sets it (null removes the limit). Admin only.
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { isAdminRequest } from "../../../lib/server/player-auth";
import { merchStockKey } from "../../../lib/server/prizeTable";

const cleanSku = (v: unknown) => String(v ?? "").trim().slice(0, 40);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAdminRequest(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    if (req.method === "GET") {
      const skus = String(req.query.skus || "").split(",").map(cleanSku).filter(Boolean).slice(0, 60);
      const vals = skus.length ? await redis.mget<unknown[]>(...skus.map(merchStockKey)) : [];
      return res.status(200).json({ ok: true, stock: Object.fromEntries(skus.map((s, i) => [s, vals[i] === null || vals[i] === undefined ? null : Math.max(0, Number(vals[i]) || 0)])) });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
      const sku = cleanSku(body.sku);
      if (!sku) return res.status(400).json({ ok: false, error: "SKU needed" });
      if (body.stock === null || body.stock === "") {
        await redis.del(merchStockKey(sku));
        return res.status(200).json({ ok: true, sku, stock: null });
      }
      const n = Math.floor(Number(body.stock));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return res.status(400).json({ ok: false, error: "Stock is a whole number, 0 or more" });
      await redis.set(merchStockKey(sku), n);
      return res.status(200).json({ ok: true, sku, stock: n });
    }
    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
