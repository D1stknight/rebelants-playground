// lib/economy.ts
// ─────────────────────────────────────────────────────────────
// Bridge from the Playground to Rebel Economy Core.
//
// The Playground no longer keeps its own $REBEL balance. Balance lives
// in the central economy ledger (shared with After Dark + Discord).
// This module is the ONLY place that talks to the economy API.
//
// Identity: the Discord sign-in leaves a signed session (lib/player-session.ts;
// the older "ra_discord_user" cookie is not signed and proves nothing). We turn
// that into the canonical economy userId via /api/internal/resolve, then
// move points with /api/internal/credit and /api/internal/debit.
//
// Daily-cap logic stays in the Playground (see balance/earn/spend) — the
// economy is just the ledger of record.
// ─────────────────────────────────────────────────────────────
import type { NextApiRequest } from "next";
import { verifyNameSession, NAME_SESSION_COOKIE } from "./name-session";
import { DISCORD_SESSION_COOKIE, verifyDiscordSession } from "./player-session";

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
export function readCookie(req: NextApiRequest, name: string): string {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.split("=").slice(1).join("=")) : "";
}

// Pull the signed-in Discord identity from the signed Discord session.
// Returns null if the user is not signed in with Discord (guest play).
export function getDiscordIdentity(req: NextApiRequest): DiscordIdentity | null {
  const s = verifyDiscordSession(readCookie(req, DISCORD_SESSION_COOKIE));
  if (!s) return null;
  return {
    discordId: s.discordUserId,
    username: s.discordName || s.discordUserId,
    displayName: s.discordName || null,
  };
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

// Resolve the shared sign-on session token from the request.
// Both Discord login and Commander Name + PIN set this same cookie (issued
// by the economy's poker-auth). The economy verifies it server-side.
// Resolve an economy user from a Playground playerId string.
//
// Playground playerId formats:
//   discord:<id>   -> economy keys by the raw Discord id (strip the prefix)
//   name:<slug>    -> economy stores name-auth identities with the prefix intact
//   wallet:0x...   -> economy resolves/creates by this namespaced key
//   guest-xxxxx    -> no persistent economy identity (returns null)
//   anything else  -> null (a bare Discord id or a made-up prefix used to reach
//                     whatever account the economy had under it)
//
// Used by server-side flows (e.g. PvP payouts) that only have a stored
// playerId and no request/cookie to read. A playerId from the browser goes
// through lib/server/player-auth.ts first, which only lets signed ones by.
export async function resolveByPlayerId(
  playerId: string,
): Promise<ResolvedUser | null> {
  if (!playerId) return null;

  let discordId: string;
  let username: string;
  if (playerId.startsWith("discord:")) {
    discordId = playerId.slice("discord:".length);
    if (!/^[0-9]{5,32}$/.test(discordId)) return null;
    username = discordId;
  } else if (/^(name|wallet):./.test(playerId)) {
    // name:<slug>, wallet:0x... -> pass through
    discordId = playerId;
    username = playerId;
  } else {
    return null;
  }
  return resolveEconomyUser({ discordId, username, displayName: null });
}

// Resolve a verified Commander Name/PIN identity from its signed cookie.
// Returns the economy user only if the ra_name_session HMAC is valid.
// Keyed by NAME_SESSION_SECRET, else a key derived from the Discord app secret (lib/name-session.ts).
export async function getVerifiedNameUser(
  req: NextApiRequest,
): Promise<ResolvedUser | null> {
  const tok = readCookie(req, NAME_SESSION_COOKIE);
  if (!tok) return null;
  const playerId = verifyNameSession(tok);
  if (!playerId) return null;
  return resolveByPlayerId(playerId);
}

export function getSessionToken(req: NextApiRequest): string | null {
  const tok = readCookie(req, "poker_session");
  return tok || null;
}

// Resolve directly from the request -> economy user.
// Prefers the shared session token (Discord OR Commander Name/PIN); falls
// back to the signed Discord session.
export async function resolveFromRequest(
  req: NextApiRequest,
): Promise<ResolvedUser | null> {
  const sessionToken = getSessionToken(req);
  if (sessionToken) {
    const viaSession = await resolveBySessionToken(sessionToken);
    if (viaSession) return viaSession;
  }
  const identity = getDiscordIdentity(req);
  if (!identity) return null;
  return resolveEconomyUser(identity);
}

// Resolve via a verified session token (economy verifies it).
export async function resolveBySessionToken(
  sessionToken: string,
): Promise<ResolvedUser | null> {
  try {
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/resolve", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ sessionToken }),
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
  type?: "game_reward" | "refund" | "earn" | "claim_code";
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

// ---- The Rebel Economy's points shop (Oct 20): packs by card, APE or ETH, one shop for every app ----

export const ECONOMY_SHOP_URL = ECONOMY_BASE_URL + "/shop";

export type EconomyPurchase = { id: string; amount: number; source: string; at: string };

// Points this account bought in the shop after the cursor `after` ("<time>|<id>", from an earlier answer's
// next), oldest first, 50 at a time. null when the economy did not answer.
export async function economyPurchases(
  userId: string,
  after: string | null,
): Promise<{ purchases: EconomyPurchase[]; next: string | null; more: boolean } | null> {
  try {
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/purchases", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId, after }),
      cache: "no-store",
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok || !Array.isArray(j.purchases)) return null;
    return { purchases: j.purchases, next: j.next ?? null, more: Boolean(j.more) };
  } catch {
    return null;
  }
}

// Commander names and the Rebel Economy's colony names (the casino, the village) are one set of
// accounts: "name:<slug>" is the same economy user everywhere. The economy's slugs are letters,
// digits and hyphens, ours letters, digits and underscores, so a name of letters and digits only is
// the same id in both and must sign in with the economy's PIN (one name, one PIN). A name with an
// underscore can never be an economy name: it stays the Playground's own.
export function sharedWithEconomy(slug: string): boolean {
  return /^[a-z0-9]+$/.test(slug);
}

// A name as the economy reads it (its slugify): lowercase, every run of other characters one "-". A
// casino or village name typed with a space ("Big Chain") is the account name:big-chain.
export function economySlug(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

// The spelling the economy keeps for a new name: the Playground's own one when its letters and digits
// make the same slug, else the slug itself (the economy makes its slug from this text).
export function economyName(displayName: string, slug: string): string {
  const letters = String(displayName || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  return letters.toLowerCase() === slug ? letters : slug;
}

export type EconomyNameAnswer = {
  ok: boolean;
  // the economy's code (registered, signed_in, name_taken, name_unknown, pin_wrong, locked, ...),
  // or rate_limited / unavailable
  code: string;
  identityId?: string;
  displayName?: string;
  retryAfter?: number;
};

// The economy's name + PIN check (/api/internal/name-auth). `player` is the player's address, for
// the economy's own limits (it never stores it). Never log the PIN. adopt (register only): this
// Playground has proven the player owns the name with its own PIN, so the economy account made for
// it earlier (by resolve) may get this PIN; without it the economy answers name_taken for a name
// that already has an account.
export async function economyNameAuth(
  action: "login" | "register",
  name: string,
  pin: string,
  player: string,
  opts: { adopt?: boolean } = {},
): Promise<EconomyNameAnswer> {
  if (!SERVICE_API_KEY) return { ok: false, code: "unavailable" };
  try {
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/name-auth", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action, name, pin, player: String(player || "").slice(0, 64), ...(opts.adopt ? { adopt: true } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 429) {
      return { ok: false, code: "rate_limited", retryAfter: Number(r.headers.get("retry-after")) || 60 };
    }
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j) return { ok: false, code: "unavailable" };
    if (j.ok && j.identity && typeof j.identity.id === "string") {
      return { ok: true, code: String(j.code || ""), identityId: j.identity.id, displayName: j.identity.displayName || undefined };
    }
    return { ok: false, code: String(j.code || "failed") };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

// A 2-minute sign-in ticket for the shop: the URL that opens it signed in to this account, with its Back
// link to `ret`. null when the economy has no ticket route yet or did not answer.
export async function economyShopTicket(userId: string, ret: string): Promise<string | null> {
  try {
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/shop-ticket", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId, return: ret }),
      cache: "no-store",
    });
    const j: any = await r.json().catch(() => null);
    const url = r.ok && j && j.ok ? String(j.url || "") : "";
    // only ever the shop's own entrance
    return url.startsWith(ECONOMY_SHOP_URL + "/enter?t=") ? url : null;
  } catch {
    return null;
  }
}
