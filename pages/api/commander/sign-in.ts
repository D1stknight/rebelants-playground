import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { createHash } from "crypto";
import { signNameSession, nameSessionSetCookie } from "../../../lib/name-session";
import { rateLimit } from "../../../lib/server/ratelimit";
import { economyName, economyNameAuth, economySlug, sharedWithEconomy } from "../../../lib/economy";

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

  const ip = getIP(req);
  const keys = (slug: string) => ({
    nameKey: `ra:commander:name:${slug}`,
    pinKey: `ra:commander:pin:${slug}`,
    shownKey: `ra:commander:player:name:${slug}`,
  });
  const tooManyFails = async (slug: string) => {
    const fails = PIN_FAILS(slug, ip);
    const counts = await Promise.all(fails.map((f) => redis.get<number>(f.key)));
    return counts.some((c, i) => Number(c || 0) >= fails[i].limit);
  };
  const countFail = (slug: string) => Promise.all(PIN_FAILS(slug, ip).map((f) => rateLimit(f)));
  const signIn = (slug: string, displayName: string) => {
    // Keyed by NAME_SESSION_SECRET, else a key derived from the Discord app secret (lib/name-session.ts).
    const sessionToken = signNameSession("name:" + slug);
    if (sessionToken) res.setHeader("Set-Cookie", nameSessionSetCookie(sessionToken));
    return res.status(200).json({ ok: true, name: slug, playerId: `name:${slug}`, displayName });
  };
  const tooMany = () => res.status(429).json({ ok: false, error: "Too many wrong PINs. Try again later." });
  const limited = () => res.status(429).json({ ok: false, error: "Too many sign-in attempts. Try again in a few minutes." });
  const locked = () => res.status(429).json({ ok: false, error: "Too many wrong PINs for this name. Try again in 15 minutes." });
  const wrongPin = () => res.status(403).json({ ok: false, error: "Incorrect PIN" });
  const twoPins = () => res.status(403).json({ ok: false, code: "economy_pin", error: "This name is also a Rebel Economy (casino) account with another PIN. Sign in with that PIN." });
  const unavailable = () => res.status(503).json({ ok: false, error: "Sign-in is not available right now. Try again in a minute." });
  const notFound = () => res.status(404).json({ ok: false, error: "Commander name not found" });

  // A name of letters and digits is also the Rebel Economy's colony name (the casino, the village); one
  // typed with spaces or symbols ("Big Chain") is the economy's account of that spelling (name:big-chain),
  // or an old Playground name typed that way. An old name with _ is the Playground's own (the economy
  // spells _ as -); a newer one is the economy's (big_chain is name:big-chain).
  const spelled = economySlug(raw);
  if (name.includes("_")) {
    if ((await redis.get(keys(name).nameKey)) || spelled.length < 3) return signInPlaygroundOnly();
    return signInSpelled(spelled);
  }
  if (sharedWithEconomy(name) && spelled !== name && spelled.length >= 3) return signInSpelled(spelled);
  return signInWithEconomy();

  async function signInPlaygroundOnly() {
    const k = keys(name);
    // Check name exists
    const exists = await redis.get(k.nameKey);
    if (!exists) return notFound();

    // Check PIN
    const storedHash = await redis.get<string>(k.pinKey);
    // code no_pin: the sign-in card offers the device that holds this name a PIN (as the home page's SET PIN)
    if (!storedHash) return res.status(403).json({ ok: false, code: "no_pin", error: "No PIN set for this name. Contact support." });

    if (await tooManyFails(name)) return tooMany();

    if (hashPin(name, pin) !== storedHash) {
      await countFail(name);
      return wrongPin();
    }

    // Get display name
    return signIn(name, (await redis.get<string>(k.shownKey)) || raw);
  }

  // Signed in by the economy: on the Playground's list too, its PIN kept by the economy alone ("economy"
  // is no PIN hash, so the Playground's own PIN check and set-pin never match or replace it).
  async function economySignedIn(slug: string, displayName?: string) {
    const k = keys(slug);
    await Promise.all([
      redis.set(k.nameKey, `name:${slug}`, { nx: true }),
      redis.set(k.pinKey, "economy", { nx: true }),
      displayName ? redis.set(k.shownKey, displayName, { nx: true }) : null,
    ]);
    return signIn(slug, (await redis.get<string>(k.shownKey)) || displayName || raw);
  }

  // A name typed with spaces or symbols: the account of that exact spelling first, so its PIN always signs in
  // to it. An old Playground name typed that way ("Big Chain" for bigchain) comes second: when the economy has
  // no account of that spelling, or that account's PIN is not this one and the old name's is.
  async function signInSpelled(spelledSlug: string) {
    if (await tooManyFails(spelledSlug)) return tooMany();
    const e = await economyNameAuth("login", raw, pin, ip);
    if (e.ok) return e.identityId === `name:${spelledSlug}` ? economySignedIn(spelledSlug, e.displayName) : unavailable();
    if (e.code === "rate_limited") return limited();
    if (e.code === "name_unknown") return name.includes("_") ? notFound() : signInWithEconomy();
    if (e.code === "pin_wrong" || e.code === "locked") {
      const stored = name.includes("_") ? null : await redis.get<string>(keys(name).pinKey);
      if (stored && stored === hashPin(name, pin)) return signInWithEconomy();
      if (e.code === "locked") return locked();
      await countFail(spelledSlug);
      return wrongPin();
    }
    return unavailable();
  }

  // A name of letters and digits: the economy's PIN signs it in. An old Playground name the economy does not
  // have yet is proven by its Playground PIN and then gets that PIN in the economy (adopting the economy
  // account the Playground's points are on), so it is one name with one PIN everywhere.
  async function signInWithEconomy() {
    const k = keys(name);
    if (await tooManyFails(name)) return tooMany();
    const ours = (id?: string) => id === `name:${name}`;
    const e = await economyNameAuth("login", name, pin, ip);
    if (e.ok) return ours(e.identityId) ? economySignedIn(name, e.displayName) : unavailable();
    if (e.code === "rate_limited") return limited();
    if (e.code === "locked") return locked();
    const storedHash = await redis.get<string>(k.pinKey);
    if (e.code === "pin_wrong") {
      await countFail(name);
      // The Playground PIN of the same name, but the economy (casino) account has another PIN.
      if (storedHash && storedHash === hashPin(name, pin)) return twoPins();
      return wrongPin();
    }
    if (e.code !== "name_unknown") return unavailable();

    if (!(await redis.get(k.nameKey))) return notFound();
    if (!storedHash) return res.status(403).json({ ok: false, code: "no_pin", error: "No PIN set for this name. Contact support." });
    if (hashPin(name, pin) !== storedHash) {
      await countFail(name);
      return wrongPin();
    }
    const display = (await redis.get<string>(k.shownKey)) || raw;
    let r = await economyNameAuth("register", economyName(display, name), pin, ip, { adopt: true });
    // made in the economy a moment ago (a second tab, another app): the same PIN signs it in
    if (r.code === "name_taken") r = await economyNameAuth("login", name, pin, ip);
    if (r.ok && ours(r.identityId)) return signIn(name, display);
    if (r.code === "rate_limited") return limited();
    if (r.code === "pin_wrong" || r.code === "locked") return twoPins();
    return unavailable();
  }
}
