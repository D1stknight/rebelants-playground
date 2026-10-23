import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { createHash } from "crypto";
import { signNameSession, nameSessionSetCookie } from "../../../lib/name-session";
import { economyNameAuth, economySlug } from "../../../lib/economy";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  const raw = String(body.name || "").trim();
  const pin = String(body.pin || "").trim();
  const shownIn = String(body.displayName || raw).trim();
  // A name follows the Rebel Economy's rules, as in the casino and the village: up to 24 characters as
  // typed (spaces, symbols, an email), the account its slug ("Big Chain" is name:big-chain). An older page
  // sends a lowercased copy as name, with the typed one as displayName.
  const typed = (economySlug(shownIn) === economySlug(raw) ? shownIn : raw).slice(0, 24).trim();
  const slug = economySlug(typed);

  if (typed.length < 3) return res.status(400).json({ ok: false, error: "Name must be at least 3 characters" });
  if (slug.length < 3) return res.status(400).json({ ok: false, error: "Use at least 3 letters or numbers" });
  if (!pin || pin.length < 4 || pin.length > 6 || !/^[0-9]+$/.test(pin)) {
    return res.status(400).json({ ok: false, error: "PIN must be 4-6 digits (numbers only)" });
  }

  // IP rate limit — max 3 new names per IP per 24h
  const ip = getIP(req);
  const ipKey = `ra:commander:ip:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const ipCount = Number((await redis.get<number>(ipKey)) || 0);
  if (ipCount >= 3) return res.status(429).json({ ok: false, error: "Too many names created today. Try again tomorrow." });

  // Check if taken: this account, or an old Playground name that reads the same without the spaces and
  // symbols (the Playground used to drop them: "Big Chain" was bigchain)
  const nameKey = `ra:commander:name:${slug}`;
  const old = normalize(typed);
  const [existing, lookalike] = await Promise.all([redis.get(nameKey), old && old !== slug ? redis.get(`ra:commander:name:${old}`) : null]);
  if (existing || lookalike) return res.status(409).json({ ok: false, error: "Name is already taken" });

  const playerId = `name:${slug}`;

  // Made in the Rebel Economy first (the casino, the village use the same accounts), so a name the economy
  // already has (a PIN there, or an account with points) is never handed out again here.
  const r = await economyNameAuth("register", typed, pin, ip);
  if (!r.ok || r.identityId !== playerId) {
    if (r.code === "name_taken") {
      return res.status(409).json({ ok: false, error: "That name is already taken in Rebel Ants. If it's yours, sign in with its PIN; else pick another." });
    }
    if (r.code === "rate_limited") return res.status(429).json({ ok: false, error: "Too many new names right now. Try again later." });
    if (r.code === "name_short" || r.code === "name_chars" || r.code === "pin_format") {
      return res.status(400).json({ ok: false, error: "Pick a name with at least 3 letters or numbers and a 4-6 digit PIN." });
    }
    return res.status(503).json({ ok: false, error: "Names are not available right now. Try again in a minute." });
  }
  const shown = r.displayName || typed;

  // Store name + PIN + metadata atomically
  await Promise.all([
    redis.set(nameKey, playerId),
    redis.set(`ra:commander:pin:${slug}`, hashPin(slug, pin)),
    redis.set(`ra:commander:player:${playerId}`, shown),
    redis.incr(ipKey).then(() => redis.expire(ipKey, 86400)),
  ]);

  // Signed in with the new name at once (the points routes believe name:<slug> only with this session).
  const sessionToken = signNameSession(playerId);
  if (sessionToken) res.setHeader("Set-Cookie", nameSessionSetCookie(sessionToken));
  return res.status(200).json({ ok: true, name: slug, displayName: shown, playerId });
}
