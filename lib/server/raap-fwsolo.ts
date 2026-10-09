import { createHash, randomInt } from "node:crypto";
import { advanceSoloCampaign, newSoloCampaign, soloEntryCost,
  type SoloCampaign, type SoloCommand, type SoloConfig, type SoloPointEffect } from "../factionWarsSoloCampaign";
import type { FactionId } from "../factionWarsSoloRules";
import type { PlaygroundRebelSelection } from "./raap-rebel-selection";
import { createPlaygroundPointEffects } from "./raap-pvp-point-effects";

import { soloDigest, soloCommandKey, soloCanonical, soloActionRecord, parseSoloActionRecord, type SoloReviewedCommand } from "./raap-solo-protocol";

type Store = { get<T>(key: string): Promise<T | null>; eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> };
type Selected = Pick<PlaygroundRebelSelection, "selectionId" | "controller" | "controllerEpoch" | "validAfter" | "validUntil" | "asset">;
export interface SoloSession {
  schema: "rebel.playground.solo-session.v1"; id: string; playerId: string;
  selected: Selected; createdAt: number; validUntil: number; config: SoloConfig;
  revision: number; state: SoloCampaign; abandoned: boolean;
  pending: null | { commandId: string; requestId: string; after: SoloCampaign; effects: SoloPointEffect[]; review?: SoloReviewedCommand };
  lastCommandId: string; pointDisplayUnconfirmed?: boolean; raapActionCount?: number;
}
export interface SoloExperience {
  schema: "rebel.playground.solo-experience.v1"; intact: true; matchDigest: string;
  campaignId: string; playerId: string; selected: Selected; completedAt: number; raapActionCount?: number;
}
const hash = (value: string) => "0x" + createHash("sha256").update(value).digest("hex");
const sessionKey = (id: string) => `ra:raap:fwsolo:session:${id}`;
const activeKey = (player: string) => `ra:raap:fwsolo:active:${hash(player)}`;
export const soloResultKeys = (id: string) => [`ra:fwsolo:match:${id}`, `ra:raap:fwsolo:experience:${id}`];
function unavailable(): never { throw Error("SOLO_SAVED_STATUS_REQUIRED"); }
const raw = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value);
const random = () => randomInt(0, 0x100000000) / 0x100000000;
const CREATE = `
local active = redis.call('GET', KEYS[2])
if active then return redis.call('GET', 'ra:raap:fwsolo:session:' .. active) or '' end
if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('GET', KEYS[1]) end
redis.call('SET', KEYS[1], ARGV[1]); redis.call('SET', KEYS[2], ARGV[2]); return 'CLAIMED'
`;
const CLAIM = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2]); return 1
`;
const COMMIT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if #KEYS == 5 and redis.call('GET', KEYS[5]) ~= ARGV[8] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
if #KEYS == 5 then redis.call('SET', KEYS[5], ARGV[9]) end
if ARGV[3] ~= '' then
  redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[5])
  redis.call('SET', KEYS[4], ARGV[4], 'EX', ARGV[5])
end
if ARGV[6] == '1' then
  if redis.call('GET', KEYS[2]) == ARGV[7] then redis.call('DEL', KEYS[2]) end
  redis.call('EXPIRE', KEYS[1], ARGV[5])
end
return 1
`;

const CLAIM_REVIEW = `
local prior = redis.call('GET', KEYS[2]); if prior then return prior end
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  redis.call('SET', KEYS[2], ARGV[4]); return ARGV[4]
end
redis.call('SET', KEYS[1], ARGV[2]); redis.call('SET', KEYS[2], ARGV[3]); return 'CLAIMED'
`;

/** Only the configured authenticated human or exact RAAP route may call this service. The
 * callback must be the existing Economy adapter, with its exact stable key.
 * No background task, auto-retry, second player or new Economy role is used. */
