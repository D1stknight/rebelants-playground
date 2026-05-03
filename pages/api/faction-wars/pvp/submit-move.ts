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
import { getMatch, saveMatch } from "../../../../lib/server/fwpvp";
import {
  FACTIONS,
  MAX_HP,
  TEAM_SIZE,
  TERRITORY_COUNT,
  calcDamage,
  calcPassiveBonus,
} from "../../../../lib/factionWarsCore";
import type { Move, FactionId } from "../../../../lib/factionWarsCore";
import type {
  PvpMatch,
  PvpRound,
  PvpSide,
  PvpTerritoryResult,
  SubmitMoveRequest,
} from "../../../../lib/types/fwpvp";

function findMoveOnFaction(factionId: FactionId, moveId: string): Move | null {
  const f = FACTIONS[factionId];
  if (!f) return null;
  const m = f.moves.find((mv) => mv.id === moveId);
  return m || null;
}

function rarityForWins(won: number): "common" | "rare" | "ultra" | null {
  if (won >= 5) return "ultra";
  if (won >= 4) return "rare";
  if (won >= 3) return "common";
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const match: PvpMatch | null = await getMatch(challengeId);
    if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
    if (match.status !== "active") {
      return res.status(409).json({ ok: false, error: `Match not active (${match.status})` });
    }
    if (match.currentTurnPlayerId !== playerId) {
      return res.status(403).json({ ok: false, error: "Not your turn" });
    }

    const attackerSide: PvpSide = match.currentTurnSide!;
    const defenderSide: PvpSide = attackerSide === "challenger" ? "opponent" : "challenger";

    // Resolve attacker / defender factions from the team arrays
    const attackerTeam = attackerSide === "challenger" ? match.challengerTeam : match.opponentTeam;
    const defenderTeam = defenderSide === "challenger" ? match.challengerTeam : match.opponentTeam;
    const attackerIdx = attackerSide === "challenger" ? match.challengerCurrentFactionIndex : match.opponentCurrentFactionIndex;
    const defenderIdx = defenderSide === "challenger" ? match.challengerCurrentFactionIndex : match.opponentCurrentFactionIndex;

    if (attackerIdx >= TEAM_SIZE || defenderIdx >= TEAM_SIZE) {
      return res.status(409).json({ ok: false, error: "No active fighter on one or both sides" });
    }

    const attackerFaction = attackerTeam[attackerIdx];
    const defenderFaction = defenderTeam[defenderIdx];

    // Validate move belongs to attacker's current faction
    const move = findMoveOnFaction(attackerFaction, moveId);
    if (!move) {
      return res.status(400).json({ ok: false, error: "Move does not belong to active faction" });
    }

    // ── Damage calculation ────────────────────────────────────────────────
    // PvP cap symmetry: pass isPlayer=true on both sides so the cap is 24
    // for both. (AI mode caps player at 24, AI at 28.)
    const attackerSideTerritoriesWon = attackerSide === "challenger"
      ? match.challengerTerritoriesWon
      : match.opponentTerritoriesWon;
    const attackerSideTerritoriesLost = attackerSide === "challenger"
      ? match.opponentTerritoriesWon
      : match.challengerTerritoriesWon;
    const isFirstFighterOnSide = attackerIdx === 0;
    const passiveBonus = calcPassiveBonus(attackerFaction, attackerSideTerritoriesWon, isFirstFighterOnSide);

    const damage = calcDamage(
      move,
      attackerFaction,
      defenderFaction,
      passiveBonus,
      attackerSideTerritoriesWon,
      attackerSideTerritoriesLost,
      0.5,   // diff (medium difficulty constant; only used by AI cap, not relevant in PvP)
      true   // isPlayer=true on both sides for cap symmetry
    );

    // Apply damage to defender HP
    const now = Date.now();
    if (defenderSide === "challenger") {
      match.challengerHp = Math.max(0, match.challengerHp - damage);
    } else {
      match.opponentHp = Math.max(0, match.opponentHp - damage);
    }
    const defenderHpAfter = defenderSide === "challenger" ? match.challengerHp : match.opponentHp;

    // Round counter: count rounds within current territory
    const roundsThisTerritory = match.roundHistory.filter((r) => r.territory === match.currentTerritory).length;

    const round: PvpRound = {
      territory: match.currentTerritory,
      roundInTerritory: roundsThisTerritory + 1,
      attackerSide,
      attackerFaction,
      defenderFaction,
      moveId,
      moveType: move.type,
      damageDealt: damage,
      defenderHpAfter,
      byPlayerId: playerId,
      at: now,
    };
    match.roundHistory.push(round);

    // ── Territory transition check ────────────────────────────────────────
    let territoryEnded = false;
    if (defenderHpAfter <= 0) {
      territoryEnded = true;
      // Attacker wins this territory
      if (attackerSide === "challenger") match.challengerTerritoriesWon += 1;
      else match.opponentTerritoriesWon += 1;

      const tr: PvpTerritoryResult = {
        territory: match.currentTerritory,
        challengerFaction: match.challengerTeam[match.challengerCurrentFactionIndex],
        opponentFaction: match.opponentTeam[match.opponentCurrentFactionIndex],
        winnerSide: attackerSide,
        challengerHpFinal: match.challengerHp,
        opponentHpFinal: match.opponentHp,
        rounds: roundsThisTerritory + 1,
      };
      match.territoryResults.push(tr);

      // Advance both fighters and reset HPs
      match.challengerCurrentFactionIndex += 1;
      match.opponentCurrentFactionIndex += 1;
      match.challengerHp = MAX_HP;
      match.opponentHp = MAX_HP;
      match.currentTerritory += 1;
    }

    // ── Match completion check ────────────────────────────────────────────
    const allTerritoriesPlayed = match.currentTerritory >= TERRITORY_COUNT;
    const challengerOutOfFighters = match.challengerCurrentFactionIndex >= TEAM_SIZE;
    const opponentOutOfFighters = match.opponentCurrentFactionIndex >= TEAM_SIZE;

    if (allTerritoriesPlayed || challengerOutOfFighters || opponentOutOfFighters) {
      match.status = "completed";
      match.currentTurnPlayerId = null;
      match.currentTurnSide = null;
      // Winner = side with more territoriesWon (no tie possible with 5 territories)
      if (match.challengerTerritoriesWon > match.opponentTerritoriesWon) {
        match.winnerPlayerId = match.challengerPlayerId;
        match.loserPlayerId = match.opponentPlayerId;
        match.winnerCrateRarity = rarityForWins(match.challengerTerritoriesWon);
      } else if (match.opponentTerritoriesWon > match.challengerTerritoriesWon) {
        match.winnerPlayerId = match.opponentPlayerId;
        match.loserPlayerId = match.challengerPlayerId;
        match.winnerCrateRarity = rarityForWins(match.opponentTerritoriesWon);
      } else {
        // Tie (rare with 5 territories — could happen if territory_count becomes even later)
        match.winnerPlayerId = null;
        match.loserPlayerId = null;
        match.winnerCrateRarity = null;
      }
    } else {
      // Match continues — flip turn
      match.currentTurnSide = defenderSide;
      match.currentTurnPlayerId = defenderSide === "challenger" ? match.challengerPlayerId : match.opponentPlayerId;
    }

    match.updatedAt = now;
    match.lastActionAt = now;
    await saveMatch(match);

    return res.status(200).json({ ok: true, match, round, territoryEnded });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
