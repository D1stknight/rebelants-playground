// PvP Faction Wars — Redis persistence helpers
//
// Storage strategy (Upstash Redis, follows existing ra:fw:* naming convention):
//
//   ra:fwpvp:match:{challengeId}       -> JSON blob of PvpMatch
//   ra:fwpvp:player:{playerId}         -> SET of challengeIds the player participates in
//   ra:fwpvp:active                    -> SET of challengeIds in active or pending state (cap-able)
//
// All match state is read/write atomic at the JSON-blob level (Upstash strings).
// We accept last-write-wins for now; in V2 we may add optimistic versioning if
// double-submit becomes a real problem.
//
// challengeId format: 12 chars [a-z0-9], URL-safe.

import { redis } from "./redis";
import type { PvpMatch, PvpBet, PvpBetsState, PvpSide, ChatMessage, ChatMute, ChatRole, Tournament, TournamentParticipant, TournamentRound, TournamentBracketSlot, TournamentStatus } from "../types/fwpvp";

const MATCH_KEY = (id: string) => `ra:fwpvp:match:${id}`;
const PLAYER_MATCHES_KEY = (pid: string) => `ra:fwpvp:player:${pid}`;
const ACTIVE_INDEX_KEY = "ra:fwpvp:active";

// 7 days TTL on a finished match record. Active matches keep getting refreshed
// on every action so they don't expire.
const MATCH_TTL_SECONDS = 60 * 60 * 24 * 7;

export function generateChallengeId(): string {
  // 12 chars from base36 alphabet
  return (
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-6)
  );
}

export async function getMatch(challengeId: string): Promise<PvpMatch | null> {
  if (!challengeId) return null;
  try {
    const raw = await redis.get<string | object>(MATCH_KEY(challengeId));
    if (!raw) return null;
    // Upstash auto-parses JSON when the stored value is JSON-stringifiable.
    // Defensive: handle both string and already-parsed object.
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const match = parsed as PvpMatch;
    // Defensive: backfill spell fields on matches created before the spell
    // mechanic shipped. Without this, older active matches throw on the
    // tick logic below.
    if ((match as any).challengerSpellUsed === undefined) (match as any).challengerSpellUsed = false;
    if ((match as any).opponentSpellUsed === undefined) (match as any).opponentSpellUsed = false;
    if ((match as any).spellChallengerActive === undefined) (match as any).spellChallengerActive = null;
    if ((match as any).spellOpponentActive === undefined) (match as any).spellOpponentActive = null;
    // Project spell DoT into HP for read-time display. Read-only — does NOT
    // persist back to Redis here. Mutations (submit-move, heal, cast) call
    // `applySpellTick` themselves before saving so the persisted state stays
    // consistent. This keeps idle reads cheap.
    try {
      const cfg = await getSpellConfig();
      applySpellTick(match, Date.now(), cfg);
    } catch {
      // Spell tick is best-effort projection; never block reads.
    }
    return match;
  } catch {
    return null;
  }
}

// ── Death Spell tick (Commit Spell) ──────────────────────────────────────────
// Mutates `match` in-place: applies wall-clock DoT damage from any active
// spell, capping per-spell total damage at cfg.factionWarsSpellDuration *
// cfg.factionWarsSpellDot, and clears expired spells. Persists across
// territory transitions: HP resets to MAX_HP at rollover but the spell
// timer keeps ticking against the fresh HP. Caller is responsible for
// saveMatch() if they want the change persisted (read paths skip the write).
export function applySpellTick(match: PvpMatch, now: number, cfg: SpellConfig): void {
  if (match.status !== "active") return;
  const dotPerSec = Math.max(0, Number(cfg.factionWarsSpellDot) || 0);
  if (dotPerSec <= 0) return;
  const maxTotal = dotPerSec * Math.max(1, Number(cfg.factionWarsSpellDuration) || 0);

  for (const slot of ["spellChallengerActive", "spellOpponentActive"] as const) {
    const sp = match[slot];
    if (!sp) continue;
    // Compute elapsed full seconds since last tick (integer floor).
    const elapsedSec = Math.max(0, Math.floor((now - sp.lastTickAt) / 1000));
    if (elapsedSec <= 0 && now < sp.expiresAt) continue; // not yet a full sec
    // Don't tick past expiresAt.
    const effectiveNow = Math.min(now, sp.expiresAt);
    const effSec = Math.max(0, Math.floor((effectiveNow - sp.lastTickAt) / 1000));
    let toApply = effSec * dotPerSec;
    // Cap total damage per spell instance.
    const remainingBudget = Math.max(0, maxTotal - sp.damageApplied);
    if (toApply > remainingBudget) toApply = remainingBudget;
    if (toApply > 0) {
      if (sp.targetSide === "challenger") {
        match.challengerHp = Math.max(0, match.challengerHp - toApply);
      } else {
        match.opponentHp = Math.max(0, match.opponentHp - toApply);
      }
      sp.damageApplied += toApply;
      sp.lastTickAt = sp.lastTickAt + effSec * 1000;
    }
    // Clear if fully expired and budget exhausted (or time is up).
    if (now >= sp.expiresAt || sp.damageApplied >= maxTotal) {
      match[slot] = null;
    }
  }
}

export async function saveMatch(match: PvpMatch): Promise<void> {
  const value = JSON.stringify(match);
  // Always refresh TTL on save so active matches don't expire mid-game.
  await redis.set(MATCH_KEY(match.challengeId), value, { ex: MATCH_TTL_SECONDS });
}

export async function addPlayerMatch(playerId: string, challengeId: string): Promise<void> {
  if (!playerId || !challengeId) return;
  await redis.sadd(PLAYER_MATCHES_KEY(playerId), challengeId);
  // Refresh the player-index TTL too
  await redis.expire(PLAYER_MATCHES_KEY(playerId), MATCH_TTL_SECONDS);
}

