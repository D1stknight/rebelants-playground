import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

function normalize(n: string) {
  return n.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const raw = String(req.query.name || "").trim();
  const name = normalize(raw);

  if (!name || name.length < 3) return res.status(200).json({ ok: true, available: false, reason: "Name must be at least 3 characters" });
  if (name.length > 20) return res.status(200).json({ ok: true, available: false, reason: "Name must be 20 characters or less" });

  const taken = await redis.get(`ra:commander:name:${name}`);
  return res.status(200).json({ ok: true, available: !taken, name });
}
