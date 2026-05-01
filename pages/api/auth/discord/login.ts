import type { NextApiRequest, NextApiResponse } from "next";

// Map of known hosts to their registered Discord redirect URIs
// Add any new deployment URLs here as needed
const REDIRECT_URI_MAP: Record<string, string> = {
  "play.rebelants.io": "https://play.rebelants.io/api/auth/discord/callback",
  "rebelants-playground-d1stknight.vercel.app": "https://rebelants-playground-d1stknight.vercel.app/api/auth/discord/callback",
  "rebel-ants-playground-testing.vercel.app": "https://rebel-ants-playground-testing.vercel.app/api/auth/discord/callback",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send("Missing DISCORD_CLIENT_ID");
  }

  // Determine the actual host this request arrived on
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  ).split(":")[0]; // strip port if any

  // Look up registered redirect URI for this host, fall back to env var
  const redirectUri =
    REDIRECT_URI_MAP[host] ||
    process.env.DISCORD_REDIRECT_URI ||
    `https://${host}/api/auth/discord/callback`;

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  res.setHeader("Set-Cookie", [
    `ra_discord_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    `ra_return_to=${encodeURIComponent(String(Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer || "/"))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    // Store which redirectUri was used — callback must use the exact same one
    `ra_discord_redir=${encodeURIComponent(redirectUri)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
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
