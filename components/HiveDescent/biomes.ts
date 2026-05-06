// components/HiveDescent/biomes.ts
// 10 floors of the Hive Descent. Each biome has its own palette, fog, and signature.

export type BiomeKind = "combat" | "mini_boss" | "final_boss";

export type Biome = {
  floor: number;
  name: string;
  subtitle: string;
  kind: BiomeKind;
  enemyTypes: string[];
  // Visual palette (used by the Three.js scene)
  skyTop: string;
  skyBottom: string;
  fogColor: string;
  fogDensity: number; // 0..1
  ambientColor: string;
  keyLightColor: string;
  particleColor: string;
  // Reward scaling
  rebelReward: number;
};

export const BIOMES: Biome[] = [
  {
    floor: 1,
    name: "Surface Tunnels",
    subtitle: "The hive's outer skin",
    kind: "combat",
    enemyTypes: ["scout_beetle", "scout_beetle", "worker_drone"],
    skyTop: "#3a2818",
    skyBottom: "#0c0604",
    fogColor: "#4a2e18",
    fogDensity: 0.04,
    ambientColor: "#6b4a2e",
    keyLightColor: "#ffb070",
    particleColor: "#ffaa55",
    rebelReward: 50,
  },
  {
    floor: 2,
    name: "Root Network",
    subtitle: "Tangled veins of the world tree",
    kind: "combat",
    enemyTypes: ["spider_drone", "spider_drone", "scout_beetle"],
    skyTop: "#0a1a2a",
    skyBottom: "#02080f",
    fogColor: "#0e2a3a",
    fogDensity: 0.05,
    ambientColor: "#2a5a7a",
    keyLightColor: "#55ddff",
    particleColor: "#66e6ff",
    rebelReward: 80,
  },
  {
    floor: 3,
    name: "Crystal Caverns",
    subtitle: "Refracted light, refracted minds",
    kind: "combat",
    enemyTypes: ["crystal_mite", "crystal_mite", "spider_drone"],
    skyTop: "#2a0a3a",
    skyBottom: "#0c0418",
    fogColor: "#3a0e5a",
    fogDensity: 0.05,
    ambientColor: "#7a3aaa",
    keyLightColor: "#cc66ff",
    particleColor: "#dd99ff",
    rebelReward: 120,
  },
  {
    floor: 4,
    name: "The Spider Queen",
    subtitle: "She has eight eyes and remembers them all",
    kind: "mini_boss",
    enemyTypes: ["spider_queen"],
    skyTop: "#1a0420",
    skyBottom: "#040108",
    fogColor: "#2a0830",
    fogDensity: 0.07,
    ambientColor: "#5a1f70",
    keyLightColor: "#ff55cc",
    particleColor: "#ffaaee",
    rebelReward: 200,
  },
  {
    floor: 5,
    name: "Lava Forge",
    subtitle: "Where soldier ants are tempered",
    kind: "combat",
    enemyTypes: ["flame_wasp", "flame_wasp", "worker_drone"],
    skyTop: "#3a0808",
    skyBottom: "#1a0202",
    fogColor: "#5a1408",
    fogDensity: 0.06,
    ambientColor: "#aa3010",
    keyLightColor: "#ff7030",
    particleColor: "#ffaa44",
    rebelReward: 150,
  },
  {
    floor: 6,
    name: "Frozen Depths",
    subtitle: "The hive that time forgot",
    kind: "combat",
    enemyTypes: ["ice_mantis", "ice_mantis", "crystal_mite"],
    skyTop: "#0a1e2a",
    skyBottom: "#020608",
    fogColor: "#1a3a5a",
    fogDensity: 0.06,
    ambientColor: "#5588aa",
    keyLightColor: "#aaccff",
    particleColor: "#ffffff",
    rebelReward: 200,
  },
  {
    floor: 7,
    name: "Toxic Marsh",
    subtitle: "The poison that fed the colony",
    kind: "combat",
    enemyTypes: ["acid_slug", "acid_slug", "spider_drone"],
    skyTop: "#0a2a0a",
    skyBottom: "#020802",
    fogColor: "#1e4a1e",
    fogDensity: 0.08,
    ambientColor: "#3a8a3a",
    keyLightColor: "#88ee44",
    particleColor: "#aaff66",
    rebelReward: 280,
  },
  {
    floor: 8,
    name: "The Twin Mantis",
    subtitle: "Two blades, one mind",
    kind: "mini_boss",
    enemyTypes: ["twin_mantis"],
    skyTop: "#180818",
    skyBottom: "#040108",
    fogColor: "#2a0a2a",
    fogDensity: 0.07,
    ambientColor: "#6a2a6a",
    keyLightColor: "#ff66ff",
    particleColor: "#ffccff",
    rebelReward: 400,
  },
  {
    floor: 9,
    name: "Royal Chambers",
    subtitle: "The hall of the corrupted court",
    kind: "combat",
    enemyTypes: ["elite_guard", "elite_guard", "elite_guard"],
    skyTop: "#2a1e08",
    skyBottom: "#0a0602",
    fogColor: "#4a3a18",
    fogDensity: 0.05,
    ambientColor: "#aa8030",
    keyLightColor: "#ffd070",
    particleColor: "#ffeeaa",
    rebelReward: 350,
  },
  {
    floor: 10,
    name: "THE QUEEN",
    subtitle: "The hive's heart still beats. End it.",
    kind: "final_boss",
    enemyTypes: ["the_queen"],
    skyTop: "#1a0010",
    skyBottom: "#040004",
    fogColor: "#3a0028",
    fogDensity: 0.08,
    ambientColor: "#aa1466",
    keyLightColor: "#ff3399",
    particleColor: "#ffaadd",
    rebelReward: 1000,
  },
];

export function getBiome(floor: number): Biome {
  const b = BIOMES.find((x) => x.floor === floor);
  return b || BIOMES[0];
}
