// pages/api/admin/reset.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function isAdmin(req: NextApiRequest) {
  const token = req.headers["x-admin-token"];
  const provided = Array.isArray(token) ? token[0] : token;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return !!provided && provided === expected;
}

const CONFIG_KEY = "ra:config:points";
const LB_TOTAL_EARNED = "ra:lb:totalEarned";
const LB_BALANCE = "ra:lb:balance";
const RECENT_WINS = "ra:wins:recent";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { what } = (req.body ?? {}) as { what?: "recentWins" | "leaderboards" | "all" };

    if (what === "recentWins") {
      await redis.del(RECENT_WINS);
      return res.status(200).json({ ok: true, cleared: "recentWins" });
    }

    if (what === "leaderboards") {
      await redis.del(LB_TOTAL_EARNED, LB_BALANCE);
      return res.status(200).json({ ok: true, cleared: "leaderboards" });
    }

    if (what === "all") {
      await redis.del(RECENT_WINS, LB_TOTAL_EARNED, LB_BALANCE, CONFIG_KEY);
      return res.status(200).json({ ok: true, cleared: "all (wins + leaderboards + config override)" });
    }

    return res.status(400).json({ ok: false, error: "Invalid reset target" });
  } catch (err: any) {
    console.error("admin reset error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
