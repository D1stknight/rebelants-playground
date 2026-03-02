// pages/api/admin/inventory/summary.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getMerchSummary, getNftInventorySummary } from "../../../../lib/server/inventory";

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
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const [nfts, merch] = await Promise.all([getNftInventorySummary(), getMerchSummary()]);
    return res.status(200).json({ ok: true, nfts, merch });
  } catch (e: any) {
    console.error("inventory summary error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
