// components/HiveDescent/relics.ts
// Relics are persistent buffs collected during a descent. Effects are flags + numbers
// the engine reads each tick — keep them data-only here for v1.

export type RelicRarity = "common" | "rare" | "legendary";

export type RelicEffect = {
  // Multipliers (1 = no change)
  damageMult?: number;
  speedMult?: number;
  attackSpeedMult?: number;
  // Flat additions
  maxHpAdd?: number;
  critChanceAdd?: number; // 0..1
  critDamageAdd?: number; // 0..1
  // Triggers (engine reads these by id)
  healOnKill?: number;
  ignite?: boolean;
  reviveOnce?: boolean;
  dodgeIframesAdd?: number; // ms
  specialCooldownMult?: number;
  rebelGainMult?: number;
};

export type Relic = {
  id: string;
  name: string;
  rarity: RelicRarity;
  flavor: string;
  effect: RelicEffect;
};

export const RELICS: Relic[] = [
  { id: "queens_mandible", name: "Queen's Mandible", rarity: "rare", flavor: "Carved from a fallen matriarch.", effect: { critChanceAdd: 0.15 } },
  { id: "pheromone_trail", name: "Pheromone Trail", rarity: "common", flavor: "The hive remembers its own.", effect: { healOnKill: 5 } },
  { id: "soldiers_resolve", name: "Soldier's Resolve", rarity: "legendary", flavor: "One last stand. Every time.", effect: { reviveOnce: true } },
  { id: "forge_ember", name: "Forge Ember", rarity: "rare", flavor: "Still hot from the lava forge.", effect: { ignite: true } },
  { id: "iron_carapace", name: "Iron Carapace", rarity: "common", flavor: "Heavy. Worth it.", effect: { maxHpAdd: 25 } },
  { id: "swiftstep", name: "Swiftstep", rarity: "common", flavor: "The wind remembers your name.", effect: { speedMult: 1.20 } },
  { id: "warriors_focus", name: "Warrior's Focus", rarity: "rare", flavor: "Slow your breath. Strike true.", effect: { critDamageAdd: 0.50 } },
  { id: "vipers_fang", name: "Viper's Fang", rarity: "rare", flavor: "Bites twice. Always.", effect: { attackSpeedMult: 1.30 } },
  { id: "kings_signet", name: "King's Signet", rarity: "legendary", flavor: "Bow when it speaks.", effect: { damageMult: 1.40 } },
  { id: "dodgers_cloak", name: "Dodger's Cloak", rarity: "common", flavor: "There, then not.", effect: { dodgeIframesAdd: 200 } },
  { id: "rapid_pulse", name: "Rapid Pulse", rarity: "common", flavor: "Cooldowns shorten when the heart pounds.", effect: { specialCooldownMult: 0.75 } },
  { id: "greed_charm", name: "Greed Charm", rarity: "rare", flavor: "Every coin is a soul. Take more souls.", effect: { rebelGainMult: 1.25 } },
  { id: "blood_pact", name: "Blood Pact", rarity: "rare", flavor: "Pay in HP, collect in violence.", effect: { damageMult: 1.25, maxHpAdd: -15 } },
  { id: "ancients_eye", name: "Ancient's Eye", rarity: "legendary", flavor: "It sees the floor before you do.", effect: { critChanceAdd: 0.20, critDamageAdd: 0.30 } },
  { id: "shroud_of_dust", name: "Shroud of Dust", rarity: "common", flavor: "They lose your scent.", effect: { dodgeIframesAdd: 100, speedMult: 1.10 } },
  { id: "mountains_heart", name: "Mountain's Heart", rarity: "legendary", flavor: "Unmoving. Unbreaking.", effect: { maxHpAdd: 60 } },
  { id: "scavengers_luck", name: "Scavenger's Luck", rarity: "common", flavor: "The trash heap pays.", effect: { rebelGainMult: 1.10 } },
  { id: "thorned_husk", name: "Thorned Husk", rarity: "rare", flavor: "They bleed when they touch you.", effect: { damageMult: 1.10, maxHpAdd: 15 } },
  { id: "trance_drum", name: "Trance Drum", rarity: "rare", flavor: "Every kill resets the rhythm.", effect: { healOnKill: 8, attackSpeedMult: 1.10 } },
  { id: "soulbinder", name: "Soulbinder", rarity: "legendary", flavor: "Your shadow fights with you.", effect: { damageMult: 1.20, attackSpeedMult: 1.20 } },
  { id: "frostbite_ring", name: "Frostbite Ring", rarity: "rare", flavor: "Cold to the touch. Colder to be touched by.", effect: { speedMult: 1.10, attackSpeedMult: 1.15 } },
  { id: "embers_kiss", name: "Ember's Kiss", rarity: "common", flavor: "A small fire. A loud scream.", effect: { ignite: true, damageMult: 1.05 } },
];

export function pickRandomRelics(count: number, exclude: string[] = []): Relic[] {
  const pool = RELICS.filter((r) => !exclude.includes(r.id));
  const out: Relic[] = [];
  const used = new Set<string>();
  while (out.length < count && pool.length > used.size) {
    const idx = Math.floor(Math.random() * pool.length);
    const r = pool[idx];
    if (!used.has(r.id)) {
      used.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export function getRarityColor(rarity: RelicRarity): string {
  if (rarity === "legendary") return "#ffaa33";
  if (rarity === "rare") return "#aa66ff";
  return "#88ddff";
}
