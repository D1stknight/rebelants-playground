// lib/server/player-auth.ts
// Who is playing: only what a signed cookie proves. The playerId the browser
// sends only chooses between those, so it can no longer name someone else's
// account. Every route that moves points asks here first: actingPlayer() for
// the points routes, the daily claim and the old shop claim, and
// requireSignedPlayer() for Faction Wars PvP and tournaments.
//
// Proof: the signed Discord or wallet session (lib/player-session.ts), the
// name + PIN session (lib/name-session.ts), or the Rebel Economy's own session
// (poker_session, checked by the economy).
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyNameSession, NAME_SESSION_COOKIE } from "../name-session";
import { DISCORD_SESSION_COOKIE, WALLET_SESSION_COOKIE, verifyDiscordSession, verifyWalletSession } from "../player-session";
import { readCookie, resolveByPlayerId, resolveBySessionToken, getSessionToken, type ResolvedUser } from "../economy";

export type SignInKind = "discord" | "name" | "wallet";

// The admin page's key (ADMIN_KEY / ADMIN_TOKEN, the header the admin routes read).
export function isAdminRequest(req: NextApiRequest): boolean {
  const h = (v: unknown) => (Array.isArray(v) ? String(v[0] || "") : String(v || ""));
  const provided = h(req.headers["x-admin-key"]) || h(req.headers["x-admin-token"]);
  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  return !!expected && provided === expected;
}

const clean = (v: unknown) => String(v || "").trim().slice(0, 64);

// A guest id moves no points: resolveByPlayerId has no account for it.
export function isGuestId(playerId: string): boolean {
  return playerId.startsWith("guest-") || playerId.startsWith("guest:");
}

// The sign-in a playerId needs (the Playground's own sign-in banner asks for it), or null.
export function signInKind(playerId: string): SignInKind | null {
  if (playerId.startsWith("discord:")) return "discord";
  if (playerId.startsWith("name:")) return "name";
  if (playerId.startsWith("wallet:")) return "wallet";
  return null;
}

// The players this request's own signed cookies prove, Discord first.
export function signedPlayerIds(req: NextApiRequest): string[] {
  const out: string[] = [];
  const d = verifyDiscordSession(readCookie(req, DISCORD_SESSION_COOKIE));
  if (d) out.push(`discord:${d.discordUserId}`);
  const n = verifyNameSession(readCookie(req, NAME_SESSION_COOKIE));
  if (n) out.push(n);
  const w = verifyWalletSession(readCookie(req, WALLET_SESSION_COOKIE));
  if (w) out.push(`wallet:${w}`);
  return out;
}

// The Rebel Economy's own session as a Playground playerId.
async function economySessionPlayer(req: NextApiRequest): Promise<{ playerId: string; user: ResolvedUser } | null> {
  const token = getSessionToken(req);
  if (!token) return null;
  const user = await resolveBySessionToken(token);
  const id = String(user?.discordId || "");
  if (!user || !id) return null;
  return { playerId: /^(name|wallet):/.test(id) ? id : `discord:${id}`, user };
}

export type ActingPlayer =
  | { ok: true; playerId: string; user: ResolvedUser }
  | { ok: false; signIn: SignInKind | null };

// The player a request may move points for: the claimed playerId when a signed
// session proves it, or for a guest id the player the session proves. Else the
// sign-in the claimed id needs (null: a guest, an id of no known kind, or an
// economy that did not answer, so no sign-in would help).
export async function actingPlayer(req: NextApiRequest, claimedRaw: unknown): Promise<ActingPlayer> {
  const claimed = clean(claimedRaw);
  const kind = signInKind(claimed);
  const guest = !claimed || claimed === "guest" || isGuestId(claimed);
  if (!kind && !guest) return { ok: false, signIn: null };
  const own = signedPlayerIds(req);
  const pick = kind ? (own.includes(claimed) ? claimed : null) : own[0] || null;
  if (pick) {
    const user = await resolveByPlayerId(pick);
    return user ? { ok: true, playerId: pick, user } : { ok: false, signIn: null };
  }
  const econ = await economySessionPlayer(req);
  if (econ && (!kind || econ.playerId === claimed)) return { ok: true, ...econ };
  return { ok: false, signIn: kind };
}

// The Faction Wars routes' HTTP entry: a POST whose body field names a player must
// come from that player's signed session (requireSignedPlayer). An empty field, a
// body that does not parse or another method goes on to the route, which answers it
// as before. Only the HTTP route is wrapped: server code that calls a route's own
// handler (RAAP's move dispatch, submitPvpMove) is not.
export function withSignedPlayer(field: string, handler: (req: NextApiRequest, res: NextApiResponse) => unknown) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") return handler(req, res);
    let claimed = "";
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      claimed = clean(body?.[field]);
    } catch {
      return handler(req, res);
    }
    if (claimed && !(await requireSignedPlayer(req, res, claimed))) return;
    return handler(req, res);
  };
}

// For routes that act as a stored match player (PvP, tournaments): the claimed
// playerId must be one a signed session proves. Guest ids pass (they move no
// points). Otherwise it answers 401 itself and returns false.
export async function requireSignedPlayer(req: NextApiRequest, res: NextApiResponse, claimedRaw: unknown): Promise<boolean> {
  const claimed = clean(claimedRaw);
  if (isGuestId(claimed)) return true;
  const kind = signInKind(claimed);
  if (kind) {
    if (signedPlayerIds(req).includes(claimed)) return true;
    if ((await economySessionPlayer(req))?.playerId === claimed) return true;
  }
  res.status(401).json({ ok: false, error: "Sign in again to play.", signIn: kind });
  return false;
}
