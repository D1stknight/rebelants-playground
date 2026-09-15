// lib/descentConfig.ts
// Hive Descent v2 — turn-based roguelite on the Faction Wars 3D cast.
// Entry costs REBEL (admin key `descentCost`), rewards are REBEL per floor (see biomes.ts).

export const DESCENT_DEFAULT_COST = 300;          // REBEL to start a run (admin override: pointsConfig.descentCost)
export const DESCENT_TOTAL_FLOORS = 10;
export const DESCENT_DEATH_PENALTY = 0.5;         // keep 50% of unbanked REBEL on death
export const DESCENT_CASHOUT_FLOORS = [3, 6, 9];  // floors that offer the escape option

// ── Turn combat constants ────────────────────────────────────────────────
export const BASE_MAX_HP = 100;
export const BASE_ATTACK_DAMAGE = 18;
export const BASE_CRIT_CHANCE = 0.10;
export const BASE_CRIT_MULT = 1.6;
export const DEFEND_DAMAGE_TAKEN = 0.35;          // incoming damage multiplier while defending
export const DEFEND_HEAL = 5;
export const MAGIC_DAMAGE = 14;                   // ignores enemy guard
export const MAGIC_COOLDOWN_TURNS = 2;
export const SPECIAL_COOLDOWN_TURNS = 3;
export const ENEMY_GUARD_MULT = 0.5;              // player damage multiplier when enemy is guarding
export const ENEMY_HEAVY_MULT = 1.7;
export const BOSS_SPECIAL_MULT = 2.2;
export const BURN_DAMAGE = 4;                     // per turn (ignite relics)
export const BURN_TURNS = 2;

export const HEAL_AMOUNT = 40;
export const POWER_DAMAGE_BONUS = 0.25;

// ── Faction specials (the 11 real Rebel Ants factions) ───────────────────
export type SpecialEffect =
  | { kind: "strike"; dmg: number; crit?: boolean; guardThisTurn?: number }
  | { kind: "multi"; dmg: number; hits: number }
  | { kind: "berserk"; dmg: number; selfDamageTakenMult: number }
  | { kind: "rally"; dmg: number; buffMult: number; buffTurns: number }
  | { kind: "poison"; dmg: number; dot: number; dotTurns: number }
  | { kind: "drain"; dmg: number; heal: number }
  | { kind: "heal"; amount: number }
  | { kind: "fortify"; heal: number; guardThisTurn: number }
  | { kind: "stun"; dmg: number; stunTurns: number };

export type DescentFaction = {
  id: string; name: string;
  specialName: string; blurb: string;
  effect: SpecialEffect;
};

export const DESCENT_FACTIONS: ReadonlyArray<DescentFaction> = [
  { id: "ashigaru",  name: "Ashigaru",  specialName: "Spear Wall",    blurb: "Strike and brace. 22 damage, then take only half this turn.",       effect: { kind: "strike", dmg: 22, guardThisTurn: 0.5 } },
  { id: "ronin",     name: "Ronin",     specialName: "Iaido",         blurb: "One cut. 32 damage, no questions.",                                 effect: { kind: "strike", dmg: 32 } },
  { id: "samurai",   name: "Samurai",   specialName: "Bushido Cut",   blurb: "26 damage and it always crits.",                                    effect: { kind: "strike", dmg: 26, crit: true } },
  { id: "bushi",     name: "Bushi",     specialName: "Fortify",       blurb: "Heal 30 and block 70% of anything that comes this turn.",            effect: { kind: "fortify", heal: 30, guardThisTurn: 0.3 } },
  { id: "warrior",   name: "Warriors",  specialName: "Berserk",       blurb: "40 damage. You take +50% this turn. Worth it.",                     effect: { kind: "berserk", dmg: 40, selfDamageTakenMult: 1.5 } },
  { id: "shogun",    name: "Shogun",    specialName: "Command",       blurb: "20 damage, then +30% damage for the next 2 turns.",                 effect: { kind: "rally", dmg: 20, buffMult: 1.3, buffTurns: 2 } },
  { id: "buke",      name: "Buke",      specialName: "Poison Blade",  blurb: "14 damage, then 8 poison a turn for 3 turns.",                      effect: { kind: "poison", dmg: 14, dot: 8, dotTurns: 3 } },
  { id: "kenshi",    name: "Kenshi",    specialName: "Twin Strike",   blurb: "Two cuts of 15. Each can crit.",                                    effect: { kind: "multi", dmg: 15, hits: 2 } },
  { id: "wokou",     name: "Wokou",     specialName: "Plunder",       blurb: "18 damage and steal 14 HP back.",                                   effect: { kind: "drain", dmg: 18, heal: 14 } },
  { id: "sohei",     name: "Sohei",     specialName: "Prayer",        blurb: "Heal 40. The hive can wait.",                                       effect: { kind: "heal", amount: 40 } },
  { id: "yamabushi", name: "Yamabushi", specialName: "Mountain Wind", blurb: "24 damage and the enemy loses its next turn.",                      effect: { kind: "stun", dmg: 24, stunTurns: 1 } },
];

export function getDescentFaction(id: string): DescentFaction {
  return DESCENT_FACTIONS.find((f) => f.id === id) || DESCENT_FACTIONS[0];
}

// Reward choice — what shows between floors
export type RewardOfferKind = "heal" | "power" | "relic" | "cashout";

// Leaderboard categories
export const DESCENT_LEADERBOARD_CATEGORIES = ["deepest", "fastest_queen", "highest_run"] as const;
export type DescentLeaderboardCategory = (typeof DESCENT_LEADERBOARD_CATEGORIES)[number];

// Daily seed — everyone gets the same hive today (UTC)
export function todaySeed(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
