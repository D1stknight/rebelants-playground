// pages/api/faction-wars/pvp/forfeit.ts
//
// Challenger forfeits a match they created. Effects vary by status:
//
// pending (no opponent yet) → behaves like cancel: refund challenger ante,
//   mark cancelled. (We use cancelled, not completed, so it doesn't pollute
//   loss records when there was no opponent.)
//
// team_selection / active → mark completed, opponent wins. Pay out pot to
//   opponent (both antes), record win for opponent + loss for forfeiter,
//   bump streak/leaderboard. Refund any open bets at current state.
//
// Only the challenger (match.challengerPlayerId) can forfeit. Opponent who
// wants out should just stop playing — challenger eats the timeout.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getMatch,
  saveMatch,
  creditREBEL,
  unmarkActive,
  refundBets,
  payoutBets,
  tightenChatTTL,
  getPvpEconomyConfig,
  recordPvpResult,
} from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as {
      challengeId?: string;
      playerId?: string;
    };
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });

    const match = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

    // Only challenger may forfeit
    if (match.challengerPlayerId !== playerId) {
      return res.status(403).json({ ok: false, error: "Only the challenger can forfeit" });
    }

    if (match.status === "completed" || match.status === "cancelled") {
      return res.status(409).json({ ok: false, error: `Cannot forfeit; match is ${match.status}` });
    }

    const now = Date.now();
    const cost = Number(match.pvpCost || 0);

    // ── Case A: still pending (no opponent) → refund challenger and cancel ──
    if (match.status === "pending") {
      let refunded = 0;
      let refundedBalance: number | null = null;
      if (match.challengerPaid && cost > 0) {
        const newBal = await creditREBEL(match.challengerPlayerId, cost);
        if (newBal !== null) {
          refunded = cost;
          refundedBalance = newBal;
          match.challengerPaid = false;
        }
      }
      match.status = "cancelled";
      match.cancelledAt = now;
      match.updatedAt = now;
      await saveMatch(match);
      await refundBets(challengeId).catch(() => {});
      await unmarkActive(challengeId).catch(() => {});
      await tightenChatTTL(challengeId).catch(() => {});
      return res.status(200).json({
        ok: true,
        match,
        refunded,
        refundedBalance,
        outcome: "cancelled-no-opponent",
      });
    }

    // ── Case B: team_selection or active → opponent wins by forfeit ──
    if (!match.opponentPlayerId) {
      // Defensive: no opponent recorded but status moved past pending. Cancel.
      match.status = "cancelled";
      match.cancelledAt = now;
      match.updatedAt = now;
      await saveMatch(match);
      return res.status(200).json({ ok: true, match, outcome: "cancelled-no-opponent" });
    }

    // Mark match completed with opponent as winner
    match.status = "completed";
    match.winnerPlayerId = match.opponentPlayerId;
    match.loserPlayerId = match.challengerPlayerId;
    match.completedAt = now;
    match.updatedAt = now;
    match.forfeitedBy = match.challengerPlayerId;

    // Pot = both antes if both paid, else whatever was collected
    let pot = 0;
    if (match.challengerPaid && cost > 0) pot += cost;
    if (match.opponentPaid && cost > 0) pot += cost;

    // Pay pot to opponent
    let payoutBalance: number | null = null;
    if (pot > 0) {
      const newBal = await creditREBEL(match.opponentPlayerId, pot);
      payoutBalance = newBal;
      match.payoutAmount = pot;
      match.payoutPlayerId = match.opponentPlayerId;
    }

    await saveMatch(match);

    // Settle bets toward opponent victory, then leaderboards
    await payoutBets(challengeId, match.opponentPlayerId).catch(() => {});

    const winnerName = match.opponentDisplayName || "Opponent";
    const loserName = match.challengerDisplayName || "Challenger";
    await recordPvpResult(
      match.opponentPlayerId,
      match.challengerPlayerId,
      winnerName,
      loserName,
      pot,
    ).catch(() => {});

    await unmarkActive(challengeId).catch(() => {});
    await tightenChatTTL(challengeId).catch(() => {});

    return res.status(200).json({
      ok: true,
      match,
      pot,
      payoutBalance,
      outcome: "forfeit",
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "forfeit failed" });
  }
}
