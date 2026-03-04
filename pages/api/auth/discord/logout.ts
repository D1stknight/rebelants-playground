// pages/api/auth/discord/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // allow GET or POST
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ✅ Your /api/auth/discord/session reads THIS cookie:
  // const raw = getCookie(req, "ra_discord_user");
  // So we MUST clear ra_discord_user (and also clear ra_discord_session just in case).
  const cookies = [
    `ra_discord_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
  ];

  res.setHeader("Set-Cookie", cookies);

  // Go back to Shuffle
  res.writeHead(302, { Location: "/shuffle" });
  res.end();
}
