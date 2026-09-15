// lib/bountyConfig.ts
// Bounty Hunters — a Contra-style run-and-gun. Entry costs REBEL (admin key `bountyCost`), kills and bosses pay bounties.

export const BOUNTY_DEFAULT_COST = 100;      // REBEL to start a hunt (admin override: pointsConfig.bountyCost)
export const BOUNTY_DEATH_KEEP = 0.5;        // share of collected bounty kept on game over
export const BOUNTY_LIVES = 3;

export type BoardId = "jungle" | "sewers" | "fortress" | "throne";

export type Board = {
  id: BoardId;
  n: number;
  name: string;
  subtitle: string;
  boss: { id: string; name: string; bounty: number; hp: number };
  length: number;         // tiles
  difficulty: number;     // 1..4 scales enemy density / speed
  accent: string;
  music: string;
};

export const BOARDS: Board[] = [
  { id: "jungle",   n: 1, name: "Jungle Outskirts",   subtitle: "The hive's first raiders",  boss: { id: "grubthorn",  name: "GRUBTHORN",       bounty: 150, hp: 36 }, length: 190, difficulty: 1, accent: "#7ad27a", music: "hd-war" },
  { id: "sewers",   n: 2, name: "Hive Sewers",        subtitle: "Where the corrupted breed", boss: { id: "sludge",     name: "SLUDGE MAW",      bounty: 250, hp: 50 }, length: 210, difficulty: 2, accent: "#5ff0b4", music: "hd-war" },
  { id: "fortress", n: 3, name: "Wasp Fortress",      subtitle: "The mercenary stronghold",  boss: { id: "warden",     name: "THE WARDEN",      bounty: 400, hp: 64 }, length: 230, difficulty: 3, accent: "#ffa03c", music: "fw-battle-epic" },
  { id: "throne",   n: 4, name: "Corrupted Throne",   subtitle: "Her royal guard",           boss: { id: "queenguard", name: "QUEEN'S HEADSMAN", bounty: 600, hp: 84 }, length: 250, difficulty: 4, accent: "#ff50c8", music: "fw-battle-epic" },
];

// REBEL per kill
export const KILL_BOUNTY: Record<string, number> = { grunt: 4, elite: 8, wasp: 3, turret: 6 };
