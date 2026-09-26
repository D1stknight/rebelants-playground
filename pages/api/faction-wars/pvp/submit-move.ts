import { withPlaygroundMatchExperience } from "../../../../lib/server/raap-fwpvp-experience";
// POST /api/faction-wars/pvp/submit-move
//
// The current-turn player submits ONE move. The move is applied as a direct
// attack against the opponent's currently-active fighter. Damage is computed
// using calcDamage from factionWarsCore. There is no concurrent counter-move
// — PvP is strict sequential turn-taking, as called out in the design spec.
//
// After damage:
//   - If defender HP > 0: turn flips to the other player.
//   - If defender HP <= 0: territory ends. The attacker wins this territory.
//     Both sides advance their currentFactionIndex. HPs reset to MAX_HP.
//     currentTerritory increments. If currentTerritory >= TERRITORY_COUNT
//     OR either side has no more fighters, the match completes.
//
// After completion: winner is the side with more territoriesWon. Crate rarity
// is determined by the WINNER's territoriesWon (3=common, 4=rare, 5=ultra).
// Loser gets nothing per design spec.
//
// Validation: the submitted moveId must belong to the moves[] of the player's
// currently-active faction. This prevents move spoofing.

import type { NextApiRequest, NextApiResponse } from "next";
import { getMatch, saveMatch, creditREBEL, getCrateRewards, recordPvpResult, unmarkActive, lockBets, payoutBets, refundBets, getPvpEconomyConfig, tightenChatTTL, onTournamentMatchComplete } from "../../../../lib/server/fwpvp";
import {TERRITORY_COUNT} from "../../../../lib/factionWarsCore";
import {applyPvpMove, PvpRuleError} from "../../../../lib/server/fwpvp-rules";
import type {SubmitMoveRequest} from "../../../../lib/types/fwpvp";

