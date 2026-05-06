import type { NextApiRequest, NextApiResponse } from "next";

const TESTING_HOST = "rebel-ants-playground-testing.vercel.app";
const TESTING_REDIRECT_URI = `https://${TESTING_HOST}/api/auth/discord/callback`;

// Map of known hosts to their registered Discord redirect URIs
// Add any new deployment URLs here as needed
const REDIRECT_URI_MAP: Record<string, string> = {
  "play.rebelants.io": "https://play.rebelants.io/api/auth/discord/callback",
  "rebelants-playground-d1stknight.vercel.app": "https://rebelants-playground-d1stknight.vercel.app/api/auth/discord/callback",
  [TESTING_HOST]: TESTING_REDIRECT_URI,
};

function getRequestOrigin(req: NextApiRequest, host: string): string {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${host}`;
}

function isVercelBranchPreviewHost(host: string): boolean {
  return host.endsWith(".vercel.app") && host.includes("git-");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send("Missing DISCORD_CLIENT_ID");
  }

  // Determine the actual host this request arrived on
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  ).split(":")[0]; // strip port if any

  const requestOrigin = getRequestOrigin(req, host);
  const mappedRedirectUri = REDIRECT_URI_MAP[host];

  // Random Vercel branch preview URLs are not registered in Discord.
  // Send them through the stable Testing domain, which is registered.
  if (!mappedRedirectUri && isVercelBranchPreviewHost(host)) {
    const returnTo = String(
      Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer || "/descent"
    );
    const canonicalLoginUrl = new URL("/api/auth/discord/login", `https://${TESTING_HOST}`);
    canonicalLoginUrl.searchParams.set("returnTo", returnTo);
    return res.redirect(canonicalLoginUrl.toString());
  }

  // Look up registered redirect URI for this host, fall back to env var
  const envRedirectUri = process.env.DISCORD_REDIRECT_URI || "";
  const redirectUri =
    mappedRedirectUri ||
    envRedirectUri ||
    `https://${host}/api/auth/discord/callback`;

  // If an unknown host falls back to a different callback host, bounce the login
  // to that callback host first. Otherwise the state cookie is set on one domain, but
  // Discord returns to another domain, causing "Invalid state".
  if (!mappedRedirectUri && envRedirectUri) {
    try {
      const redirectOrigin = new URL(envRedirectUri).origin;
      if (redirectOrigin !== requestOrigin) {
        const returnTo = String(
          Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer || "/"
        );
        const canonicalLoginUrl = new URL("/api/auth/discord/login", redirectOrigin);
        canonicalLoginUrl.searchParams.set("returnTo", returnTo);
        return res.redirect(canonicalLoginUrl.toString());
      }
    } catch {
      // If envRedirectUri is malformed, continue to the normal error path below.
    }
  }

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const returnTo = String(
    req.query.returnTo ||
    (Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer || "/")
  );

  res.setHeader("Set-Cookie", [
    `ra_discord_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    `ra_return_to=${encodeURIComponent(returnTo)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
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
