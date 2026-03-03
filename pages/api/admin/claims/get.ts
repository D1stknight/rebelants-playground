// pages/api/admin/claims/get.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../lib/server/redis";

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

function claimKey(id: string) {
  return `ra:claim:${id}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const claimId = String(req.query.claimId || "").trim();
    if (!claimId) return res.status(400).json({ ok: false, error: "Missing claimId" });

    const raw = await redis.get<string>(claimKey(claimId));
    if (!raw) return res.status(404).json({ ok: false, error: "Not found" });

    let claim: any = null;
    try {
      claim = JSON.parse(String(raw));
    } catch {
      claim = null;
    }

    return res.status(200).json({ ok: true, claim });
  } catch (e: any) {
    console.error("admin claims get error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
