// GET /api/faction-wars/tournament/list
//
// Public. Returns the list of active tournaments for display on /tournament.

import type { NextApiRequest, NextApiResponse } from "next";
import { listActiveTournaments } from "../../../../lib/server/fwpvp";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const tournaments = await listActiveTournaments();
    return res.status(200).json({ ok: true, tournaments });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
