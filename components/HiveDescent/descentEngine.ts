// components/HiveDescent/descentEngine.ts
// Hive Descent v2 — pure, deterministic turn engine. No React, no three.js.
// Everything random is drawn from the daily seed so every player fights the same hive today.

import { BIOMES, getBiome, type Biome } from "./biomes";
import { ENEMIES, type EnemyKind } from "./enemies";
import { RELICS, type Relic } from "./relics";
import {
  BASE_MAX_HP, BASE_ATTACK_DAMAGE, BASE_CRIT_CHANCE, BASE_CRIT_MULT,
  DEFEND_DAMAGE_TAKEN, DEFEND_HEAL, MAGIC_DAMAGE, MAGIC_COOLDOWN_TURNS, SPECIAL_COOLDOWN_TURNS,
  ENEMY_GUARD_MULT, ENEMY_HEAVY_MULT, BOSS_SPECIAL_MULT, BURN_DAMAGE, BURN_TURNS,
  HEAL_AMOUNT, POWER_DAMAGE_BONUS, DESCENT_CASHOUT_FLOORS, DESCENT_TOTAL_FLOORS, DESCENT_DEATH_PENALTY,
  getDescentFaction, type DescentFaction, type RewardOfferKind,
} from "../../lib/descentConfig";

// ── Seeded RNG ───────────────────────────────────────────────────────────
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/** Deterministic 0..1 for a (seed, scope) pair. */
export function roll(seed: string, scope: string): number {
  let x = hash32(seed + "|" + scope) || 1;
  x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
  return (x >>> 0) / 4294967296;
}

// ── Types ────────────────────────────────────────────────────────────────
export type Action = "attack" | "defend" | "special" | "magic";
export type IntentKind = "attack" | "heavy" | "guard" | "special";
export type Intent = { kind: IntentKind; dmg: number; label: string; hint: string };

export const ALL_FACTION_IDS = ["ashigaru", "ronin", "samurai", "bushi", "warrior", "shogun", "buke", "kenshi", "wokou", "sohei", "yamabushi"] as const;

export const ENEMY_NAMES: Record<EnemyKind, string> = {
  scout_beetle: "Scout Beetle", worker_drone: "Worker Drone", spider_drone: "Spider Drone", crystal_mite: "Crystal Mite",
  spider_queen: "The Spider Queen", flame_wasp: "Flame Wasp", ice_mantis: "Ice Mantis", acid_slug: "Acid Slug",
  twin_mantis: "The Twin Mantis", elite_guard: "Elite Guard", the_queen: "THE QUEEN",
};

export type Enemy = {
  kind: EnemyKind; name: string; factionId: string;   // factionId = which 3D model wears the corruption
  hp: number; maxHp: number; dmg: number; isBoss: boolean; scale: number;
  guarding: boolean; stunned: number; burn: number; poison: number; poisonDmg: number;
  intent: Intent; turn: number;
};

export type Player = {
  hp: number; maxHp: number;
  dmgMult: number; critChance: number; critMult: number;
  healOnKill: number; ignite: boolean; reviveOnce: boolean; dodge: number;
  doubleHit: number; specialCdMult: number; rebelMult: number;
  specialCd: number; magicCd: number;
  buffMult: number; buffTurns: number;
  guardThisTurn: number | null; takenMultThisTurn: number;
};

export type Ev =
  | { t: "anim"; who: "player" | "enemy"; anim: "attack" | "defend" | "magic" | "trick" | "hit" | "win" | "lose"; ms?: number }
  | { t: "dmg"; who: "player" | "enemy"; amount: number; crit?: boolean; kind?: "burn" | "poison" | "dodge" | "blocked" }
  | { t: "heal"; who: "player" | "enemy"; amount: number }
  | { t: "text"; text: string; tone?: "good" | "bad" | "info" | "boom" }
  | { t: "enemyDown"; name: string; rebel: number }
  | { t: "playerDown"; revived: boolean }
  | { t: "floorClear"; floor: number; rebel: number };

export type RewardOffer = { kind: RewardOfferKind; relic?: Relic; title: string; desc: string };

