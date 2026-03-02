// pages/api/auth/discord/logout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // allow GET or POST
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Clear cookie used by your discord session endpoint
  // (This assumes your session cookie name is "ra_discord_session")
  res.setHeader(
    "Set-Cookie",
    `ra_discord_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
  );

  // Go back to Shuffle
  res.writeHead(302, { Location: "/shuffle" });
  res.end();
}
