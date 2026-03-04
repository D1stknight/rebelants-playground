// pages/api/auth/discord/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // allow GET or POST
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // IMPORTANT:
  // Your /api/auth/discord/session endpoint reads "ra_discord_user"
  // so logout MUST clear "ra_discord_user" (and we also clear the old name just in case).
  //
  // Also: cookies can exist on different Paths. To reliably delete, we clear common paths.

  const clears = [
    // primary cookie used by session endpoint
    `ra_discord_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_user=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_user=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_user=; Path=/api/auth/discord; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,

    // legacy/extra safety (if you ever used this name)
    `ra_discord_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_session=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_session=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    `ra_discord_session=; Path=/api/auth/discord; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
  ];

  res.setHeader("Set-Cookie", clears);

  // Go back to Shuffle
  res.writeHead(302, { Location: "/shuffle" });
  res.end();
}