export type Phase = "intro" | "battle" | "reward" | "dead" | "victory" | "cashout";

export type Run = {
  seed: string; factionId: string; faction: DescentFaction;
  floor: number; enemyIdx: number; enemies: Enemy[];
  player: Player; relics: Relic[];
  unbanked: number; banked: number; phase: Phase;
  rewardOffers: RewardOffer[];
  startedAt: number; turns: number; kills: number; crits: number; maxFloorReached: number;
};

// ── Enemy generation ─────────────────────────────────────────────────────
function enemiesPerFloor(floor: number): number {
  if (floor === 4 || floor === 8 || floor === 10) return 1;
  return floor === 9 ? 2 : 2;
}
function bossHp(kind: EnemyKind): number {
  if (kind === "spider_queen") return 140;
  if (kind === "twin_mantis") return 160;
  if (kind === "the_queen") return 230;
  return ENEMIES[kind].hp;
}
function pickEnemyFaction(seed: string, playerFaction: string, floor: number, idx: number): string {
  const pool = ALL_FACTION_IDS.filter((f) => f !== playerFaction);
  return pool[Math.floor(roll(seed, `ef${floor}.${idx}`) * pool.length)];
}
export function makeEnemy(seed: string, playerFaction: string, floor: number, idx: number): Enemy {
  const biome = getBiome(floor);
  const kinds = biome.enemyTypes as EnemyKind[];
  const kind = kinds[Math.floor(roll(seed, `ek${floor}.${idx}`) * kinds.length)];
  const arch = ENEMIES[kind];
  const hp = arch.isBoss ? bossHp(kind) : arch.hp;
  const e: Enemy = {
    kind, name: ENEMY_NAMES[kind], factionId: pickEnemyFaction(seed, playerFaction, floor, idx),
    hp, maxHp: hp, dmg: arch.damage, isBoss: !!arch.isBoss, scale: arch.isBoss ? (kind === "the_queen" ? 1.55 : 1.3) : 1,
    guarding: false, stunned: 0, burn: 0, poison: 0, poisonDmg: 0,
    intent: { kind: "attack", dmg: arch.damage, label: "", hint: "" }, turn: 0,
  };
  e.intent = rollIntent(seed, e, floor, idx, 0);
  return e;
}

export function rollIntent(seed: string, e: Enemy, floor: number, idx: number, turn: number): Intent {
  if (e.isBoss && turn > 0 && turn % 4 === 3) {
    const dmg = Math.round(e.dmg * BOSS_SPECIAL_MULT);
    return { kind: "special", dmg, label: `☠ ${e.name.replace(/^The /i, "")} unleashes`, hint: `${dmg} damage — DEFEND or stun it` };
  }
  const r = roll(seed, `in${floor}.${idx}.${turn}`);
  if (r < 0.5) return { kind: "attack", dmg: e.dmg, label: "⚔ Attack", hint: `${e.dmg} damage` };
  if (r < 0.75) { const dmg = Math.round(e.dmg * ENEMY_HEAVY_MULT); return { kind: "heavy", dmg, label: "⚠ Heavy strike", hint: `${dmg} damage — defending cuts it to ${Math.round(dmg * DEFEND_DAMAGE_TAKEN)}` }; }
  if (r < 0.9) return { kind: "guard", dmg: 0, label: "🛡 Guard", hint: "Your attack does half — Magic ignores it" };
  return { kind: "attack", dmg: e.dmg, label: "⚔ Attack", hint: `${e.dmg} damage` };
}

