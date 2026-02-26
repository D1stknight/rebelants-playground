// pages/api/admin/grant.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function isAdmin(req: NextApiRequest) {
  const token = req.headers["x-admin-token"];
  const provided = Array.isArray(token) ? token[0] : token;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return !!provided && provided === expected;
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function lbBalanceKey() {
  return `ra:lb:balance`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { playerId, amount } = (req.body ?? {}) as { playerId?: string; amount?: number };
    const pid = (playerId || "guest").trim().slice(0, 64) || "guest";
    const amt = Number(amount || 0);

    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const newBalance = await redis.incrby(balKey(pid), amt);

    // keep a balance leaderboard for visibility (NOT "Top Earners", just useful)
    await redis.zadd(lbBalanceKey(), { score: Number(newBalance || 0), member: pid });

    return res.status(200).json({
      ok: true,
      playerId: pid,
      added: amt,
      balance: Number(newBalance || 0),
      note: "Grant affects balance. Top Earners uses total earned from gameplay, not grants.",
    });
  } catch (err: any) {
    console.error("admin grant error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
