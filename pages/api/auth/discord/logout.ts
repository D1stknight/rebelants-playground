// pages/api/auth/discord/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // allow GET or POST
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ✅ IMPORTANT:
  // /api/auth/discord/session reads cookie: "ra_discord_user"
  // So logout MUST clear "ra_discord_user" (and also clear "ra_discord_session" just in case)
 const cookies = [
  // clear main cookie
  `ra_discord_user=; Path=/; Max-Age=0`,
  `ra_discord_user=; Path=/; HttpOnly; Max-Age=0`,
  `ra_discord_user=; Path=/; SameSite=Lax; Max-Age=0`,
  `ra_discord_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  `ra_discord_user=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,

  // safety clear
  `ra_discord_session=; Path=/; Max-Age=0`,
];

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Set-Cookie", cookies);

  // Go back to Shuffle
  res.writeHead(302, { Location: "/shuffle" });
  res.end();
}
