import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send("Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI");
  }

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // store state in httpOnly cookie (CSRF protection)
  res.setHeader("Set-Cookie", [
    `ra_discord_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  ]);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
}
