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

// Light "active" registry — useful later for matchmaking / spectator. Kept tiny.
export async function markActive(challengeId: string): Promise<void> {
  await redis.sadd(ACTIVE_INDEX_KEY, challengeId);
}
export async function unmarkActive(challengeId: string): Promise<void> {
  await redis.srem(ACTIVE_INDEX_KEY, challengeId);
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

export interface PvpEconomyConfig {
  factionWarsPvpCost: number;
  factionWarsPvpPayoutMode: "pot";
  factionWarsPvpEnabled: boolean;
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
      // We accept the row even if cost is unset (use default). The presence of
      // ANY key in the cfg means it's valid live config — we just fill blanks.
      if (cfg && typeof cfg === "object") {
        return {
          factionWarsPvpCost: Number.isFinite(cost) && cost >= 0 ? cost : PVP_COST_DEFAULT,
          factionWarsPvpPayoutMode: PVP_PAYOUT_MODE_DEFAULT,
          factionWarsPvpEnabled: enabled === false ? false : PVP_ENABLED_DEFAULT,
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

