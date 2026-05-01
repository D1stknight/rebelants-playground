import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send("Missing DISCORD_CLIENT_ID");
  }

  // Derive redirect URI from the actual host so it works on any deployment
  // (testing preview, production, etc.) without needing per-env config
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${proto}://${host}/api/auth/discord/callback`;

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // Store state in httpOnly cookie (CSRF protection)
  res.setHeader("Set-Cookie", [
    `ra_discord_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    `ra_return_to=${encodeURIComponent(String(Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer || "/"))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    // Store redirectUri in cookie so callback uses the same one (required by Discord)
    `ra_discord_redirect=${encodeURIComponent(redirectUri)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
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
