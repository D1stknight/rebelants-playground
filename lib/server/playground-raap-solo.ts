import { createHmac, timingSafeEqual } from "node:crypto";
import { advanceSoloCampaign, type SoloCommand } from "../factionWarsSoloCampaign";
import { FACTIONS } from "../factionWarsSoloRules";
import type { createSoloCampaignService, SoloSession } from "./raap-fwsolo";
import { soloCanonical, soloDigest, soloCommandKey, soloActionRecord, parseSoloActionRecord,
  type SoloReviewedCommand } from "./raap-solo-protocol";

type Store = Parameters<typeof createSoloCampaignService>[0]["store"];
function deny(): never { throw Error("PLAYGROUND_SOLO_UNAVAILABLE"); }
function exact(v: any, fields: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== [...fields].sort().join()) deny();
}
function integer(v: unknown, min = 0) { if (!Number.isSafeInteger(v) || Number(v) < min) deny(); }
function address(v: unknown) { if (typeof v !== "string" || !/^0x[0-9a-f]{40}$/.test(v)) deny(); }
function digest(v: unknown) { if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/.test(v)) deny(); }
function action(v: any): asserts v is SoloCommand {
  exact(v, v?.kind === "MOVE" ? ["kind", "moveId"] : ["kind"]);
  if (v.kind === "MOVE") { if (typeof v.moveId !== "string" || !/^[a-z0-9_]{1,64}$/.test(v.moveId)) deny(); }
  else if (v.kind !== "HEAL" && v.kind !== "NEXT") deny();
}
export function soloMoveQuote(s: SoloSession, command: SoloCommand) {
  if (s.pending || s.abandoned || s.state.phase === "final_result") deny();
  // A pure simulation checks the unchanged rules; it sends no point intent.
  const { effects } = advanceSoloCampaign(s.state, command, s.config, () => 0.5);
  return effects.filter(e => e.direction === "DEBIT").reduce((sum, e) => sum + e.amount, 0);
}
function view(s: SoloSession, at: number) {
  const available = !s.pending && !s.abandoned && at < Math.min(s.validUntil, s.selected.validUntil) * 1000;
  const allowed = (command: SoloCommand) => { try { if (!available) return false; soloMoveQuote(s, command); return true; } catch { return false; } };
  const moves = s.state.phase === "battle" ? FACTIONS[s.state.team[s.state.territory]].moves
    .filter(m => allowed({ kind: "MOVE", moveId: m.id })).map(m => ({ id: m.id, label: m.label, type: m.type })) : [];
  return { challengeId: s.id, revision: s.revision, phase: s.state.phase, territory: s.state.territory,
    team: s.state.team, defenders: s.state.defenders, playerHp: s.state.playerHp, enemyHp: s.state.enemyHp,
    healsUsed: s.state.healUsed, healMaximum: s.config.healMaximum, healCost: s.config.healCost,
    moves, canHeal: allowed({ kind: "HEAL" }), canAdvance: allowed({ kind: "NEXT" }),
    held: s.pending !== null, abandoned: s.abandoned, validUntil: Math.min(s.validUntil, s.selected.validUntil) * 1000,
    raapActionCount: s.raapActionCount ?? 0 };
}

/** Reuses the existing campaign and Economy rules. Read and action credentials
 * remain separate. The saved authenticated selection supplies the player, so a
 * caller cannot redirect a move to another Discord account or campaign. */
