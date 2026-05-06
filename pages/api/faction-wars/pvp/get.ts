// GET /api/faction-wars/pvp/get?id=<challengeId>
//
// Returns the full match state. Used for polling by both players. No identity
// check — match state is considered viewable by anyone who has the link
// (you'd need the 12-char challengeId to even guess).
//
// In V2 we may scope returned fields by viewer (e.g. hide opponent's locked
// team until both teams are in). Not required in V1.

import type { NextApiRequest, NextApiResponse } from "next";
import { getMatch } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const id = String(req.query.id || "").trim().slice(0, 64);
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
  const match = await getMatch(id);
  if (!match) return res.status(404).json({ ok: false, error: "Match not found" });
  return res.status(200).json({ ok: true, match });
}
