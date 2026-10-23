import type { NextApiRequest, NextApiResponse } from "next";
import { DISCORD_SESSION_COOKIE, verifyDiscordSession } from "../../../../lib/player-session";

function getCookie(req: NextApiRequest, name: string) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.split("=").slice(1).join("=")) : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  // Signed in = the signed session (the old ra_discord_user cookie alone can be written by anyone).
  const s = verifyDiscordSession(getCookie(req, DISCORD_SESSION_COOKIE));
  if (!s) return res.status(200).json({ ok: false });
  return res.status(200).json({ ok: true, discordUserId: s.discordUserId, discordName: s.discordName });
}
