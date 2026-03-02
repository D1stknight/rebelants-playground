// pages/api/admin/inventory/nft/add.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { addNftInventory, registerNftCollection } from "../../../../../lib/server/inventory";

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
    const chain = String(body.chain || "ETH").toUpperCase();
    const contract = String(body.contract || "").trim();
    const tokenIdsRaw = body.tokenIds;

    const tokenIds: string[] = Array.isArray(tokenIdsRaw)
      ? tokenIdsRaw.map((x) => String(x).trim()).filter(Boolean)
      : String(tokenIdsRaw || "")
          .split(/[\s,]+/g)
          .map((x) => x.trim())
          .filter(Boolean);

    if (!contract || !tokenIds.length) {
      return res.status(400).json({ ok: false, error: "Missing contract or tokenIds" });
    }
    if (chain !== "ETH" && chain !== "APECHAIN") {
      return res.status(400).json({ ok: false, error: "Invalid chain" });
    }

    await registerNftCollection(chain as any, contract);

    const items = tokenIds.map((t) => ({
      chain,
      contract,
      tokenId: t,
      label: body.label ? `${String(body.label)} #${t}` : undefined,
    }));

    const r = await addNftInventory(items as any);
    return res.status(200).json({ ok: true, added: r.added });
  } catch (e: any) {
    console.error("admin nft add error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
