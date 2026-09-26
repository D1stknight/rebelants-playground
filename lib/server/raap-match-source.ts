import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { readPlaygroundCompletedExperience, type PlaygroundCompletedExperience } from "./raap-fwpvp-experience";
import type { PlaygroundRebelSelection } from "./raap-rebel-selection";
import { createPlaygroundRebelSelectionReader } from "./raap-rebel-selection";

/** A game fact, deliberately without an XP amount or badge rule. The separate
 * RAAP issuer selects an admitted rule before its own history delivery. */
export interface PlaygroundMatchFact {
  schema: "rebel.playground.completed-experience.v1";
  issuerId: "rebel.playground";
  keyId: string;
  snapshot: PlaygroundCompletedExperience;
  observedAt: number;
  signature: `0x${string}`;
}
type Store = {
  get<T>(key: string): Promise<T | null>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
};
type Saved = { challengeId: string; playerId: string; selection: PlaygroundRebelSelection; fact: PlaygroundMatchFact };
const deny = (): never => { throw Error("PLAYGROUND_MATCH_SOURCE_UNAVAILABLE"); };
const factKey = (digest: string) => `ra:raap:match-fact:${digest}`;
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" :
    "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
function signingBytes(fact: PlaygroundMatchFact) {
  const { signature: _signature, ...document } = fact;
  return Buffer.from(canonical(document));
}
// Persist only if the exact observed match attribution still exists. A source
// activity is globally bound to one selected Rebel, irrespective of rule/owner.
// The record expires with its underlying evidence, never later.
const SAVE_FACT = `
local game = redis.call('GET', KEYS[1])
local evidence = redis.call('GET', KEYS[2])
if not game or not evidence then return '' end
local ok, record = pcall(cjson.decode, evidence)
if not ok or record.intact ~= true or game ~= ARGV[1] or evidence ~= ARGV[2] then return '' end
local existing = redis.call('GET', KEYS[3])
if existing then return existing end
local ttl = math.min(redis.call('TTL', KEYS[1]), redis.call('TTL', KEYS[2]), tonumber(ARGV[4]))
if ttl < 1 then return '' end
redis.call('SET', KEYS[3], ARGV[3], 'EX', ttl, 'NX')
return redis.call('GET', KEYS[3]) or ''
`;

/** Dedicated source key only; no discovery, key generation, reward or game
 * mutation. A configured constructor does not enable this path by itself. */
