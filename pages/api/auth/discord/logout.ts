// pages/api/auth/discord/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // allow GET or POST
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // No cache
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  // ✅ IMPORTANT: your /api/auth/discord/session reads ra_discord_user
  // So logout must clear ra_discord_user (and also clear ra_discord_session just in case)
  res.setHeader("Set-Cookie", [
    `ra_discord_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
  ]);

  // Go back to Shuffle
  res.writeHead(302, { Location: "/shuffle" });
  res.end();
}
