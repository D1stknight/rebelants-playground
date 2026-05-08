// POST /api/faction-wars/tournament/leave
//
// Player withdraws from a draft tournament before it's seeded. Refunds entry fee.

import type { NextApiRequest, NextApiResponse } from "next";
import { getTournament, saveTournament, creditREBEL } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const body = req.body || {};
  const tournamentId = String(body.tournamentId || "").trim();
  const playerId = String(body.playerId || "").trim();
  if (!tournamentId || !playerId) {
    return res.status(400).json({ ok: false, error: "tournamentId, playerId required" });
  }

  const t = await getTournament(tournamentId);
  if (!t) return res.status(404).json({ ok: false, error: "tournament not found" });
  if (t.status !== "draft") {
    return res.status(400).json({ ok: false, error: "cannot leave after seeding" });
  }

  const idx = t.participants.findIndex(p => p.playerId === playerId);
  if (idx < 0) return res.status(400).json({ ok: false, error: "not joined" });

  t.participants.splice(idx, 1);
  await saveTournament(t);

  // Refund best-effort
  if (t.entryFee > 0) {
    await creditREBEL(playerId, t.entryFee);
  }

  return res.status(200).json({ ok: true, tournament: t });
}
