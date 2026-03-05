// pages/api/admin/claims/delete.ts
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
  if (!expected) return false;

  return !!provided && provided === expected;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const claimId = String(body.claimId || "").trim();

    if (!claimId) {
      return res.status(400).json({ ok: false, error: "Missing claimId" });
    }

    const key = `ra:claim:${claimId}`;

    const existed = await redis.get(key);
    await redis.del(key);

    return res.status(200).json({ ok: true, claimId, deleted: !!existed });
  } catch (e: any) {
    console.error("admin claims delete error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
