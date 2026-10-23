import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { createHash } from "crypto";
import { signNameSession, nameSessionSetCookie } from "../../../lib/name-session";
import { rateLimit } from "../../../lib/server/ratelimit";
import { economyName, economyNameAuth, sharedWithEconomy } from "../../../lib/economy";

function hashPin(name: string, pin: string): string {
  return createHash("sha256")
    .update(`ra:commander:${name.toLowerCase()}:${pin}:rebel-ants-2026`)
    .digest("hex");
}

function normalize(n: string) {
  return n.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function getIP(req: NextApiRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Wrong PINs allowed before sign-in waits (a 4-6 digit PIN must not fall to guessing):
// per name 10 in 15 minutes and 50 a day, per address 30 in 15 minutes.
const PIN_FAILS = (name: string, ip: string) => [
  { key: `ra:commander:pinfail:name:${name}`, limit: 10, windowSec: 15 * 60 },
  { key: `ra:commander:pinfail:day:${name}`, limit: 50, windowSec: 24 * 60 * 60 },
  { key: `ra:commander:pinfail:ip:${ip}`, limit: 30, windowSec: 15 * 60 },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const raw = String(body.name || "").trim();
  const pin = String(body.pin || "").trim();
  const name = normalize(raw);

  if (!name) return res.status(400).json({ ok: false, error: "Name required" });
  if (!pin) return res.status(400).json({ ok: false, error: "PIN required" });

  const nameKey = `ra:commander:name:${name}`;
  const pinKey = `ra:commander:pin:${name}`;
  const fails = PIN_FAILS(name, getIP(req));
  const signIn = (displayName: string) => {
    // Keyed by NAME_SESSION_SECRET, else a key derived from the Discord app secret (lib/name-session.ts).
    const sessionToken = signNameSession("name:" + name);
    if (sessionToken) res.setHeader("Set-Cookie", nameSessionSetCookie(sessionToken));
    return res.status(200).json({ ok: true, name, playerId: `name:${name}`, displayName });
  };
  if (sharedWithEconomy(name)) return signInWithEconomy();

  // Check name exists
  const exists = await redis.get(nameKey);
  if (!exists) return res.status(404).json({ ok: false, error: "Commander name not found" });

  // Check PIN
  const storedHash = await redis.get<string>(pinKey);
  // code no_pin: the sign-in card offers the device that holds this name a PIN (as the home page's SET PIN)
  if (!storedHash) return res.status(403).json({ ok: false, code: "no_pin", error: "No PIN set for this name. Contact support." });

  if (await tooManyFails()) return res.status(429).json({ ok: false, error: "Too many wrong PINs. Try again later." });

  const attemptHash = hashPin(name, pin);
  if (attemptHash !== storedHash) {
    await Promise.all(fails.map((f) => rateLimit(f)));
    return res.status(403).json({ ok: false, error: "Incorrect PIN" });
  }

  // Get display name
  return signIn(await redis.get<string>(`ra:commander:player:name:${name}`) || raw);

  async function tooManyFails() {
    const counts = await Promise.all(fails.map((f) => redis.get<number>(f.key)));
    return counts.some((c, i) => Number(c || 0) >= fails[i].limit);
  }

  // A name of letters and digits is also a Rebel Economy colony name (the casino, the village): the
  // economy's PIN signs it in. An old Playground name the economy does not have yet is proven by its
  // Playground PIN and then gets that PIN in the economy, so it is one name with one PIN everywhere.
  async function signInWithEconomy() {
    if (await tooManyFails()) return res.status(429).json({ ok: false, error: "Too many wrong PINs. Try again later." });
    const ip = getIP(req);
    const ours = (id?: string) => id === `name:${name}`;
    const unavailable = () => res.status(503).json({ ok: false, error: "Sign-in is not available right now. Try again in a minute." });
    const shown = async (fallback?: string) => (await redis.get<string>(`ra:commander:player:name:${name}`)) || fallback || raw;
    const e = await economyNameAuth("login", name, pin, ip);
    if (e.ok) {
      if (!ours(e.identityId)) return unavailable();
      // First time here for a casino / village name: on the list, its PIN kept by the economy alone
      // ("economy" is no PIN hash, so the Playground's own PIN check never matches it).
      await Promise.all([
        redis.set(nameKey, `name:${name}`, { nx: true }),
        redis.set(pinKey, "economy", { nx: true }),
        e.displayName ? redis.set(`ra:commander:player:name:${name}`, e.displayName, { nx: true }) : null,
      ]);
      return signIn(await shown(e.displayName));
    }
    if (e.code === "rate_limited") return res.status(429).json({ ok: false, error: "Too many sign-in attempts. Try again in a few minutes." });
    if (e.code === "locked") return res.status(429).json({ ok: false, error: "Too many wrong PINs for this name. Try again in 15 minutes." });
    const storedHash = await redis.get<string>(pinKey);
    if (e.code === "pin_wrong") {
      await Promise.all(fails.map((f) => rateLimit(f)));
      // The Playground PIN of the same name, but the economy (casino) account has another PIN.
      if (storedHash && storedHash === hashPin(name, pin)) {
        return res.status(403).json({ ok: false, code: "economy_pin", error: "This name is also a Rebel Economy (casino) account with another PIN. Sign in with that PIN." });
      }
      return res.status(403).json({ ok: false, error: "Incorrect PIN" });
    }
    if (e.code !== "name_unknown") return unavailable();

    if (!(await redis.get(nameKey))) return res.status(404).json({ ok: false, error: "Commander name not found" });
    if (!storedHash) return res.status(403).json({ ok: false, code: "no_pin", error: "No PIN set for this name. Contact support." });
    if (hashPin(name, pin) !== storedHash) {
      await Promise.all(fails.map((f) => rateLimit(f)));
      return res.status(403).json({ ok: false, error: "Incorrect PIN" });
    }
    const display = await shown();
    let r = await economyNameAuth("register", economyName(display, name), pin, ip);
    // made in the economy a moment ago (a second tab, another app): the same PIN signs it in
    if (r.code === "name_taken") r = await economyNameAuth("login", name, pin, ip);
    if (r.ok && ours(r.identityId)) return signIn(display);
    if (r.code === "rate_limited") return res.status(429).json({ ok: false, error: "Too many sign-in attempts. Try again in a few minutes." });
    if (r.code === "pin_wrong" || r.code === "locked") {
      return res.status(403).json({ ok: false, code: "economy_pin", error: "This name is also a Rebel Economy (casino) account with another PIN. Sign in with that PIN." });
    }
    return unavailable();
  }
}
