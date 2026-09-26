import { readRaapDiscordPlayer } from "./raap-discord-player.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createPlaygroundRebelSelectionReader, type PlaygroundRebelSelection } from "./raap-rebel-selection.js";

const COOKIE = "__Host-raap-experience";
function deny(): never { throw Error("PLAYGROUND_CONNECTION_UNAVAILABLE"); }
type Session = { selectionId: string; controller: string; epoch: number; validUntil: number };

/** Local proof of the original signed connection only. This is NOT current
 * ownership/consent: delivery must still call authenticate/getSelection. It lets
 * the game attribute its own requests without a blockchain read per move. */
export function inspectPlaygroundLearningSession(request: Request, options: { cookieKey: Uint8Array; validUntil: number; now(): number }): Session {
    if (!Number.isSafeInteger(options.validUntil) || options.cookieKey.length !== 32 || !options.cookieKey.some(v => v !== 0) || !Number.isSafeInteger(options.now()) || options.now() <= 0 || options.now() >= options.validUntil) deny();
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(COOKIE + "="));
    if (cookies.length !== 1) deny();
    const parts = cookies[0].slice(COOKIE.length + 1).split(".");
    if (parts.length !== 2 || parts[0].length > 1024 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) deny();
    const signature = Buffer.from(parts[1], "base64url");
    if (signature.length !== 32 || !timingSafeEqual(signature, createHmac("sha256", options.cookieKey).update("playground.owner-experience.v1\0" + parts[0]).digest())) deny();
    const s = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!s || Object.keys(s).sort().join() !== "controller,epoch,selectionId,validUntil" ||
      typeof s.selectionId !== "string" || !/^0x[0-9a-f]{64}$/.test(s.selectionId) ||
      typeof s.controller !== "string" || !/^0x[0-9a-f]{40}$/.test(s.controller) ||
      !Number.isSafeInteger(s.epoch) || s.epoch < 1 || !Number.isSafeInteger(s.validUntil) || s.validUntil <= options.now() || s.validUntil > options.validUntil) deny();
    return s;
  }

/** An optional learning connection only. Never used as authority for legacy
 * game moves, Economy identity, scores, rewards or chat. Every read rechecks
 * RAAP's current consent/owner; possession of an old cookie is insufficient. */
export function createPlaygroundPlayerConnection(options: Parameters<typeof createPlaygroundRebelSelectionReader>[0] & {
  cookieKey: Uint8Array;
}) {
  if (!options.handoffKey || options.cookieKey.length !== 32 || !options.cookieKey.some(v => v !== 0) ||
    Buffer.from(options.cookieKey).equals(Buffer.from(options.key)) || Buffer.from(options.cookieKey).equals(Buffer.from(options.handoffKey))) deny();
  const source = createPlaygroundRebelSelectionReader(options), cookieKey = Buffer.from(options.cookieKey);
  let closed = false;
  function mac(value: string) { return createHmac("sha256", cookieKey).update("playground.owner-experience.v1\0" + value).digest(); }
  function live() { const at = options.now(); if (closed || !Number.isSafeInteger(at) || at <= 0 || at >= options.validUntil) deny(); return at; }
  function encode(selection: PlaygroundRebelSelection) {
    const record: Session = { selectionId: selection.selectionId, controller: selection.controller,
      epoch: selection.controllerEpoch, validUntil: Math.min(selection.validUntil, options.validUntil) };
    const body = Buffer.from(JSON.stringify(record)).toString("base64url");
    return { value: body + "." + mac(body).toString("base64url"), record };
  }
  function decode(request: Request) {
    live(); return inspectPlaygroundLearningSession(request, { cookieKey, validUntil: options.validUntil, now: options.now });
  }
  async function authenticate(request: Request): Promise<PlaygroundRebelSelection> {
    live(); const s = decode(request), current = await source.read(s.selectionId);
    if (current.controller !== s.controller || current.controllerEpoch !== s.epoch ||
      s.validUntil > current.validUntil || live() >= s.validUntil) deny();
    return current;
  }
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  return {
    authenticate,
    async authenticatePlayer(request: Request, playerId: string) {
      // The caller supplies an identity to compare, never a trusted profile.
      // Both OAuth and the selected-owner receipt must belong to this request.
      if (typeof playerId !== "string" || request.headers.get("origin") !== options.playgroundOrigin ||
        request.headers.get("sec-fetch-site") !== "same-origin") deny();
      const identity = decode(request);
      const discord = readRaapDiscordPlayer(request.headers.get("cookie") ?? "", {
        key: cookieKey, origin: options.playgroundOrigin, validUntil: options.validUntil, now: options.now,
      });
      if (playerId !== `wallet:${identity.controller}` && playerId !== discord) deny();
      return authenticate(request);
    },
    close() { closed = true; source.close(); cookieKey.fill(0); },
    async handle(request: Request) {
      try {
        const url = new URL(request.url); live();
        if (url.origin !== options.playgroundOrigin || url.pathname !== "/api/raap/connection" || url.search || url.hash || request.headers.has("content-encoding")) deny();
        if (request.method === "POST") {
          if (request.headers.get("origin") !== options.raapOrigin ||
            request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") deny();
          const reader = request.body?.getReader(); if (!reader) deny();
          let size = 0; const chunks: Uint8Array[] = [];
          try { for (;;) { const next = await reader.read(); if (next.done) break;
            size += next.value.length; if (size > 1024) deny(); chunks.push(next.value); }
          } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
          const form = new URLSearchParams(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)));
          if ([...form.keys()].sort().join() !== "selectionId,ticket") deny();
          const selection = await source.consume(form.get("selectionId")!, form.get("ticket")!);
          const session = encode(selection), age = session.record.validUntil - live(); if (age <= 0 || age > 86400) deny();
          return new Response(null, { status: 303, headers: { ...headers, location: "/faction-wars",
            "set-cookie": `${COOKIE}=${session.value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}` } });
        }
        if (request.headers.get("origin") && request.headers.get("origin") !== options.playgroundOrigin ||
          request.headers.get("sec-fetch-site") !== "same-origin") deny();
        if (request.method === "GET") {
          const selection = await authenticate(request);
          return Response.json({ connected: true, asset: selection.asset, validUntil: selection.validUntil,
            actor: "OWNER_PLAYED", gameplayAuthority: false }, { headers });
        }
        if (request.method === "DELETE" && request.headers.get("origin") === options.playgroundOrigin) {
          return Response.json({ connected: false, raapPermissionRevoked: false }, { headers: { ...headers,
            "set-cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` } });
        }
        deny();
      } catch { return Response.json({ error: "PLAYGROUND_CONNECTION_UNAVAILABLE" }, { status: 403, headers }); }
    },
  };
}
