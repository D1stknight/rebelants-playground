// lib/bountyConfig.ts
// Bounty Hunters — a Contra-style run-and-gun. Entry costs REBEL (admin key `bountyCost`), kills and bosses pay bounties.

export const BOUNTY_DEFAULT_COST = 100;      // REBEL to start a hunt (admin override: pointsConfig.bountyCost)
export const BOUNTY_DEATH_KEEP = 0.5;        // share of collected bounty kept on game over
export const BOUNTY_LIVES = 3;
export const BOUNTY_HP = 4;                  // hits per life — bullets/contact 1, spikes 2, liquids/pits/crushers take the whole bar

export type BiomeId = "jungle" | "sewers" | "fortress" | "throne";

export type Board = {
  id: string;             // "w1s2"
  n: number;              // 1..12 running number (unlock order)
  world: number;          // 1..4
  stage: number;          // 1..3 — stage 3 is the world boss, 1–2 end with a captain
  biome: BiomeId;
  name: string;
  subtitle: string;
  boss: { id: string; name: string; bounty: number; hp: number; captain: boolean };
  length: number;         // tiles
  difficulty: number;     // 1..12 scales density / speed / hazards
  accent: string;
  music: string;
};

const WORLDS: { biome: BiomeId; name: string; accent: string; music: string; boss: { id: string; name: string; bounty: number; hp: number }; stages: [string, string, string]; subs: [string, string, string] }[] = [
  { biome: "jungle",   name: "Jungle",   accent: "#7ad27a", music: "hd-war",         boss: { id: "grubthorn",  name: "GRUBTHORN",        bounty: 150, hp: 36 },  stages: ["Outskirts", "Canopy Trail", "Grub's Hollow"],      subs: ["The hive's first raiders", "Wasps in the branches", "The beetle general's lair"] },
  { biome: "sewers",   name: "Sewers",   accent: "#5ff0b4", music: "hd-war",         boss: { id: "sludge",     name: "SLUDGE MAW",       bounty: 250, hp: 50 },  stages: ["Drain Pipes", "Crusher Works", "The Sump"],           subs: ["Where the corrupted breed", "Machinery that never stops", "Something feeds in the dark"] },
  { biome: "fortress", name: "Fortress", accent: "#ffa03c", music: "fw-battle-epic", boss: { id: "warden",     name: "THE WARDEN",       bounty: 400, hp: 64 },  stages: ["Outer Wall", "Cannon Gallery", "Warden's Keep"],      subs: ["The mercenary stronghold", "Cross the line of fire", "The keeper of the gate"] },
  { biome: "throne",   name: "Throne",   accent: "#ff50c8", music: "fw-battle-epic", boss: { id: "queenguard", name: "QUEEN'S HEADSMAN", bounty: 600, hp: 84 },  stages: ["Brood Chambers", "Royal Gauntlet", "Corrupted Throne"], subs: ["Her nursery, her rules", "Everything at once", "Her royal guard"] },
];

export const BOARDS: Board[] = WORLDS.flatMap((w, wi) => [0, 1, 2].map((si) => {
  const world = wi + 1, stage = si + 1, n = wi * 3 + stage;
  const captain = stage < 3;
  return {
    id: `w${world}s${stage}`, n, world, stage, biome: w.biome,
    name: `${w.name} ${stage}: ${w.stages[si]}`, subtitle: w.subs[si],
    boss: captain ? { id: "captain", name: `${w.name.toUpperCase()} CAPTAIN`, bounty: 40 * world + 30 * stage, hp: 14 + 6 * n, captain: true } : { ...w.boss, captain: false },
    length: 170 + n * 16 + (stage === 3 ? 24 : 0),
    difficulty: n,
    accent: w.accent, music: w.music,
  };
}));

// REBEL per kill
export const KILL_BOUNTY: Record<string, number> = { grunt: 4, elite: 8, wasp: 3, turret: 6, hopper: 5 };
