// lib/descentCards.ts
// Hive Descent v3 — the card pool. Pure data; the engine interprets `effect`.

export type CardType = "attack" | "skill" | "power";
export type CardTarget = "enemy" | "all" | "self";
export type CardRarity = "starter" | "common" | "rare" | "legendary" | "faction";

export type CardEffect = {
  dmg?: number;            // damage per hit (attack cards)
  hits?: number;           // number of hits (default 1)
  ignoreBlock?: boolean;
  block?: number;
  heal?: number;
  draw?: number;
  energy?: number;         // gain energy now
  strength?: number;       // permanent +damage per hit for the run (this combat only)
  tempStrength?: number;   // +damage per hit this turn
  poison?: number;         // apply poison (dmg per turn, decays by 1)
  burn?: number;           // apply burn turns (fixed dmg per turn)
  stun?: number;           // enemy skips N turns
  vulnerable?: number;     // enemy takes +50% for N turns
  weak?: number;           // enemy deals -25% for N turns
  selfDamage?: number;
  rebel?: number;          // loot REBEL on play
  exhaust?: boolean;       // removed for the rest of the combat
  power?: string;          // persistent effect id (see POWERS)
  xCost?: boolean;         // spend all energy; effect scales per energy
  lifesteal?: number;      // fraction of damage dealt healed (0..1)
};

export type Card = {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  target: CardTarget;
  rarity: CardRarity;
  text: string;
  effect: CardEffect;
  factionId?: string;
};

export const POWERS: Record<string, { name: string; text: string }> = {
  iron_skin: { name: "Iron Skin", text: "Gain 3 Block at the start of every turn" },
  regen: { name: "Regeneration", text: "Heal 3 at the start of every turn" },
  momentum: { name: "Momentum", text: "+1 Energy every turn" },
  thorns: { name: "Thorned Husk", text: "Enemies that hit you take 4 damage" },
  bloodlust: { name: "Bloodlust", text: "Killing an enemy grants +2 Strength" },
  ember_heart: { name: "Ember Heart", text: "Attacks also apply 2 Burn" },
  mandible: { name: "Mandible", text: "Draw 1 extra card every turn" },
};

const C = (c: Card) => c;

// ── starter cards ─────────────────────────────────────────────────────────────
export const STRIKE = C({ id: "strike", name: "Strike", type: "attack", cost: 1, target: "enemy", rarity: "starter", text: "Deal 6 damage.", effect: { dmg: 6 } });
export const GUARD = C({ id: "guard", name: "Guard", type: "skill", cost: 1, target: "self", rarity: "starter", text: "Gain 5 Block.", effect: { block: 5 } });
export const FOCUS = C({ id: "focus", name: "Focus", type: "skill", cost: 0, target: "self", rarity: "starter", text: "Draw 2 cards. Exhaust.", effect: { draw: 2, exhaust: true } });

