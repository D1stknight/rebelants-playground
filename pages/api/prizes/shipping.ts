// pages/api/prizes/shipping.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function claimKey(id: string) {
  return `ra:claim:${id}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const rawBody = req.body;
    const body =
      typeof rawBody === "string"
        ? (rawBody.trim() ? JSON.parse(rawBody) : {})
        : (rawBody ?? {});

    const claimId = String(body.claimId || "").trim();
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const shipping = body.shipping ?? null;

    if (!claimId || !playerId) {
      return res.status(400).json({ ok: false, error: "Missing claimId/playerId" });
    }
    if (!shipping) {
      return res.status(400).json({ ok: false, error: "Missing shipping" });
    }

    const key = claimKey(claimId);
    const raw = await redis.get<string>(key);
    if (!raw) {
      return res.status(404).json({ ok: false, error: "Claim not found" });
    }

    let claim: any = null;
    try {
      claim = JSON.parse(raw);
    } catch {
      return res.status(500).json({ ok: false, error: "Stored claim is not valid JSON" });
    }

    if (String(claim?.playerId || "") !== playerId) {
      return res.status(403).json({ ok: false, error: "Player mismatch" });
    }

    const type = String(claim?.prize?.type || "").toLowerCase();
    if (type !== "merch") {
      return res.status(400).json({ ok: false, error: "Claim is not a merch prize" });
    }

    // Update shipping + status
    claim.shipping = shipping;
    claim.status = "PENDING";

    await redis.set(key, JSON.stringify(claim));
    await redis.expire(key, 60 * 60 * 24 * 90); // keep 90 days

    return res.status(200).json({ ok: true, claim });
  } catch (e: any) {
    console.error("prizes/shipping error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
