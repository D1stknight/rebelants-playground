// lib/economy.ts
// ─────────────────────────────────────────────────────────────
// Bridge from the Playground to Rebel Economy Core.
//
// The Playground no longer keeps its own $REBEL balance. Balance lives
// in the central economy ledger (shared with After Dark + Discord).
// This module is the ONLY place that talks to the economy API.
//
// Identity: the Playground already stores the signed-in Discord user in
// the "ra_discord_user" cookie ({ discordUserId, discordName }). We turn
// that into the canonical economy userId via /api/internal/resolve, then
// move points with /api/internal/credit and /api/internal/debit.
//
// Daily-cap logic stays in the Playground (see balance/earn/spend) — the
// economy is just the ledger of record.
// ─────────────────────────────────────────────────────────────
import type { NextApiRequest } from "next";

const ECONOMY_BASE_URL =
  process.env.ECONOMY_BASE_URL || "https://economy.rebelants.io";
const SERVICE_API_KEY = process.env.SERVICE_API_KEY || "";

export type DiscordIdentity = {
  discordId: string;
  username: string;
  displayName?: string | null;
};

export type ResolvedUser = {
  userId: string;
  displayName: string | null;
  discordId: string | null;
  balance: number;
  justLinked: boolean;
  claimedImport: boolean;
};

// Read a cookie value from the incoming request.
function readCookie(req: NextApiRequest, name: string): string {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.split("=").slice(1).join("=")) : "";
}

// Pull the signed-in Discord identity from the existing Playground cookie.
// Returns null if the user is not signed in with Discord (guest play).
export function getDiscordIdentity(req: NextApiRequest): DiscordIdentity | null {
  const raw = readCookie(req, "ra_discord_user");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j || !j.discordUserId) return null;
    return {
      discordId: String(j.discordUserId),
      username: String(j.discordName || j.discordUserId),
      displayName: j.discordName ? String(j.discordName) : null,
    };
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer " + SERVICE_API_KEY,
  };
}

// Resolve (and link/create) the economy user for a Discord identity.
// Also returns the current economy balance.
export async function resolveEconomyUser(
  identity: DiscordIdentity,
): Promise<ResolvedUser | null> {
  try {
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/resolve", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        discordId: identity.discordId,
        username: identity.username,
        displayName: identity.displayName ?? null,
      }),
      cache: "no-store",
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) return null;
    return {
      userId: String(j.userId),
      displayName: j.displayName ?? null,
      discordId: j.discordId ?? null,
      balance: Number(j.balance || 0),
      justLinked: Boolean(j.justLinked),
      claimedImport: Boolean(j.claimedImport),
    };
  } catch {
    return null;
  }
}

// Convenience: resolve directly from the request (cookie -> economy user).
export async function resolveFromRequest(
  req: NextApiRequest,
): Promise<ResolvedUser | null> {
  const identity = getDiscordIdentity(req);
  if (!identity) return null;
  return resolveEconomyUser(identity);
}

export type EconomyMoveResult = {
  ok: boolean;
  balance: number;
  error?: string;
};

// Credit points to a user in the economy ledger.
export async function economyCredit(args: {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  type?: "game_reward" | "refund" | "earn";
  metadata?: Record<string, unknown>;
}): Promise<EconomyMoveResult> {
  try {
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/credit", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        userId: args.userId,
        amount: Math.max(0, Math.floor(args.amount)),
        type: args.type || "game_reward",
        source: "playground",
        reason: args.reason,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
      }),
      cache: "no-store",
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j) return { ok: false, balance: 0, error: j?.error || "credit_failed" };
    return { ok: true, balance: Number(j.balance ?? j.newBalance ?? 0) };
  } catch (e: any) {
    return { ok: false, balance: 0, error: String(e?.message || e) };
  }
}

// Debit (spend) points from a user in the economy ledger.
export async function economyDebit(args: {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  type?: "game_spend" | "spend";
  metadata?: Record<string, unknown>;
}): Promise<EconomyMoveResult> {
  try {
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/debit", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        userId: args.userId,
        amount: Math.max(0, Math.floor(args.amount)),
        type: args.type || "game_spend",
        source: "playground",
        reason: args.reason,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
      }),
      cache: "no-store",
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j) {
      return { ok: false, balance: 0, error: j?.error || "debit_failed" };
    }
    return { ok: true, balance: Number(j.balance ?? j.newBalance ?? 0) };
  } catch (e: any) {
    return { ok: false, balance: 0, error: String(e?.message || e) };
  }
}

// Build a stable-ish idempotency key for a points move.
export function idemKey(parts: Array<string | number>): string {
  return "pg:" + parts.join(":");
}
