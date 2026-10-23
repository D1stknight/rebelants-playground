// lib/raidRules.ts
// The Raid's battle: the squad's survival rolls and the crate rarity the survivors bring home. The server
// fights it (pages/api/raid/launch.ts) and the page shows that battle (components/Raid.tsx).

export type Rarity = "none" | "common" | "rare" | "ultra";
export type AntRole = "scout" | "soldier" | "carrier" | "guard" | "bomber";

export type AntSlot = {
  role: AntRole;
  survived: boolean | null;
  boosted?: boolean;
};

export const SQUAD_SIZE = 20;
export const ANT_ROLES: AntRole[] = ["scout", "soldier", "carrier", "guard", "bomber"];

// Default survival odds (can be overridden by admin via pointsConfig)
export const BASE_SURVIVAL: Record<AntRole, number> = {
  scout:   0.62,
  soldier: 0.48,
  carrier: 0.20, // brutal — needs guards
  guard:   0.58,
  bomber:  0.08,
};

// Default crate thresholds (can be overridden by admin)
export const DEFAULT_ULTRA_CARRIERS   = 4;
export const DEFAULT_ULTRA_RATIO      = 0.65;
export const DEFAULT_RARE_CARRIERS    = 1;
export const DEFAULT_RARE_RATIO       = 0.40;
export const DEFAULT_COMMON_SURVIVORS = 5;

// Role costs (REBEL) - added to squad total before raid launch
export const ROLE_COST: Record<AntRole, number> = {
  scout:   10,
  soldier: 15,
  guard:   20,
  carrier: 30,
  bomber:   5,
};

export function calcSquadCost(squad: AntRole[]): number {
  return squad.reduce((sum, role) => sum + ROLE_COST[role], 0);
}

export function isSquad(v: unknown): v is AntRole[] {
  return Array.isArray(v) && v.length === SQUAD_SIZE && v.every((r) => (ANT_ROLES as unknown[]).includes(r));
}

export function simulateBattle(squad: AntRole[], cfg: any, survivalMult = 1.0, random: () => number = Math.random): AntSlot[] {
  const slots: AntSlot[] = squad.map(role => ({ role, survived: null, boosted: false }));

  // Pull survival overrides from admin config if present
  const carrierSurvival = Number(cfg?.raidCarrierSurvival ?? BASE_SURVIVAL.carrier);

  const survival: Record<AntRole, number> = {
    ...BASE_SURVIVAL,
    carrier: carrierSurvival,
  };

  const frontScouts = squad.slice(0, 4).filter(r => r === "scout").length;
  const scoutBonus = frontScouts * 0.04;
  let bomberBoostRemaining = 0;

  for (let i = 0; i < slots.length; i++) {
    const role = slots[i].role;
    let chance = survival[role] + scoutBonus;

    if (bomberBoostRemaining > 0 && role !== "bomber") {
      chance += 0.30;
      slots[i].boosted = true;
      bomberBoostRemaining--;
    }

    if (role === "carrier") {
      if (i > 0 && squad[i - 1] === "guard") chance += 0.25;
      if (i < squad.length - 1 && squad[i + 1] === "guard") chance += 0.25;
    }

    if (role === "bomber") {
      slots[i].survived = false;
      bomberBoostRemaining = 3;
      continue;
    }

    slots[i].survived = random() < Math.min(chance * survivalMult, 0.88);
  }

  return slots;
}

// The crate the survivors bring home.
export function raidRarity(slots: AntSlot[], cfg: any): Rarity {
  const survivors = slots.filter(s => s.survived).length;
  const carriers  = slots.filter(s => s.role === "carrier" && s.survived).length;
  const ratio     = survivors / slots.length;

  const ultraCarriers = Number(cfg?.raidUltraCarriers ?? DEFAULT_ULTRA_CARRIERS);
  const ultraRatio    = Number(cfg?.raidUltraRatio    ?? DEFAULT_ULTRA_RATIO);
  const rareCarriers  = Number(cfg?.raidRareCarriers  ?? DEFAULT_RARE_CARRIERS);
  const rareRatio     = Number(cfg?.raidRareRatio     ?? DEFAULT_RARE_RATIO);
  const commonMin     = Number(cfg?.raidCommonSurvivors ?? DEFAULT_COMMON_SURVIVORS);

  if (carriers >= ultraCarriers && ratio >= ultraRatio)    return "ultra";
  if (carriers >= rareCarriers && ratio >= rareRatio)      return "rare";
  if (survivors >= commonMin)                              return "common";
  return "none";
}
