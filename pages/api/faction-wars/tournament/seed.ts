// POST /api/faction-wars/tournament/seed
//
// Admin-only. Locks participant list, builds the bracket via Fisher-Yates,
// and creates round-1 PvpMatches for every paired slot. Slots with only one
// player (byes — happens when fewer than `size` joined) auto-advance.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getTournament,
  saveTournament,
  buildBracket,
  spawnTournamentRoundMatch,
  propagateWinners,
  checkAdminAuth,
} from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!checkAdminAuth(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  const body = req.body || {};
  const tournamentId = String(body.tournamentId || "").trim();
  if (!tournamentId) return res.status(400).json({ ok: false, error: "tournamentId required" });

  const t = await getTournament(tournamentId);
  if (!t) return res.status(404).json({ ok: false, error: "tournament not found" });
  if (t.status !== "draft") {
    return res.status(400).json({ ok: false, error: "tournament already seeded" });
  }
  if (t.participants.length < 2) {
    return res.status(400).json({ ok: false, error: "need at least 2 participants" });
  }

  // Build the empty bracket and populate round 0 with shuffled participants
  const ids = t.participants.map(p => p.playerId);
  t.rounds = buildBracket(t.size, ids, t.potPerRound);
  t.status = "seeded";
  t.startedAt = Date.now();

  // For each round-0 slot with both players, create the PvP match.
  // For byes (single player), set winner so they auto-advance.
  const round0 = t.rounds[0];
  for (const slot of round0.matches) {
    if (slot.p1 && slot.p2) {
      await spawnTournamentRoundMatch(t, 0, slot.slotIndex);
    } else if (slot.p1 && !slot.p2) {
      slot.winner = slot.p1;
    } else if (!slot.p1 && slot.p2) {
      slot.winner = slot.p2;
    }
  }

  // Propagate any byes forward
  propagateWinners(t);

  // If propagation created next-round pairings (rare with byes), spawn those
  // matches too — only round 1 since byes can't cascade past one level when
  // round 0 has at least one paired match.
  if (t.rounds.length > 1) {
    const round1 = t.rounds[1];
    for (const slot of round1.matches) {
      if (slot.p1 && slot.p2 && !slot.challengeId) {
        await spawnTournamentRoundMatch(t, 1, slot.slotIndex);
      }
    }
  }

  await saveTournament(t);
  return res.status(200).json({ ok: true, tournament: t });
}
