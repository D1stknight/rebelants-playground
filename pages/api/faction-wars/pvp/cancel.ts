// POST /api/faction-wars/pvp/cancel
//
// Challenger cancels a pending challenge (only valid if status === "pending",
// i.e. opponent has not accepted yet). Sets status to "cancelled". Match is
// preserved in storage with TTL so the link returns "cancelled" if visited.

import type { NextApiRequest, NextApiResponse } from "next";
import { getMatch, saveMatch } from "../../../../lib/server/fwpvp";
import type { CancelChallengeRequest } from "../../../../lib/types/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<CancelChallengeRequest>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });

    const match = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (match.challengerPlayerId !== playerId) {
      return res.status(403).json({ ok: false, error: "Only the challenger can cancel" });
    }
    if (match.status !== "pending") {
      return res.status(409).json({ ok: false, error: `Cannot cancel; match is ${match.status}` });
    }

    const now = Date.now();
    match.status = "cancelled";
    match.updatedAt = now;
    match.lastActionAt = now;
    await saveMatch(match);

    return res.status(200).json({ ok: true, match });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
