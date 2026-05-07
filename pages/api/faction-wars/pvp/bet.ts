// POST /api/faction-wars/pvp/bet
//
// Spectator places (or tops up) a side bet on a PvP match.
//
// Validation:
//   - match exists and is in a bettable state (team_selection or active before lock territory)
//   - bets aren't locked (territory < factionWarsBetLockTerritory)
//   - player isn't a participant (challenger or opponent)
//   - amount within [factionWarsBetMin, factionWarsBetMax]
//   - new pool total stays under factionWarsBetPoolCap
//   - if topping up, new bet must stay on the same side as existing bet
//   - bet system enabled (factionWarsBetEnabled)
//   - player has enough REBEL balance (debited by placeBet)
//
// Returns the updated PvpBetsState + the player's new balance.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getMatch,
  getPvpEconomyConfig,
  placeBet,
  getBets,
  isBetsLocked,
} from "../../../../lib/server/fwpvp";
import { TERRITORY_COUNT } from "../../../../lib/factionWarsCore";
import type { PlaceBetRequest } from "../../../../lib/types/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as Partial<PlaceBetRequest>;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);
    const displayName = String(body.displayName || "").trim().slice(0, 32);
    const side = body.side === "challenger" || body.side === "opponent" ? body.side : null;
    const amount = Math.floor(Number(body.amount));

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });
    if (!displayName) return res.status(400).json({ ok: false, error: "Missing displayName" });
    if (!side) return res.status(400).json({ ok: false, error: "Side must be 'challenger' or 'opponent'" });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: "Amount must be a positive integer" });

    const [match, cfg, locked] = await Promise.all([
      getMatch(challengeId),
      getPvpEconomyConfig(),
      isBetsLocked(challengeId),
    ]);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (!cfg.factionWarsBetEnabled) {
      return res.status(403).json({ ok: false, error: "Side bets are currently disabled" });
    }
    if (locked) return res.status(409).json({ ok: false, error: "Bets are locked for this match" });

    // Status gate — only bettable while teams are picking or match is active
    // and current territory is below the lock threshold.
    if (match.status !== "team_selection" && match.status !== "active") {
      return res.status(409).json({ ok: false, error: `Match is ${match.status} — bets closed` });
    }
    // factionWarsBetLockTerritory is 1-indexed (1..5). currentTerritory is 0-indexed.
    // Bets close when match has ENTERED the lock territory: currentTerritory >= lockTerritory - 1.
    const lockIdx = Math.max(1, Math.min(TERRITORY_COUNT, cfg.factionWarsBetLockTerritory)) - 1;
    if (match.currentTerritory >= lockIdx) {
      return res.status(409).json({ ok: false, error: "Bets locked — match has progressed too far" });
    }

    // Participant check
    if (match.challengerPlayerId === playerId || match.opponentPlayerId === playerId) {
      return res.status(403).json({ ok: false, error: "Players can't bet on their own match" });
    }

    // Bet amount limits
    if (amount < cfg.factionWarsBetMin) {
      return res.status(400).json({ ok: false, error: `Minimum bet is ${cfg.factionWarsBetMin} REBEL` });
    }
    if (amount > cfg.factionWarsBetMax) {
      return res.status(400).json({ ok: false, error: `Maximum single bet is ${cfg.factionWarsBetMax} REBEL` });
    }

    // Pool cap check (per side)
    const currentBets = await getBets(challengeId);
    const sidePool = side === "challenger" ? currentBets.challengerPool : currentBets.opponentPool;
    if (sidePool + amount > cfg.factionWarsBetPoolCap) {
      const room = Math.max(0, cfg.factionWarsBetPoolCap - sidePool);
      return res.status(409).json({
        ok: false,
        error: `Pool cap reached. Max additional on ${side}: ${room} REBEL.`,
      });
    }

    const result = await placeBet({ challengeId, playerId, displayName, side, amount });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    const fresh = await getBets(challengeId);
    return res.status(200).json({
      ok: true,
      bet: result.bet,
      newBalance: result.newBalance,
      bets: fresh,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "bet failed" });
  }
}
