// lib/rgpConfig.ts
// Rebel Grand Prix — SNES-style Mode 7 kart racer. Entry costs REBEL (admin key `gpCost`), finishing position pays out.

export const GP_DEFAULT_COST = 100;
export const GP_LAPS = 3;
export const GP_RACERS = 8;
/** payout multipliers of the entry cost by finishing place (1st..8th) */
export const GP_PAYOUT = [3.0, 2.0, 1.4, 1.0, 0.6, 0.3, 0.15, 0];
/** cup bonus: sum of place points (1st 10 … 8th 1) over the 3 tracks; ≥ 24 pays the cup bounty */
export const GP_PLACE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

export type ChassisId = "scout" | "soldier" | "tank" | "drone" | "royal";
export type Chassis = { id: ChassisId; name: string; blurb: string; top: number; accel: number; handling: number; weight: number };
export const CHASSIS: Chassis[] = [
  { id: "scout",   name: "Scout",   blurb: "Needle nose, tiny wings. Fast off the line, turns on a dime, gets bullied.",      top: 0.94, accel: 1.25, handling: 1.25, weight: 0.7 },
  { id: "soldier", name: "Soldier", blurb: "The classic open-wheeler. Nothing special, nothing wrong.",                       top: 1.0,  accel: 1.0,  handling: 1.0,  weight: 1.0 },
  { id: "tank",    name: "Tank",    blurb: "Fat rear tyres, huge wing. Slow to wind up, top speed king, shoves everyone.",     top: 1.08, accel: 0.78, handling: 0.82, weight: 1.45 },
  { id: "drone",   name: "Drone",   blurb: "Long, low and slippery. Best drifts on the grid, weak in a shoving match.",        top: 1.03, accel: 0.95, handling: 1.15, weight: 0.85 },
  { id: "royal",   name: "Royal",   blurb: "Gold trim, tall airbox. Strong everywhere, brakes like a queen — slowly.",          top: 1.05, accel: 1.05, handling: 0.9,  weight: 1.2 },
];

export type CupId = 1 | 2 | 3 | 4 | 5;
export type TrackMeta = { id: string; n: number; cup: CupId; name: string; biome: string; diff: number };
export const CUPS: { id: CupId; name: string; biome: string; accent: string; bounty: number }[] = [
  { id: 1, name: "Jungle Cup",   biome: "jungle",   accent: "#7ad27a", bounty: 300 },
  { id: 2, name: "Sewer Cup",    biome: "sewers",   accent: "#5ff0b4", bounty: 450 },
  { id: 3, name: "Fortress Cup", biome: "fortress", accent: "#ffa03c", bounty: 600 },
  { id: 4, name: "Throne Cup",   biome: "throne",   accent: "#ff50c8", bounty: 800 },
  { id: 5, name: "Garden Cup",   biome: "garden",   accent: "#ffe066", bounty: 1000 },
];
export const TRACKS: TrackMeta[] = [
  { id: "j1", n: 1,  cup: 1, name: "Canopy Loop",       biome: "jungle",   diff: 1 },
  { id: "j2", n: 2,  cup: 1, name: "River Bend",        biome: "jungle",   diff: 2 },
  { id: "j3", n: 3,  cup: 1, name: "Grub Hollow GP",    biome: "jungle",   diff: 3 },
  { id: "s1", n: 4,  cup: 2, name: "Drain Circuit",     biome: "sewers",   diff: 4 },
  { id: "s2", n: 5,  cup: 2, name: "Acid Run",          biome: "sewers",   diff: 5 },
  { id: "s3", n: 6,  cup: 2, name: "The Sump 500",      biome: "sewers",   diff: 6 },
  { id: "f1", n: 7,  cup: 3, name: "Outer Wall Sprint", biome: "fortress", diff: 7 },
  { id: "f2", n: 8,  cup: 3, name: "Cannon Gallery",    biome: "fortress", diff: 8 },
  { id: "f3", n: 9,  cup: 3, name: "Warden's Keep",     biome: "fortress", diff: 9 },
  { id: "t1", n: 10, cup: 4, name: "Brood Chambers",    biome: "throne",   diff: 10 },
  { id: "t2", n: 11, cup: 4, name: "Royal Gauntlet",    biome: "throne",   diff: 11 },
  { id: "t3", n: 12, cup: 4, name: "Corrupted Throne",  biome: "throne",   diff: 12 },
  { id: "g1", n: 13, cup: 5, name: "Picnic Table",      biome: "garden",   diff: 13 },
  { id: "g2", n: 14, cup: 5, name: "Lawnmower Alley",   biome: "garden",   diff: 14 },
  { id: "g3", n: 15, cup: 5, name: "Rebel Grand Prix",  biome: "garden",   diff: 15 },
];

export type ItemId = "slick" | "shell" | "wasp" | "spore" | "nectar" | "shield" | "wrath";
export const ITEMS: Record<ItemId, { name: string; blurb: string; icon: number }> = {
  slick:  { name: "Honey Slick",   blurb: "Drop it behind you. Whoever drives through it spins out.", icon: 0 },
  shell:  { name: "Acid Shell",    blurb: "Fires straight ahead, bounces off walls. Spins out what it hits.", icon: 1 },
  wasp:   { name: "Homing Wasp",   blurb: "Hunts the next racer ahead of you.", icon: 2 },
  spore:  { name: "Spore Cloud",   blurb: "Blinds every racer near you for a few seconds.", icon: 3 },
  nectar: { name: "Nectar Boost",  blurb: "A big burst of speed.", icon: 4 },
  shield: { name: "Shell Shield",  blurb: "Blocks the next hit.", icon: 5 },
  wrath:  { name: "Queen's Wrath", blurb: "Finds whoever is in first place. Nobody is safe.", icon: 6 },
};
/** item odds by rank (1st … 8th) — leaders get defensive junk, trailers get the good stuff */
export const ITEM_TABLE: Record<number, Partial<Record<ItemId, number>>> = {
  1: { slick: 45, shield: 30, shell: 20, spore: 5 },
  2: { slick: 35, shell: 30, shield: 20, spore: 10, nectar: 5 },
  3: { shell: 35, slick: 20, wasp: 20, nectar: 15, spore: 10 },
  4: { shell: 25, wasp: 30, nectar: 25, spore: 15, shield: 5 },
  5: { wasp: 35, nectar: 30, shell: 15, spore: 15, wrath: 5 },
  6: { wasp: 30, nectar: 35, spore: 15, wrath: 15, shell: 5 },
  7: { nectar: 40, wasp: 25, wrath: 25, spore: 10 },
  8: { nectar: 40, wrath: 40, wasp: 20 },
};

/** kart paint per faction (matches the pre-rendered sheets in public/rgp/karts) */
export const FACTION_PAINT: Record<string, { paint: string; accent: string }> = {
  ashigaru: { paint: "#2e7d32", accent: "#ffd166" }, ronin: { paint: "#37474f", accent: "#ff5252" }, samurai: { paint: "#c0392b", accent: "#ffd166" },
  bushi: { paint: "#1565c0", accent: "#ffffff" }, warrior: { paint: "#6d1b1b", accent: "#ffb300" }, shogun: { paint: "#6a1b9a", accent: "#ffd700" },
  buke: { paint: "#00897b", accent: "#b2ff59" }, kenshi: { paint: "#e65100", accent: "#fff176" }, wokou: { paint: "#004d40", accent: "#80cbc4" },
  sohei: { paint: "#f9a825", accent: "#ffffff" }, yamabushi: { paint: "#4e342e", accent: "#a5d6a7" },
};
export const FACTION_IDS = Object.keys(FACTION_PAINT);