export async function listPlayerMatchIds(playerId: string): Promise<string[]> {
  if (!playerId) return [];
  try {
    const ids = await redis.smembers(PLAYER_MATCHES_KEY(playerId));
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

// Per-player hidden matches: lets a user clear their completed list view
// without affecting the OTHER side's history. Matches stay in Redis; we
// just filter them out for the player who hid them.
const PLAYER_HIDDEN_KEY = (pid: string) => `ra:fwpvp:hidden:${pid}`;

export async function addHiddenMatches(playerId: string, challengeIds: string[]): Promise<void> {
  if (!playerId || !Array.isArray(challengeIds) || challengeIds.length === 0) return;
  const capped = challengeIds.slice(0, 200);
  try {
    // Upstash sadd typing rejects spread; call per-id (small N).
    for (const id of capped) {
      await redis.sadd(PLAYER_HIDDEN_KEY(playerId), id);
    }
  } catch {}
}

export async function listHiddenMatchIds(playerId: string): Promise<Set<string>> {
  if (!playerId) return new Set();
  try {
    const ids = await redis.smembers(PLAYER_HIDDEN_KEY(playerId));
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}

// Light "active" registry — useful later for matchmaking / spectator. Kept tiny.
export async function markActive(challengeId: string): Promise<void> {
  await redis.sadd(ACTIVE_INDEX_KEY, challengeId);
}
export async function unmarkActive(challengeId: string): Promise<void> {
  await redis.srem(ACTIVE_INDEX_KEY, challengeId);
}

// ── Live Matches list (Layer 2C) ──────────────────────────────────────────────
// Returns up to `limit` active matches that are NOT private and NOT in a
// terminal state. Used by the public "⚔️ Live Matches" lobby section.
// Sorted by lastActionAt DESC (most recently active first) so freshly-played
// matches surface to the top.
export async function listActiveMatches(limit: number = 20): Promise<PvpMatch[]> {
  const ids = await redis.smembers(ACTIVE_INDEX_KEY);
  if (!ids || ids.length === 0) return [];
  // Cap fanout — even a busy lobby shouldn't fetch >100 matches.
  const slice = ids.slice(0, 100);
  const matches = await Promise.all(slice.map((id) => getMatch(String(id)).catch(() => null)));
  const live: PvpMatch[] = [];
  const stale: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const id = String(slice[i]);
    if (!m) {
      // Match was deleted/expired — clean up the index entry.
      stale.push(id);
      continue;
    }
    if (m.status === "completed" || m.status === "cancelled") {
      stale.push(id);
      continue;
    }
    if (m.isPrivate) continue;
    live.push(m);
  }
  // Best-effort cleanup of stale index entries.
  for (const id of stale) {
    redis.srem(ACTIVE_INDEX_KEY, id).catch(() => {});
  }
  live.sort((a, b) => (Number(b.lastActionAt ?? 0) - Number(a.lastActionAt ?? 0)));
  return live.slice(0, Math.max(1, Math.min(50, limit)));
}

// ── Spectator presence counter (Layer 2C) ─────────────────────────────────────
// Tracks unique spectators in the last ~30s using one short-lived Redis key
// per (challengeId, viewerKey). Counter = number of distinct keys still alive.
// Cheap, eventually consistent, no per-viewer bookkeeping needed.
const SPECTATOR_KEY = (cid: string, vid: string) => `ra:fwpvp:spec:${cid}:${vid}`;
const SPECTATOR_TTL_SECONDS = 30;

export async function pingSpectator(challengeId: string, viewerKey: string): Promise<void> {
  await redis.set(SPECTATOR_KEY(challengeId, viewerKey), 1, { ex: SPECTATOR_TTL_SECONDS });
}

export async function countSpectators(challengeId: string): Promise<number> {
  // Scan-based count of keys matching the prefix. Upstash supports SCAN; we
  // use a simple SCAN-MATCH loop with a small cursor budget so we don't burn
  // a ton of read ops on a hot match.
  let cursor: string | number = 0;
  let count = 0;
  let iters = 0;
  const pattern = `ra:fwpvp:spec:${challengeId}:*`;
  while (iters < 5) {
    iters++;
    const result: any = await redis.scan(cursor, { match: pattern, count: 100 });
    // Upstash returns [nextCursor, keys[]]
    const next = Array.isArray(result) ? result[0] : result?.cursor;
    const keys = Array.isArray(result) ? result[1] : result?.keys;
    if (Array.isArray(keys)) count += keys.length;
    cursor = next;
    if (cursor === 0 || cursor === "0") break;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// PvP Economy helpers (Commit C)
// ─────────────────────────────────────────────────────────────────────────────
//
// REBEL balance is shared with the rest of the playground (points/spend.ts,
// points/earn.ts both use the same key prefix). We mirror that key shape here
// so PvP transactions show up in player balance immediately.
//
// Balance key: ra:points:bal:${playerId}  — same as pages/api/points/spend.ts
//
// We deliberately do NOT touch points/spend.ts's "shuffle" or "tunnel" daily-cap
// logic — PvP is a wallet transfer between players, not earning. The pot
// circulates: 300 in from challenger + 300 from opponent = 600 out to winner
// (loser gets 0). Net flow is zero across the two players.

const REBEL_BAL_KEY = (pid: string) => `ra:points:bal:${pid}`;

// Default values used when admin config is absent or partially populated.
const PVP_COST_DEFAULT = 300;
const PVP_PAYOUT_MODE_DEFAULT: "pot" = "pot";
const PVP_ENABLED_DEFAULT = true;
const PVP_TIERS_DEFAULT: number[] = [100, 300, 500, 1000, 3000, 5000, 10000];
// Spectator side bets (Layer 2B). All admin-overridable from ra:config:economy.
const BET_MIN_DEFAULT = 50;
const BET_MAX_DEFAULT = 25000;
const BET_POOL_CAP_DEFAULT = 100000;
const BET_LOCK_TERRITORY_DEFAULT = 3;  // bets close when match enters T3 (0-indexed: territory >= 2)
const BET_ENABLED_DEFAULT = true;
// Per-match chat (Layer 2D)
const CHAT_ENABLED_DEFAULT = true;
const CHAT_POST_CLEANUP_MINS_DEFAULT = 30;  // chat TTL after match completion

export interface PvpEconomyConfig {
  factionWarsPvpCost: number;
  factionWarsPvpPayoutMode: "pot";
  factionWarsPvpEnabled: boolean;
  factionWarsPvpWagerTiers: number[];
  // Spectator side bets (Layer 2B)
  factionWarsBetEnabled: boolean;
  factionWarsBetMin: number;
  factionWarsBetMax: number;
  factionWarsBetPoolCap: number;
  factionWarsBetLockTerritory: number;  // 1-indexed for admin clarity (1..5). Stored as 0-indexed comparison.
  // Per-match chat (Layer 2D)
  factionWarsChatEnabled: boolean;
  factionWarsChatPostCleanupMins: number;  // minutes after match completion before chat TTLs out
  // Featured match (admin podcast tool) — empty/undefined = no featured match
  featuredMatchId?: string;
}

// Reads the live admin config from Redis and returns the PvP economy slice.
// Falls back to defaults for any missing keys. Mirrors the read pattern in
// pages/api/points/spend.ts so admin saves are picked up without redeploy.
export async function getPvpEconomyConfig(): Promise<PvpEconomyConfig> {
  const keysToTry = [
    "ra:config:economy",   // primary key Admin writes to
    "ra:points:config",
    "ra:config:points",
    "ra:pointsConfig",
    "ra:config",
  ];

  const normalize = (raw: any) => {
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return null; }
    }
    if (raw && typeof raw === "object") return raw;
    return null;
  };

  for (const k of keysToTry) {
    try {
      const raw = await redis.get<any>(k);
      const v = normalize(raw);
      if (!v) continue;

      // Some admin saves wrap the config under a "pointsConfig" key.
      const cfg = (v as any).pointsConfig && typeof (v as any).pointsConfig === "object"
        ? (v as any).pointsConfig
        : v;

      const cost = Number((cfg as any).factionWarsPvpCost);
      const enabled = (cfg as any).factionWarsPvpEnabled;
      const rawTiers = (cfg as any).factionWarsPvpWagerTiers;
      const tiers: number[] = Array.isArray(rawTiers)
        ? rawTiers
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n) && n >= 0)
        : [];
      // We accept the row even if cost is unset (use default). The presence of
      // ANY key in the cfg means it's valid live config — we just fill blanks.
      if (cfg && typeof cfg === "object") {
        const betEnabled = (cfg as any).factionWarsBetEnabled;
        const betMin = Number((cfg as any).factionWarsBetMin);
        const betMax = Number((cfg as any).factionWarsBetMax);
        const betCap = Number((cfg as any).factionWarsBetPoolCap);
        const betLock = Number((cfg as any).factionWarsBetLockTerritory);
        const featuredMatchIdRaw = (cfg as any).featuredMatchId;
        const featuredMatchId = typeof featuredMatchIdRaw === "string" && featuredMatchIdRaw.trim().length > 0
          ? featuredMatchIdRaw.trim().slice(0, 64)
          : undefined;
        const chatEnabled = (cfg as any).factionWarsChatEnabled;
        const chatCleanup = Number((cfg as any).factionWarsChatPostCleanupMins);
        return {
          factionWarsPvpCost: Number.isFinite(cost) && cost >= 0 ? cost : PVP_COST_DEFAULT,
          factionWarsPvpPayoutMode: PVP_PAYOUT_MODE_DEFAULT,
          factionWarsPvpEnabled: enabled === false ? false : PVP_ENABLED_DEFAULT,
          factionWarsPvpWagerTiers: tiers.length > 0 ? tiers : PVP_TIERS_DEFAULT,
          factionWarsBetEnabled: betEnabled === false ? false : BET_ENABLED_DEFAULT,
          factionWarsBetMin: Number.isFinite(betMin) && betMin >= 0 ? betMin : BET_MIN_DEFAULT,
          factionWarsBetMax: Number.isFinite(betMax) && betMax >= 0 ? betMax : BET_MAX_DEFAULT,
          factionWarsBetPoolCap: Number.isFinite(betCap) && betCap >= 0 ? betCap : BET_POOL_CAP_DEFAULT,
          factionWarsBetLockTerritory: Number.isFinite(betLock) && betLock >= 1 && betLock <= 5 ? Math.floor(betLock) : BET_LOCK_TERRITORY_DEFAULT,
          factionWarsChatEnabled: chatEnabled === false ? false : CHAT_ENABLED_DEFAULT,
          factionWarsChatPostCleanupMins: Number.isFinite(chatCleanup) && chatCleanup >= 0 ? Math.floor(chatCleanup) : CHAT_POST_CLEANUP_MINS_DEFAULT,
          featuredMatchId,
        };
      }
    } catch {
      // ignore and try next key
    }
  }

  return {
    factionWarsPvpCost: PVP_COST_DEFAULT,
    factionWarsPvpPayoutMode: PVP_PAYOUT_MODE_DEFAULT,
    factionWarsPvpEnabled: PVP_ENABLED_DEFAULT,
    factionWarsPvpWagerTiers: PVP_TIERS_DEFAULT,
    factionWarsBetEnabled: BET_ENABLED_DEFAULT,
    factionWarsBetMin: BET_MIN_DEFAULT,
    factionWarsBetMax: BET_MAX_DEFAULT,
    factionWarsBetPoolCap: BET_POOL_CAP_DEFAULT,
    factionWarsBetLockTerritory: BET_LOCK_TERRITORY_DEFAULT,
    factionWarsChatEnabled: CHAT_ENABLED_DEFAULT,
    factionWarsChatPostCleanupMins: CHAT_POST_CLEANUP_MINS_DEFAULT,
    featuredMatchId: undefined,
  };
}

