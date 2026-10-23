// lib/player-session.ts
// Signed sessions for Discord and wallet players.
//
// The Discord sign-in used to leave only "ra_discord_user", a plain cookie anyone
// can write, and the points routes believed the playerId the browser sent. Now
// the Discord callback and a checked wallet signature also set a signed cookie,
// and the routes that move points ask lib/server/player-auth.ts who is playing.
//
// KEY: DISCORD_SESSION_SECRET when it is set, else one derived from the Discord
// app secret (the sign-in cannot work without it), so nothing new has to be
// configured. Each kind of session gets a key of its own.
import { createHmac, timingSafeEqual } from "crypto";

export const DISCORD_SESSION_COOKIE = "ra_discord_session";
export const WALLET_SESSION_COOKIE = "ra_wallet_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, like the name session

// A key for one kind of session, or null when no secret is configured.
export function sessionKey(purpose: string): Buffer | null {
  const root = process.env.DISCORD_SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || "";
  if (!root) return null;
  return createHmac("sha256", root).update(`rebelants-playground:${purpose}:v1`).digest();
}

function b64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(input: string): string {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// "<encoded payload>.<signature>", the payload carrying its own expiry.
function signToken(purpose: string, payload: Record<string, unknown>): string | null {
  const key = sessionKey(purpose);
  if (!key) return null;
  const encoded = b64url(Buffer.from(JSON.stringify({ ...payload, e: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS }), "utf8"));
  return encoded + "." + b64url(createHmac("sha256", key).update(encoded).digest());
}

function verifyToken(purpose: string, token: string): any | null {
  const key = sessionKey(purpose);
  if (!key || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(b64url(createHmac("sha256", key).update(encoded).digest()));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(fromB64url(encoded));
    if (!p || typeof p !== "object" || !(Number(p.e) > Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

export function signDiscordSession(discordUserId: string, discordName: string): string | null {
  if (!discordUserId) return null;
  return signToken("discord-session", { d: discordUserId, n: discordName });
}

export function verifyDiscordSession(token: string): { discordUserId: string; discordName: string } | null {
  const p = verifyToken("discord-session", token);
  if (!p || typeof p.d !== "string" || !p.d) return null;
  return { discordUserId: p.d, discordName: typeof p.n === "string" ? p.n : "" };
}

export function signWalletSession(wallet: string): string | null {
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;
  return signToken("wallet-session", { w: wallet });
}

export function verifyWalletSession(token: string): string | null {
  const p = verifyToken("wallet-session", token);
  return p && typeof p.w === "string" && /^0x[0-9a-f]{40}$/.test(p.w) ? p.w : null;
}

export function sessionSetCookie(name: string, token: string): string {
  return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function sessionClearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
