// POST /api/faction-wars/pvp/decline
//
// Opponent declines a pending challenge (only valid if status === "pending"
// and the caller is NOT the challenger). Sets status to "cancelled" and
// refunds the challenger's ante. Symmetric to cancel.ts (which is the
// challenger-side path) — both end with status="cancelled" so the share
// link rendering stays uniform.

import type { NextApiRequest, NextApiResponse } from "next";
import { getMatch, saveMatch, creditREBEL } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<{
      challengeId: string;
      playerId: string;
    }>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });

    const match = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

    if (match.challengerPlayerId === playerId) {
      return res.status(403).json({ ok: false, error: "Challenger should use cancel, not decline" });
    }
    if (match.status !== "pending") {
      return res.status(409).json({ ok: false, error: `Cannot decline; match is ${match.status}` });
    }

    // ── Refund ─────────────────────────────────────────────────────────────
    // Decliner is the opponent — they never paid an ante (accept is what
    // takes the ante). We refund the CHALLENGER's ante, matching cancel.ts.
    let refunded = 0;
    let refundedTo: string | null = null;
    let refundedBalance: number | null = null;
    if (match.challengerPaid && Number(match.pvpCost ?? 0) > 0) {
      const amt = Number(match.pvpCost);
      const newBal = await creditREBEL(match.challengerPlayerId, amt);
      if (newBal !== null) {
        refunded = amt;
        refundedTo = match.challengerPlayerId;
        refundedBalance = newBal;
        match.challengerPaid = false;
        match.pvpPotPaid = Math.max(0, Number(match.pvpPotPaid ?? 0) - amt);
      }
    }

    const now = Date.now();
    match.status = "cancelled";
    match.updatedAt = now;
    match.lastActionAt = now;
    await saveMatch(match);

    return res.status(200).json({ ok: true, match, refunded, refundedTo, refundedBalance });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "decline failed" });
  }
}