export function createPlaygroundRaapSoloHandler(input: {
  readKey: Uint8Array; actionKey: Uint8Array; collection: string; validUntil: number;
  maximumAdditionalPoints: number; now(): number; store: Store; service: ReturnType<typeof createSoloCampaignService>;
}) {
  const readKey = Buffer.from(input.readKey), actionKey = Buffer.from(input.actionKey);
  if ([readKey, actionKey].some(k => k.length !== 32 || !k.some(v => v !== 0)) || readKey.equals(actionKey)) deny();
  address(input.collection); integer(input.validUntil, 1); integer(input.maximumAdditionalPoints);
  return async (http: Request): Promise<Response> => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status,
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    try {
      if (http.method !== "POST" || http.headers.get("content-type") !== "application/json" || http.headers.has("cookie") ||
        http.headers.has("origin") || http.headers.has("content-encoding") || new URL(http.url).search || !http.body) deny();
      const reader = http.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length;
        if (size > 4096) { await reader.cancel(); deny(); } chunks.push(item.value); } } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks), r = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const execute = r.operation === "EXECUTE", receiptRead = r.operation === "RECEIPT", quote = r.operation === "QUOTE";
      const signed = http.headers.get("x-raap-auth") ?? "", key = execute || receiptRead ? actionKey : readKey;
      if (!/^[0-9a-f]{64}$/.test(signed) || !timingSafeEqual(Buffer.from(signed, "hex"), createHmac("sha256", key).update(bytes).digest())) deny();
      exact(r, ["schema", "operation", "asset", "controller", "epoch", "account", "contextCommitment", "challengeId", "issuedAt", "validUntil",
        ...(execute ? ["commandId", "revision", "stateCommitment", "configurationCommitment", "action", "maximumAdditionalPoints"] : receiptRead ? ["commandId"] : quote ? ["action"] : [])]);
      exact(r.asset, ["chainId", "collection", "tokenId"]);
      if (r.schema !== (execute || receiptRead ? "playground.raap.solo-action.v1" : "playground.raap.solo-read.v1") ||
        !["OBSERVE", "QUOTE", "EXECUTE", "RECEIPT"].includes(r.operation) || r.asset.chainId !== 1 || r.asset.collection !== input.collection ||
        typeof r.asset.tokenId !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(r.asset.tokenId) ||
        typeof r.challengeId !== "string" || !/^[a-z0-9]{12}$/.test(r.challengeId)) deny();
      address(r.controller); address(r.account); digest(r.contextCommitment); integer(r.epoch, 1); integer(r.issuedAt, 1); integer(r.validUntil, 1);
      const at = input.now();
      if (r.issuedAt > at || at >= r.validUntil || r.validUntil - r.issuedAt > (execute ? 300000 : 30000)) deny();
      const binding = (saved: SoloReviewedCommand) => saved.challengeId === r.challengeId && saved.controller === r.controller &&
        saved.epoch === r.epoch && saved.account === r.account && soloCanonical(saved.asset) === soloCanonical(r.asset);
      if (execute || receiptRead) {
        digest(r.commandId);
        const stored = await input.store.get(soloCommandKey(r.commandId));
        if (stored) {
          const record = parseSoloActionRecord(stored);
          if (!binding(record.request) || execute && soloCanonical(record.request) !== soloCanonical(r)) deny();
          return reply(200, { receipt: record.receipt });
        }
        if (receiptRead) return reply(200, { receipt: null });
      }
      if (at >= input.validUntil || r.validUntil > input.validUntil) deny();
      const raw = await input.store.get<SoloSession | string>(`ra:raap:fwsolo:session:${r.challengeId}`);
      const s = typeof raw === "string" ? JSON.parse(raw) as SoloSession : raw;
      if (!s || s.schema !== "rebel.playground.solo-session.v1" || s.id !== r.challengeId ||
        !/^(discord:[1-9][0-9]{16,19}|wallet:0x[0-9a-f]{40})$/.test(s.playerId) ||
        s.selected.controller !== r.controller || s.selected.controllerEpoch !== r.epoch ||
        s.selected.asset.sourceChainId !== "1" || r.asset.collection !== s.selected.asset.collection || r.asset.tokenId !== s.selected.asset.tokenId || s.selected.validAfter * 1000 > at) deny();
      const expires = Math.min(input.validUntil, s.validUntil * 1000, s.selected.validUntil * 1000);
      if (quote || execute) { action(r.action); if (at >= expires) deny(); }
      if (execute) {
        integer(r.revision); integer(r.maximumAdditionalPoints); digest(r.stateCommitment); digest(r.configurationCommitment);
        if (r.maximumAdditionalPoints > input.maximumAdditionalPoints || r.validUntil > expires) deny();
        let valid = false;
        try { valid = r.revision === s.revision && r.stateCommitment === soloDigest(s) && r.configurationCommitment === soloDigest(s.config) &&
          r.maximumAdditionalPoints === soloMoveQuote(s, r.action); } catch { /* Save a terminal rejection, without an effect. */ }
        if (!valid) {
          const record = soloActionRecord(r);
          record.receipt = { ...record.receipt, status: "DECLINED", after: r.stateCommitment, additionalPoints: 0, committedAt: input.now() };
          const saved = await input.store.eval("local old=redis.call('GET',KEYS[1]); if old then return old end; redis.call('SET',KEYS[1],ARGV[1]); return ARGV[1]",
            [soloCommandKey(r.commandId)], [JSON.stringify(record)]);
          const retained = parseSoloActionRecord(saved);
          if (soloCanonical(retained.request) !== soloCanonical(r)) deny();
          return reply(200, { receipt: retained.receipt });
        }
        // The engine rechecks the exact revision and atomically saves its intent
        // with the shared human state. Only the winning claim may send effects.
        await input.service.act({ playerId: s.playerId, id: s.id, revision: r.revision, commandId: r.commandId,
          command: r.action, maximumDebit: r.maximumAdditionalPoints }, r);
        const saved = await input.store.get(soloCommandKey(r.commandId));
        if (!saved) deny();
        return reply(200, { receipt: parseSoloActionRecord(saved).receipt });
      }
      if (input.now() >= r.validUntil || input.now() >= input.validUntil) deny();
      if (quote) {
        const maximumAdditionalPoints = soloMoveQuote(s, r.action);
        if (maximumAdditionalPoints > input.maximumAdditionalPoints) deny();
        return reply(200, { schema: "playground.raap.solo-quote.v1", contextCommitment: r.contextCommitment,
          challengeId: s.id, revision: s.revision, stateCommitment: soloDigest(s), configurationCommitment: soloDigest(s.config),
          action: r.action, maximumAdditionalPoints, preparedAt: at, validUntil: Math.min(at + 300000, expires), executionAllowed: false });
      }
      return reply(200, { schema: "playground.raap.solo-observation.v1", contextCommitment: r.contextCommitment,
        stateCommitment: soloDigest(s), match: view(s, input.now()), observedAt: input.now(), actionAllowed: false });
    } catch { return reply(403, { error: "PLAYGROUND_SOLO_UNAVAILABLE" }); }
  };
}
