// pages/api/admin/players/search.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../lib/server/redis";

const PLAYER_NAMES = "ra:player_names_v1"; // playerId -> last known display name

function headerValue(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isAuthed(req: NextApiRequest) {
  const provided =
    headerValue(req.headers["x-admin-key"]) ||
    headerValue(req.headers["x-admin-token"]) ||
    "";

  const expected = process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "";
  if (!expected) return false;

  return !!provided && provided === expected;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const qRaw = String(req.query.q ?? "").trim();
    const q = qRaw.toLowerCase();

    if (!q || q.length < 2) {
      return res.status(200).json({ ok: true, results: [] });
    }

    // Pull all (playerId -> name) and filter server-side (fine for now)
    const map = (await redis.hgetall(PLAYER_NAMES)) as Record<string, string> | null;
    const entries = Object.entries(map || {});

    // rank: startsWith first, then includes
    const starts: Array<{ playerId: string; name: string }> = [];
    const includes: Array<{ playerId: string; name: string }> = [];

    for (const [playerId, nameRaw] of entries) {
      const name = String(nameRaw || "").trim();
      if (!name) continue;

      const hay = name.toLowerCase();
      if (hay.startsWith(q)) starts.push({ playerId, name });
      else if (hay.includes(q)) includes.push({ playerId, name });
    }

    const results = [...starts, ...includes].slice(0, 10);

    return res.status(200).json({ ok: true, results });
  } catch (e: any) {
    console.error("admin players search error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