// ── Player ───────────────────────────────────────────────────────────────
export function basePlayer(): Player {
  return {
    hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, dmgMult: 1, critChance: BASE_CRIT_CHANCE, critMult: BASE_CRIT_MULT,
    healOnKill: 0, ignite: false, reviveOnce: false, dodge: 0, doubleHit: 0, specialCdMult: 1, rebelMult: 1,
    specialCd: 0, magicCd: 0, buffMult: 1, buffTurns: 0, guardThisTurn: null, takenMultThisTurn: 1,
  };
}
export function applyRelic(p: Player, r: Relic): Player {
  const e = r.effect; const n = { ...p };
  if (e.damageMult) n.dmgMult *= e.damageMult;
  if (e.maxHpAdd) { n.maxHp = Math.max(30, n.maxHp + e.maxHpAdd); n.hp = Math.min(n.maxHp, n.hp + Math.max(0, e.maxHpAdd)); }
  if (e.critChanceAdd) n.critChance += e.critChanceAdd;
  if (e.critDamageAdd) n.critMult += e.critDamageAdd;
  if (e.healOnKill) n.healOnKill += e.healOnKill;
  if (e.ignite) n.ignite = true;
  if (e.reviveOnce) n.reviveOnce = true;
  if (e.dodgeIframesAdd) n.dodge += e.dodgeIframesAdd / 2000;      // 200ms → +10% dodge
  if (e.speedMult) n.dodge += (e.speedMult - 1) / 2;                 // 1.2 → +10% dodge
  if (e.attackSpeedMult) n.doubleHit += (e.attackSpeedMult - 1);     // 1.3 → 30% chance of a free second hit
  if (e.specialCooldownMult) n.specialCdMult *= e.specialCooldownMult;
  if (e.rebelGainMult) n.rebelMult *= e.rebelGainMult;
  return n;
}

// ── Run lifecycle ────────────────────────────────────────────────────────
export function newRun(seed: string, factionId: string): Run {
  const faction = getDescentFaction(factionId);
  const run: Run = {
    seed, factionId, faction, floor: 1, enemyIdx: 0, enemies: [], player: basePlayer(), relics: [],
    unbanked: 0, banked: 0, phase: "intro", rewardOffers: [], startedAt: Date.now(), turns: 0, kills: 0, crits: 0, maxFloorReached: 1,
  };
  run.enemies = spawnFloor(run);
  return run;
}
function spawnFloor(run: Run): Enemy[] {
  const n = enemiesPerFloor(run.floor);
  return Array.from({ length: n }, (_, i) => makeEnemy(run.seed, run.factionId, run.floor, i));
}
export function currentEnemy(run: Run): Enemy | null { return run.enemies[run.enemyIdx] || null; }
export function biomeOf(run: Run): Biome { return getBiome(run.floor); }
export function specialCooldownTurns(p: Player): number { return Math.max(2, Math.round(SPECIAL_COOLDOWN_TURNS * p.specialCdMult)); }
export function canCashOut(run: Run): boolean { return DESCENT_CASHOUT_FLOORS.includes(run.floor); }

// ── Turn resolution ──────────────────────────────────────────────────────
type Ctx = { run: Run; e: Enemy; p: Player; evs: Ev[]; scope: string; k: number };
const r = (c: Ctx, tag: string) => roll(c.run.seed, `${c.scope}.${tag}.${c.k++}`);

function hitEnemy(c: Ctx, base: number, opts: { forceCrit?: boolean; ignoreGuard?: boolean; anim?: boolean } = {}): number {
  const p = c.p, e = c.e;
  const crit = opts.forceCrit || r(c, "crit") < p.critChance;
  let dmg = base * p.dmgMult * p.buffMult * (crit ? p.critMult : 1);
  if (e.guarding && !opts.ignoreGuard) dmg *= ENEMY_GUARD_MULT;
  dmg = Math.max(1, Math.round(dmg));
  e.hp = Math.max(0, e.hp - dmg);
  c.evs.push({ t: "dmg", who: "enemy", amount: dmg, crit, kind: e.guarding && !opts.ignoreGuard ? "blocked" : undefined });
  if (crit) c.run.crits++;
  if (p.ignite && e.burn === 0) e.burn = BURN_TURNS;
  return dmg;
}

