// pages/api/boards/record.ts — a finished run goes on its game's boards, once (lib/server/gameBoards.ts)
import type { NextApiRequest, NextApiResponse } from "next";
import { actingPlayer } from "../../../lib/server/player-auth";
import { firstRecord, runOutcome } from "../../../lib/server/gameRuns";
import { checkSiege, entryFor, isBoardGame, readSiegeSession, recordBoards } from "../../../lib/server/gameBoards";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    const game = body.game;
    if (!isBoardGame(game)) return res.status(400).json({ ok: false, error: "Unknown game" });
    const who = await actingPlayer(req, body.playerId);
    if (!who.ok) return res.status(401).json({ ok: false, error: "Sign in to get on the boards.", signIn: who.signIn });
    const playerName = String(body.playerName || who.playerId).trim().slice(0, 40) || "player";
    const stats = body.stats && typeof body.stats === "object" ? body.stats : {};

    if (game === "siege") {
      const sess = await readSiegeSession(body.session);
      if (!sess || sess.userId !== who.user.userId || !(await firstRecord("gb-siege", sess.id))) return res.status(200).json({ ok: true, recorded: false });
      const checked = checkSiege(stats, sess);
      const e = entryFor("siege", checked, 0);
      await recordBoards({ game, playerId: who.playerId, playerName, ...e });
      return res.status(200).json({ ok: true, recorded: true });
    }
    const out = await runOutcome({ runId: body.runId, userId: who.user.userId });
    if (!out || out.game !== game || !(await firstRecord(`gb-${game}`, out.id))) return res.status(200).json({ ok: true, recorded: false });
    // a race can't be quicker than the run that paid for it
    if (game === "gp" && out.run && Number(stats.timeMs) > 0) stats.timeMs = Math.max(Number(stats.timeMs || 0), Date.now() - out.run.startedAt - 30000);
    const e = entryFor(game, stats, out.points);
    await recordBoards({ game, playerId: who.playerId, playerName, ...e });
    return res.status(200).json({ ok: true, recorded: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed" });
  }
}
