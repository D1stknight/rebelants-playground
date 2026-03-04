// pages/api/auth/discord/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // allow GET or POST
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ✅ IMPORTANT:
  // Your /api/auth/discord/session reads cookie "ra_discord_user"
  // so logout MUST clear "ra_discord_user" (and we also clear the old one to be safe).
  const base = "Path=/; HttpOnly; SameSite=Lax; Max-Age=0";

  res.setHeader("Set-Cookie", [
    `ra_discord_user=; ${base}`,
    `ra_discord_session=; ${base}`,
  ]);

  // Go back to Shuffle
  res.writeHead(302, { Location: "/shuffle" });
  res.end();
}
