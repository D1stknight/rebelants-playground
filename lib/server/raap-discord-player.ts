import { createHmac, timingSafeEqual } from "node:crypto";

const NAME = "__Host-raap-game-player";
const DOMAIN = "playground.discord-player.v1\0";
export const clearRaapDiscordPlayer = `${NAME}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
type Settings = { key: Uint8Array; origin: string; validUntil: number; now(): number };

function settings(input: Settings) {
  const origin = new URL(input.origin), at = input.now();
  if (origin.protocol !== "https:" || origin.origin !== input.origin || input.key.length !== 32 ||
    !input.key.some(value => value !== 0) || !Number.isSafeInteger(at) || at <= 0 ||
    !Number.isSafeInteger(input.validUntil) || input.validUntil <= at) throw Error("PLAYGROUND_PLAYER_UNAVAILABLE");
  return at;
}
const mac = (body: string, input: Settings) => createHmac("sha256", input.key).update(DOMAIN + body).digest();

/** Only the successful server-to-Discord OAuth callback may issue this receipt.
 * The legacy JSON profile cookie remains display data, never evidence of a
 * player's identity. This receipt does not authorize an Economy payment. */
export function raapDiscordPlayerCookie(discordUserId: string, input: Settings): string {
  const issuedAt = settings(input), validUntil = Math.min(input.validUntil, issuedAt + 86400);
  if (!/^[1-9][0-9]{16,19}$/.test(discordUserId)) throw Error("PLAYGROUND_PLAYER_UNAVAILABLE");
  const body = Buffer.from(JSON.stringify({ playerId: `discord:${discordUserId}`, origin: input.origin, issuedAt, validUntil })).toString("base64url");
  return `${NAME}=${body}.${mac(body, input).toString("base64url")}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${validUntil - issuedAt}`;
}

export function readRaapDiscordPlayer(cookie: string, input: Settings): string | undefined {
  try {
    const at = settings(input), found = cookie.split(";").map(x => x.trim()).filter(x => x.startsWith(NAME + "="));
    if (found.length !== 1) return;
    const parts = found[0].slice(NAME.length + 1).split(".");
    if (parts.length !== 2 || parts[0].length > 1024 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return;
    const signature = Buffer.from(parts[1], "base64url");
    if (signature.length !== 32 || !timingSafeEqual(signature, mac(parts[0], input))) return;
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!value || Object.keys(value).sort().join() !== "issuedAt,origin,playerId,validUntil" || value.origin !== input.origin ||
      !/^discord:[1-9][0-9]{16,19}$/.test(value.playerId) || !Number.isSafeInteger(value.issuedAt) || value.issuedAt > at ||
      !Number.isSafeInteger(value.validUntil) || value.validUntil <= at || value.validUntil > input.validUntil ||
      value.validUntil > value.issuedAt + 86400) return;
    return value.playerId;
  } catch { return; }
}

/** Explicit RAAP opt-in only; no fallback to Discord/Economy/provider secrets. */
export function raapDiscordPlayerSettings(env: NodeJS.ProcessEnv, now = () => Math.floor(Date.now() / 1000)): Settings | undefined {
  try {
    if (env.RAAP_REBEL_CONNECTION_ENABLED !== "true" || !/^[0-9a-f]{64}$/.test(env.RAAP_REBEL_COOKIE_KEY_HEX ?? "")) return;
    const input = { key: Buffer.from(env.RAAP_REBEL_COOKIE_KEY_HEX!, "hex"), origin: env.RAAP_REBEL_PLAYGROUND_ORIGIN!,
      validUntil: Number(env.RAAP_REBEL_CONNECTION_VALID_UNTIL), now };
    settings(input); return input;
  } catch { return; }
}
