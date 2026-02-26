// pages/api/admin/ping.ts
import type { NextApiRequest, NextApiResponse } from "next";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAdmin(req: NextApiRequest) {
  // accept either header name
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";

  // accept either env var name
  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";

  if (!expected) return false;
  return !!provided && provided === expected;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  return res.status(200).json({ ok: true });
}