// ── Heal config (Commit E) ───────────────────────────────────────────────────
// Heal mechanic mirrors AI mode exactly: same cost / amount / max from the
// SAME admin config keys. We reuse keys (not factionWarsPvpHeal*) so admins
// have one place to tune heal economy across both modes.
export interface HealConfig {
  factionWarsHealCost: number;   // REBEL spent per heal
  factionWarsHealAmt: number;    // HP restored per heal (capped at MAX_HP)
  factionWarsHealMax: number;    // Max heals per side per match
}

const HEAL_COST_DEFAULT = 25;
const HEAL_AMT_DEFAULT = 30;
const HEAL_MAX_DEFAULT = 2;

export async function getHealConfig(): Promise<HealConfig> {
  const keysToTry = [
    "ra:config:economy",
    "ra:points:config",
    "ra:config:points",
    "ra:pointsConfig",
    "ra:config",
  ];

  const normalize = (raw: any) => {
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return null; }
    }
    if (raw && typeof raw === "object") return raw;
    return null;
  };

  for (const k of keysToTry) {
    try {
      const raw = await redis.get<any>(k);
      const v = normalize(raw);
      if (!v) continue;
      const cfg = (v as any).pointsConfig && typeof (v as any).pointsConfig === "object"
        ? (v as any).pointsConfig
        : v;
      if (cfg && typeof cfg === "object") {
        const cost = Number((cfg as any).factionWarsHealCost);
        const amt = Number((cfg as any).factionWarsHealAmt);
        const max = Number((cfg as any).factionWarsHealMax);
        return {
          factionWarsHealCost: Number.isFinite(cost) && cost >= 0 ? cost : HEAL_COST_DEFAULT,
          factionWarsHealAmt: Number.isFinite(amt) && amt > 0 ? amt : HEAL_AMT_DEFAULT,
          factionWarsHealMax: Number.isFinite(max) && max >= 0 ? max : HEAL_MAX_DEFAULT,
        };
      }
    } catch {
      // try next key
    }
  }

  return {
    factionWarsHealCost: HEAL_COST_DEFAULT,
    factionWarsHealAmt: HEAL_AMT_DEFAULT,
    factionWarsHealMax: HEAL_MAX_DEFAULT,
  };
}

