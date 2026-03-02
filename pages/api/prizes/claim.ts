// pages/api/prizes/claim.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function claimKey(id: string) {
  return `ra:claim:${id}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const claimId = String(body.claimId || "").trim();
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const prize = body.prize ?? null;

    const wallet = String(body.wallet || "").trim();
    const shipping = body.shipping ?? null;

    if (!claimId || !playerId || !prize) {
      return res.status(400).json({ ok: false, error: "Missing claimId/playerId/prize" });
    }

    // idempotency guard (prevents double-claim)
    const existing = await redis.get<string>(claimKey(claimId));
    if (existing) {
      return res.status(200).json({ ok: true, already: true });
    }

    // store claim
    const payload = {
      claimId,
      ts: Date.now(),
      playerId,
      prize,
      wallet: wallet || null,
      shipping,
      status: "PENDING",
    };

    await redis.set(claimKey(claimId), JSON.stringify(payload));
    await redis.expire(claimKey(claimId), 60 * 60 * 24 * 90); // 90 days

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("prizes/claim error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
