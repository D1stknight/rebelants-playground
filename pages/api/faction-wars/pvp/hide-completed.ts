// POST /api/faction-wars/pvp/hide-completed
//
// Body: { playerId: string, challengeIds: string[] }
//
// Adds the supplied challengeIds to the player's hidden-matches set so they
// no longer appear in the player's own list-mine response. The match itself
// is NOT deleted — the OTHER player still sees it in their history.
//
// V1 trusts the supplied playerId, mirroring list-mine's contract. In V2
// we'll cross-check with the session.

import type { NextApiRequest, NextApiResponse } from "next";
import { addHiddenMatches } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {};
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const rawIds = Array.isArray(body.challengeIds) ? body.challengeIds : [];
    const challengeIds = rawIds
      .map((x: unknown) => String(x || "").trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 200);

    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (challengeIds.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing challengeIds" });
    }

    await addHiddenMatches(playerId, challengeIds);
    return res.status(200).json({ ok: true, hidden: challengeIds.length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