// ── Death Spell config (Commit Spell) ────────────────────────────────────────
// Centralized spell tunables. Same admin config blob as heal/economy. Reads
// the same Redis keys ra:config:economy etc. so admin save flow stays the
// same. Defaults keep the spec values: 1000 REBEL cost, 2 HP/sec for 15s.
export interface SpellConfig {
  factionWarsSpellEnabled: boolean;     // master kill switch
  factionWarsSpellCost: number;         // REBEL spent per cast
  factionWarsSpellDot: number;          // HP per second
  factionWarsSpellDuration: number;     // seconds the DoT runs
}

const SPELL_ENABLED_DEFAULT = true;
const SPELL_COST_DEFAULT = 1000;
const SPELL_DOT_DEFAULT = 2;
const SPELL_DURATION_DEFAULT = 15;

export async function getSpellConfig(): Promise<SpellConfig> {
  const keysToTry = [
    "ra:config:economy",
    "ra:points:config",
    "ra:config:points",
    "ra:pointsConfig",
    "ra:config",
  ];
  const normalize = (raw: any) => {
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return null; }
    }
    if (raw && typeof raw === "object") return raw;
    return null;
  };
  for (const k of keysToTry) {
    try {
      const raw = await redis.get<any>(k);
      const v = normalize(raw);
      if (!v) continue;
      const cfg = (v as any).pointsConfig && typeof (v as any).pointsConfig === "object"
        ? (v as any).pointsConfig
        : v;
      if (cfg && typeof cfg === "object") {
        const cost = Number((cfg as any).factionWarsSpellCost);
        const dot = Number((cfg as any).factionWarsSpellDot);
        const dur = Number((cfg as any).factionWarsSpellDuration);
        const enabledRaw = (cfg as any).factionWarsSpellEnabled;
        const enabled = enabledRaw === undefined ? SPELL_ENABLED_DEFAULT : Boolean(enabledRaw);
        return {
          factionWarsSpellEnabled: enabled,
          factionWarsSpellCost: Number.isFinite(cost) && cost >= 0 ? cost : SPELL_COST_DEFAULT,
          factionWarsSpellDot: Number.isFinite(dot) && dot > 0 ? dot : SPELL_DOT_DEFAULT,
          factionWarsSpellDuration: Number.isFinite(dur) && dur > 0 ? dur : SPELL_DURATION_DEFAULT,
        };
      }
    } catch {
      // try next key
    }
  }
  return {
    factionWarsSpellEnabled: SPELL_ENABLED_DEFAULT,
    factionWarsSpellCost: SPELL_COST_DEFAULT,
    factionWarsSpellDot: SPELL_DOT_DEFAULT,
    factionWarsSpellDuration: SPELL_DURATION_DEFAULT,
  };
}

// ── Crate rewards (Commit F) ─────────────────────────────────────────────────
// Reads cfg.rewards (same admin config AI mode uses) for the per-rarity REBEL
// payout. The winner of a PvP match gets cfg.rewards[rarity] REBEL on TOP of
// the pot when the match completes. Defaults match what AI mode uses.
export interface CrateRewards {
  common: number;
  rare: number;
  ultra: number;
}

const CRATE_COMMON_DEFAULT = 50;
const CRATE_RARE_DEFAULT = 100;
const CRATE_ULTRA_DEFAULT = 300;

export async function getCrateRewards(): Promise<CrateRewards> {
  const keysToTry = [
    "ra:config:economy",
    "ra:points:config",
    "ra:config:points",
    "ra:pointsConfig",
    "ra:config",
  ];

  const normalize = (raw: any) => {
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return null; }
    }
    if (raw && typeof raw === "object") return raw;
    return null;
  };

  for (const k of keysToTry) {
    try {
      const raw = await redis.get<any>(k);
      const v = normalize(raw);
      if (!v) continue;
      const cfg = (v as any).pointsConfig && typeof (v as any).pointsConfig === "object"
        ? (v as any).pointsConfig
        : v;
      const rewards = (cfg as any)?.rewards;
      if (rewards && typeof rewards === "object") {
        const common = Number((rewards as any).common);
        const rare = Number((rewards as any).rare);
        const ultra = Number((rewards as any).ultra);
        return {
          common: Number.isFinite(common) && common >= 0 ? common : CRATE_COMMON_DEFAULT,
          rare: Number.isFinite(rare) && rare >= 0 ? rare : CRATE_RARE_DEFAULT,
          ultra: Number.isFinite(ultra) && ultra >= 0 ? ultra : CRATE_ULTRA_DEFAULT,
        };
      }
    } catch {
      // try next key
    }
  }

  return {
    common: CRATE_COMMON_DEFAULT,
    rare: CRATE_RARE_DEFAULT,
    ultra: CRATE_ULTRA_DEFAULT,
  };
}

// Reads a player's current REBEL balance.
export async function getREBELBalance(playerId: string): Promise<number> {
  if (!playerId) return 0;
  try {
    const raw = await redis.get<number>(REBEL_BAL_KEY(playerId));
    return Number(raw || 0);
  } catch {
    return 0;
  }
}

// Atomically deduct REBEL from a player's balance. Returns the new balance
// on success, or null if the player has insufficient funds.
//
// Note: Upstash Redis doesn't support multi-step transactions cleanly, so we
// do a check-then-decrement. Two simultaneous spends from the same player
// could race past the check, but the 300-REBEL stakes here mean the worst case
// is a player going slightly negative. We guard create/accept against this by
// rejecting matches if balance is too low BEFORE the spend.
export async function spendREBEL(playerId: string, amount: number): Promise<number | null> {
  if (!playerId) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const bal = await getREBELBalance(playerId);
  if (bal < amount) return null;
  try {
    const newBal = await redis.incrby(REBEL_BAL_KEY(playerId), -amount);
    return Number(newBal || 0);
  } catch {
    return null;
  }
}

