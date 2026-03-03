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
  if (!expected) return false;

  return !!provided && provided === expected;
}

function claimKey(id: string) {
  return `ra:claim:${id}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const claimId = String(req.query.claimId || "").trim();
    if (!claimId) return res.status(400).json({ ok: false, error: "Missing claimId" });

    const key = claimKey(claimId);
    const raw = await redis.get<any>(key);

if (!raw) {
  return res.status(200).json({ ok: true, claim: null });
}

// ✅ If Upstash returns an already-parsed object, return it directly
if (typeof raw === "object") {
  return res.status(200).json({ ok: true, claim: raw });
}

// ✅ Otherwise it's a string: try JSON.parse, else return raw string
if (typeof raw === "string") {
  try {
    return res.status(200).json({ ok: true, claim: JSON.parse(raw) });
  } catch {
    return res.status(200).json({ ok: true, claim: { raw } });
  }
}

// fallback (shouldn't happen)
return res.status(200).json({ ok: true, claim: { raw: String(raw) } });
  } catch (e: any) {
    console.error("admin claims get error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
