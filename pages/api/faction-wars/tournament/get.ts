// GET /api/faction-wars/tournament/get?id=...
//
// Public. Returns a single tournament's full state including rounds + bracket.

import type { NextApiRequest, NextApiResponse } from "next";
import { getTournament } from "../../../../lib/server/fwpvp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = String(req.query.id || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id required" });
  const t = await getTournament(id);
  if (!t) return res.status(404).json({ ok: false, error: "not found" });
  return res.status(200).json({ ok: true, tournament: t });
}
