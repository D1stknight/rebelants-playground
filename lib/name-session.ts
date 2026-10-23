// lib/name-session.ts
// Server-verified session for Commander Name/PIN identities.
//
// Mints and verifies an HMAC signature over the playerId so the server can
// trust a "name:<slug>" identity without relying on the client-sent playerId.
// This closes the spoofing gap for name/PIN players (who previously had no
// server-side session at all).
//
// KEY: NAME_SESSION_SECRET when it is set (sessions already given out stay
// valid), else one derived from the Discord app secret (lib/player-session.ts):
// the points routes only believe a signed session now, so name sign-in must
// always give one.
import { createHmac, timingSafeEqual } from "crypto";
import { sessionKey } from "./player-session";

const SECRET: string | Buffer = process.env.NAME_SESSION_SECRET || sessionKey("name-session") || "";
export const NAME_SESSION_COOKIE = "ra_name_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): string {
  return Buffer.from(
    input.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", SECRET).update(payload).digest());
}

// Returns a signed token "<encodedPlayerId>.<sig>", or null if no secret set.
export function signNameSession(playerId: string): string | null {
  if (!SECRET || !playerId) return null;
  const encoded = b64url(Buffer.from(playerId, "utf8"));
  return encoded + "." + sign(encoded);
}

// Verifies a token and returns the playerId (only if it is a "name:" id), or null.
export function verifyNameSession(token: string): string | null {
  if (!SECRET || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const playerId = fromB64url(encoded);
    if (!playerId.startsWith("name:")) return null;
    return playerId;
  } catch {
    return null;
  }
}

// Set-Cookie value to issue the session (mirrors the discord cookie flags).
export function nameSessionSetCookie(token: string): string {
  return (
    NAME_SESSION_COOKIE +
    "=" +
    token +
    "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" +
    MAX_AGE_SECONDS
  );
}

// Set-Cookie value(s) to clear the session on sign-out.
export function nameSessionClearCookies(): string[] {
  return [
    NAME_SESSION_COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
  ];
}
