// lib/server/prizesWon.ts
// NFT and merch prizes the server rolled (pages/api/prizes/roll.ts, pages/api/raid/launch.ts). A claim
// (pages/api/prizes/claim.ts, pages/api/claims/create.ts) takes its prize from here, once, for the account
// that won it, never from what the request says the prize is.
import { randomBytes } from "crypto";
import { redis } from "./redis";

export type WonPrize = { wonId: string; playerId: string; userId: string | null; game: string; rarity: string; prize: any; at: number };

const key = (id: string) => `ra:prize:won:${id}`;
const claimedKey = (id: string) => `ra:prize:won:${id}:claimed`;
const TTL = 30 * 24 * 60 * 60; // a won prize can be claimed for 30 days

export async function saveWonPrize(o: Omit<WonPrize, "wonId" | "at">): Promise<string> {
  const wonId = `w${Date.now().toString(36)}${randomBytes(9).toString("hex")}`;
  const { wonId: _ignored, ...prize } = o.prize || {};
  await redis.set(key(wonId), JSON.stringify({ ...o, prize, wonId, at: Date.now() }), { ex: TTL });
  return wonId;
}

export async function readWonPrize(id: unknown): Promise<WonPrize | null> {
  const s = String(id || "");
  if (!/^w[0-9a-z]{6,14}[0-9a-f]{18}$/.test(s)) return null;
  const raw = await redis.get(key(s));
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as WonPrize;
  } catch {
    return null;
  }
}

// Is this won prize the claiming account's? (prizes the RAAP solo campaign rolled name only the playerId)
export function wonBy(won: WonPrize, who: { playerId: string; userId: string }): boolean {
  return won.userId ? won.userId === who.userId : won.playerId === who.playerId;
}

// The first claim of a won prize marks it (true); a later one with another claim id gets false.
export async function markClaimed(wonId: string, claimId: string): Promise<boolean> {
  if (await redis.set(claimedKey(wonId), claimId, { nx: true, ex: TTL })) return true;
  return String((await redis.get(claimedKey(wonId))) ?? "") === claimId;
}

// A claim that could not be made after all (no NFT left in the inventory): the prize can be claimed again.
export async function unmarkClaimed(wonId: string): Promise<void> {
  await redis.del(claimedKey(wonId));
}