// ── faction specials (one per faction, in the starter deck) ───────────────────
export const FACTION_CARDS: Record<string, Card> = {
  ashigaru:  C({ id: "spear_wall", name: "Spear Wall", type: "attack", cost: 2, target: "enemy", rarity: "faction", factionId: "ashigaru", text: "Deal 10 damage. Gain 8 Block.", effect: { dmg: 10, block: 8 } }),
  ronin:     C({ id: "iaido", name: "Iaido", type: "attack", cost: 2, target: "enemy", rarity: "faction", factionId: "ronin", text: "Deal 18 damage. Exhaust.", effect: { dmg: 18, exhaust: true } }),
  samurai:   C({ id: "bushido_cut", name: "Bushido Cut", type: "attack", cost: 2, target: "enemy", rarity: "faction", factionId: "samurai", text: "Deal 12 damage. Apply 2 Vulnerable.", effect: { dmg: 12, vulnerable: 2 } }),
  bushi:     C({ id: "fortify", name: "Fortify", type: "skill", cost: 2, target: "self", rarity: "faction", factionId: "bushi", text: "Gain 14 Block. Heal 6.", effect: { block: 14, heal: 6 } }),
  warrior:   C({ id: "berserk", name: "Berserk", type: "attack", cost: 2, target: "enemy", rarity: "faction", factionId: "warrior", text: "Deal 20 damage. Lose 5 HP.", effect: { dmg: 20, selfDamage: 5 } }),
  shogun:    C({ id: "command", name: "Command", type: "skill", cost: 1, target: "self", rarity: "faction", factionId: "shogun", text: "Gain 2 Strength. Draw 1.", effect: { strength: 2, draw: 1 } }),
  buke:      C({ id: "poison_blade", name: "Poison Blade", type: "attack", cost: 1, target: "enemy", rarity: "faction", factionId: "buke", text: "Deal 5 damage. Apply 6 Poison.", effect: { dmg: 5, poison: 6 } }),
  kenshi:    C({ id: "twin_strike", name: "Twin Strike", type: "attack", cost: 1, target: "enemy", rarity: "faction", factionId: "kenshi", text: "Deal 5 damage twice.", effect: { dmg: 5, hits: 2 } }),
  wokou:     C({ id: "plunder", name: "Plunder", type: "attack", cost: 2, target: "enemy", rarity: "faction", factionId: "wokou", text: "Deal 9 damage. Loot 15 REBEL.", effect: { dmg: 9, rebel: 15 } }),
  sohei:     C({ id: "prayer", name: "Prayer", type: "skill", cost: 1, target: "self", rarity: "faction", factionId: "sohei", text: "Heal 12. Exhaust.", effect: { heal: 12, exhaust: true } }),
  yamabushi: C({ id: "mountain_wind", name: "Mountain Wind", type: "attack", cost: 2, target: "enemy", rarity: "faction", factionId: "yamabushi", text: "Deal 9 damage. Stun 1 turn.", effect: { dmg: 9, stun: 1 } }),
};

