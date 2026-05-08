// pages/api/admin/players/search.ts
//
// Search the admin player directory by name fragment. Reads from MULTIPLE
// name registries so commanders who haven't won anything yet still appear:
//   - ra:player_names_v1     (set by /api/wins/add — wins-game players)
//   - ra:fw:pvp_player_names (set by FW PvP — match participants)
// Results are merged + deduplicated by playerId. starts-with matches sort
// before substring matches.

import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../../lib/server/redis";

const NAME_HASHES = [
  "ra:player_names_v1",
  "ra:fw:pvp_player_names",
];

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

    const qRaw = String(req.query.q || "").trim();
    const q = qRaw.toLowerCase();

    if (!q || q.length < 2) {
      return res.status(200).json({ ok: true, results: [] });
    }

    // Read all name hashes in parallel
    const maps = await Promise.all(
      NAME_HASHES.map(async (key) => {
        try {
          const m = (await redis.hgetall(key)) as Record<string, string> | null;
          return m || {};
        } catch {
          return {};
        }
      })
    );

    // Merge — last hash wins on duplicates (FW pvp likely has more recent names)
    const merged: Record<string, string> = {};
    for (const m of maps) {
      for (const [pid, name] of Object.entries(m)) {
        const trimmed = String(name || "").trim();
        if (trimmed) merged[pid] = trimmed;
      }
    }

    const starts: Array<{ playerId: string; name: string }> = [];
    const includes: Array<{ playerId: string; name: string }> = [];

    for (const [playerId, name] of Object.entries(merged)) {
      const hay = name.toLowerCase();
      if (hay.startsWith(q)) starts.push({ playerId, name });
      else if (hay.includes(q)) includes.push({ playerId, name });
    }

    const results = [...starts, ...includes].slice(0, 25);
    return res.status(200).json({ ok: true, results });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