function playerAct(c: Ctx, action: Action) {
  const p = c.p, e = c.e, f = c.run.faction;
  p.guardThisTurn = null; p.takenMultThisTurn = 1;
  if (action === "attack") {
    c.evs.push({ t: "anim", who: "player", anim: "attack" });
    hitEnemy(c, BASE_ATTACK_DAMAGE);
    if (e.hp > 0 && p.doubleHit > 0 && r(c, "dbl") < p.doubleHit) { c.evs.push({ t: "text", text: "Follow-up strike!", tone: "good" }); c.evs.push({ t: "anim", who: "player", anim: "attack", ms: 500 }); hitEnemy(c, BASE_ATTACK_DAMAGE * 0.7); }
    return;
  }
  if (action === "defend") {
    c.evs.push({ t: "anim", who: "player", anim: "defend" });
    p.guardThisTurn = DEFEND_DAMAGE_TAKEN;
    const heal = Math.min(DEFEND_HEAL, p.maxHp - p.hp); if (heal > 0) { p.hp += heal; c.evs.push({ t: "heal", who: "player", amount: heal }); }
    c.evs.push({ t: "text", text: "Braced. Incoming damage cut to 35%.", tone: "info" });
    return;
  }
  if (action === "magic") {
    c.evs.push({ t: "anim", who: "player", anim: "magic" });
    p.magicCd = MAGIC_COOLDOWN_TURNS + 1;
    hitEnemy(c, MAGIC_DAMAGE, { ignoreGuard: true });
    return;
  }
  // special
  c.evs.push({ t: "anim", who: "player", anim: "trick" });
  p.specialCd = specialCooldownTurns(p) + 1;
  c.evs.push({ t: "text", text: `⚡ ${f.specialName}`, tone: "boom" });
  const ef = f.effect;
  switch (ef.kind) {
    case "strike": hitEnemy(c, ef.dmg, { forceCrit: ef.crit }); if (ef.guardThisTurn) p.guardThisTurn = ef.guardThisTurn; break;
    case "multi": for (let i = 0; i < ef.hits; i++) { if (e.hp <= 0) break; if (i > 0) c.evs.push({ t: "anim", who: "player", anim: "attack", ms: 450 }); hitEnemy(c, ef.dmg); } break;
    case "berserk": hitEnemy(c, ef.dmg); p.takenMultThisTurn = ef.selfDamageTakenMult; break;
    case "rally": hitEnemy(c, ef.dmg); p.buffMult = ef.buffMult; p.buffTurns = ef.buffTurns + 1; c.evs.push({ t: "text", text: `+${Math.round((ef.buffMult - 1) * 100)}% damage for ${ef.buffTurns} turns`, tone: "good" }); break;
    case "poison": hitEnemy(c, ef.dmg); e.poison = ef.dotTurns; e.poisonDmg = ef.dot; c.evs.push({ t: "text", text: `Poisoned — ${ef.dot}/turn for ${ef.dotTurns} turns`, tone: "good" }); break;
    case "drain": { hitEnemy(c, ef.dmg); const heal = Math.min(ef.heal, p.maxHp - p.hp); if (heal > 0) { p.hp += heal; c.evs.push({ t: "heal", who: "player", amount: heal }); } break; }
    case "heal": { const heal = Math.min(ef.amount, p.maxHp - p.hp); p.hp += heal; c.evs.push({ t: "heal", who: "player", amount: heal }); break; }
    case "fortify": { const heal = Math.min(ef.heal, p.maxHp - p.hp); p.hp += heal; c.evs.push({ t: "heal", who: "player", amount: heal }); p.guardThisTurn = ef.guardThisTurn; break; }
    case "stun": hitEnemy(c, ef.dmg); e.stunned = ef.stunTurns; c.evs.push({ t: "text", text: `${e.name} is stunned`, tone: "good" }); break;
  }
}

