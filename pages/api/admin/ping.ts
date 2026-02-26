// pages/api/admin/ping.ts
import type { NextApiRequest, NextApiResponse } from "next";

function isAdmin(req: NextApiRequest) {
  const token = req.headers["x-admin-token"];
  const provided = Array.isArray(token) ? token[0] : token;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return !!provided && provided === expected;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  return res.status(200).json({ ok: true });
}
