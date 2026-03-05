// pages/api/admin/claims/delete.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../lib/server/redis";

function isAuthed(req: NextApiRequest) {
  const token =
    String(req.headers["x-admin-key"] || req.headers["x-admin-token"] || "").trim();

  const expected = String(process.env.ADMIN_TOKEN || "").trim();

  // If you already use a different env var name, change ADMIN_TOKEN here to match.
  return !!token && !!expected && token === expected;
}

function claimKey(id: string) {
  return `ra:claim:${id}`;
}

function transferLockKey(id: string) {
  return `ra:claim:${id}:transferLock`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!isAuthed(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const body =
      typeof req.body === "string" ? (req.body.trim() ? JSON.parse(req.body) : {}) : (req.body ?? {});
    const claimId = String(body?.claimId || "").trim();

    if (!claimId) {
      return res.status(400).json({ ok: false, error: "Missing claimId" });
    }

    // delete claim + any leftover transfer lock
    const deletedClaim = await redis.del(claimKey(claimId));
    const deletedLock = await redis.del(transferLockKey(claimId));

    return res.status(200).json({
      ok: true,
      claimId,
      deletedClaim,
      deletedLock,
    });
  } catch (e: any) {
    console.error("admin/claims/delete error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