export function createSoloCampaignService(input: {
  store: Store; now(): number; validUntil: number;
  send(effect: SoloPointEffect, playerId: string, idempotencyKey: string): Promise<number | null>;
  afterPoint?(effect: SoloPointEffect, playerId: string, balance: number): Promise<void>;
  random?: () => number;
}) {
  const points = createPlaygroundPointEffects(input);
  const draw = input.random ?? random;
  function fresh() { const at = input.now(); if (!Number.isSafeInteger(at) || at <= 0 || at >= input.validUntil) unavailable(); return at; }
  function parse(value: unknown, playerId: string): SoloSession {
    const text = raw(value);
    if (!text || Buffer.byteLength(text) > 524288) unavailable();
    const s = JSON.parse(text) as SoloSession;
    if (s?.schema !== "rebel.playground.solo-session.v1" || s.playerId !== playerId ||
      !/^[a-z0-9]{12}$/.test(s.id) || !Number.isSafeInteger(s.revision) || s.revision < 0) unavailable();
    return s;
  }
  const commandId = (id: string) => { if (!/^0x[0-9a-f]{64}$/.test(id)) unavailable(); };
  async function settle(s: SoloSession): Promise<SoloSession> {
    if (!s.pending) unavailable();
    const before = JSON.stringify(s), pending = s.pending!;
    let pointDisplayUnconfirmed = s.pointDisplayUnconfirmed;
    for (let index = 0; index < pending.effects.length; index++) {
      if (fresh() >= s.validUntil) return s;
      const effect = pending.effects[index];
      const receipt = await points.execute({ schema: "rebel.playground.point-effect.v1",
        commandId: pending.commandId, index, direction: effect.direction, amount: effect.amount, playerId: s.playerId },
      idem => input.send(effect, s.playerId, idem));
      if (receipt.status !== "ACKNOWLEDGED") return s;
      // Optional display totals follow the durable point acknowledgement. A
      // failed/slower leaderboard write cannot turn a known debit into unknown.
      if (input.afterPoint) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([input.afterPoint(effect, s.playerId, receipt.balance!),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("DISPLAY_TIMEOUT")), 2500); })]);
        } catch { pointDisplayUnconfirmed = true; }
        finally { if (timer) clearTimeout(timer); }
      }
    }
    // This is the only invocation that may settle a newly claimed command.
    // A repeated POST/READ returns its saved record and never calls settle.
    const after = { ...s, state: pending.after, revision: s.revision + 1,
      ...(pending.review ? { raapActionCount: (s.raapActionCount ?? 0) + 1 } : {}),
      pending: null, lastCommandId: pending.requestId, ...(pointDisplayUnconfirmed ? { pointDisplayUnconfirmed: true } : {}) };
    const at = fresh(), completed = after.state.phase === "final_result";
    const result = completed ? JSON.stringify({ schema: "rebel.playground.solo-result.v1", campaignId: s.id,
      playerId: s.playerId, moves: after.state.moves, results: after.state.results.map(r => ({ territory: r.territory, won: r.won })),
      rarity: after.state.rarity, completedAt: at, stateDigest: hash(JSON.stringify(after.state)) }) : "";
    const evidence: SoloExperience | undefined = completed ? { schema: "rebel.playground.solo-experience.v1",
      intact: true, matchDigest: hash(result), campaignId: s.id, playerId: s.playerId, selected: s.selected, completedAt: at, ...(after.raapActionCount ? { raapActionCount: after.raapActionCount } : {}) } : undefined;
    const ttl = Math.max(1, Math.min(7 * 86400, input.validUntil - at));
    const saved = await input.store.eval(COMMIT, [sessionKey(s.id), activeKey(s.playerId), ...soloResultKeys(s.id), ...(pending.review ? [soloCommandKey(pending.review.commandId)] : [])],
      [before, JSON.stringify(after), result, evidence ? JSON.stringify(evidence) : "", ttl, completed ? "1" : "0", s.id,
        ...(pending.review ? [JSON.stringify(soloActionRecord(pending.review)), JSON.stringify(soloActionRecord(pending.review, after, at * 1000))] : [])]);
    if (saved !== 1) unavailable();
    return after;
  }
  return {
    async read(playerId: string, id?: string) {
      if (id && !/^[a-z0-9]{12}$/.test(id)) unavailable();
      const selected = id ?? await input.store.get<string>(activeKey(playerId));
      if (!selected) return null;
      const value = await input.store.get(sessionKey(selected));
      return value ? parse(value, playerId) : unavailable();
    },
    async start(request: { playerId: string; commandId: string; team: FactionId[]; maximumDebit: number;
      selection: PlaygroundRebelSelection; config: SoloConfig }) {
      const at = fresh(); commandId(request.commandId);
      if (!/^(discord:[1-9][0-9]{16,19}|wallet:0x[0-9a-f]{40})$/.test(request.playerId) ||
        request.selection.status !== "ACTIVE" || request.selection.publicExperienceConsent !== true ||
        at < request.selection.validAfter || at >= request.selection.validUntil) unavailable();
      const existing = await this.read(request.playerId);
      if (existing) return existing;
      const state = newSoloCampaign(request.team, draw), cost = soloEntryCost(request.team, request.config);
      if (request.maximumDebit !== cost) throw Error("SOLO_PRICE_CHANGED");
      const s = request.selection;
      const selected: Selected = { selectionId: s.selectionId, controller: s.controller, controllerEpoch: s.controllerEpoch,
        validAfter: s.validAfter, validUntil: s.validUntil, asset: structuredClone(s.asset) };
      const id = hash(JSON.stringify(["rebel.playground.solo.v1", request.playerId, request.commandId])).slice(2, 14);
      const effectId = hash(JSON.stringify(["rebel.playground.solo-start.v1", request.playerId, id, request.commandId]));
      const session: SoloSession = { schema: "rebel.playground.solo-session.v1", id, playerId: request.playerId, selected,
        createdAt: at, validUntil: Math.min(input.validUntil, at + 86400), config: structuredClone(request.config),
        revision: 0, state, abandoned: false, lastCommandId: request.commandId,
        pending: { commandId: effectId, requestId: request.commandId, after: state, effects: cost > 0 ? [{ direction: "DEBIT", amount: cost, reason: "Faction Wars campaign" }] : [] } };
      const value = await input.store.eval(CREATE, [sessionKey(id), activeKey(request.playerId)], [JSON.stringify(session), id]);
      if (value !== "CLAIMED") return parse(value, request.playerId);
      return settle(session);
    },
    async act(request: { playerId: string; id: string; revision: number; commandId: string; command: SoloCommand; maximumDebit: number }, review?: SoloReviewedCommand) {
      fresh(); commandId(request.commandId);
      const s = await this.read(request.playerId, request.id);
      if (!s) unavailable();
      if (review) {
        const prior = await input.store.get(soloCommandKey(review.commandId));
        if (prior) {
          if (soloCanonical(parseSoloActionRecord(prior).request) !== soloCanonical(review)) unavailable();
          return s;
        }
        if (review.commandId !== request.commandId || review.challengeId !== s.id || review.revision !== request.revision ||
          soloCanonical(review.action) !== soloCanonical(request.command) || review.maximumAdditionalPoints !== request.maximumDebit ||
          review.controller !== s.selected.controller || review.epoch !== s.selected.controllerEpoch ||
          s.selected.asset.sourceChainId !== "1" || review.asset.chainId !== 1 || review.asset.collection !== s.selected.asset.collection || review.asset.tokenId !== s.selected.asset.tokenId || fresh() * 1000 < review.issuedAt || fresh() * 1000 >= review.validUntil ||
          review.validUntil > Math.min(input.validUntil, s.validUntil, s.selected.validUntil) * 1000 || review.validUntil - review.issuedAt > 300000) unavailable();
        // A human may win between the route's read and this second read. Save
        // a conclusive no-effect result instead of leaving an absent receipt.
        if (s.abandoned || s.pending || review.revision !== s.revision || review.stateCommitment !== soloDigest(s) ||
          review.configurationCommitment !== soloDigest(s.config)) {
          const record = soloActionRecord(review);
          record.receipt = { ...record.receipt, status: "DECLINED", after: review.stateCommitment,
            additionalPoints: 0, committedAt: fresh() * 1000 };
          const saved = await input.store.eval("local old=redis.call('GET',KEYS[1]); if old then return old end; redis.call('SET',KEYS[1],ARGV[1]); return ARGV[1]",
            [soloCommandKey(review.commandId)], [JSON.stringify(record)]);
          if (soloCanonical(parseSoloActionRecord(saved).request) !== soloCanonical(review)) unavailable();
          return s;
        }
      }
      if (s.abandoned) unavailable();
      if (s.pending || s.lastCommandId === request.commandId) return s;
      if (fresh() >= s.validUntil || request.revision !== s.revision || s.state.phase === "final_result") unavailable();
      const { state, effects } = advanceSoloCampaign(s.state, request.command, s.config, draw);
      const debit = effects.filter(e => e.direction === "DEBIT").reduce((sum, e) => sum + e.amount, 0);
      if (request.maximumDebit !== debit) throw Error("SOLO_PRICE_CHANGED");
      const next: SoloSession = { ...s, pending: {
        commandId: hash(JSON.stringify(["rebel.playground.solo-command.v1", s.id, s.revision, request.commandId])),
        requestId: request.commandId, after: state, effects, ...(review ? { review: structuredClone(review) } : {}) } };
      if (Buffer.byteLength(JSON.stringify(next)) > 524288) throw Error("SOLO_RECORD_LIMIT");
      const record = review && soloActionRecord(review);
      const declined = record && { ...record, receipt: { ...record.receipt, status: "DECLINED", after: review!.stateCommitment,
        additionalPoints: 0, committedAt: fresh() * 1000 } };
      const claimed = review
        ? await input.store.eval(CLAIM_REVIEW, [sessionKey(s.id), soloCommandKey(review.commandId)],
          [JSON.stringify(s), JSON.stringify(next), JSON.stringify(record), JSON.stringify(declined)])
        : await input.store.eval(CLAIM, [sessionKey(s.id)], [JSON.stringify(s), JSON.stringify(next)]);
      if (claimed !== (review ? "CLAIMED" : 1)) return this.read(request.playerId, request.id);
      return settle(next);
    },
    async abandon(playerId: string, id: string, revision: number) {
      fresh(); const s = await this.read(playerId, id);
      if (!s || s.pending || s.revision !== revision || s.state.phase === "final_result") unavailable();
      const next = { ...s, revision: s.revision + 1, abandoned: true };
      const changed = await input.store.eval(COMMIT, [sessionKey(id), activeKey(playerId), ...soloResultKeys(id)],
        [JSON.stringify(s), JSON.stringify(next), "", "", 7 * 86400, "1", id]);
      if (changed !== 1) unavailable(); return next;
    },
    async resultEffect(playerId: string, id: string, kind: "REWARD" | "CLAIM" | "BOARD", run?: (session: SoloSession) => Promise<unknown>) {
      const s = await this.read(playerId, id);
      if (!s || s.pending || s.abandoned || s.state.phase !== "final_result") unavailable();
      const key = `ra:raap:fwsolo:result-effect:${id}:${kind}`;
      const prior = await input.store.get<{ status: string; value?: unknown }>(key);
      if (prior) return typeof prior === "string" ? JSON.parse(prior) : prior;
      if (!run) return null;
      fresh();
      const pending = JSON.stringify({ status: "OUTCOME_UNKNOWN" });
      const claim = await input.store.eval(`local old = redis.call('GET', KEYS[1]); if old then return old end; redis.call('SET', KEYS[1], ARGV[1]); return 'CLAIMED'`, [key], [pending]);
      if (claim !== "CLAIMED") return JSON.parse(raw(claim));
      try {
        const value: any = await run(s);
        if (!value || value.ok !== true || Buffer.byteLength(JSON.stringify(value)) > 8192) return { status: "OUTCOME_UNKNOWN" };
        const ready = { status: "ACKNOWLEDGED", value };
        const saved = await input.store.eval(CLAIM, [key], [pending, JSON.stringify(ready)]);
        return saved === 1 ? ready : { status: "OUTCOME_UNKNOWN" };
      } catch { return { status: "OUTCOME_UNKNOWN" }; }
    },
  };
}

