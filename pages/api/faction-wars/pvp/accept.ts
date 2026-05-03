// POST /api/faction-wars/pvp/accept
//
// Opponent accepts a pending challenge. Transitions status to "team_selection".
// The opponent must be a different player from the challenger.
// Identity check matches the create endpoint pattern: V1 trusts the supplied
// identity. In production UI we'll require commander name or Discord linked.

import type { NextApiRequest, NextApiResponse } from "next";
import { getMatch, saveMatch, addPlayerMatch } from "../../../../lib/server/fwpvp";
import type { AcceptChallengeRequest } from "../../../../lib/types/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<AcceptChallengeRequest>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const opponentPlayerId = String(body.opponentPlayerId || "").trim().slice(0, 64);
    const opponentDisplayName = String(body.opponentDisplayName || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!opponentPlayerId) return res.status(400).json({ ok: false, error: "Missing opponentPlayerId" });
    if (!opponentDisplayName) return res.status(400).json({ ok: false, error: "Missing opponentDisplayName" });

    const match = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (match.status !== "pending") {
      return res.status(409).json({ ok: false, error: `Cannot accept; match is ${match.status}` });
    }
    if (match.challengerPlayerId === opponentPlayerId) {
      return res.status(400).json({ ok: false, error: "Cannot accept your own challenge" });
    }

    const now = Date.now();
    match.status = "team_selection";
    match.opponentPlayerId = opponentPlayerId;
    match.opponentDisplayName = opponentDisplayName;
    match.updatedAt = now;
    match.lastActionAt = now;

    await saveMatch(match);
    await addPlayerMatch(opponentPlayerId, challengeId);

    return res.status(200).json({ ok: true, match });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
