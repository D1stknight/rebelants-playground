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
