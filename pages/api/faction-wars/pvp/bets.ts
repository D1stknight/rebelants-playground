// GET /api/faction-wars/pvp/bets?id={challengeId}
//
// Returns the live bet state for a match: pool totals, lock flag, full
// bettor list (sorted by lastAt DESC). Used by the spectator page betting
// panel and the recent-bettors feed.
//
// Public endpoint — no auth needed. Bettor names are intentionally public
// per the design (Q6).

import type { NextApiRequest, NextApiResponse } from "next";
import { getBets } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const challengeId = String(req.query.id || "").trim().slice(0, 64);
    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing id" });
    const state = await getBets(challengeId);
    return res.status(200).json({ ok: true, bets: state });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "get-bets failed" });
  }
}
