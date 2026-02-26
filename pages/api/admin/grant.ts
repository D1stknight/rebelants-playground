// pages/api/admin/grant.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

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

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { playerId, amount } = (body ?? {}) as { playerId?: string; amount?: number };

    const pid = (playerId || "guest").trim().slice(0, 64) || "guest";
    const amt = Number(amount || 0);

    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const newBalance = await redis.incrby(balKey(pid), amt);

    // balance leaderboard (visibility only; NOT top earners)
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
