// components/HiveDescent/descentEngine.ts
// Hive Descent v3 — deterministic card-battle roguelite engine. No React, no three.js.
// Every random draw comes from the daily seed, so everyone fights the same hive today.

import { BIOMES, getBiome, type Biome } from "./biomes";
import { ENEMIES, type EnemyKind } from "./enemies";
import { RELICS, type Relic } from "./relics";
import { DESCENT_CASHOUT_FLOORS, DESCENT_TOTAL_FLOORS, DESCENT_DEATH_PENALTY, getDescentFaction, type DescentFaction } from "../../lib/descentConfig";
import { CARD_POOL, starterDeck, type Card } from "../../lib/descentCards";

// ── Seeded RNG ────────────────────────────────────────────────────────────────
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

// ── Constants ─────────────────────────────────────────────────────────────────
export const BASE_MAX_HP = 100;
export const BASE_ENERGY = 3;
export const HAND_SIZE = 5;
export const HEAL_REWARD = 30;
export const BURN_DAMAGE = 3;
const ENEMY_HP_SCALE = 0.10, ENEMY_DMG_SCALE = 0.06;
const ENEMY_HP_BASE = 0.8, ENEMY_DMG_BASE = 0.55;   // archetype stats were tuned for the old real-time game

export const ALL_FACTION_IDS = ["ashigaru", "ronin", "samurai", "bushi", "warrior", "shogun", "buke", "kenshi", "wokou", "sohei", "yamabushi"] as const;

export const ENEMY_NAMES: Record<EnemyKind, string> = {
  scout_beetle: "Scout Beetle", worker_drone: "Worker Drone", spider_drone: "Spider Drone", crystal_mite: "Crystal Mite",
  spider_queen: "The Spider Queen", flame_wasp: "Flame Wasp", ice_mantis: "Ice Mantis", acid_slug: "Acid Slug",
  twin_mantis: "The Twin Mantis", elite_guard: "Elite Guard", the_queen: "THE QUEEN",
};

// ── Types ─────────────────────────────────────────────────────────────────────
export type IntentKind = "attack" | "heavy" | "multi" | "guard" | "buff" | "special";
export type Intent = { kind: IntentKind; dmg: number; hits: number; label: string; hint: string };

export type Enemy = {
  id: number; kind: EnemyKind; name: string; factionId: string; isBoss: boolean; scale: number;
  hp: number; maxHp: number; block: number; strength: number; baseDmg: number;
  poison: number; burn: number; stun: number; vulnerable: number; weak: number;
  intent: Intent; turn: number; alive: boolean;
};

export type Player = {
  hp: number; maxHp: number; block: number;
  energy: number; maxEnergy: number;
  strength: number; tempStrength: number;
  vulnerable: number; weak: number;
  powers: Record<string, number>;
  // relic-derived
  dmgMult: number; critChance: number; healOnKill: number; ignite: boolean; reviveOnce: boolean; dodge: number; rebelMult: number; doubleHit: number; specialDiscount: number;
};

export type Who = "player" | { enemy: number };
export type Ev =
  | { t: "play"; card: Card; target: number | null }
  | { t: "anim"; who: Who; anim: "attack" | "defend" | "magic" | "trick" | "hit" | "win" | "lose" }
  | { t: "dmg"; who: Who; amount: number; blocked: number; crit?: boolean; kind?: "poison" | "burn" | "thorns" | "self" }
  | { t: "dodge" }
  | { t: "block"; who: Who; amount: number }
  | { t: "heal"; who: Who; amount: number }
  | { t: "status"; who: Who; status: string; amount: number }
  | { t: "draw"; n: number }
  | { t: "text"; text: string; tone?: "good" | "bad" | "info" | "boom" }
  | { t: "enemyDown"; enemy: number; name: string; rebel: number }
  | { t: "playerDown"; revived: boolean }
  | { t: "floorClear"; floor: number; rebel: number }
  | { t: "turn"; n: number };

export type RewardOffer = { kind: "card"; card: Card; title: string; desc: string } | { kind: "relic"; relic: Relic; title: string; desc: string } | { kind: "heal"; title: string; desc: string } | { kind: "cashout"; title: string; desc: string } | { kind: "skip"; title: string; desc: string };
export type Phase = "intro" | "battle" | "reward" | "dead" | "victory" | "cashout";

