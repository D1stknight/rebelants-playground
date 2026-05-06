// components/HiveDescent/enemies.ts
// Enemy archetypes. Phase B ships scout_beetle. Other types are stubbed for Phase C+.

export type EnemyKind =
  | "scout_beetle"
  | "worker_drone"
  | "spider_drone"
  | "crystal_mite"
  | "spider_queen"
  | "flame_wasp"
  | "ice_mantis"
  | "acid_slug"
  | "twin_mantis"
  | "elite_guard"
  | "the_queen";

export type EnemyArchetype = {
  kind: EnemyKind;
  hp: number;
  damage: number;
  moveSpeed: number;        // m/s
  attackRange: number;      // m
  detectRange: number;      // m
  attackCooldownMs: number;
  // Visual
  bodyColor: string;
  accentColor: string;
  glowColor: string;
  scale: number;            // overall body scale
  // Behavior flags
  isBoss?: boolean;
};

export const ENEMIES: Record<EnemyKind, EnemyArchetype> = {
  scout_beetle: {
    kind: "scout_beetle",
    hp: 30, damage: 8, moveSpeed: 2.6, attackRange: 1.4, detectRange: 9, attackCooldownMs: 1200,
    bodyColor: "#3a1a08", accentColor: "#ff7030", glowColor: "#ffaa55", scale: 0.9,
  },
  worker_drone: {
    kind: "worker_drone",
    hp: 22, damage: 5, moveSpeed: 2.2, attackRange: 1.3, detectRange: 7, attackCooldownMs: 1000,
    bodyColor: "#2a2010", accentColor: "#ddaa44", glowColor: "#ffcc55", scale: 0.85,
  },
  spider_drone: {
    kind: "spider_drone",
    hp: 28, damage: 7, moveSpeed: 3.2, attackRange: 1.5, detectRange: 10, attackCooldownMs: 900,
    bodyColor: "#0e1828", accentColor: "#55ddff", glowColor: "#88e6ff", scale: 0.95,
  },
  crystal_mite: {
    kind: "crystal_mite",
    hp: 40, damage: 10, moveSpeed: 2.0, attackRange: 1.4, detectRange: 8, attackCooldownMs: 1400,
    bodyColor: "#3a0a4a", accentColor: "#cc66ff", glowColor: "#dd99ff", scale: 1.0,
  },
  spider_queen: {
    kind: "spider_queen",
    hp: 320, damage: 18, moveSpeed: 2.8, attackRange: 2.4, detectRange: 30, attackCooldownMs: 1600,
    bodyColor: "#2a0820", accentColor: "#ff55cc", glowColor: "#ffaaee", scale: 2.4, isBoss: true,
  },
  flame_wasp: {
    kind: "flame_wasp",
    hp: 26, damage: 11, moveSpeed: 4.2, attackRange: 8, detectRange: 14, attackCooldownMs: 1500,
    bodyColor: "#3a0808", accentColor: "#ff7030", glowColor: "#ffaa44", scale: 0.85,
  },
  ice_mantis: {
    kind: "ice_mantis",
    hp: 50, damage: 14, moveSpeed: 3.0, attackRange: 1.8, detectRange: 12, attackCooldownMs: 1300,
    bodyColor: "#0a1e2a", accentColor: "#aaccff", glowColor: "#ffffff", scale: 1.05,
  },
  acid_slug: {
    kind: "acid_slug",
    hp: 70, damage: 16, moveSpeed: 1.4, attackRange: 1.6, detectRange: 7, attackCooldownMs: 2000,
    bodyColor: "#0a2a0a", accentColor: "#88ee44", glowColor: "#aaff66", scale: 1.15,
  },
  twin_mantis: {
    kind: "twin_mantis",
    hp: 280, damage: 20, moveSpeed: 3.6, attackRange: 2.0, detectRange: 25, attackCooldownMs: 1100,
    bodyColor: "#180818", accentColor: "#ff66ff", glowColor: "#ffccff", scale: 2.0, isBoss: true,
  },
  elite_guard: {
    kind: "elite_guard",
    hp: 80, damage: 18, moveSpeed: 2.8, attackRange: 1.6, detectRange: 11, attackCooldownMs: 1400,
    bodyColor: "#2a1e08", accentColor: "#ffd070", glowColor: "#ffeeaa", scale: 1.1,
  },
  the_queen: {
    kind: "the_queen",
    hp: 700, damage: 28, moveSpeed: 2.2, attackRange: 4, detectRange: 999, attackCooldownMs: 1800,
    bodyColor: "#1a0010", accentColor: "#ff3399", glowColor: "#ffaadd", scale: 3.6, isBoss: true,
  },
};

// Pick how many enemies spawn for a given floor's enemyTypes list (Phase B = floor 1)
export function spawnCountForFloor(floor: number): number {
  if (floor <= 0) return 3;
  if (floor === 4 || floor === 8 || floor === 10) return 1; // bosses
  if (floor <= 3) return 4 + floor; // 5, 6, 7
  return 6 + Math.floor(floor / 2);
}