export function createPlaygroundMatchSource(options: {
  keyId: string; privateKeyPem?: string; publicKeyHex: string;
  activatedAt: number; validUntil: number; now(): number; store: Store;
  selection(id: string): Promise<PlaygroundRebelSelection>;
}) {
  if (!/^0x[0-9a-f]{64}$/.test(options.publicKeyHex)) deny();
  const key = options.privateKeyPem ? createPrivateKey(options.privateKeyPem) : undefined;
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(options.publicKeyHex.slice(2), "hex")]), format: "der", type: "spki" });
  if (key && (key.asymmetricKeyType !== "ed25519" || !createPublicKey(key).equals(publicKey)) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.keyId) ||
    "0x" + publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex") !== options.publicKeyHex ||
    !Number.isSafeInteger(options.activatedAt) || options.activatedAt < 1 ||
    !Number.isSafeInteger(options.validUntil) || options.validUntil <= options.activatedAt) deny();
  function fresh() {
    const at = options.now();
    if (!Number.isSafeInteger(at) || at < options.activatedAt || at >= options.validUntil) deny();
    return at;
  }
  async function observe(challengeId: string, playerId: string, selectionId: string) {
    fresh();
    const selection = await options.selection(selectionId);
    if (selection.selectionId !== selectionId) deny();
    const snapshot = await readPlaygroundCompletedExperience({ challengeId, playerId, selection, now: options.now, store: options.store });
    if (snapshot.completedAt < options.activatedAt) deny();
    fresh(); return { snapshot, selection };
  }
  function saved(value: unknown): Saved {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (!raw || Buffer.byteLength(raw) > 8192) deny();
    const result = JSON.parse(raw) as Saved, fact = result?.fact;
    if (!fact || fact.schema !== "rebel.playground.completed-experience.v1" || fact.issuerId !== "rebel.playground" ||
      fact.keyId !== options.keyId || !Number.isSafeInteger(fact.observedAt) || fact.observedAt < options.activatedAt ||
      fact.observedAt > fresh() || !/^0x[0-9a-f]{128}$/.test(fact.signature) ||
      !verify(null, signingBytes(fact), publicKey, Buffer.from(fact.signature.slice(2), "hex"))) deny();
    return result;
  }
  return {
    deliveryRequest(fact: PlaygroundMatchFact, playgroundOrigin: string) {
      if (!key || new URL(playgroundOrigin).origin !== playgroundOrigin || !playgroundOrigin.startsWith("https://") ||
        fact.keyId !== options.keyId || !verify(null, signingBytes(fact), publicKey, Buffer.from(fact.signature.slice(2), "hex"))) deny();
      const at = fresh(), validUntil = Math.min(at + 30, options.validUntil);
      const request = { operation: "SOURCE_EXPERIENCE", payload: { sourceActivityDigest: fact.snapshot.sourceActivityDigest,
        selectionId: fact.snapshot.selectionId, playgroundOrigin, keyId: options.keyId,
        nonce: "0x" + randomBytes(32).toString("hex"), issuedAt: at, validUntil } };
      return { request, signature: "0x" + sign(null,
        Buffer.from(canonical({ domain: "rebel.playground.experience-delivery.v1", request })), key!).toString("hex") };
    },
    async issue(challengeId: string, playerId: string, selectionId: string) {
      if (!key) deny();
      const { snapshot, selection } = await observe(challengeId, playerId, selectionId);
      const fact: PlaygroundMatchFact = { schema: "rebel.playground.completed-experience.v1", issuerId: "rebel.playground",
        keyId: options.keyId, snapshot, observedAt: fresh(), signature: `0x${"00".repeat(64)}` };
      fact.signature = `0x${sign(null, signingBytes(fact), key!).toString("hex")}`;
      // Obtain original bytes again; a changed observation is not re-signed.
      const pair = await options.store.eval("return {redis.call('GET', KEYS[1]) or '', redis.call('GET', KEYS[2]) or ''}",
        [`ra:fwpvp:match:${challengeId}`, `ra:raap:fwpvp:experience:${challengeId}`], []);
      if (!Array.isArray(pair) || pair.length !== 2) deny();
      const [game, evidence] = pair as [unknown, unknown];
      const gameRaw = typeof game === "string" ? game : JSON.stringify(game);
      const raw = typeof evidence === "string" ? evidence : JSON.stringify(evidence);
      if (!raw || !gameRaw || Buffer.byteLength(gameRaw) > 262144 || Buffer.byteLength(raw) > 8192) deny();
      if ("0x" + createHash("sha256").update(raw).digest("hex") !== snapshot.evidenceDigest) deny();
      const record = JSON.parse(raw);
      if ("0x" + createHash("sha256").update(gameRaw).digest("hex") !== record.matchDigest) deny();
      const result = saved(await options.store.eval(SAVE_FACT,
        [`ra:fwpvp:match:${challengeId}`, `ra:raap:fwpvp:experience:${challengeId}`, factKey(snapshot.sourceActivityDigest)],
        [gameRaw, raw, JSON.stringify({ challengeId, playerId, selection, fact }), options.validUntil - fresh()]));
      if (result.challengeId !== challengeId || result.playerId !== playerId || canonical(result.fact.snapshot) !== canonical(snapshot)) deny();
      // Recheck the stored game result after the claim. RAAP independently checks
      // current ownership/consent before history delivery; this is only a fact.
      if (canonical(await readPlaygroundCompletedExperience({ challengeId, playerId, selection,
        now: options.now, store: options.store })) !== canonical(snapshot)) deny();
      fresh();
      return result.fact;
    },
    async read(sourceActivityDigest: string) {
      if (!/^0x[0-9a-f]{64}$/.test(sourceActivityDigest)) deny();
      fresh(); const raw = await options.store.get<string | Saved>(factKey(sourceActivityDigest));
      if (!raw) return undefined;
      const result = saved(raw);
      if (result.fact.snapshot.sourceActivityDigest !== sourceActivityDigest ||
        canonical(await readPlaygroundCompletedExperience({ challengeId: result.challengeId, playerId: result.playerId,
          selection: result.selection, now: options.now, store: options.store })) !== canonical(result.fact.snapshot)) deny();
      // The retained selection is historical attribution, not current consent.
      // Reading evidence does not call back to RAAP or consume more owner RPCs.
      // The receiving admission performs the live permission/epoch check.
      fresh();
      return result.fact;
    },
  };
}

