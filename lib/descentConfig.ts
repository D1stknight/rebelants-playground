// lib/descentConfig.ts
// Hive Descent — economy + run config. Costs are in PLAYS (drawn from daily cap),
// rewards are in REBEL.

export const DESCENT_PLAY_COST = 3;            // Each descent attempt = 3 plays
export const DESCENT_TOTAL_FLOORS = 10;
export const DESCENT_DEATH_PENALTY = 0.5;      // Lose 50% of unbanked REBEL on death
export const DESCENT_CASHOUT_FLOORS = [3, 6, 9]; // Floors that offer the escape option

export const DESCENT_FACTIONS: ReadonlyArray<{
  id: string;
  name: string;
  specialId: string;
  specialName: string;
  specialCooldownMs: number;
  blurb: string;
}> = [
  { id: "samurai",  name: "Samurai",  specialId: "iaido_strike",   specialName: "Iaido Strike",   specialCooldownMs: 6000,  blurb: "Instant teleport-slash. The blade arrives before the body." },
  { id: "spartan",  name: "Spartan",  specialId: "phalanx",        specialName: "Phalanx",        specialCooldownMs: 8000,  blurb: "3 seconds of unbreakable shield." },
  { id: "viking",   name: "Viking",   specialId: "berserker_roar", specialName: "Berserker Roar", specialCooldownMs: 9000,  blurb: "5 seconds of doubled fury." },
  { id: "pirate",   name: "Pirate",   specialId: "cannon_volley",  specialName: "Cannon Volley",  specialCooldownMs: 10000, blurb: "AoE explosion. No survivors." },
  { id: "ninja",    name: "Ninja",    specialId: "smoke_bomb",     specialName: "Smoke Bomb",     specialCooldownMs: 7000,  blurb: "Vanish for 4 seconds. Reappear behind." },
  { id: "knight",   name: "Knight",   specialId: "holy_slam",      specialName: "Holy Slam",      specialCooldownMs: 9000,  blurb: "Ground pound. Knockback ring." },
  { id: "pharaoh",  name: "Pharaoh",  specialId: "sandstorm",      specialName: "Sandstorm",      specialCooldownMs: 8000,  blurb: "Slow every enemy in sight." },
  { id: "aztec",    name: "Aztec",    specialId: "blood_pact",     specialName: "Blood Pact",     specialCooldownMs: 7000,  blurb: "Spend HP. Deal massive damage." },
  { id: "mongol",   name: "Mongol",   specialId: "horse_charge",   specialName: "Horse Charge",   specialCooldownMs: 7000,  blurb: "Dash through enemies. Trample." },
  { id: "roman",    name: "Roman",    specialId: "legion_call",    specialName: "Legion Call",    specialCooldownMs: 12000, blurb: "Summon 3 legionnaire ants for 10 seconds." },
  { id: "zulu",     name: "Zulu",     specialId: "war_drums",      specialName: "War Drums",      specialCooldownMs: 9000,  blurb: "Stun every enemy in radius." },
];

// Reward choice — what shows between floors
export type RewardOfferKind = "heal" | "power" | "relic" | "cashout";
export const HEAL_AMOUNT = 40;
export const POWER_DAMAGE_BONUS = 0.25;

// Player base stats
export const BASE_MAX_HP = 100;
export const BASE_MOVE_SPEED = 6;       // m/s in Three.js scene
export const BASE_ATTACK_DAMAGE = 18;
export const BASE_ATTACK_SPEED = 1.6;   // attacks/sec
export const BASE_DODGE_IFRAMES_MS = 350;
export const BASE_DODGE_COOLDOWN_MS = 900;

// Leaderboard categories
export const DESCENT_LEADERBOARD_CATEGORIES = ["deepest", "fastest_queen", "highest_run"] as const;
export type DescentLeaderboardCategory = (typeof DESCENT_LEADERBOARD_CATEGORIES)[number];
