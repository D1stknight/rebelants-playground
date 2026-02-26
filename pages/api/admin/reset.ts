// pages/api/admin/reset.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

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

// ✅ match your actual keys used elsewhere
const CONFIG_KEY = "ra:config:economy";   // from pages/api/admin/config.ts
const LB_TOTAL_EARNED = "lb:earn";        // from pages/api/leaderboard/top.ts
const LB_BALANCE = "ra:lb:balance";       // from pages/api/admin/grant.ts
const RECENT_WINS = "wins:recent";        // from pages/api/wins/recent.ts + wins/add.ts

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { what } = (body ?? {}) as { what?: "recentWins" | "leaderboards" | "all" };

    if (what === "recentWins") {
      await redis.del(RECENT_WINS);
      return res.status(200).json({ ok: true, cleared: "recentWins", keys: [RECENT_WINS] });
    }

    if (what === "leaderboards") {
      await redis.del(LB_TOTAL_EARNED, LB_BALANCE);
      return res.status(200).json({ ok: true, cleared: "leaderboards", keys: [LB_TOTAL_EARNED, LB_BALANCE] });
    }

    if (what === "all") {
      await redis.del(RECENT_WINS, LB_TOTAL_EARNED, LB_BALANCE, CONFIG_KEY);
      return res.status(200).json({
        ok: true,
        cleared: "all (wins + leaderboards + config override)",
        keys: [RECENT_WINS, LB_TOTAL_EARNED, LB_BALANCE, CONFIG_KEY],
      });
    }

    return res.status(400).json({ ok: false, error: "Invalid reset target" });
  } catch (err: any) {
    console.error("admin reset error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
