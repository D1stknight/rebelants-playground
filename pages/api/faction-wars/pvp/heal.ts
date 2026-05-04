// POST /api/faction-wars/pvp/heal
//
// Allows a player to spend REBEL to restore HP during their turn. Mirrors
// the AI mode heal exactly: same admin config keys (factionWarsHealCost,
// factionWarsHealAmt, factionWarsHealMax), same restore semantics.
//
// Why "during their turn" only? Simplifies edge cases. AI mode allows heal
// any time because there's no concurrent state to clash with — but in PvP
// constraining heal to your own turn means we don't have to handle "heal
// arrives during opponent's submit-move" race conditions. UX-wise this is
// fine: the player can heal, then play their move.
//
// Validates server-side (do not trust the client):
//   - match exists and is "active"
//   - playerId is a participant
//   - it's currently this player's turn
//   - currentHp < MAX_HP (don't waste REBEL on a no-op)
//   - healsUsed < factionWarsHealMax
//   - balance >= factionWarsHealCost
//
// On success: spends REBEL atomically, increments HP (capped at MAX_HP),
// increments healsUsed, returns updated match + new balance.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getMatch,
  saveMatch,
  spendREBEL,
  getREBELBalance,
  getHealConfig,
} from "../../../../lib/server/fwpvp";
import { MAX_HP } from "../../../../lib/factionWarsCore";
import type { PvpMatch } from "../../../../lib/types/fwpvp";

interface HealRequest {
  challengeId?: string;
  playerId?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as HealRequest;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });

    const match: PvpMatch | null = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (match.status !== "active") {
      return res.status(409).json({ ok: false, error: `Cannot heal; match is ${match.status}` });
    }

    const isChallenger = match.challengerPlayerId === playerId;
    const isOpponent = match.opponentPlayerId === playerId;
    if (!isChallenger && !isOpponent) {
      return res.status(403).json({ ok: false, error: "Not a participant in this match" });
    }
    if (match.currentTurnPlayerId !== playerId) {
      return res.status(409).json({ ok: false, error: "Not your turn" });
    }

    const currentHp = isChallenger ? match.challengerHp : match.opponentHp;
    const healsUsed = isChallenger
      ? Number(match.challengerHealsUsed ?? 0)
      : Number(match.opponentHealsUsed ?? 0);

    if (currentHp >= MAX_HP) {
      return res.status(400).json({ ok: false, error: "Already at full HP" });
    }

    const healCfg = await getHealConfig();
    if (healsUsed >= healCfg.factionWarsHealMax) {
      return res.status(400).json({
        ok: false,
        error: `Heal limit reached (${healCfg.factionWarsHealMax}/${healCfg.factionWarsHealMax})`,
      });
    }

    const cost = healCfg.factionWarsHealCost;
    if (cost > 0) {
      const bal = await getREBELBalance(playerId);
      if (bal < cost) {
        return res.status(400).json({
          ok: false,
          error: `Insufficient REBEL. Need ${cost}, have ${bal}.`,
          balance: bal,
          required: cost,
        });
      }
      const newBal = await spendREBEL(playerId, cost);
      if (newBal === null) {
        return res.status(400).json({ ok: false, error: "Could not deduct heal cost (try again)" });
      }
    }

    // Apply the heal.
    const restored = Math.min(MAX_HP, currentHp + healCfg.factionWarsHealAmt);
    const now = Date.now();
    if (isChallenger) {
      match.challengerHp = restored;
      match.challengerHealsUsed = healsUsed + 1;
    } else {
      match.opponentHp = restored;
      match.opponentHealsUsed = healsUsed + 1;
    }
    match.updatedAt = now;
    match.lastActionAt = now;

    await saveMatch(match);

    const newBalance = await getREBELBalance(playerId);
    return res.status(200).json({
      ok: true,
      match,
      healed: restored - currentHp,
      cost,
      balance: newBalance,
      healsUsed: healsUsed + 1,
      healsMax: healCfg.factionWarsHealMax,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