function enemyAct(c: Ctx) {
  const p = c.p, e = c.e; const it = e.intent;
  if (e.stunned > 0) { e.stunned--; c.evs.push({ t: "text", text: `${e.name} is stunned and loses its turn`, tone: "info" }); return; }
  if (it.kind === "guard") { c.evs.push({ t: "anim", who: "enemy", anim: "defend" }); c.evs.push({ t: "text", text: `${e.name} holds its guard`, tone: "info" }); return; }
  c.evs.push({ t: "anim", who: "enemy", anim: it.kind === "special" ? "trick" : it.kind === "heavy" ? "magic" : "attack" });
  if (p.dodge > 0 && r(c, "dodge") < Math.min(0.5, p.dodge)) { c.evs.push({ t: "dmg", who: "player", amount: 0, kind: "dodge" }); c.evs.push({ t: "text", text: "Dodged!", tone: "good" }); return; }
  let dmg = it.dmg * p.takenMultThisTurn;
  const guarded = p.guardThisTurn != null;
  if (guarded) dmg *= p.guardThisTurn as number;
  dmg = Math.max(0, Math.round(dmg));
  p.hp = Math.max(0, p.hp - dmg);
  c.evs.push({ t: "dmg", who: "player", amount: dmg, kind: guarded ? "blocked" : undefined });
  if (p.hp > 0) c.evs.push({ t: "anim", who: "player", anim: "hit", ms: 500 });
}

function tickDots(c: Ctx) {
  const e = c.e;
  if (e.hp > 0 && e.burn > 0) { e.burn--; const d = BURN_DAMAGE; e.hp = Math.max(0, e.hp - d); c.evs.push({ t: "dmg", who: "enemy", amount: d, kind: "burn" }); }
  if (e.hp > 0 && e.poison > 0) { e.poison--; e.hp = Math.max(0, e.hp - e.poisonDmg); c.evs.push({ t: "dmg", who: "enemy", amount: e.poisonDmg, kind: "poison" }); }
}

/** Resolve one full turn. Mutates a copy of `run` and returns it plus the ordered event list for the UI to animate. */
export function takeTurn(run0: Run, action: Action): { run: Run; evs: Ev[] } {
  const run: Run = { ...run0, player: { ...run0.player }, enemies: run0.enemies.map((e) => ({ ...e, intent: { ...e.intent } })) };
  const e = run.enemies[run.enemyIdx]; const p = run.player; const evs: Ev[] = [];
  if (!e || run.phase !== "battle") return { run, evs };
  if (action === "special" && p.specialCd > 0) action = "attack";
  if (action === "magic" && p.magicCd > 0) action = "attack";
  const c: Ctx = { run, e, p, evs, scope: `t${run.floor}.${run.enemyIdx}.${e.turn}`, k: 0 };
  run.turns++;

  // a telegraphed Guard is up before the player swings (Magic ignores it)
  e.guarding = e.intent.kind === "guard" && e.stunned === 0;

  playerAct(c, action);
  tickDots(c);

  // cooldowns + buffs tick once the player has acted (UI shows the remaining blocked turns directly)
  if (p.specialCd > 0) p.specialCd--; if (p.magicCd > 0) p.magicCd--;
  if (p.buffTurns > 0) { p.buffTurns--; if (p.buffTurns === 0) p.buffMult = 1; }

  if (e.hp <= 0) {
    onEnemyDown(run, evs); return { run, evs };
  }
  enemyAct(c);
  e.guarding = false;

  if (p.hp <= 0) {
    if (p.reviveOnce) { p.reviveOnce = false; p.hp = Math.round(p.maxHp * 0.5); evs.push({ t: "playerDown", revived: true }); evs.push({ t: "text", text: "Soldier's Resolve — you stand again at 50% HP", tone: "boom" }); }
    else { evs.push({ t: "anim", who: "player", anim: "lose" }); evs.push({ t: "playerDown", revived: false }); run.phase = "dead"; run.banked = Math.floor(run.unbanked * DESCENT_DEATH_PENALTY); return { run, evs }; }
  }
  e.turn++;
  e.intent = rollIntent(run.seed, e, run.floor, run.enemyIdx, e.turn);
  p.guardThisTurn = null; p.takenMultThisTurn = 1;
  return { run, evs };
}

