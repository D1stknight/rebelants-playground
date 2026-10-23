import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { createHash } from "crypto";
import { signNameSession, nameSessionSetCookie } from "../../../lib/name-session";
import { rateLimit } from "../../../lib/server/ratelimit";

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

  // Check name exists
  const nameKey = `ra:commander:name:${name}`;
  const exists = await redis.get(nameKey);
  if (!exists) return res.status(404).json({ ok: false, error: "Commander name not found" });

  // Check PIN
  const pinKey = `ra:commander:pin:${name}`;
  const storedHash = await redis.get<string>(pinKey);
  if (!storedHash) return res.status(403).json({ ok: false, error: "No PIN set for this name. Contact support." });

  const fails = PIN_FAILS(name, getIP(req));
  const counts = await Promise.all(fails.map((f) => redis.get<number>(f.key)));
  if (counts.some((c, i) => Number(c || 0) >= fails[i].limit)) {
    return res.status(429).json({ ok: false, error: "Too many wrong PINs. Try again later." });
  }

  const attemptHash = hashPin(name, pin);
  if (attemptHash !== storedHash) {
    await Promise.all(fails.map((f) => rateLimit(f)));
    return res.status(403).json({ ok: false, error: "Incorrect PIN" });
  }

  // Get display name
  const displayName = await redis.get<string>(`ra:commander:player:name:${name}`) || raw;

  // Issue a server-verified session cookie for this name identity.
  // No-op until NAME_SESSION_SECRET is set (signNameSession returns null).
  const sessionToken = signNameSession("name:" + name);
  if (sessionToken) res.setHeader("Set-Cookie", nameSessionSetCookie(sessionToken));
  return res.status(200).json({ ok: true, name, playerId: `name:${name}`, displayName });
}
