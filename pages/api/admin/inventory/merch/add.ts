// pages/api/admin/inventory/merch/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { addMerchStock, registerMerchSku } from "../../../../../lib/server/inventory";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}
function isAdmin(req: NextApiRequest) {
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";
  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  return !!expected && !!provided && provided === expected;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const sku = String(body.sku || "").trim();
    const label = String(body.label || sku).trim();
    const qty = Math.floor(Number(body.qty || 0));

    if (!sku || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid sku/qty" });
    }

    await registerMerchSku(sku);
    const r = await addMerchStock(sku, qty, label);
    if (!r.ok) return res.status(400).json({ ok: false, error: "Could not add stock" });

    return res.status(200).json({ ok: true, sku: r.sku, qty: r.qty });
  } catch (e: any) {
    console.error("admin merch add error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