export type Run = {
  seed: string; factionId: string; faction: DescentFaction;
  floor: number; enemies: Enemy[];
  player: Player; relics: Relic[];
  deck: Card[];                 // the run's full deck (persists between floors)
  draw: Card[]; hand: Card[]; discard: Card[]; exhaust: Card[];
  turnNo: number; rng: number;
  unbanked: number; banked: number; phase: Phase;
  rewardOffers: RewardOffer[];
  startedAt: number; turns: number; kills: number; crits: number; cardsPlayed: number; maxFloorReached: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const clone = (r: Run): Run => ({ ...r, player: { ...r.player, powers: { ...r.player.powers } }, enemies: r.enemies.map((e) => ({ ...e, intent: { ...e.intent } })), draw: [...r.draw], hand: [...r.hand], discard: [...r.discard], exhaust: [...r.exhaust], relics: [...r.relics], deck: [...r.deck] });
function nextRoll(run: Run, tag: string): number { run.rng++; return roll(run.seed, `${tag}.${run.rng}`); }
function shuffle<T>(run: Run, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(nextRoll(run, "shuf") * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function biomeOf(run: Run): Biome { return getBiome(run.floor); }
export function canCashOut(run: Run): boolean { return DESCENT_CASHOUT_FLOORS.includes(run.floor); }
export function aliveEnemies(run: Run): Enemy[] { return run.enemies.filter((e) => e.alive); }
export function cardCost(run: Run, card: Card): number { return card.rarity === "faction" ? Math.max(0, card.cost - run.player.specialDiscount) : card.cost; }

// ── Enemy generation ──────────────────────────────────────────────────────────
function floorLineup(floor: number): EnemyKind[] {
  const b = getBiome(floor); const kinds = b.enemyTypes as EnemyKind[];
  if (floor === 4) return ["spider_queen"];
  if (floor === 8) return ["twin_mantis"];
  if (floor === 10) return ["elite_guard", "the_queen", "elite_guard"];
  const n = floor <= 2 || floor === 3 || floor === 5 ? 2 : 3;
  return Array.from({ length: n }, (_, i) => kinds[i % kinds.length]);
}
function bossHp(kind: EnemyKind): number { return kind === "spider_queen" ? 90 : kind === "twin_mantis" ? 130 : kind === "the_queen" ? 180 : kind === "elite_guard" ? 55 : ENEMIES[kind].hp; }
function pickEnemyFaction(seed: string, playerFaction: string, floor: number, idx: number): string {
  const pool = ALL_FACTION_IDS.filter((f) => f !== playerFaction);
  return pool[Math.floor(roll(seed, `ef${floor}.${idx}`) * pool.length)];
}
function makeEnemy(run: Run, floor: number, idx: number, kind: EnemyKind, packSize = 1): Enemy {
  const arch = ENEMIES[kind]; const isBoss = !!arch.isBoss;
  const pack = packSize >= 3 ? 0.8 : 1;   // three-enemy floors: each one hits/lives a little less
  const scaleHp = (1 + ENEMY_HP_SCALE * (floor - 1)) * (packSize >= 3 ? 0.9 : 1), scaleDmg = (1 + ENEMY_DMG_SCALE * (floor - 1)) * pack;
  const hp = Math.round((isBoss || kind === "elite_guard" ? bossHp(kind) : arch.hp * ENEMY_HP_BASE) * (isBoss ? 1 : scaleHp));
  const e: Enemy = {
    id: floor * 10 + idx, kind, name: ENEMY_NAMES[kind], factionId: pickEnemyFaction(run.seed, run.factionId, floor, idx), isBoss, scale: kind === "the_queen" ? 1.5 : isBoss ? 1.3 : kind === "elite_guard" ? 1.12 : 1,
    hp, maxHp: hp, block: 0, strength: 0, baseDmg: Math.max(3, Math.round(arch.damage * (isBoss ? 0.5 : ENEMY_DMG_BASE) * scaleDmg)),
    poison: 0, burn: 0, stun: 0, vulnerable: 0, weak: 0,
    intent: { kind: "attack", dmg: 0, hits: 1, label: "", hint: "" }, turn: 0, alive: true,
  };
  e.intent = rollIntent(run, e);
  return e;
}
function rollIntent(run: Run, e: Enemy): Intent {
  const dmg = e.baseDmg + e.strength;
  if (e.isBoss && e.turn > 0 && e.turn % 3 === 2) { const d = Math.round(dmg * 0.6); return { kind: "special", dmg: d, hits: 3, label: `☠ ${e.name.replace(/^The /i, "")} unleashes`, hint: `${d} × 3` }; }
  const r = roll(run.seed, `in${run.floor}.${e.id}.${e.turn}`);
  if (r < 0.45) return { kind: "attack", dmg, hits: 1, label: "⚔ Attack", hint: `${dmg}` };
  if (r < 0.62) { const d = Math.round(dmg * 1.6); return { kind: "heavy", dmg: d, hits: 1, label: "⚠ Heavy", hint: `${d}` }; }
  if (r < 0.75) { const d = Math.max(2, Math.round(dmg * 0.45)); return { kind: "multi", dmg: d, hits: 3, label: "⚔ Frenzy", hint: `${d} × 3` }; }
  if (r < 0.88) return { kind: "guard", dmg: 0, hits: 0, label: "🛡 Guard", hint: `+${8 + run.floor} Block` };
  return { kind: "buff", dmg: 0, hits: 0, label: "↑ Enrage", hint: "+2 Strength" };
}

// ── Player / relics ───────────────────────────────────────────────────────────
export function basePlayer(): Player {
  return { hp: BASE_MAX_HP, maxHp: BASE_MAX_HP, block: 0, energy: BASE_ENERGY, maxEnergy: BASE_ENERGY, strength: 0, tempStrength: 0, vulnerable: 0, weak: 0, powers: {}, dmgMult: 1, critChance: 0.05, healOnKill: 0, ignite: false, reviveOnce: false, dodge: 0, rebelMult: 1, doubleHit: 0, specialDiscount: 0 };
}
export function applyRelic(p: Player, r: Relic): Player {
  const e = r.effect; const n = { ...p };
  if (e.damageMult) n.dmgMult *= e.damageMult;
  if (e.maxHpAdd) { n.maxHp = Math.max(30, n.maxHp + e.maxHpAdd); n.hp = Math.min(n.maxHp, n.hp + Math.max(0, e.maxHpAdd)); }
  if (e.critChanceAdd) n.critChance += e.critChanceAdd;
  if (e.critDamageAdd) n.dmgMult *= 1 + e.critDamageAdd * 0.3;
  if (e.healOnKill) n.healOnKill += e.healOnKill;
  if (e.ignite) n.ignite = true;
  if (e.reviveOnce) n.reviveOnce = true;
  if (e.dodgeIframesAdd) n.dodge += e.dodgeIframesAdd / 2000;
  if (e.speedMult) n.dodge += (e.speedMult - 1) / 2;
  if (e.attackSpeedMult) n.doubleHit += e.attackSpeedMult - 1;
  if (e.specialCooldownMult) n.specialDiscount = 1;
  if (e.rebelGainMult) n.rebelMult *= e.rebelGainMult;
  return n;
}

// ── Run lifecycle ─────────────────────────────────────────────────────────────
export function newRun(seed: string, factionId: string): Run {
  const faction = getDescentFaction(factionId);
  const run: Run = {
    seed, factionId, faction, floor: 1, enemies: [], player: basePlayer(), relics: [],
    deck: starterDeck(factionId), draw: [], hand: [], discard: [], exhaust: [], turnNo: 0, rng: 0,
    unbanked: 0, banked: 0, phase: "intro", rewardOffers: [], startedAt: Date.now(), turns: 0, kills: 0, crits: 0, cardsPlayed: 0, maxFloorReached: 1,
  };
  const l1 = floorLineup(1); run.enemies = l1.map((k, i) => makeEnemy(run, 1, i, k, l1.length));
  return run;
}

/** intro → battle: set up the deck and draw the first hand. */
export function beginBattle(run0: Run): { run: Run; evs: Ev[] } {
  if (run0.phase !== "intro") return { run: run0, evs: [] };
  const run = clone(run0); const evs: Ev[] = [];
  run.phase = "battle"; run.turnNo = 0;
  run.draw = shuffle(run, run.deck); run.hand = []; run.discard = []; run.exhaust = [];
  run.player.block = 0; run.player.tempStrength = 0; run.player.strength = 0; run.player.vulnerable = 0; run.player.weak = 0; run.player.powers = {};
  startTurn(run, evs);
  return { run, evs };
}

function drawCards(run: Run, n: number, evs: Ev[]) {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (run.draw.length === 0) { if (run.discard.length === 0) break; run.draw = shuffle(run, run.discard); run.discard = []; }
    if (run.hand.length >= 10) break;
    run.hand.push(run.draw.pop() as Card); drawn++;
  }
  if (drawn) evs.push({ t: "draw", n: drawn });
}

function startTurn(run: Run, evs: Ev[]) {
  const p = run.player;
  run.turnNo++; run.turns++;
  evs.push({ t: "turn", n: run.turnNo });
  p.block = 0; p.tempStrength = 0;
  p.energy = p.maxEnergy + (p.powers.momentum || 0);
  if (p.powers.iron_skin) { p.block += 3 * p.powers.iron_skin; evs.push({ t: "block", who: "player", amount: 3 * p.powers.iron_skin }); }
  if (p.powers.regen) { const h = Math.min(3 * p.powers.regen, p.maxHp - p.hp); if (h > 0) { p.hp += h; evs.push({ t: "heal", who: "player", amount: h }); } }
  drawCards(run, HAND_SIZE + (p.powers.mandible || 0), evs);
}

// ── Damage ────────────────────────────────────────────────────────────────────
function hitEnemy(run: Run, e: Enemy, base: number, evs: Ev[], opts: { ignoreBlock?: boolean; crit?: boolean } = {}): number {
  const p = run.player;
  const crit = opts.crit ?? nextRoll(run, "crit") < p.critChance;
  let dmg = (base + p.strength + p.tempStrength) * p.dmgMult * (e.vulnerable > 0 ? 1.5 : 1) * (p.weak > 0 ? 0.75 : 1) * (crit ? 1.5 : 1);
  dmg = Math.max(0, Math.round(dmg));
  let blocked = 0;
  if (!opts.ignoreBlock && e.block > 0) { blocked = Math.min(e.block, dmg); e.block -= blocked; dmg -= blocked; }
  e.hp = Math.max(0, e.hp - dmg);
  if (crit) run.crits++;
  evs.push({ t: "dmg", who: { enemy: e.id }, amount: dmg, blocked, crit });
  if (p.ignite && dmg > 0) e.burn = Math.max(e.burn, 2);
  if (p.powers.ember_heart && dmg > 0) e.burn = Math.max(e.burn, 2 * p.powers.ember_heart);
  return dmg;
}

function damagePlayer(run: Run, raw: number, evs: Ev[], kind?: "poison" | "burn" | "thorns" | "self"): number {
  const p = run.player;
  let dmg = Math.max(0, Math.round(raw));
  let blocked = 0;
  if (kind !== "self" && p.block > 0) { blocked = Math.min(p.block, dmg); p.block -= blocked; dmg -= blocked; }
  p.hp = Math.max(0, p.hp - dmg);
  evs.push({ t: "dmg", who: "player", amount: dmg, blocked, kind });
  return dmg;
}

function checkEnemyDeaths(run: Run, evs: Ev[]) {
  const p = run.player;
  for (const e of run.enemies) {
    if (!e.alive || e.hp > 0) continue;
    e.alive = false; run.kills++;
    evs.push({ t: "anim", who: { enemy: e.id }, anim: "lose" });
    const biome = getBiome(run.floor);
    const share = Math.round((biome.rebelReward * p.rebelMult) / run.enemies.length);
    run.unbanked += share;
    evs.push({ t: "enemyDown", enemy: e.id, name: e.name, rebel: share });
    if (p.healOnKill > 0) { const h = Math.min(p.healOnKill, p.maxHp - p.hp); if (h > 0) { p.hp += h; evs.push({ t: "heal", who: "player", amount: h }); } }
    if (p.powers.bloodlust) { p.strength += 2 * p.powers.bloodlust; evs.push({ t: "status", who: "player", status: "strength", amount: 2 * p.powers.bloodlust }); }
  }
}

function checkFloorClear(run: Run, evs: Ev[]): boolean {
  if (aliveEnemies(run).length > 0) return false;
  evs.push({ t: "anim", who: "player", anim: "win" });
  const biome = getBiome(run.floor);
  evs.push({ t: "floorClear", floor: run.floor, rebel: Math.round(biome.rebelReward * run.player.rebelMult) });
  run.maxFloorReached = Math.max(run.maxFloorReached, run.floor);
  run.hand = []; run.discard = []; run.draw = []; run.exhaust = [];
  if (run.floor >= DESCENT_TOTAL_FLOORS) { run.phase = "victory"; run.banked = run.unbanked; return true; }
  run.phase = "reward"; run.rewardOffers = makeRewardOffers(run);
  return true;
}

// ── Playing a card ────────────────────────────────────────────────────────────
export function canPlay(run: Run, handIdx: number): boolean {
  const card = run.hand[handIdx]; if (!card || run.phase !== "battle") return false;
  return cardCost(run, card) <= run.player.energy;
}

export function playCard(run0: Run, handIdx: number, targetId: number | null): { run: Run; evs: Ev[] } {
  const run = clone(run0); const evs: Ev[] = []; const p = run.player;
  const card = run.hand[handIdx];
  if (!card || run.phase !== "battle") return { run: run0, evs };
  const cost = card.effect.xCost ? p.energy : cardCost(run, card);
  if (cost > p.energy) return { run: run0, evs };
  const alive = aliveEnemies(run);
  let target: Enemy | null = null;
  if (card.target === "enemy") { target = alive.find((e) => e.id === targetId) || alive[0] || null; if (!target) return { run: run0, evs }; }
  const xValue = card.effect.xCost ? p.energy : 1;
  p.energy -= cost;
  run.hand.splice(handIdx, 1);
  run.cardsPlayed++;
  evs.push({ t: "play", card, target: target ? target.id : null });
  evs.push({ t: "anim", who: "player", anim: card.type === "attack" ? "attack" : card.type === "power" ? "magic" : card.effect.block ? "defend" : "trick" });
  const ef = card.effect;
  const targets: Enemy[] = card.target === "all" ? alive : target ? [target] : [];

  if (ef.tempStrength) { p.tempStrength += ef.tempStrength; evs.push({ t: "status", who: "player", status: "strength (turn)", amount: ef.tempStrength }); }
  if (ef.strength) { p.strength += ef.strength; evs.push({ t: "status", who: "player", status: "strength", amount: ef.strength }); }
  if (ef.selfDamage) damagePlayer(run, ef.selfDamage, evs, "self");

  if (ef.dmg) {
    const hits = (ef.hits || 1) * xValue;
    let total = 0;
    for (const e of targets) {
      for (let h = 0; h < hits; h++) {
        if (e.hp <= 0) break;
        total += hitEnemy(run, e, ef.dmg, evs, { ignoreBlock: ef.ignoreBlock });
        if (p.doubleHit > 0 && e.hp > 0 && nextRoll(run, "dbl") < p.doubleHit) { evs.push({ t: "text", text: "Follow-up!", tone: "good" }); total += hitEnemy(run, e, Math.round(ef.dmg * 0.6), evs, { ignoreBlock: ef.ignoreBlock }); }
      }
    }
    if (ef.lifesteal && total > 0) { const h = Math.min(Math.round(total * ef.lifesteal), p.maxHp - p.hp); if (h > 0) { p.hp += h; evs.push({ t: "heal", who: "player", amount: h }); } }
  }
  for (const e of targets) {
    if (e.hp <= 0) continue;
    if (ef.poison) { e.poison += ef.poison; evs.push({ t: "status", who: { enemy: e.id }, status: "poison", amount: ef.poison }); }
    if (ef.burn) { e.burn += ef.burn; evs.push({ t: "status", who: { enemy: e.id }, status: "burn", amount: ef.burn }); }
    if (ef.stun) { e.stun = Math.max(e.stun, ef.stun); evs.push({ t: "status", who: { enemy: e.id }, status: "stunned", amount: ef.stun }); }
    if (ef.vulnerable) { e.vulnerable += ef.vulnerable; evs.push({ t: "status", who: { enemy: e.id }, status: "vulnerable", amount: ef.vulnerable }); }
    if (ef.weak) { e.weak += ef.weak; evs.push({ t: "status", who: { enemy: e.id }, status: "weak", amount: ef.weak }); }
  }
  if (ef.block) { p.block += ef.block; evs.push({ t: "block", who: "player", amount: ef.block }); }
  if (ef.heal) { const h = Math.min(ef.heal, p.maxHp - p.hp); if (h > 0) { p.hp += h; evs.push({ t: "heal", who: "player", amount: h }); } }
  if (ef.energy) { p.energy += ef.energy; evs.push({ t: "status", who: "player", status: "energy", amount: ef.energy }); }
  if (ef.rebel) { const r = Math.round(ef.rebel * p.rebelMult); run.unbanked += r; evs.push({ t: "text", text: `+${r} REBEL plundered`, tone: "good" }); }
  if (ef.power) { p.powers[ef.power] = (p.powers[ef.power] || 0) + 1; evs.push({ t: "status", who: "player", status: ef.power, amount: 1 }); }
  if (ef.draw) drawCards(run, ef.draw, evs);

  if (ef.exhaust || card.type === "power") run.exhaust.push(card); else run.discard.push(card);

  checkEnemyDeaths(run, evs);
  if (p.hp <= 0) { handlePlayerDeath(run, evs); return { run, evs }; }
  checkFloorClear(run, evs);
  return { run, evs };
}

function handlePlayerDeath(run: Run, evs: Ev[]) {
  const p = run.player;
  if (p.reviveOnce) { p.reviveOnce = false; p.hp = Math.round(p.maxHp * 0.4); evs.push({ t: "playerDown", revived: true }); evs.push({ t: "text", text: "Soldier's Resolve — you stand again", tone: "boom" }); return; }
  evs.push({ t: "anim", who: "player", anim: "lose" }); evs.push({ t: "playerDown", revived: false });
  run.phase = "dead"; run.banked = Math.floor(run.unbanked * DESCENT_DEATH_PENALTY);
}

// ── End of turn: enemies act ──────────────────────────────────────────────────
export function endTurn(run0: Run): { run: Run; evs: Ev[] } {
  if (run0.phase !== "battle") return { run: run0, evs: [] };
  const run = clone(run0); const evs: Ev[] = []; const p = run.player;
  // discard hand
  run.discard.push(...run.hand); run.hand = [];
  p.tempStrength = 0;

  // dots tick on enemies
  for (const e of aliveEnemies(run)) {
    if (e.poison > 0) { e.hp = Math.max(0, e.hp - e.poison); evs.push({ t: "dmg", who: { enemy: e.id }, amount: e.poison, blocked: 0, kind: "poison" }); e.poison--; }
    if (e.hp > 0 && e.burn > 0) { e.hp = Math.max(0, e.hp - BURN_DAMAGE); evs.push({ t: "dmg", who: { enemy: e.id }, amount: BURN_DAMAGE, blocked: 0, kind: "burn" }); e.burn--; }
  }
  checkEnemyDeaths(run, evs);
  if (checkFloorClear(run, evs)) return { run, evs };

  // enemies act
  for (const e of aliveEnemies(run)) {
    e.block = 0;
    if (e.stun > 0) { e.stun--; evs.push({ t: "text", text: `${e.name} is stunned`, tone: "info" }); }
    else {
      const it = e.intent;
      if (it.kind === "guard") { e.block += 8 + run.floor; evs.push({ t: "anim", who: { enemy: e.id }, anim: "defend" }); evs.push({ t: "block", who: { enemy: e.id }, amount: e.block }); }
      else if (it.kind === "buff") { e.strength += 2; evs.push({ t: "anim", who: { enemy: e.id }, anim: "magic" }); evs.push({ t: "status", who: { enemy: e.id }, status: "strength", amount: 2 }); }
      else {
        evs.push({ t: "anim", who: { enemy: e.id }, anim: it.kind === "special" ? "trick" : it.kind === "heavy" ? "magic" : "attack" });
        for (let h = 0; h < it.hits; h++) {
          if (p.hp <= 0) break;
          if (p.dodge > 0 && nextRoll(run, "dodge") < Math.min(0.5, p.dodge)) { evs.push({ t: "dodge" }); continue; }
          const raw = it.dmg * (e.weak > 0 ? 0.75 : 1) * (p.vulnerable > 0 ? 1.5 : 1);
          const dealt = damagePlayer(run, raw, evs);
          if (dealt > 0 && p.powers.thorns) { e.hp = Math.max(0, e.hp - 4 * p.powers.thorns); evs.push({ t: "dmg", who: { enemy: e.id }, amount: 4 * p.powers.thorns, blocked: 0, kind: "thorns" }); }
        }
        if (p.hp > 0) evs.push({ t: "anim", who: "player", anim: "hit" });
      }
    }
    if (e.vulnerable > 0) e.vulnerable--; if (e.weak > 0) e.weak--;
    e.turn++; e.intent = rollIntent(run, e);
    if (p.hp <= 0) { handlePlayerDeath(run, evs); if (run.phase === "dead") return { run, evs }; }
  }
  if (p.vulnerable > 0) p.vulnerable--; if (p.weak > 0) p.weak--;
  checkEnemyDeaths(run, evs);
  if (checkFloorClear(run, evs)) return { run, evs };
  startTurn(run, evs);
  return { run, evs };
}

// ── Rewards ───────────────────────────────────────────────────────────────────
export function makeRewardOffers(run: Run): RewardOffer[] {
  const offers: RewardOffer[] = [];
  const legendaryChance = run.floor >= 7 ? 0.2 : run.floor >= 4 ? 0.1 : 0.03, rareChance = run.floor >= 4 ? 0.4 : 0.3;
  const pickCard = (i: number): Card => {
    const rr = roll(run.seed, `cr${run.floor}.${i}`);
    const rarity = rr < legendaryChance ? "legendary" : rr < legendaryChance + rareChance ? "rare" : "common";
    const pool = CARD_POOL.filter((c) => c.rarity === rarity && !offers.some((o) => o.kind === "card" && o.card.id === c.id));
    return pool[Math.floor(roll(run.seed, `cp${run.floor}.${i}`) * pool.length)];
  };
  for (let i = 0; i < 3; i++) { const c = pickCard(i); offers.push({ kind: "card", card: c, title: c.name, desc: c.text }); }
  const owned = new Set(run.relics.map((r) => r.id));
  const rpool = RELICS.filter((r) => !owned.has(r.id));
  if (rpool.length && roll(run.seed, `relic${run.floor}`) < (run.floor % 2 === 0 ? 0.85 : 0.45)) {
    const legendary = run.floor >= 6 ? 0.18 : 0.06;
    const rr = roll(run.seed, `rr${run.floor}`);
    const rarity = rr < legendary ? "legendary" : rr < legendary + 0.42 ? "rare" : "common";
    const by = rpool.filter((r) => r.rarity === rarity); const cand = by.length ? by : rpool;
    const relic = cand[Math.floor(roll(run.seed, `rp${run.floor}`) * cand.length)];
    offers.push({ kind: "relic", relic, title: relic.name, desc: relic.flavor });
  }
  offers.push({ kind: "heal", title: "Mend", desc: `Restore ${HEAL_REWARD} HP` });
  if (canCashOut(run)) offers.push({ kind: "cashout", title: "Escape the hive", desc: `Bank ${run.unbanked} REBEL and leave` });
  return offers;
}

export function chooseReward(run0: Run, offer: RewardOffer): Run {
  const run = clone(run0);
  if (run.phase !== "reward") return run;
  if (offer.kind === "card") run.deck.push(offer.card);
  else if (offer.kind === "heal") run.player.hp = Math.min(run.player.maxHp, run.player.hp + HEAL_REWARD);
  else if (offer.kind === "relic") { run.relics.push(offer.relic); run.player = applyRelic(run.player, offer.relic); }
  else if (offer.kind === "cashout") { run.phase = "cashout"; run.banked = run.unbanked; return run; }
  run.floor++; run.maxFloorReached = Math.max(run.maxFloorReached, run.floor);
  const lineup = floorLineup(run.floor); run.enemies = lineup.map((k, i) => makeEnemy(run, run.floor, i, k, lineup.length));
  run.phase = "intro"; run.rewardOffers = [];
  return run;
}

export function totalPossibleRebel(): number { return BIOMES.reduce((s, b) => s + b.rebelReward, 0); }

export function rarityForRun(run: Run): "ultra" | "rare" | "common" | "none" {
  if (run.phase === "victory") return "ultra";
  if (run.maxFloorReached >= 7) return "rare";
  if (run.maxFloorReached >= 4) return "common";
  return "none";
}
