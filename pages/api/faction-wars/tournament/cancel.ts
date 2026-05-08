// POST /api/faction-wars/tournament/cancel
//
// Admin-only. Cancels a tournament and refunds entry fees to anyone who
// hasn't started a match yet. Matches already in progress are NOT cancelled —
// admin should manually finish or cancel each via the existing PvP cancel.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getTournament,
  saveTournament,
  creditREBEL,
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
  if (t.status === "completed" || t.status === "cancelled") {
    return res.status(400).json({ ok: false, error: "tournament already finished" });
  }

  // If still in draft, refund everyone. If seeded, refund only participants
  // not yet eliminated (they paid an entry fee but didn't get a fair shot).
  const refundEligible = t.status === "draft"
    ? t.participants
    : t.participants.filter((p: any) => p.eliminatedRound === null);

  let refundedCount = 0;
  if (t.entryFee > 0) {
    for (const p of refundEligible) {
      const newBal = await creditREBEL(p.playerId, t.entryFee);
      if (newBal !== null) refundedCount++;
    }
  }

  t.status = "cancelled";
  t.completedAt = Date.now();
  await saveTournament(t);

  return res.status(200).json({ ok: true, tournament: t, refundedCount });
}
