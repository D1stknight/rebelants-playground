import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

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
  const name = normalize(raw);
  const displayName = String(body.displayName || raw).trim().slice(0, 24);

  if (!name || name.length < 3) return res.status(400).json({ ok: false, error: "Name must be at least 3 characters" });
  if (name.length > 20) return res.status(400).json({ ok: false, error: "Name must be 20 characters or less" });

  // IP rate limit — max 3 new names per IP per 24h
  const ip = getIP(req);
  const ipKey = `ra:commander:ip:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const ipCount = Number((await redis.get<number>(ipKey)) || 0);
  if (ipCount >= 3) return res.status(429).json({ ok: false, error: "Too many names created today. Try again tomorrow." });

  // Check if taken
  const nameKey = `ra:commander:name:${name}`;
  const existing = await redis.get(nameKey);
  if (existing) return res.status(409).json({ ok: false, error: "Name is already taken" });

  const playerId = `name:${name}`;

  // Claim it — store permanently (no TTL)
  await redis.set(nameKey, playerId);
  // Increment IP rate limit counter (24h TTL)
  await redis.incr(ipKey);
  await redis.expire(ipKey, 86400);
  // Store reverse lookup
  await redis.set(`ra:commander:player:${playerId}`, displayName);

  return res.status(200).json({ ok: true, name, displayName, playerId });
}
