// POST /api/faction-wars/pvp/cast-spell
//
// Allows a player to spend REBEL to cast a Death Spell on the opposing
// fighter. Once-per-match per side. The spell applies wall-clock DoT
// damage (factionWarsSpellDot HP per second for factionWarsSpellDuration
// seconds) regardless of whose turn it is, and persists across territory
// transitions. Heals do NOT suspend the DoT — victim can heal normally
// to outpace it.
//
// Validates server-side:
//   - match exists and is "active"
//   - playerId is a participant
//   - the caster has not already used their spell this match
//   - balance >= factionWarsSpellCost
//   - spell mechanic is enabled (factionWarsSpellEnabled)
//
// On success: spends REBEL, marks {challenger,opponent}SpellUsed = true,
// installs an active spell record on spell{Caster}Active pointing at the
// opposing fighter. Returns the updated match snapshot.

import type { NextApiRequest, NextApiResponse } from "next";
import {
  getMatch,
  saveMatch,
  spendREBEL,
  getREBELBalance,
  getSpellConfig,
  applySpellTick,
} from "../../../../lib/server/fwpvp";
import type { PvpMatch } from "../../../../lib/types/fwpvp";

interface CastSpellRequest {
  challengeId?: string;
  playerId?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}) as CastSpellRequest;
    const challengeId = String(body.challengeId || "").trim().slice(0, 64);
    const playerId = String(body.playerId || "").trim().slice(0, 64);

    if (!challengeId) return res.status(400).json({ ok: false, error: "Missing challengeId" });
    if (!playerId) return res.status(400).json({ ok: false, error: "Missing playerId" });

    const match = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (match.status !== "active") {
      return res.status(409).json({ ok: false, error: "Match is not active" });
    }

    const isChallenger = match.challengerPlayerId === playerId;
    const isOpponent = match.opponentPlayerId === playerId;
    if (!isChallenger && !isOpponent) {
      return res.status(403).json({ ok: false, error: "Not a participant in this match" });
    }

    const cfg = await getSpellConfig();
    if (!cfg.factionWarsSpellEnabled) {
      return res.status(400).json({ ok: false, error: "Spell mechanic is currently disabled" });
    }

    const alreadyUsed = isChallenger ? match.challengerSpellUsed : match.opponentSpellUsed;
    if (alreadyUsed) {
      return res.status(400).json({ ok: false, error: "You have already cast your spell this match" });
    }

    const cost = cfg.factionWarsSpellCost;
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
        return res.status(400).json({ ok: false, error: "Could not deduct spell cost (try again)" });
      }
    }

    // Install the active spell. `getMatch` already projected any prior
    // ticks into match HP; since this caster has no prior spell, that
    // doesn't matter here. We set lastTickAt = now so the first damage
    // applies one second from now (not retroactively).
    const now = Date.now();
    const targetSide: "challenger" | "opponent" = isChallenger ? "opponent" : "challenger";
    const spell = {
      targetSide,
      startedAt: now,
      expiresAt: now + cfg.factionWarsSpellDuration * 1000,
      lastTickAt: now,
      damageApplied: 0,
    };
    if (isChallenger) {
      match.challengerSpellUsed = true;
      match.spellChallengerActive = spell;
    } else {
      match.opponentSpellUsed = true;
      match.spellOpponentActive = spell;
    }
    match.updatedAt = now;
    match.lastActionAt = now;

    // Apply any immediately-due ticks (none on freshly-installed spell, but
    // safe to call) so the persisted state reflects what the next read will
    // project.
    applySpellTick(match, now, cfg);
    await saveMatch(match);

    return res.status(200).json({
      ok: true,
      match,
      cost,
      spellExpiresAt: spell.expiresAt,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || "Server error") });
  }
}