// ── the pool offered between floors ───────────────────────────────────────────
export const CARD_POOL: Card[] = [
  // common attacks
  C({ id: "heavy_strike", name: "Heavy Strike", type: "attack", cost: 2, target: "enemy", rarity: "common", text: "Deal 13 damage.", effect: { dmg: 13 } }),
  C({ id: "cleave", name: "Cleave", type: "attack", cost: 1, target: "all", rarity: "common", text: "Deal 5 damage to ALL enemies.", effect: { dmg: 5 } }),
  C({ id: "pierce", name: "Pierce", type: "attack", cost: 1, target: "enemy", rarity: "common", text: "Deal 7 damage. Ignores Block.", effect: { dmg: 7, ignoreBlock: true } }),
  C({ id: "flurry", name: "Flurry", type: "attack", cost: 1, target: "enemy", rarity: "common", text: "Deal 3 damage three times.", effect: { dmg: 3, hits: 3 } }),
  C({ id: "venom_dart", name: "Venom Dart", type: "attack", cost: 0, target: "enemy", rarity: "common", text: "Deal 2 damage. Apply 3 Poison.", effect: { dmg: 2, poison: 3 } }),
  C({ id: "crippling_blow", name: "Crippling Blow", type: "attack", cost: 1, target: "enemy", rarity: "common", text: "Deal 6 damage. Apply 2 Weak.", effect: { dmg: 6, weak: 2 } }),
  // common skills
  C({ id: "brace", name: "Brace", type: "skill", cost: 1, target: "self", rarity: "common", text: "Gain 9 Block.", effect: { block: 9 } }),
  C({ id: "battle_cry", name: "Battle Cry", type: "skill", cost: 0, target: "self", rarity: "common", text: "+3 damage on every hit this turn.", effect: { tempStrength: 3 } }),
  C({ id: "second_wind", name: "Second Wind", type: "skill", cost: 1, target: "self", rarity: "common", text: "Heal 8. Exhaust.", effect: { heal: 8, exhaust: true } }),
  C({ id: "quick_draw", name: "Quick Draw", type: "skill", cost: 1, target: "self", rarity: "common", text: "Draw 3 cards.", effect: { draw: 3 } }),
  C({ id: "adrenaline", name: "Adrenaline", type: "skill", cost: 0, target: "self", rarity: "common", text: "Gain 2 Energy. Exhaust.", effect: { energy: 2, exhaust: true } }),
  C({ id: "sacrifice", name: "Blood Price", type: "skill", cost: 0, target: "self", rarity: "common", text: "Lose 6 HP. Gain 2 Strength.", effect: { selfDamage: 6, strength: 2 } }),
  // rare
  C({ id: "whirlwind", name: "Whirlwind", type: "attack", cost: 0, target: "all", rarity: "rare", text: "Spend all Energy: deal 5 damage to ALL enemies per Energy spent.", effect: { dmg: 5, xCost: true } }),
  C({ id: "execute", name: "Execute", type: "attack", cost: 2, target: "enemy", rarity: "rare", text: "Deal 22 damage. Exhaust.", effect: { dmg: 22, exhaust: true } }),
  C({ id: "venom_cloud", name: "Venom Cloud", type: "skill", cost: 1, target: "all", rarity: "rare", text: "Apply 5 Poison to ALL enemies.", effect: { poison: 5 } }),
  C({ id: "leech", name: "Leech", type: "attack", cost: 1, target: "enemy", rarity: "rare", text: "Deal 8 damage. Heal for half.", effect: { dmg: 8, lifesteal: 0.5 } }),
  C({ id: "shatter", name: "Shatter", type: "attack", cost: 1, target: "enemy", rarity: "rare", text: "Deal 8 damage. Apply 2 Vulnerable.", effect: { dmg: 8, vulnerable: 2 } }),
  C({ id: "bulwark", name: "Bulwark", type: "skill", cost: 2, target: "self", rarity: "rare", text: "Gain 20 Block.", effect: { block: 20 } }),
  C({ id: "iron_skin", name: "Iron Skin", type: "power", cost: 1, target: "self", rarity: "rare", text: "Gain 3 Block at the start of every turn.", effect: { power: "iron_skin" } }),
  C({ id: "regen", name: "Regeneration", type: "power", cost: 1, target: "self", rarity: "rare", text: "Heal 3 at the start of every turn.", effect: { power: "regen" } }),
  C({ id: "thorns", name: "Thorned Husk", type: "power", cost: 1, target: "self", rarity: "rare", text: "Enemies that hit you take 4 damage.", effect: { power: "thorns" } }),
  C({ id: "war_drums", name: "War Drums", type: "skill", cost: 1, target: "self", rarity: "rare", text: "Gain 3 Strength. Exhaust.", effect: { strength: 3, exhaust: true } }),
  // legendary
  C({ id: "queens_wrath", name: "Queen's Wrath", type: "attack", cost: 3, target: "all", rarity: "legendary", text: "Deal 18 damage to ALL enemies.", effect: { dmg: 18 } }),
  C({ id: "momentum", name: "Momentum", type: "power", cost: 2, target: "self", rarity: "legendary", text: "+1 Energy every turn.", effect: { power: "momentum" } }),
  C({ id: "bloodlust", name: "Bloodlust", type: "power", cost: 1, target: "self", rarity: "legendary", text: "Every kill grants +2 Strength.", effect: { power: "bloodlust" } }),
  C({ id: "ember_heart", name: "Ember Heart", type: "power", cost: 1, target: "self", rarity: "legendary", text: "Your attacks also apply 2 Burn.", effect: { power: "ember_heart" } }),
  C({ id: "mandible", name: "Mandible", type: "power", cost: 1, target: "self", rarity: "legendary", text: "Draw 1 extra card every turn.", effect: { power: "mandible" } }),
  C({ id: "thunderclap", name: "Thunderclap", type: "attack", cost: 2, target: "all", rarity: "legendary", text: "Deal 9 damage to ALL enemies. Stun them for 1 turn.", effect: { dmg: 9, stun: 1 } }),
];

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries([STRIKE, GUARD, FOCUS, ...Object.values(FACTION_CARDS), ...CARD_POOL].map((c) => [c.id, c]));

export function starterDeck(factionId: string): Card[] {
  const special = FACTION_CARDS[factionId] || FACTION_CARDS.samurai;
  return [STRIKE, STRIKE, STRIKE, STRIKE, STRIKE, GUARD, GUARD, GUARD, GUARD, FOCUS, special, special];
}

export function rarityColor(r: CardRarity): string {
  return r === "legendary" ? "#ffaa33" : r === "rare" ? "#aa66ff" : r === "faction" ? "#ff66bb" : r === "starter" ? "#9ca3af" : "#88ddff";
}
