import type { NextApiRequest, NextApiResponse } from "next";

function getCookie(req: NextApiRequest, name: string) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  const hit = parts.find((p) => p.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.split("=").slice(1).join("=")) : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send("Missing Discord env vars");
  }

  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const stateCookie = getCookie(req, "ra_discord_state");

  if (!code) return res.status(400).send("Missing code");
  if (!state || !stateCookie || state !== stateCookie) {
    return res.status(400).send("Invalid state");
  }

  // exchange code -> token
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenJson: any = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenJson?.access_token) {
    return res.status(400).send("Token exchange failed");
  }

  // fetch user identity
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });

  const me: any = await meRes.json().catch(() => null);
  if (!meRes.ok || !me?.id) {
    return res.status(400).send("Failed to fetch Discord user");
  }

  const discordUserId = String(me.id);
  const discordName = String(me.global_name || me.username || "discord");

  // ✅ set session cookie (httpOnly) so client cannot spoof
  // also clear state cookie
  res.setHeader("Set-Cookie", [
    `ra_discord_user=${encodeURIComponent(JSON.stringify({ discordUserId, discordName }))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    `ra_discord_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ]);

  // go back to Shuffle
  const returnTo = (typeof state === "object" && state?.returnTo) ? String(state.returnTo) : "/";
  res.redirect(appUrl ? `${appUrl}${returnTo}?discord=1` : `${returnTo}?discord=1`);
}