function onEnemyDown(run: Run, evs: Ev[]) {
  const e = run.enemies[run.enemyIdx]; const p = run.player;
  run.kills++;
  evs.push({ t: "anim", who: "enemy", anim: "lose" });
  if (p.healOnKill > 0) { const h = Math.min(p.healOnKill, p.maxHp - p.hp); if (h > 0) { p.hp += h; evs.push({ t: "heal", who: "player", amount: h }); } }
  const last = run.enemyIdx >= run.enemies.length - 1;
  const biome = getBiome(run.floor);
  const perEnemy = Math.round((biome.rebelReward * p.rebelMult) / run.enemies.length);
  run.unbanked += perEnemy;
  evs.push({ t: "enemyDown", name: e.name, rebel: perEnemy });
  if (!last) { run.enemyIdx++; p.guardThisTurn = null; p.takenMultThisTurn = 1; return; }
  evs.push({ t: "anim", who: "player", anim: "win" });
  evs.push({ t: "floorClear", floor: run.floor, rebel: Math.round(biome.rebelReward * p.rebelMult) });
  run.maxFloorReached = Math.max(run.maxFloorReached, run.floor);
  if (run.floor >= DESCENT_TOTAL_FLOORS) { run.phase = "victory"; run.banked = run.unbanked; return; }
  run.phase = "reward"; run.rewardOffers = makeRewardOffers(run);
}

// ── Rewards ──────────────────────────────────────────────────────────────
export function makeRewardOffers(run: Run): RewardOffer[] {
  const owned = new Set(run.relics.map((r) => r.id));
  const pool = RELICS.filter((r) => !owned.has(r.id));
  const rr = roll(run.seed, `relic${run.floor}`);
  // rarity weights by depth
  const legendaryChance = run.floor >= 6 ? 0.18 : 0.06, rareChance = 0.42;
  const rarity = rr < legendaryChance ? "legendary" : rr < legendaryChance + rareChance ? "rare" : "common";
  const byRarity = pool.filter((r) => r.rarity === rarity);
  const cand = byRarity.length ? byRarity : pool;
  const relic = cand[Math.floor(roll(run.seed, `relicpick${run.floor}`) * cand.length)];
  const offers: RewardOffer[] = [
    { kind: "heal", title: "Mend", desc: `Restore ${HEAL_AMOUNT} HP` },
    { kind: "power", title: "Sharpen", desc: `+${Math.round(POWER_DAMAGE_BONUS * 100)}% damage for the rest of the run` },
  ];
  if (relic) offers.push({ kind: "relic", relic, title: relic.name, desc: relic.flavor });
  if (canCashOut(run)) offers.push({ kind: "cashout", title: "Escape the hive", desc: `Bank ${run.unbanked} REBEL and leave` });
  return offers;
}

export function chooseReward(run0: Run, offer: RewardOffer): Run {
  const run: Run = { ...run0, player: { ...run0.player }, relics: [...run0.relics] };
  if (run.phase !== "reward") return run;
  if (offer.kind === "heal") run.player.hp = Math.min(run.player.maxHp, run.player.hp + HEAL_AMOUNT);
  else if (offer.kind === "power") run.player.dmgMult *= 1 + POWER_DAMAGE_BONUS;
  else if (offer.kind === "relic" && offer.relic) { run.relics.push(offer.relic); run.player = applyRelic(run.player, offer.relic); }
  else if (offer.kind === "cashout") { run.phase = "cashout"; run.banked = run.unbanked; return run; }
  // next floor
  run.floor++; run.enemyIdx = 0; run.enemies = spawnFloor(run); run.phase = "intro"; run.rewardOffers = [];
  run.maxFloorReached = Math.max(run.maxFloorReached, run.floor);
  run.player.specialCd = 0; run.player.magicCd = 0; run.player.guardThisTurn = null; run.player.takenMultThisTurn = 1;
  return run;
}

export function beginBattle(run0: Run): Run { return run0.phase === "intro" ? { ...run0, phase: "battle" } : run0; }

export function totalPossibleRebel(): number { return BIOMES.reduce((s, b) => s + b.rebelReward, 0); }

export function rarityForRun(run: Run): "ultra" | "rare" | "common" | "none" {
  if (run.phase === "victory") return "ultra";
  if (run.maxFloorReached >= 7) return "rare";
  if (run.maxFloorReached >= 4) return "common";
  return "none";
}
