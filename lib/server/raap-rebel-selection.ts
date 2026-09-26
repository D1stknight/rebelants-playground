import { createHmac, randomBytes } from "node:crypto";

export interface PlaygroundRebelSelection {
  selectionId: string; issuerId: "rebel.playground"; status: "ACTIVE";
  asset: { sourceChainId: string; collection: string; tokenId: string; raapId: string };
  controller: string; controllerEpoch: number; validAfter: number; validUntil: number; publicExperienceConsent: true;
}
function deny(): never { throw Error("PLAYGROUND_REBEL_CONNECTION_UNAVAILABLE"); }
function exact(value: any, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()) deny();
}
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" :
    "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
/** Explicit server connection, not an environment fallback or a gameplay login.
 * Read-only lookup confirms RAAP's selected NFT/consent. It cannot prove that a
 * player completed a match, issue rewards or authorize a move/payment. */
export function createPlaygroundRebelSelectionReader(options: { raapOrigin: string; playgroundOrigin: string;
  key: Uint8Array; handoffKey?: Uint8Array; validUntil: number; now(): number; transport?: typeof fetch }) {
  for (const origin of [options.raapOrigin, options.playgroundOrigin]) {
    const u = new URL(origin); if (u.protocol !== "https:" || u.origin !== origin) deny();
  }
  if (options.raapOrigin === options.playgroundOrigin || options.key.length !== 32 || !options.key.some(v => v !== 0) ||
    !Number.isSafeInteger(options.validUntil)) deny();
  const key = Buffer.from(options.key), transport = options.transport ?? fetch;
  const handoffKey = options.handoffKey ? Buffer.from(options.handoffKey) : undefined;
  if (handoffKey && (handoffKey.length !== 32 || !handoffKey.some(v => v !== 0) || handoffKey.equals(key))) deny();
  let closed = false;
  async function request(selectionId: string, ticket?: string): Promise<PlaygroundRebelSelection> {
      const at = options.now();
      if (closed || !Number.isSafeInteger(at) || at <= 0 || at + 30 > options.validUntil ||
        !/^0x[0-9a-f]{64}$/.test(selectionId) || /^0x0+$/.test(selectionId)) deny();
      if (ticket !== undefined && (!handoffKey || !/^[0-9a-f]{64}$/.test(ticket))) deny();
      const request = { operation: ticket === undefined ? "SOURCE_SELECTION" : "SOURCE_CONNECT", payload: { selectionId, playgroundOrigin: options.playgroundOrigin,
        nonce: "0x" + randomBytes(32).toString("hex"), issuedAt: at, validUntil: at + 30, ...(ticket === undefined ? {} : { ticket }) } };
      const signature = createHmac("sha256", ticket === undefined ? key : handoffKey!).update(canonical(request)).digest("hex");
      const response = await transport(options.raapOrigin + "/api/r7/playground-source", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ request, signature }),
        credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body) deny();
      const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length;
        if (size > 8192) deny(); chunks.push(next.value); }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
      const body = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)));
      exact(body, ["data"]); const d = body.data; exact(d, ["selection", "nonce", "observedAt"]);
      const s = d.selection; exact(s, ["selectionId", "issuerId", "status", "asset", "controller", "controllerEpoch", "validAfter", "validUntil", "publicExperienceConsent"]);
      exact(s.asset, ["sourceChainId", "collection", "tokenId", "raapId"]);
      const end = options.now();
      if (closed || !Number.isSafeInteger(end) || end < at || end >= at + 30 || d.nonce !== request.payload.nonce ||
        !Number.isSafeInteger(d.observedAt) || d.observedAt < at || d.observedAt > end || s.selectionId !== selectionId ||
        s.issuerId !== "rebel.playground" || s.status !== "ACTIVE" || s.publicExperienceConsent !== true ||
        typeof s.asset.sourceChainId !== "string" || !/^[1-9][0-9]{0,14}$/.test(s.asset.sourceChainId) ||
        typeof s.asset.collection !== "string" || !/^0x[0-9a-f]{40}$/.test(s.asset.collection) ||
        typeof s.asset.tokenId !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(s.asset.tokenId) ||
        typeof s.asset.raapId !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{1,127}$/.test(s.asset.raapId) ||
        typeof s.controller !== "string" || !/^0x[0-9a-f]{40}$/.test(s.controller) ||
        !Number.isSafeInteger(s.controllerEpoch) || s.controllerEpoch < 1 || !Number.isSafeInteger(s.validAfter) ||
        s.validAfter > end || !Number.isSafeInteger(s.validUntil) || s.validUntil <= end) deny();
      return s;
  }
  return {
    close() { closed = true; key.fill(0); handoffKey?.fill(0); },
    read: (selectionId: string) => request(selectionId),
    consume: (selectionId: string, ticket: string) => request(selectionId, ticket),
  };
}
