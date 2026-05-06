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
import type { PvpMatch } from "../types/fwpvp";

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
    return parsed as PvpMatch;
  } catch {
    return null;
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

export interface PvpEconomyConfig {
  factionWarsPvpCost: number;
  factionWarsPvpPayoutMode: "pot";
  factionWarsPvpEnabled: boolean;
  factionWarsPvpWagerTiers: number[];
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
        return {
          factionWarsPvpCost: Number.isFinite(cost) && cost >= 0 ? cost : PVP_COST_DEFAULT,
          factionWarsPvpPayoutMode: PVP_PAYOUT_MODE_DEFAULT,
          factionWarsPvpEnabled: enabled === false ? false : PVP_ENABLED_DEFAULT,
          factionWarsPvpWagerTiers: tiers.length > 0 ? tiers : PVP_TIERS_DEFAULT,
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