/** One explicit server delivery after the owner-consented completion. No retry
 * or success assumption after a lost response. Ordinary game/payout calls are
 * never routed here. The receiver still verifies its own source and rules. */
export async function deliverPlaygroundMatchFact(options: {
  raapOrigin: string; body: ReturnType<ReturnType<typeof createPlaygroundMatchSource>["deliveryRequest"]>;
  transport?: typeof fetch;
}) {
  const origin = new URL(options.raapOrigin);
  if (origin.protocol !== "https:" || origin.origin !== options.raapOrigin) deny();
  const response = await (options.transport ?? fetch)(options.raapOrigin + "/api/r7/playground-source", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options.body),
    redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(25000),
  });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body) deny();
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length;
    if (size > 4096) deny(); chunks.push(next.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  const value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)));
  const data = value?.data, p = options.body.request.payload;
  if (!value || Object.keys(value).join() !== "data" || !data ||
    Object.keys(data).sort().join() !== "lifeRecorded,selectionId,sourceActivityDigest,status" ||
    data.selectionId !== p.selectionId || data.sourceActivityDigest !== p.sourceActivityDigest ||
    data.status !== "RECORDED" && data.status !== "NOT_CONFIRMED" || data.lifeRecorded !== (data.status === "RECORDED")) deny();
  return data as { selectionId: string; sourceActivityDigest: string; status: "RECORDED" | "NOT_CONFIRMED"; lifeRecorded: boolean };
}

/** Optional production binding. No defaults and no live key is installed by
 * this code. Readers need the public key only; issuance needs the separate PEM. */
export function configuredPlaygroundMatchSource(env: NodeJS.ProcessEnv, store: Store, issuance: boolean) {
  if (env.RAAP_REBEL_MATCH_SOURCE_ENABLED !== "true") return undefined;
  if (env.RAAP_REBEL_CONNECTION_ENABLED !== "true" || env.RAAP_REBEL_MATCH_RECORDING_ENABLED !== "true" ||
    !env.RAAP_REBEL_ORIGIN || !env.RAAP_REBEL_PLAYGROUND_ORIGIN || !env.RAAP_REBEL_SOURCE_KEY_ID ||
    !env.RAAP_REBEL_SOURCE_PUBLIC_KEY || issuance && !env.RAAP_REBEL_SOURCE_PRIVATE_KEY_PEM ||
    !/^[0-9a-f]{64}$/.test(env.RAAP_REBEL_SELECTION_KEY_HEX ?? "")) deny();
  const now = () => Math.floor(Date.now() / 1000), validUntil = Number(env.RAAP_REBEL_CONNECTION_VALID_UNTIL);
  const reader = issuance ? createPlaygroundRebelSelectionReader({ raapOrigin: env.RAAP_REBEL_ORIGIN!, playgroundOrigin: env.RAAP_REBEL_PLAYGROUND_ORIGIN!,
    key: Buffer.from(env.RAAP_REBEL_SELECTION_KEY_HEX!, "hex"), validUntil, now }) : undefined;
  try {
    const source = createPlaygroundMatchSource({ keyId: env.RAAP_REBEL_SOURCE_KEY_ID!,
      publicKeyHex: env.RAAP_REBEL_SOURCE_PUBLIC_KEY!, privateKeyPem: issuance ? env.RAAP_REBEL_SOURCE_PRIVATE_KEY_PEM : undefined,
      activatedAt: Number(env.RAAP_REBEL_SOURCE_ACTIVATED_AT), validUntil, now, store, selection: id => reader ? reader.read(id) : Promise.reject(Error("READ_ONLY_SOURCE")) });
    return { ...source, close: () => reader?.close() };
  } catch (error) { reader?.close(); throw error; }
}
