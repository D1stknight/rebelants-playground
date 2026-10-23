import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { economySlug } from "../../../lib/economy";

function normalize(n: string) {
  return n.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  // as claim-name reads a name: the Rebel Economy's rules (24 characters, the account its slug), and an
  // old Playground name that reads the same without the spaces and symbols counts as taken
  const raw = String(req.query.name || "").trim().slice(0, 24).trim();
  const name = economySlug(raw);
  const old = normalize(raw);

  if (raw.length < 3) return res.status(200).json({ ok: true, available: false, reason: "Name must be at least 3 characters" });
  if (name.length < 3) return res.status(200).json({ ok: true, available: false, reason: "Use at least 3 letters or numbers" });

  const [taken, lookalike] = await Promise.all([redis.get(`ra:commander:name:${name}`), old && old !== name ? redis.get(`ra:commander:name:${old}`) : null]);
  return res.status(200).json({ ok: true, available: !taken && !lookalike, name });
}
