import { FACTIONS, FACTION_IDS, MAX_HP, TEAM_SIZE, TERRITORY_COUNT, calcBlock,
  calcDamage, calcPassiveBonus, calcRarity, pickEnemyMove,
  type FactionId, type Move, type Rarity, type RoundResult, type TerritoryResult } from "./factionWarsSoloRules";

export interface SoloConfig {
  cost: number; difficulty: number; plunder: number;
  healCost: number; healAmount: number; healMaximum: number;
  rewards: { common: number; rare: number; ultra: number };
}
export interface SoloCampaign {
  team: FactionId[]; defenders: FactionId[];
  phase: "battle" | "territory_result" | "final_result";
  territory: number; playerHp: number; enemyHp: number; rounds: RoundResult[];
  results: TerritoryResult[]; usedMoves: Record<string, number>; oneTimeUsed: string[];
  sacrificeBonus: number; powerBuffAmount: number; powerBuffRounds: number;
  comboBonus: number; commandActive: boolean; meditationStacks: number;
  berserkerActive: boolean; strategicRetreatUsed: boolean; plunderPending: boolean;
  healUsed: number; moves: number; rarity: Rarity; reward: number;
}
export type SoloCommand = { kind: "MOVE"; moveId: string } | { kind: "HEAL" } | { kind: "NEXT" };
export interface SoloPointEffect { direction: "DEBIT" | "CREDIT"; amount: number; reason: string }
const invalid = (): never => { throw Error("SOLO_COMMAND_UNAVAILABLE"); };

/** Settings are server-loaded. Browser quotes are compared to these values,
 * never accepted as a new game configuration. */
export function soloConfig(value: Record<string, any>): SoloConfig {
  const number = (value: unknown, fallback: number, max = 1_000_000) => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) invalid();
    return n;
  };
  const difficulty = Number(value.factionWarsAIDifficulty ?? 0.75);
  if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 1) invalid();
  return { cost: number(value.factionWarsCost, 150), difficulty,
    plunder: number(value.factionWarsPlunderBonus, 50), healCost: number(value.factionWarsHealCost, 25),
    healAmount: number(value.factionWarsHealAmt, 30, MAX_HP), healMaximum: number(value.factionWarsHealMax, 2, 100),
    rewards: { common: number(value.rewards?.common, 50), rare: number(value.rewards?.rare, 100), ultra: number(value.rewards?.ultra, 300) } };
}

export function soloEntryCost(team: FactionId[], config: SoloConfig) {
  return team.includes("ashigaru") ? Math.max(0, config.cost - 25) : config.cost;
}

export function newSoloCampaign(team: FactionId[], random: () => number): SoloCampaign {
  if (!Array.isArray(team) || team.length !== TEAM_SIZE || new Set(team).size !== TEAM_SIZE ||
    team.some(f => !FACTION_IDS.includes(f))) invalid();
  const available = [...FACTION_IDS], defenders: FactionId[] = [];
  for (let i = 0; i < TERRITORY_COUNT; i++) {
    const index = Math.floor(random() * available.length);
    if (index < 0 || index >= available.length) invalid();
    defenders.push(available[index]); available.splice(index, 1);
  }
  return { team: [...team], defenders, phase: "battle", territory: 0,
    playerHp: MAX_HP, enemyHp: MAX_HP, rounds: [], results: [], usedMoves: {}, oneTimeUsed: [],
    sacrificeBonus: 0, powerBuffAmount: 0, powerBuffRounds: 0, comboBonus: 0,
    commandActive: false, meditationStacks: 0, berserkerActive: false,
    strategicRetreatUsed: false, plunderPending: false, healUsed: 0, moves: 0, rarity: "none", reward: 0 };
}

/** Resolve one human choice using the existing solo rules. All random draws
 * come from the server. It returns point intents; it cannot send them itself.
 * Damage deliberately retains the current browser's effective HP semantics for
 * iron_meditation/blood_price, rather than silently changing game balance. */
