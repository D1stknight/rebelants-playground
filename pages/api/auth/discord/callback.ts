import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send("Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET");
  }

  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const stateCookie = req.cookies["ra_discord_state"] || "";

  if (!code) return res.status(400).send("Missing code");
  if (!state || !stateCookie || state !== stateCookie) {
    return res.status(400).send("Invalid state");
  }

  // Use the exact redirect URI that was stored during login
  const storedRedir = req.cookies["ra_discord_redir"];
  const redirectUri = storedRedir
    ? decodeURIComponent(storedRedir)
    : process.env.DISCORD_REDIRECT_URI || "";

  if (!redirectUri) return res.status(500).send("Missing redirect URI");

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
    return res.status(400).send("Token exchange failed: " + JSON.stringify(tokenJson));
  }

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });

  const me: any = await meRes.json().catch(() => null);
  if (!meRes.ok || !me?.id) {
    return res.status(400).send("Failed to fetch Discord user");
  }

  const discordUserId = String(me.id);
  const discordName = String(me.global_name || me.username || "discord");

  res.setHeader("Set-Cookie", [
    `ra_discord_user=${encodeURIComponent(JSON.stringify({ discordUserId, discordName }))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    `ra_discord_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `ra_discord_redir=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ]);

  // Always redirect back to the host the callback came in on
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const rawReturn = (() => { try { return decodeURIComponent(String(req.cookies?.ra_return_to || "/")); } catch { return "/"; } })();
  const returnPath = (() => { try { return new URL(rawReturn).pathname || "/"; } catch { return rawReturn.startsWith("/") ? rawReturn : "/"; } })();

  res.redirect(`${proto}://${host}${returnPath}?discord=1`);
}
