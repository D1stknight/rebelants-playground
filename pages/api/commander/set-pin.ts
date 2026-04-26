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
  if (!pin || pin.length < 4 || pin.length > 6 || !/^[0-9]+$/.test(pin)) {
    return res.status(400).json({ ok: false, error: "PIN must be 4-6 digits" });
  }

  // Verify name exists in Redis
  const nameKey = `ra:commander:name:${name}`;
  const existing = await redis.get(nameKey);
  if (!existing) return res.status(404).json({ ok: false, error: "Commander name not found" });

  // Check if PIN already set
  const pinKey = `ra:commander:pin:${name}`;
  const existingPin = await redis.get(pinKey);
  if (existingPin) return res.status(409).json({ ok: false, error: "PIN already set for this name" });

  // Store hashed PIN
  await redis.set(pinKey, hashPin(name, pin));

  return res.status(200).json({ ok: true, name, playerId: `name:${name}` });
}
