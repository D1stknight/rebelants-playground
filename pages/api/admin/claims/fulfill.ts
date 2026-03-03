// pages/api/admin/claims/fulfill.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../lib/server/redis";

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAuthed(req: NextApiRequest) {
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

function parseMaybeJson<T = any>(v: any): T | null {
  if (!v) return null;
  if (typeof v === "object") return v as T;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const claimId = String(body.claimId || "").trim();
    const tracking = String(body.tracking || "").trim();

    if (!claimId) return res.status(400).json({ ok: false, error: "Missing claimId" });

    const raw = await redis.get<any>(claimKey(claimId));
    if (!raw) return res.status(404).json({ ok: false, error: "Claim not found" });

    const claim = parseMaybeJson<any>(raw);
    if (!claim || typeof claim !== "object") {
      return res.status(500).json({ ok: false, error: "Stored claim is not valid JSON" });
    }

    const type = String(claim?.prize?.type || "").toLowerCase();
    if (type !== "merch") return res.status(400).json({ ok: false, error: "Not a merch claim" });

    claim.status = "FULFILLED";
    claim.fulfilledAt = new Date().toISOString();
    if (tracking) claim.tracking = tracking;

    await redis.set(claimKey(claimId), JSON.stringify(claim));
    await redis.expire(claimKey(claimId), 60 * 60 * 24 * 90);

    return res.status(200).json({ ok: true, claim });
  } catch (e: any) {
    console.error("admin/claims/fulfill error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
