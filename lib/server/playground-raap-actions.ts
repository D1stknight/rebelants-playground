import { createHmac, timingSafeEqual } from "node:crypto";
import { FACTIONS, TEAM_SIZE } from "../factionWarsCore";
import type { createPlaygroundActions, PlaygroundActionRequest } from "./raap-pvp-actions";
import { canonicalPlaygroundAction } from "./raap-pvp-actions";
function deny(): never { throw Error("PLAYGROUND_ACTION_UNAVAILABLE"); }
function exact(v: any, keys: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== [...keys].sort().join()) deny();
}
function address(v: unknown) { if (typeof v !== "string" || !/^0x[0-9a-f]{40}$/.test(v)) deny(); }
function hash(v: unknown) { if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/.test(v)) deny(); }
function integer(v: unknown, min = 0) { if (!Number.isSafeInteger(v) || Number(v) < min) deny(); }
/** Separate action credential. The existing read/quote credential cannot execute.
 * Current ownership, per-action wallet signature and account pause are enforced
 * by the RAAP worker before it authenticates this exact one-command request. */
export function createPlaygroundRaapActionsHandler(input: {
  key: Uint8Array; collection: string; validUntil: number; now(): number;
  actions: ReturnType<typeof createPlaygroundActions>;
}) {
  const key = Buffer.from(input.key); address(input.collection); integer(input.validUntil,1);
  if (key.length !== 32 || !key.some(v => v !== 0)) deny();
  return async (http: Request): Promise<Response> => {
    const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status,
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    try {
      if (http.method !== "POST" || http.headers.get("content-type") !== "application/json" || http.headers.has("cookie") ||
        http.headers.has("origin") || http.headers.has("content-encoding") || new URL(http.url).search || !http.body) deny();
      const reader = http.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
      try { for (;;) { const r = await reader.read(); if (r.done) break; length += r.value.length;
        if (length > 4096) { await reader.cancel(); deny(); } chunks.push(r.value); } } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks), signature = http.headers.get("x-raap-auth") ?? "";
      if (!/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature,"hex"),createHmac("sha256",key).update(bytes).digest())) deny();
      const r = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const execute = r.operation === "EXECUTE";
      exact(r, ["schema", "operation", "commandId", "asset", "controller", "epoch", "account", "contextCommitment", "challengeId", "issuedAt", "validUntil",
        ...(execute ? ["stateCommitment", "configurationCommitment", "action", "maximumAdditionalPoints"] : [])]);
      exact(r.asset, ["chainId", "collection", "tokenId"]);
      if (r.schema !== "playground.raap.action.v1" || !["EXECUTE", "RECEIPT"].includes(r.operation) ||
        r.asset.chainId !== 1 || r.asset.collection !== input.collection || typeof r.asset.tokenId !== "string" ||
        !/^(0|[1-9][0-9]{0,77})$/.test(r.asset.tokenId) || typeof r.challengeId !== "string" || !/^[a-z0-9]{12}$/.test(r.challengeId)) deny();
      address(r.controller); address(r.account); hash(r.contextCommitment); hash(r.commandId); integer(r.epoch,1);
      integer(r.issuedAt,1); integer(r.validUntil,1);
      const at = input.now();
      if (r.issuedAt > at || at >= r.validUntil || r.validUntil-r.issuedAt > 30000) deny();
      // Receipt reads remain possible after the operation term; they authorize
      // no replay and still require current ownership through the worker.
      if (!execute) {
        const found = await input.actions.read(r.commandId);
        if (found && (found.request.challengeId !== r.challengeId || found.request.controller !== r.controller ||
          found.request.epoch !== r.epoch || found.request.account !== r.account ||
          canonicalPlaygroundAction(found.request.asset) !== canonicalPlaygroundAction(r.asset))) deny();
        return reply(200, { receipt: found?.receipt ?? null });
      }
      if (at >= input.validUntil || r.validUntil > input.validUntil) deny();
      hash(r.stateCommitment); integer(r.maximumAdditionalPoints);
      exact(r.action, r.action?.kind === "SELECT_TEAM" ? ["kind", "team"] : r.action?.kind === "MOVE" ? ["kind", "moveId"] : ["kind"]);
      if (r.action.kind === "SELECT_TEAM") {
        if (!Array.isArray(r.action.team) || r.action.team.length !== TEAM_SIZE || new Set(r.action.team).size !== TEAM_SIZE ||
          r.action.team.some((v: unknown) => typeof v !== "string" || !Object.hasOwn(FACTIONS,v)) ||
          r.configurationCommitment !== null || r.maximumAdditionalPoints !== 0) deny();
      } else if (r.action.kind === "MOVE") {
        if(typeof r.action.moveId!=="string"||!/^[a-z0-9_]{1,64}$/.test(r.action.moveId)||r.configurationCommitment!==null||r.maximumAdditionalPoints!==0)deny();
      } else if (r.action.kind === "HEAL") hash(r.configurationCommitment);
      else deny();
      const receipt = await input.actions.execute(r as PlaygroundActionRequest);
      return reply(200, { receipt });
    } catch { return reply(403, { error: "PLAYGROUND_ACTION_UNAVAILABLE" }); }
  };
}
