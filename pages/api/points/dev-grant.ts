// pages/api/points/dev-grant.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
        // dev only (blocked unless explicitly enabled)
    const allowDevGrant =
      process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_GRANT === "true";

    if (!allowDevGrant) {
      return res.status(404).json({ error: "Not found" });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { playerId, amount } = (req.body ?? {}) as {
      playerId?: string;
      amount?: number;
    };

    const pid = (playerId || "guest").trim() || "guest";
    const amt = Number(amount || 0);

    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const newBalance = await redis.incrby(balKey(pid), amt);

    return res.status(200).json({
      ok: true,
      dev: true,
      playerId: pid,
      added: amt,
      balance: Number(newBalance || 0),
    });
  } catch (err: any) {
    console.error("dev-grant error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
