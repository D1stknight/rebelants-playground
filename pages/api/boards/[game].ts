// pages/api/boards/[game].ts — a game's leaderboards, recent finishes and (with ?playerId) the player's own stats
import type { NextApiRequest, NextApiResponse } from "next";
import { isBoardGame, readBoards } from "../../../lib/server/gameBoards";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const game = req.query.game;
  if (!isBoardGame(game)) return res.status(404).json({ ok: false, error: "Unknown game" });
  try {
    const playerId = String(req.query.playerId || "").trim().slice(0, 64);
    const trackIds = String(req.query.tracks || "").split(",").map((t) => t.replace(/[^a-z0-9_-]/gi, "").slice(0, 24)).filter(Boolean).slice(0, 20);
    const data = await readBoards(game, { playerId: playerId && playerId !== "guest" ? playerId : "", trackIds, n: Number(req.query.n || 10) });
    return res.status(200).json({ ok: true, game, ...data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed" });
  }
}
