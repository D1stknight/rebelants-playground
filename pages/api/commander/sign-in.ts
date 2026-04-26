import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { createHash } from "crypto";

function hashPin(name: string, pin: string): string {
  return createHash("sha256")
    .update(`ra:commander:${name.toLowerCase()}:${pin}:rebel-ants-2026`)
    .digest("hex");
}

function normalize(n: string) {
  return n.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

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

  const attemptHash = hashPin(name, pin);
  if (attemptHash !== storedHash) {
    return res.status(403).json({ ok: false, error: "Incorrect PIN" });
  }

  // Get display name
  const displayName = await redis.get<string>(`ra:commander:player:name:${name}`) || raw;

  return res.status(200).json({ ok: true, name, playerId: `name:${name}`, displayName });
}