// Credit REBEL to a player's balance. Used for refunds (cancel) and pot
// payouts (winner on completion). Returns new balance on success.
export async function creditREBEL(playerId: string, amount: number): Promise<number | null> {
  if (!playerId) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  try {
    const newBal = await redis.incrby(REBEL_BAL_KEY(playerId), amount);
    return Number(newBal || 0);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PvP Leaderboards (Commit J)
// Mirrors the AI-mode pattern in pages/api/faction-wars/record.ts but writes
// to PvP-specific Redis sorted sets so PvP and AI are independent.
// ─────────────────────────────────────────────────────────────────────────
const LB_FW_PVP_WINS    = "ra:fw:lb:pvpWins";    // playerId -> total PvP match wins
const LB_FW_PVP_STREAKS = "ra:fw:lb:pvpStreaks"; // playerId -> max consecutive PvP wins
const LB_FW_PVP_RICH    = "ra:fw:lb:pvpRich";    // playerId -> total REBEL earned via PvP (pot + crate)
const FW_PVP_NAMES      = "ra:fw:pvp_player_names";
const FW_PVP_STREAK_KEY = (pid: string) => `ra:fw:pvp:streak:${pid}`;

/**
 * Record a completed PvP match for the leaderboards.
 * Called from submit-move.ts the moment match.status flips to "completed".
 * Idempotency: callers ensure this fires exactly once per match completion.
 *
 * @param winnerPlayerId  null on tie (no records updated for tie)
 * @param loserPlayerId   null on tie
 * @param winnerName      display name to attach to leaderboard rows
 * @param loserName       display name to attach to leaderboard rows
 * @param rebelEarned     pot + crate REBEL credited to winner (for "rich" board)
 */
export async function recordPvpResult(
  winnerPlayerId: string | null,
  loserPlayerId: string | null,
  winnerName: string,
  loserName: string,
  rebelEarned: number,
): Promise<void> {
  // Tie -> no leaderboard movement (rare; needs even territories)
  if (!winnerPlayerId || !loserPlayerId) return;
  try {
    // Names (best effort)
    const updates: Record<string, string> = {};
    if (winnerName) updates[winnerPlayerId] = winnerName;
    if (loserName) updates[loserPlayerId] = loserName;
    if (Object.keys(updates).length > 0) {
      await redis.hset(FW_PVP_NAMES, updates).catch(() => {});
    }

    // Wins counter
    await redis.zincrby(LB_FW_PVP_WINS, 1, winnerPlayerId);

    // Streak: increment winner streak, snapshot to max-streak board if higher.
    // Reset loser streak to 0.
    const winnerStreakKey = FW_PVP_STREAK_KEY(winnerPlayerId);
    const newStreak = await redis.incr(winnerStreakKey);
    await redis.expire(winnerStreakKey, 60 * 60 * 24 * 30); // 30d sliding TTL
    const currentMax = await redis.zscore(LB_FW_PVP_STREAKS, winnerPlayerId).catch(() => 0);
    if (Number(newStreak) > Number(currentMax || 0)) {
      await redis.zadd(LB_FW_PVP_STREAKS, { score: Number(newStreak), member: winnerPlayerId });
    }
    await redis.set(FW_PVP_STREAK_KEY(loserPlayerId), 0);

    // REBEL earned via PvP (pot + crate)
    if (Number.isFinite(rebelEarned) && rebelEarned > 0) {
      await redis.zincrby(LB_FW_PVP_RICH, rebelEarned, winnerPlayerId);
    }
  } catch {
    // Leaderboard writes are best-effort; do not crash match completion.
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Spectator side bets (Layer 2B)
// ─────────────────────────────────────────────────────────────────────────────
//
// Pari-mutuel: bettors deposit REBEL into a side pool. On match resolve,
// loser-side total splits proportionally among winner-side bettors.
// House takes 0%. Loser bettors get nothing back; if no winner-side bettors
// exist, loser pool is refunded to the losers (no house grab).
//
// Storage:
//   ra:fwpvp:bets:{challengeId}            -> Redis HASH, field={playerId}, value=JSON(PvpBet)
//   ra:fwpvp:bets:locked:{challengeId}     -> string "1" with TTL > match
//   ra:fwpvp:bets:settled:{challengeId}    -> string "1" idempotency guard for payout/refund
//
// Bet amounts are debited from balance immediately at place-time. We store
// bet records (not balance lock) so refunds/payouts are cheap to compute.


const BETS_KEY = (cid: string) => `ra:fwpvp:bets:${cid}`;
const BETS_LOCKED_KEY = (cid: string) => `ra:fwpvp:bets:locked:${cid}`;
const BETS_SETTLED_KEY = (cid: string) => `ra:fwpvp:bets:settled:${cid}`;

function parseBet(raw: any): PvpBet | null {
  try {
    const b = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!b || typeof b !== "object") return null;
    if (typeof b.playerId !== "string") return null;
    if (b.side !== "challenger" && b.side !== "opponent") return null;
    if (typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount < 0) return null;
    return {
      playerId: String(b.playerId),
      displayName: String(b.displayName || ""),
      side: b.side as PvpSide,
      amount: Math.floor(b.amount),
      firstAt: Number(b.firstAt) || 0,
      lastAt: Number(b.lastAt) || 0,
    };
  } catch {
    return null;
  }
}

export async function isBetsLocked(challengeId: string): Promise<boolean> {
  try {
    const v = await redis.get(BETS_LOCKED_KEY(challengeId));
    return v === "1" || v === 1 || v === true;
  } catch {
    return false;
  }
}

export async function lockBets(challengeId: string): Promise<void> {
  // 24h TTL — long enough to outlive any active match.
  await redis.set(BETS_LOCKED_KEY(challengeId), "1", { ex: 60 * 60 * 24 });
}

export async function getBets(challengeId: string): Promise<PvpBetsState> {
  const [raw, locked] = await Promise.all([
    redis.hgetall<Record<string, any>>(BETS_KEY(challengeId)).catch(() => null),
    isBetsLocked(challengeId),
  ]);
  const bets: PvpBet[] = [];
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(raw)) {
      const b = parseBet((raw as any)[k]);
      if (b) bets.push(b);
    }
  }
  bets.sort((a, b) => Number(b.lastAt ?? 0) - Number(a.lastAt ?? 0));
  let challengerPool = 0, opponentPool = 0;
  let challengerBettorCount = 0, opponentBettorCount = 0;
  for (const b of bets) {
    if (b.side === "challenger") {
      challengerPool += b.amount;
      challengerBettorCount += 1;
    } else {
      opponentPool += b.amount;
      opponentBettorCount += 1;
    }
  }
  return {
    challengerPool,
    opponentPool,
    bets,
    locked,
    challengerBettorCount,
    opponentBettorCount,
  };
}

export async function getMyBet(challengeId: string, playerId: string): Promise<PvpBet | null> {
  try {
    const raw = await redis.hget<any>(BETS_KEY(challengeId), playerId);
    return parseBet(raw);
  } catch {
    return null;
  }
}

// Place or top-up a bet. Caller is responsible for:
//   - validating the match exists, is in a bettable status, and player isn't a participant
//   - validating amount against admin min/max/cap and player balance
//   - debiting REBEL from balance (we do that here so the write is atomic-ish)
//
// Returns the updated bet record on success, or { error: string } on failure.
export async function placeBet(params: {
  challengeId: string;
  playerId: string;
  displayName: string;
  side: PvpSide;
  amount: number;
}): Promise<{ ok: true; bet: PvpBet; newBalance: number } | { ok: false; error: string }> {
  const { challengeId, playerId, displayName, side, amount } = params;
  const now = Date.now();

  // Read existing bet (if any) to check side consistency
  const existing = await getMyBet(challengeId, playerId);
  if (existing && existing.side !== side) {
    return { ok: false, error: `You already bet on ${existing.side}. Top-ups must stay on the same side.` };
  }

  // Debit REBEL FIRST. If this fails (insufficient balance), bail.
  const newBalance = await spendREBEL(playerId, amount);
  if (newBalance === null) {
    return { ok: false, error: "Insufficient REBEL balance" };
  }

  const merged: PvpBet = {
    playerId,
    displayName: displayName.slice(0, 32),
    side,
    amount: (existing?.amount ?? 0) + amount,
    firstAt: existing?.firstAt ?? now,
    lastAt: now,
  };

  try {
    await redis.hset(BETS_KEY(challengeId), { [playerId]: JSON.stringify(merged) });
  } catch (e: any) {
    // Storage failed — best-effort refund the debit.
    await creditREBEL(playerId, amount).catch(() => {});
    return { ok: false, error: "Failed to store bet — refunded" };
  }

  return { ok: true, bet: merged, newBalance };
}

// Refund every bet at full face value. Used on cancel/decline/no-winner.
// Idempotent: sets a "settled" flag so we don't double-refund if called twice.
export async function refundBets(challengeId: string): Promise<{ refunded: number; bettorCount: number }> {
  const settled = await redis.get(BETS_SETTLED_KEY(challengeId)).catch(() => null);
  if (settled === "1" || settled === 1 || settled === true) {
    return { refunded: 0, bettorCount: 0 };
  }

  const state = await getBets(challengeId);
  let total = 0;
  let count = 0;
  for (const b of state.bets) {
    if (b.amount <= 0) continue;
    const r = await creditREBEL(b.playerId, b.amount).catch(() => null);
    if (r !== null) {
      total += b.amount;
      count += 1;
    }
  }
  await redis.set(BETS_SETTLED_KEY(challengeId), "1", { ex: 60 * 60 * 24 * 7 }).catch(() => {});
  return { refunded: total, bettorCount: count };
}

// Pari-mutuel payout. Winning side gets their stake back PLUS their pro-rata
// share of the loser pool. Loser side gets nothing.
// Edge case: if no bettors on the winning side, refund loser pool fully
// (no house grab — matches the no-fee design).
// Idempotent via the "settled" flag.
export async function payoutBets(challengeId: string, winnerSide: PvpSide): Promise<{
  winnerPaid: number;
  loserForfeited: number;
  refundedNoWinner: boolean;
}> {
  const settled = await redis.get(BETS_SETTLED_KEY(challengeId)).catch(() => null);
  if (settled === "1" || settled === 1 || settled === true) {
    return { winnerPaid: 0, loserForfeited: 0, refundedNoWinner: false };
  }

  const state = await getBets(challengeId);
  const winners = state.bets.filter((b) => b.side === winnerSide && b.amount > 0);
  const losers = state.bets.filter((b) => b.side !== winnerSide && b.amount > 0);
  const loserPool = losers.reduce((acc, b) => acc + b.amount, 0);
  const winnerPool = winners.reduce((acc, b) => acc + b.amount, 0);

  // No winners — refund losers (refund-on-no-winner per design Q3).
  if (winners.length === 0) {
    let refunded = 0;
    for (const b of losers) {
      const r = await creditREBEL(b.playerId, b.amount).catch(() => null);
      if (r !== null) refunded += b.amount;
    }
    await redis.set(BETS_SETTLED_KEY(challengeId), "1", { ex: 60 * 60 * 24 * 7 }).catch(() => {});
    return { winnerPaid: 0, loserForfeited: 0, refundedNoWinner: true };
  }

  // Pari-mutuel split. Use floor for each share so we never overpay; small
  // fractional remainder (< winners.length REBEL) is left in the system —
  // negligible at REBEL granularity.
  let winnerPaid = 0;
  for (const w of winners) {
    if (winnerPool <= 0) break;
    const shareOfLoserPool = Math.floor((w.amount / winnerPool) * loserPool);
    const total = w.amount + shareOfLoserPool;
    const r = await creditREBEL(w.playerId, total).catch(() => null);
    if (r !== null) winnerPaid += total;
  }
  await redis.set(BETS_SETTLED_KEY(challengeId), "1", { ex: 60 * 60 * 24 * 7 }).catch(() => {});
  return { winnerPaid, loserForfeited: loserPool, refundedNoWinner: false };
}


// ─────────────────────────────────────────────────────────────────────────────
// Per-match chat (Layer 2D)
// ─────────────────────────────────────────────────────────────────────────────
//
// All chat operations key off challengeId. Posts append to a Redis LIST that's
// trimmed to the latest 200 messages. Mutes are a separate hash with expireAt
// timestamps. Rate limit is a 2-second TTL string per (challenge, player).
//
// Admin endpoints (delete, mute, clear) authenticate via the SAME ADMIN_KEY
// env var that pages/api/admin/config.ts uses, accepting either the
// "x-admin-key" or "x-admin-token" header.

const CHAT_KEY = (cid: string) => `ra:fwpvp:chat:${cid}`;
const CHAT_MUTES_KEY = (cid: string) => `ra:fwpvp:chat:mutes:${cid}`;
const CHAT_RL_KEY = (cid: string, pid: string) => `ra:fwpvp:chat:rl:${cid}:${pid}`;

const CHAT_MAX_LEN = 280;
const CHAT_LIST_CAP = 200;
const CHAT_RL_SECONDS = 2;
const CHAT_TTL_LIVE_SECONDS = 60 * 60 * 24;  // 24h baseline; tightened on completion

function generateMessageId(): string {
  // 12 hex chars; ample to avoid collisions within a 200-message window.
  let out = "";
  for (let i = 0; i < 12; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function parseChatMessage(raw: any): ChatMessage | null {
  try {
    const m = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!m || typeof m !== "object") return null;
    if (typeof m.id !== "string") return null;
    if (typeof m.playerId !== "string") return null;
    if (typeof m.text !== "string") return null;
    if (m.role !== "challenger" && m.role !== "opponent" && m.role !== "spectator") return null;
    return {
      id: String(m.id),
      playerId: String(m.playerId),
      displayName: String(m.displayName || ""),
      role: m.role as ChatRole,
      text: String(m.text),
      at: Number(m.at) || 0,
    };
  } catch {
    return null;
  }
}

// Determine whether the given playerId should render as the challenger,
// opponent, or a generic spectator in chat.
export function chatRoleForPlayer(match: PvpMatch | null, playerId: string): ChatRole {
  if (!match) return "spectator";
  if (match.challengerPlayerId === playerId) return "challenger";
  if (match.opponentPlayerId === playerId) return "opponent";
  return "spectator";
}

// ── Mutes ────────────────────────────────────────────────────────────────────
// Mute records auto-expire client-side via expireAt; we lazily clean on read.

export async function getMute(challengeId: string, playerId: string): Promise<ChatMute | null> {
  try {
    const raw: any = await redis.hget(CHAT_MUTES_KEY(challengeId), playerId);
    if (!raw) return null;
    const m = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!m || typeof m !== "object") return null;
    const expireAt = Number(m.expireAt) || 0;
    if (expireAt && expireAt < Date.now()) {
      // Expired — clean up best-effort.
      redis.hdel(CHAT_MUTES_KEY(challengeId), playerId).catch(() => {});
      return null;
    }
    return {
      playerId: String(m.playerId || playerId),
      expireAt,
      displayName: m.displayName ? String(m.displayName) : undefined,
    };
  } catch {
    return null;
  }
}

export async function setMute(challengeId: string, playerId: string, durationMs: number, displayName?: string): Promise<ChatMute> {
  const expireAt = Date.now() + Math.max(0, durationMs);
  const record: ChatMute = { playerId, expireAt, displayName };
  await redis.hset(CHAT_MUTES_KEY(challengeId), { [playerId]: JSON.stringify(record) });
  // Mute hash inherits a generous TTL so it doesn't outlive the match by much.
  await redis.expire(CHAT_MUTES_KEY(challengeId), CHAT_TTL_LIVE_SECONDS).catch(() => {});
  return record;
}

export async function clearMute(challengeId: string, playerId: string): Promise<void> {
  await redis.hdel(CHAT_MUTES_KEY(challengeId), playerId).catch(() => {});
}

export async function listMutes(challengeId: string): Promise<ChatMute[]> {
  try {
    const raw: any = await redis.hgetall(CHAT_MUTES_KEY(challengeId));
    if (!raw || typeof raw !== "object") return [];
    const now = Date.now();
    const live: ChatMute[] = [];
    const stale: string[] = [];
    for (const k of Object.keys(raw)) {
      try {
        const v = (raw as any)[k];
        const m = typeof v === "string" ? JSON.parse(v) : v;
        const expireAt = Number(m?.expireAt) || 0;
        if (!expireAt || expireAt < now) {
          stale.push(k);
          continue;
        }
        live.push({
          playerId: String(m?.playerId || k),
          expireAt,
          displayName: m?.displayName ? String(m.displayName) : undefined,
        });
      } catch {
        stale.push(k);
      }
    }
    // Best-effort cleanup of expired entries.
    for (const id of stale) {
      redis.hdel(CHAT_MUTES_KEY(challengeId), id).catch(() => {});
    }
    return live;
  } catch {
    return [];
  }
}

// ── Posting ──────────────────────────────────────────────────────────────────
// Returns the created ChatMessage on success, or { error: string } on failure.
// Caller must have already validated identity. We DO check rate-limit + mute
// here so the API handler stays thin.

export async function postChatMessage(params: {
  challengeId: string;
  playerId: string;
  displayName: string;
  text: string;
  role: ChatRole;
}): Promise<{ ok: true; message: ChatMessage } | { ok: false; error: string; mute?: ChatMute }> {
  const { challengeId, playerId, displayName, role } = params;
  const trimmed = (params.text || "").trim().slice(0, CHAT_MAX_LEN);
  if (!trimmed) return { ok: false, error: "Message cannot be empty" };

  // Mute check (auto-expires via getMute).
  const mute = await getMute(challengeId, playerId);
  if (mute) {
    return { ok: false, error: "You are muted in this match", mute };
  }

  // Rate limit — atomic SET NX EX so concurrent requests can't race.
  // Returns "OK" on success (key didn't exist) or null if the key was already
  // present (player posted within CHAT_RL_SECONDS). Cast to any because the
  // Upstash types vary by version; the runtime semantics are stable.
  try {
    const setRes: any = await redis.set(CHAT_RL_KEY(challengeId, playerId), "1", { nx: true, ex: CHAT_RL_SECONDS });
    if (setRes === null) {
      return { ok: false, error: "Slow down — wait a couple seconds between messages" };
    }
  } catch {
    // If rate-limit infra fails, allow the message rather than block all posting.
  }

  const message: ChatMessage = {
    id: generateMessageId(),
    playerId,
    displayName: (displayName || "").slice(0, 32),
    role,
    text: trimmed,
    at: Date.now(),
  };

  try {
    await redis.rpush(CHAT_KEY(challengeId), JSON.stringify(message));
    // Trim to the most recent CHAT_LIST_CAP messages (keeps memory bounded
    // even if a chat goes wild).
    await redis.ltrim(CHAT_KEY(challengeId), -CHAT_LIST_CAP, -1).catch(() => {});
    // Refresh TTL so active chats don't expire mid-match.
    await redis.expire(CHAT_KEY(challengeId), CHAT_TTL_LIVE_SECONDS).catch(() => {});
  } catch (e: any) {
    return { ok: false, error: "Failed to post message" };
  }

  return { ok: true, message };
}

// ── Reading ──────────────────────────────────────────────────────────────────

export async function getChatMessages(challengeId: string, limit: number = CHAT_LIST_CAP): Promise<ChatMessage[]> {
  try {
    const cap = Math.max(1, Math.min(CHAT_LIST_CAP, limit));
    const raw: any = await redis.lrange(CHAT_KEY(challengeId), -cap, -1);
    if (!raw || !Array.isArray(raw)) return [];
    const out: ChatMessage[] = [];
    for (const item of raw) {
      const m = parseChatMessage(item);
      if (m) out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

// ── Admin ops ────────────────────────────────────────────────────────────────
// Delete a single message by id. Because messages are stored in a list, we
// LREM by re-fetching, finding the JSON containing the id, and removing that
// exact value. Cheap because list is capped at 200.

export async function adminDeleteChatMessage(challengeId: string, messageId: string): Promise<boolean> {
  try {
    const all: any = await redis.lrange(CHAT_KEY(challengeId), 0, -1);
    if (!all || !Array.isArray(all)) return false;
    let target: string | null = null;
    for (const item of all) {
      try {
        const obj = typeof item === "string" ? JSON.parse(item) : item;
        if (obj?.id === messageId) {
          target = typeof item === "string" ? item : JSON.stringify(item);
          break;
        }
      } catch {}
    }
    if (!target) return false;
    const removed: any = await redis.lrem(CHAT_KEY(challengeId), 1, target);
    return Number(removed) > 0;
  } catch {
    return false;
  }
}

export async function adminClearAllChat(challengeId: string): Promise<number> {
  let len = 0;
  try {
    const result: any = await redis.llen(CHAT_KEY(challengeId));
    len = Number(result) || 0;
  } catch {
    // ignore — proceed to del anyway
  }
  try {
    await redis.del(CHAT_KEY(challengeId));
  } catch {}
  return len;
}

// Tighten chat TTL to N minutes after match completion.
// Called from submit-move when match transitions to "completed", and from
// cancel/decline. Best-effort — if the key is gone, no-op.
export async function tightenChatTTL(challengeId: string, minutes: number): Promise<void> {
  const seconds = Math.max(60, Math.floor(minutes * 60));
  await redis.expire(CHAT_KEY(challengeId), seconds).catch(() => {});
  await redis.expire(CHAT_MUTES_KEY(challengeId), seconds).catch(() => {});
}

// Server-side admin auth check. Same env var used by /api/admin/config.ts.
// Accepts both header names that admin.tsx sends.
export function checkAdminAuth(req: { headers: Record<string, any> }): boolean {
  const headerVal = (v: any): string => Array.isArray(v) ? String(v[0] || "") : String(v || "");
  const provided = headerVal(req.headers["x-admin-key"]) || headerVal(req.headers["x-admin-token"]) || "";
  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  if (!expected) return false;
  return !!provided && provided === expected;
}


// ─────────────────────────────────────────────────────────────────────────
// Tournaments (single-elimination brackets)
// ─────────────────────────────────────────────────────────────────────────

const TOURNEY_KEY = (id: string) => `ra:fwpvp:tournament:${id}`;
const TOURNEY_ACTIVE_INDEX = "ra:fwpvp:tournaments:active";
const TOURNEY_MATCHES_KEY = (id: string) => `ra:fwpvp:tournament:${id}:matches`;
const TOURNEY_TTL_DAYS = 30;

// 12-char [a-z0-9] id, same alphabet as challengeId.
export function generateTournamentId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 12; i++) {
    id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return id;
}

export async function getTournament(id: string): Promise<Tournament | null> {
  if (!id) return null;
  try {
    const raw: any = await redis.get(TOURNEY_KEY(id));
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw) as Tournament;
    return raw as Tournament;
  } catch {
    return null;
  }
}

export async function saveTournament(t: Tournament): Promise<void> {
  await redis.set(TOURNEY_KEY(t.id), JSON.stringify(t));
  if (t.status === "completed" || t.status === "cancelled") {
    await redis.expire(TOURNEY_KEY(t.id), TOURNEY_TTL_DAYS * 24 * 60 * 60).catch(() => {});
    await (redis as any).srem(TOURNEY_ACTIVE_INDEX, t.id).catch(() => {});
  } else {
    await (redis as any).sadd(TOURNEY_ACTIVE_INDEX, t.id).catch(() => {});
  }
}

export async function listActiveTournaments(): Promise<Tournament[]> {
  try {
    const ids: any = await (redis as any).smembers(TOURNEY_ACTIVE_INDEX);
    const out: Tournament[] = [];
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const t = await getTournament(String(id));
        if (t) out.push(t);
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  } catch {
    return [];
  }
}

export async function listAllTournaments(limit: number = 50): Promise<Tournament[]> {
  // For history we'd ideally have an "all" index. For V1 we just return active.
  // Completed tournaments live for TOURNEY_TTL_DAYS days at their key but are
  // no longer in the active set; admin can fetch them directly by id.
  return listActiveTournaments();
}

export async function tournamentAddMatch(tournamentId: string, challengeId: string): Promise<void> {
  await (redis as any).sadd(TOURNEY_MATCHES_KEY(tournamentId), challengeId).catch(() => {});
}

// Validate + sanitize tournament configuration. Returns null + error string if invalid.
export function validateTournamentConfig(opts: {
  size: number;
  entryFee: number;
  potPerRound: number[];
  maxSize: number;
}): { ok: true } | { ok: false; error: string } {
  const allowedSizes = [4, 8, 16, 32];
  if (!allowedSizes.includes(opts.size)) {
    return { ok: false, error: "size must be 4, 8, 16, or 32" };
  }
  if (opts.size > opts.maxSize) {
    return { ok: false, error: `size exceeds admin max (${opts.maxSize})` };
  }
  if (!Number.isFinite(opts.entryFee) || opts.entryFee < 0) {
    return { ok: false, error: "entryFee must be >= 0" };
  }
  const expectedRounds = Math.log2(opts.size);
  if (!Array.isArray(opts.potPerRound) || opts.potPerRound.length !== expectedRounds) {
    return { ok: false, error: `potPerRound must have ${expectedRounds} entries for size ${opts.size}` };
  }
  for (const p of opts.potPerRound) {
    if (!Number.isFinite(p) || p < 0) {
      return { ok: false, error: "all potPerRound entries must be >= 0" };
    }
  }
  return { ok: true };
}

// Fisher-Yates shuffle, returns a new array.
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build the empty bracket tree for a given size, then fill round 0 from
// shuffled participant ids. Subsequent rounds start with all-null slots and
// get populated as matches complete.
export function buildBracket(size: number, participantIds: string[], potPerRound: number[]): TournamentRound[] {
  const numRounds = Math.log2(size);
  const rounds: TournamentRound[] = [];
  for (let r = 0; r < numRounds; r++) {
    const matches: TournamentBracketSlot[] = [];
    const numMatches = size / Math.pow(2, r + 1);
    for (let m = 0; m < numMatches; m++) {
      matches.push({
        slotIndex: m,
        p1: null,
        p2: null,
        challengeId: null,
        winner: null,
      });
    }
    rounds.push({
      roundIndex: r,
      matches,
      potThisRound: potPerRound[r] || 0,
    });
  }

  // Fill round 0 with shuffled participants. If fewer than `size` joined, the
  // remaining slots stay null and those matches resolve as auto-advance byes.
  const seeded = shuffle(participantIds);
  for (let i = 0; i < seeded.length; i++) {
    const matchIdx = Math.floor(i / 2);
    const slot = rounds[0].matches[matchIdx];
    if (i % 2 === 0) slot.p1 = seeded[i];
    else slot.p2 = seeded[i];
  }

  return rounds;
}

// Find the bracket slot that produced this challengeId.
// Returns { roundIndex, slotIndex } or null if not found.
export function findBracketSlot(t: Tournament, challengeId: string): { roundIndex: number; slotIndex: number } | null {
  for (let r = 0; r < t.rounds.length; r++) {
    const round = t.rounds[r];
    for (let s = 0; s < round.matches.length; s++) {
      if (round.matches[s].challengeId === challengeId) {
        return { roundIndex: r, slotIndex: s };
      }
    }
  }
  return null;
}
