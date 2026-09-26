// Original PvP rules shared by the human handler and RAAP integration.
// No storage, points, notifications or network calls occur here. Randomness is
// still supplied by the original calcDamage; prepare/read must not call this.
import {FACTIONS, MAX_HP, TEAM_SIZE, TERRITORY_COUNT, calcDamage, calcPassiveBonus, FACTION_IDS} from "../factionWarsCore";
import type {Move, FactionId} from "../factionWarsCore";
import type {PvpMatch, PvpRound, PvpSide, PvpTerritoryResult} from "../types/fwpvp";
export class PvpRuleError extends Error {
  constructor(readonly status: number, message: string) {super(message);}
}

export interface PvpHealRules { factionWarsHealCost: number; factionWarsHealAmt: number; factionWarsHealMax: number }

/** Original heal validation/calculation, shared by human play and exact RAAP
 * quotes. No point request, randomness, persistence or ownership lookup. */
export function inspectPvpHeal(match: PvpMatch, playerId: string) {
  if (match.status !== "active") throw new PvpRuleError(409, `Cannot heal; match is ${match.status}`);
  const isChallenger = match.challengerPlayerId === playerId;
  if (!isChallenger && match.opponentPlayerId !== playerId) throw new PvpRuleError(403, "Not a participant in this match");
  if (match.currentTurnPlayerId !== playerId) throw new PvpRuleError(409, "Not your turn");
  const currentHp = isChallenger ? match.challengerHp : match.opponentHp;
  const healsUsed = Number((isChallenger ? match.challengerHealsUsed : match.opponentHealsUsed) ?? 0);
  if (currentHp >= MAX_HP) throw new PvpRuleError(400, "Already at full HP");
  return { isChallenger, currentHp, healsUsed };
}

export function quotePvpHeal(match: PvpMatch, playerId: string, config: PvpHealRules) {
  const current = inspectPvpHeal(match, playerId);
  if (current.healsUsed >= config.factionWarsHealMax) {
    throw new PvpRuleError(400, `Heal limit reached (${config.factionWarsHealMax}/${config.factionWarsHealMax})`);
  }
  return { ...current, cost: config.factionWarsHealCost, restored: Math.min(MAX_HP, current.currentHp + config.factionWarsHealAmt),
    healsMax: config.factionWarsHealMax };
}

export function applyPvpHeal(current: PvpMatch, playerId: string, config: PvpHealRules, now: number) {
  const quote = quotePvpHeal(current, playerId, config), match = structuredClone(current);
  if (quote.isChallenger) {
    match.challengerHp = quote.restored;
    match.challengerHealsUsed = quote.healsUsed + 1;
  } else {
    match.opponentHp = quote.restored;
    match.opponentHealsUsed = quote.healsUsed + 1;
  }
  match.updatedAt = now;
  match.lastActionAt = now;
  return { match, healed: quote.restored - quote.currentHp, cost: quote.cost, healsUsed: quote.healsUsed + 1, healsMax: quote.healsMax };
}
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

export function applyPvpMove(current: PvpMatch, playerId: string, moveId: string, now: number) {
    const match = structuredClone(current);
    if (match.status !== "active") {
      throw new PvpRuleError(409, `Match not active (${match.status})`);
    }
    if (match.currentTurnPlayerId !== playerId) {
      throw new PvpRuleError(403, "Not your turn");
    }

    const attackerSide: PvpSide = match.currentTurnSide!;
    const defenderSide: PvpSide = attackerSide === "challenger" ? "opponent" : "challenger";

    // Resolve attacker / defender factions from the team arrays
    const attackerTeam = attackerSide === "challenger" ? match.challengerTeam : match.opponentTeam;
    const defenderTeam = defenderSide === "challenger" ? match.challengerTeam : match.opponentTeam;
    const attackerIdx = attackerSide === "challenger" ? match.challengerCurrentFactionIndex : match.opponentCurrentFactionIndex;
    const defenderIdx = defenderSide === "challenger" ? match.challengerCurrentFactionIndex : match.opponentCurrentFactionIndex;

    if (attackerIdx >= TEAM_SIZE || defenderIdx >= TEAM_SIZE) {
      throw new PvpRuleError(409, "No active fighter on one or both sides");
    }

    const attackerFaction = attackerTeam[attackerIdx];
    const defenderFaction = defenderTeam[defenderIdx];

    // Validate move belongs to attacker's current faction
    const move = findMoveOnFaction(attackerFaction, moveId);
    if (!move) {
      throw new PvpRuleError(400, "Move does not belong to active faction");
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
      match.currentTurnSide = defenderSide;
      match.currentTurnPlayerId = defenderSide === "challenger" ? match.challengerPlayerId : match.opponentPlayerId;
    }
    match.updatedAt = now;
    match.lastActionAt = now;
    return {match, round, territoryEnded};
}

const VALID = new Set<string>(FACTION_IDS);

export function sanitizeTeam(raw: unknown): FactionId[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== TEAM_SIZE) return null;
  const seen = new Set<string>();
  const out: FactionId[] = [];
  for (const item of raw) {
    const id = String(item).toLowerCase();
    if (!VALID.has(id)) return null;
    if (seen.has(id)) return null;
    seen.add(id);
    out.push(id as FactionId);
  }
  return out;
}

export function applyPvpTeam(current: PvpMatch, playerId: string, rawTeam: unknown, now: number): PvpMatch {
    const team = sanitizeTeam(rawTeam);
    if (!team) throw new PvpRuleError(400, "Invalid team (need 5 unique factions)");
    const match = structuredClone(current);
    // Allow team submission during pending (challenger only) OR team_selection (either)
    const isChallenger = playerId === match.challengerPlayerId;
    const isOpponent = playerId === match.opponentPlayerId;
    if (!isChallenger && !isOpponent) {
      throw new PvpRuleError(403, "You are not a participant in this match");
    }
    if (match.status !== "pending" && match.status !== "team_selection") {
      throw new PvpRuleError(409, `Cannot select team; match is ${match.status}`);
    }
    if (match.status === "pending" && !isChallenger) {
      throw new PvpRuleError(409, "Opponent has not accepted yet");
    }

    if (isChallenger) match.challengerTeam = team;
    if (isOpponent) match.opponentTeam = team;
    match.updatedAt = now;
    match.lastActionAt = now;

    // If both teams are locked AND we're in team_selection, transition to active.
    const bothLocked = match.challengerTeam.length === TEAM_SIZE && match.opponentTeam.length === TEAM_SIZE;
    if (bothLocked && match.status === "team_selection") {
      match.status = "active";
      match.currentTurnSide = "challenger";
      match.currentTurnPlayerId = match.challengerPlayerId;
    }

    return match;
}
