// POST /api/faction-wars/tournament/join
//
// Player pays entryFee REBEL and joins a draft tournament. Idempotent — if
// the player is already in the tournament, returns ok without double-charging.

import type { NextApiRequest, NextApiResponse } from "next";
import { getTournament, saveTournament, getREBELBalance, spendREBEL } from "../../../../lib/server/fwpvp";
import type { JoinTournamentRequest } from "../../../../lib/types/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const body = (req.body || {}) as JoinTournamentRequest;
  const tournamentId = String(body.tournamentId || "").trim();
  const playerId = String(body.playerId || "").trim();
  const displayName = String(body.displayName || "").trim().slice(0, 40);

  if (!tournamentId || !playerId || !displayName) {
    return res.status(400).json({ ok: false, error: "tournamentId, playerId, displayName required" });
  }

  const t = await getTournament(tournamentId);
  if (!t) return res.status(404).json({ ok: false, error: "tournament not found" });
  if (t.status !== "draft") {
    return res.status(400).json({ ok: false, error: "tournament already started or finished" });
  }

  // Idempotent: if already joined, return current state
  if (t.participants.some(p => p.playerId === playerId)) {
    return res.status(200).json({ ok: true, tournament: t, alreadyJoined: true });
  }

  if (t.participants.length >= t.size) {
    return res.status(400).json({ ok: false, error: "tournament is full" });
  }

  // Deduct entry fee
  if (t.entryFee > 0) {
    const bal = await getREBELBalance(playerId);
    if (bal < t.entryFee) {
      return res.status(400).json({ ok: false, error: "insufficient REBEL balance" });
    }
    const newBal = await spendREBEL(playerId, t.entryFee);
    if (newBal === null) {
      return res.status(500).json({ ok: false, error: "failed to deduct entry fee" });
    }
  }

  t.participants.push({
    playerId,
    displayName,
    joinedAt: Date.now(),
    eliminatedRound: null,
  });
  await saveTournament(t);

  return res.status(200).json({ ok: true, tournament: t });
}
