// pages/api/admin/payouts.ts
// The admin page's view of game payouts (lib/server/gameRuns.ts): the payout log (refused, cut and over-cap
// payouts, newest first) and today's biggest payouts per game, per Rebel Economy account. Read-only.
import type { NextApiRequest, NextApiResponse } from "next";
import { isAdminRequest } from "../../../lib/server/player-auth";
import { RUN_RULES, readPayoutLog, topToday } from "../../../lib/server/gameRuns";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!isAdminRequest(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const games = Object.keys(RUN_RULES).filter((g) => g !== "shuffle");
    const [log, ...tops] = await Promise.all([readPayoutLog(300), ...games.map((g) => topToday(g, 10))]);
    return res.status(200).json({ ok: true, log, today: Object.fromEntries(games.map((g, i) => [g, tops[i]])) });
  } catch (e) {
    console.error("admin/payouts", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