export async function submitPvpMove(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<SubmitMoveRequest>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const moveId = String(body.moveId || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (!moveId) return res.status(400).json({ ok: false, error: "Missing moveId" });

    const current = await getMatch(challengeId);
    if (!current) return res.status(404).json({ ok: false, error: "Match not found" });
    const now = Date.now();
    const {match, round, territoryEnded} = applyPvpMove(current, playerId, moveId, now);
    if (territoryEnded) {
      // Lock spectator side bets if we've entered or passed the lock territory
      // (Layer 2B). 1-indexed admin config; currentTerritory is 0-indexed.
      // Best-effort — failure here doesn't block the match from progressing.
      try {
        const cfg = await getPvpEconomyConfig();
        const lockIdx = Math.max(1, Math.min(TERRITORY_COUNT, cfg.factionWarsBetLockTerritory)) - 1;
        if (match.currentTerritory >= lockIdx) {
          await lockBets(match.challengeId);
        }
      } catch {}
    }
    if (match.status === "completed") {
      // ── Pot payout ──────────────────────────────────────────────────────
      // Pay the winner the full pvpPotPaid (challenger ante + opponent ante).
      // For ties (winnerPlayerId === null), refund both sides equally.
      // Defensive: only pay out if pvpPotPaid > 0 (handles legacy matches and
      // free-mode matches where pvpCost was 0).
      const potOnTable = Number(match.pvpPotPaid ?? 0);
      if (potOnTable > 0) {
        if (match.winnerPlayerId) {
          // Winner takes all. Loser gets nothing — that's the whole point.
          await creditREBEL(match.winnerPlayerId, potOnTable);
        } else if (match.challengerPlayerId && match.opponentPlayerId) {
          // True tie: refund each side their own ante so the books balance.
          // Half the pot to each side. (With 300/300 antes, this is exactly
          // what they paid in.)
          const refundEach = Math.floor(potOnTable / 2);
          if (refundEach > 0) {
            await creditREBEL(match.challengerPlayerId, refundEach);
            await creditREBEL(match.opponentPlayerId, refundEach);
          }
        }
        // Mark the pot as drained so a re-trigger of completion logic
        // (e.g. retry on a flaky save) doesn't double-pay.
        match.pvpPotPaid = 0;
      }

      // ── Crate reward (Commit F) ───────────────────────────────────────
      // On TOP of the pot, the winner gets a crate REBEL bonus matching what
      // AI mode pays for the same rarity. Loser gets nothing. Tie gets nothing.
      // The amount is read live from cfg.rewards (admin-configurable) and
      // snapshotted to match.pvpCrateRewardPaid for client display.
      let crateReward = 0;
      if (match.winnerPlayerId && match.winnerCrateRarity) {
        try {
          const rewards = await getCrateRewards();
          if (match.winnerCrateRarity === "ultra") crateReward = rewards.ultra;
          else if (match.winnerCrateRarity === "rare") crateReward = rewards.rare;
          else if (match.winnerCrateRarity === "common") crateReward = rewards.common;
          if (crateReward > 0) {
            await creditREBEL(match.winnerPlayerId, crateReward);
          }
        } catch {
          // If rewards lookup fails, don't crash completion. Set 0; admin
          // can manually adjust later via wallet endpoint.
          crateReward = 0;
        }
      }
      match.pvpCrateRewardPaid = crateReward;

      // ── Leaderboard recording (Commit J) ──────────────────────────────
      // Record win/loss/streak/REBEL totals for the PvP leaderboards. Best-
      // effort: helper swallows its own errors so a Redis hiccup can't break
      // match completion.
      try {
        const winnerName =
          match.winnerPlayerId === match.challengerPlayerId
            ? (match.challengerDisplayName || "")
            : match.winnerPlayerId === match.opponentPlayerId
              ? (match.opponentDisplayName || "")
              : "";
        const loserName =
          match.loserPlayerId === match.challengerPlayerId
            ? (match.challengerDisplayName || "")
            : match.loserPlayerId === match.opponentPlayerId
              ? (match.opponentDisplayName || "")
              : "";
        const rebelEarned = potOnTable + crateReward;
        await recordPvpResult(
          match.winnerPlayerId || null,
          match.loserPlayerId || null,
          winnerName,
          loserName,
          rebelEarned,
        );
      } catch {}
      // Match concluded — drop from public Live Matches list. Best-effort.
      try { await unmarkActive(match.challengeId); } catch {}
      // Settle spectator side bets (Layer 2B). If there's a winner, payout;
      // if a tie (no winnerPlayerId), refund all bets in full. Idempotent
      // via the BETS_SETTLED flag.
      try {
        if (match.winnerPlayerId && match.loserPlayerId) {
          const winnerSide = match.winnerPlayerId === match.challengerPlayerId ? "challenger" : "opponent";
          await payoutBets(match.challengeId, winnerSide);
        } else {
          await refundBets(match.challengeId);
        }
      } catch {}
      // Tighten chat TTL (Layer 2D). Re-fetch config in case admin changed
      // the cleanup window mid-match. Best-effort.
      try {
        const cfg2 = await getPvpEconomyConfig();
        await tightenChatTTL(match.challengeId, cfg2.factionWarsChatPostCleanupMins);
      } catch {}
    }

    match.updatedAt = now;
    match.lastActionAt = now;
    await saveMatch(match);

    // Tournament auto-advance: if this match is part of a tournament and it
    // just completed, propagate the winner forward and (if not final) spawn
    // the next-round match. Best-effort — failures don't break the response.
    if (match.status === "completed" && match.tournamentId && match.winnerPlayerId && match.loserPlayerId) {
      try {
        await onTournamentMatchComplete(
          match.tournamentId,
          match.challengeId,
          match.winnerPlayerId,
          match.loserPlayerId,
        );
      } catch (e) {
        // swallow — match is already saved, tournament can be repaired manually
      }
    }

    return res.status(200).json({ ok: true, match, round, territoryEnded });
  } catch (e: any) {
    if (e instanceof PvpRuleError) return res.status(e.status).json({ok:false,error:e.message});
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}

export default withPlaygroundMatchExperience("submit-move", submitPvpMove);