/** Public experience comes only from a committed server completion, never the
 * legacy solo scoreboard or a browser transcript. Point/prize amounts stay private. */
export async function readSoloCompletedExperience(input: {
  challengeId: string; playerId: string; selection: PlaygroundRebelSelection; now(): number; store: Store;
}) {
  if (!/^[a-z0-9]{12}$/.test(input.challengeId)) unavailable();
  const pair = await input.store.eval("return {redis.call('GET', KEYS[1]) or '', redis.call('GET', KEYS[2]) or ''}", soloResultKeys(input.challengeId), []);
  if (!Array.isArray(pair) || pair.length !== 2) unavailable();
  const gameRaw = raw(pair[0]), evidenceRaw = raw(pair[1]);
  if (!gameRaw || !evidenceRaw || gameRaw.length > 8192 || evidenceRaw.length > 8192) unavailable();
  const game = JSON.parse(gameRaw), evidence = JSON.parse(evidenceRaw) as SoloExperience;
  const s = input.selection, at = input.now();
  if (game.schema !== "rebel.playground.solo-result.v1" || evidence.schema !== "rebel.playground.solo-experience.v1" ||
    game.campaignId !== input.challengeId || evidence.campaignId !== input.challengeId ||
    game.playerId !== input.playerId || evidence.playerId !== input.playerId ||
    // The existing public reward rule is specifically owner-played. Never label
    // a campaign containing RAAP actions as wholly human-played.
    (evidence.raapActionCount ?? 0) !== 0 || evidence.intact !== true || evidence.matchDigest !== hash(gameRaw) || game.completedAt !== evidence.completedAt ||
    !Number.isSafeInteger(game.completedAt) || game.completedAt > at || game.completedAt < s.validAfter ||
    game.completedAt >= s.validUntil || at >= s.validUntil || s.status !== "ACTIVE" || s.publicExperienceConsent !== true ||
    evidence.selected.selectionId !== s.selectionId || evidence.selected.controller !== s.controller ||
    evidence.selected.controllerEpoch !== s.controllerEpoch || evidence.selected.validUntil > s.validUntil ||
    JSON.stringify(evidence.selected.asset) !== JSON.stringify(s.asset) ||
    !Number.isSafeInteger(game.moves) || game.moves < 5 || !Array.isArray(game.results) || game.results.length !== 5 ||
    game.results.some((r: any, i: number) => r.territory !== i || typeof r.won !== "boolean")) unavailable();
  return { schema: "rebel.playground.completed-match-snapshot.v1" as const,
    sourceActivityDigest: hash(JSON.stringify(["rebel.playground.solo-owner-completion.v1", input.challengeId, input.playerId])),
    evidenceDigest: hash(evidenceRaw), selectionId: s.selectionId, controllerEpoch: s.controllerEpoch, asset: structuredClone(s.asset),
    gameId: "PLAYGROUND_FACTION_WARS" as const, mode: "SOLO" as const, actor: "OWNER_PLAYED" as const,
    completedAt: game.completedAt as number, completion: "PLAYED" as const,
    won: game.results.some((r: any) => r.won), lifeRecorded: false as const, rewardIssued: false as const };
}