export function advanceSoloCampaign(previous: SoloCampaign, command: SoloCommand, config: SoloConfig,
  random: () => number): { state: SoloCampaign; effects: SoloPointEffect[] } {
  const s = structuredClone(previous), effects: SoloPointEffect[] = [];
  const credit = (amount: number, reason: string) => { if (amount > 0) effects.push({ direction: "CREDIT", amount, reason }); };
  if (s.phase === "final_result") invalid();
  if (command.kind === "NEXT") {
    if (s.phase !== "territory_result" || s.results.length !== s.territory + 1) invalid();
    if (s.territory + 1 === TERRITORY_COUNT) {
      const won = s.results.filter(r => r.won).length;
      s.rarity = calcRarity(won);
      s.reward = s.rarity === "none" ? 0 : config.rewards[s.rarity];
      if (s.team.includes("shogun") && s.rarity === "ultra") s.reward = Math.floor(s.reward * 1.15);
      const defenses = s.results.reduce((sum, r) => sum + r.rounds.filter(round => round.playerMove.type === "defend").length, 0);
      if (s.rarity === "none" && (s.strategicRetreatUsed || s.team.includes("buke") && defenses >= 3)) {
        s.rarity = "common"; s.reward = config.rewards.common;
      }
      credit(s.reward, "Faction Wars campaign reward"); s.phase = "final_result";
    } else {
      s.territory++; s.playerHp = MAX_HP; s.enemyHp = MAX_HP; s.rounds = [];
      s.usedMoves = {}; s.berserkerActive = false; s.phase = "battle";
      if (s.meditationStacks > 0) { s.powerBuffAmount = s.meditationStacks * 2; s.powerBuffRounds = 99; }
    }
    return { state: s, effects };
  }
  if (s.phase !== "battle") invalid();
  if (command.kind === "HEAL") {
    if (s.playerHp >= MAX_HP || s.playerHp <= 0 || s.healUsed >= config.healMaximum) invalid();
    if (config.healCost > 0) effects.push({ direction: "DEBIT", amount: config.healCost, reason: "Faction Wars healing" });
    s.playerHp = Math.min(MAX_HP, s.playerHp + config.healAmount); s.healUsed++;
    return { state: s, effects };
  }
  if (command.kind !== "MOVE") invalid();
  const faction = s.team[s.territory], defender = s.defenders[s.territory];
  const move = FACTIONS[faction].moves.find(m => m.id === command.moveId);
  if (!move || move.oneTime && s.oneTimeUsed.includes(move.id) || s.berserkerActive && move.type === "defend") invalid();
  const selected = move!, won = s.results.filter(r => r.won).length, lost = s.results.length - won;
  const bonus = calcPassiveBonus(faction, won, s.territory === 0) + s.sacrificeBonus +
    (s.powerBuffRounds > 0 ? s.powerBuffAmount : 0) + s.comboBonus + (s.commandActive ? 8 : 0);
  s.sacrificeBonus = 0; if (s.powerBuffRounds > 0) s.powerBuffRounds--; s.commandActive = false;
  const enemy = ["imperial_decree", "final_command"].includes(selected.id)
    ? FACTIONS[defender].moves.reduce((a, b) => a.power < b.power ? a : b)
    : pickEnemyMove(defender, selected, config.difficulty, s.enemyHp, s.playerHp, s.territory, random);
  const degraded: Move = { ...selected, power: Math.max(1, selected.power - (s.usedMoves[selected.id] || 0)) };
  s.usedMoves[selected.id] = (s.usedMoves[selected.id] || 0) + 1;
  if (selected.oneTime) s.oneTimeUsed.push(selected.id);
  s.moves++;
  if (selected.id === "berserker_rage") s.berserkerActive = true;
  if (selected.id === "iron_code") { s.powerBuffAmount = 3; s.powerBuffRounds = 8; }
  if (selected.id === "death_mark") { s.powerBuffAmount = 2; s.powerBuffRounds = 4; }
  if (["blade_harmony", "honor_bond"].includes(selected.id)) s.comboBonus += 3;
  if (selected.id === "command_strike") s.commandActive = true;
  if (selected.id === "meditation") s.meditationStacks++;
  if (selected.id === "iron_meditation") { s.powerBuffAmount = 3; s.powerBuffRounds = 4; }
  if (selected.id === "battle_cry") { s.powerBuffAmount = 4; s.powerBuffRounds = 5; }
  if (selected.id === "spirit_vision") s.powerBuffAmount = Math.max(s.powerBuffAmount, 3);
  if (["divine_auth", "plunder"].includes(selected.id)) s.plunderPending = true;
  if (selected.id === "strategic_ret") s.strategicRetreatUsed = true;
  if (selected.id === "cutlass_raid" && random() < 0.4) credit(10, "Faction Wars cutlass raid");
  if (selected.id === "mountain_seal") s.powerBuffAmount += 3;
  const finishTerritory = (round: RoundResult, win: boolean) => {
    s.rounds.push(round);
    s.results.push({ territory: s.territory, defender, playerFaction: faction,
      rounds: [...s.rounds], playerHpFinal: s.playerHp, enemyHpFinal: s.enemyHp, won: win });
    s.phase = "territory_result";
  };
  if (selected.id === "noble_sacrifice") {
    s.sacrificeBonus = 12; s.playerHp = 0;
    finishTerritory({ round: s.rounds.length + 1, playerMove: selected, enemyMove: selected,
      playerDmg: 0, enemyDmg: 100, playerHpAfter: 0, enemyHpAfter: s.enemyHp }, false);
    return { state: s, effects };
  }
  const last = s.rounds[s.rounds.length - 1];
  const counters: Record<string, string[]> = { attack: ["defend", "trick"], defend: ["magic", "attack"], magic: ["trick", "defend"], trick: ["attack", "magic"] };
  const extra = (selected.id === "ambush" && enemy.type === "attack" ? 4 : 0) +
    (selected.id === "counter_strike" ? Math.round(enemy.power * 1.2) : 0) +
    (selected.id === "perfect_form" && last?.enemyDmg === 0 ? 3 : 0) +
    (selected.id === "mountain_echo" && last ? Math.round(last.playerDmg * 0.7) : 0) +
    (selected.id === "mirror_slash" && last ? last.enemyDmg : 0) +
    (selected.id === "final_command" ? 6 : 0) + (selected.id === "officers_order" ? 3 : 0) +
    (selected.id === "tactical_blade" && degraded.type === "attack" ? 2 : 0) +
    (selected.id === "field_intel" && (counters[enemy.type] || []).includes(selected.type) ? 3 : 0) +
    (selected.id === "strategic_mind" ? won * 2 : 0) + (selected.id === "last_stand" && s.playerHp < 40 ? 15 : 0);
  const forDamage = selected.id === "sea_storm" ? { ...degraded, power: Math.floor(random() * 7) + 4 } : degraded;
  const playerDamage = calcDamage(forDamage, faction, defender, bonus + extra, won, lost, config.difficulty, true, random);
  const rawEnemyDamage = calcDamage(enemy, defender, faction, 0, 0, 0, config.difficulty, false, random);
  const block = calcBlock(selected) * (selected.id === "precision_slash" ? 0.3 : 1);
  const enemyDamage = selected.id === "endure" ? 0 : Math.round(Math.max(0, rawEnemyDamage - (selected.id === "war_stomp" ? 3 : 0)) * (1 - block));
  s.playerHp = Math.max(0, s.playerHp - enemyDamage); s.enemyHp = Math.max(0, s.enemyHp - playerDamage);
  const round: RoundResult = { round: s.rounds.length + 1, playerMove: selected, enemyMove: enemy,
    playerDmg: playerDamage, enemyDmg: enemyDamage, playerHpAfter: s.playerHp, enemyHpAfter: s.enemyHp };
  // Endure preserves the existing special rule: it never ends a territory alone.
  if (selected.id !== "endure" && (s.playerHp <= 0 || s.enemyHp <= 0)) {
    const win = s.enemyHp <= 0;
    if (win && s.plunderPending) { credit(config.plunder, "Faction Wars plunder"); s.plunderPending = false; }
    finishTerritory(round, win);
  } else s.rounds.push(round);
  return { state: s, effects };
}
