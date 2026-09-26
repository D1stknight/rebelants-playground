import { FACTIONS } from "../factionWarsCore";
import { withPlaygroundActionOutcome, assertPlaygroundActionConfirmed } from "./raap-pvp-action-outcome";
import { createHash } from "node:crypto";
import type { PvpMatch, Tournament } from "../types/fwpvp";
import { applyPvpTeam, applyPvpHeal, quotePvpHeal, type PvpHealRules } from "./fwpvp-rules";
import { createPlaygroundPointEffects, withPlaygroundPointCommand, assertPlaygroundPointsConfirmed } from "./raap-pvp-point-effects";
import { playgroundGameKey, playgroundMatchLockKey, playgroundMatchTournament, playgroundTournamentLockKey, withClaimedPlaygroundWriter, type PlaygroundMatchStore } from "./raap-pvp-coordination";

export const canonicalPlaygroundAction = (v: any): string => v === null || typeof v !== "object" ? JSON.stringify(v) :
  Array.isArray(v) ? "[" + v.map(canonicalPlaygroundAction).join(",") + "]" :
    "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonicalPlaygroundAction(v[k])).join(",") + "}";
export const playgroundActionDigest = (v: unknown) => "0x" + createHash("sha256").update(canonicalPlaygroundAction(v)).digest("hex");
export interface PlaygroundActionRequest {
  schema: "playground.raap.action.v1"; operation: "EXECUTE";
  commandId: string; asset: { chainId: 1; collection: string; tokenId: string };
  controller: string; epoch: number; account: string; contextCommitment: string;
  challengeId: string; stateCommitment: string; configurationCommitment: string | null;
  action: { kind: "SELECT_TEAM"; team: string[] } | { kind: "HEAL" } | { kind: "MOVE"; moveId: string };
  maximumAdditionalPoints: number; issuedAt: number; validUntil: number;
}
export interface PlaygroundActionReceipt {
  schema: "playground.raap.action-receipt.v1"; commandId: string; requestCommitment: string;
  challengeId: string; before: string; after: string | null;
  status: "OUTCOME_UNKNOWN" | "APPLIED" | "DECLINED";
  additionalPoints: number | null; committedAt: number | null;
}
interface Saved { request: PlaygroundActionRequest; receipt: PlaygroundActionReceipt }
const commandKey = (id: string) => `ra:raap:fwpvp:command:${id}`;
function unavailable(): never { throw Error("PLAYGROUND_ACTION_UNAVAILABLE"); }
const CLAIM = `
local prior = redis.call('GET', KEYS[1])
if prior then return prior end
if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('GET', KEYS[3]) ~= ARGV[1] or (#KEYS == 4 and redis.call('EXISTS', KEYS[4]) == 1) then return 'CONFLICT' end
redis.call('SET', KEYS[1], ARGV[2]); redis.call('SET', KEYS[2], ARGV[3]);
if #KEYS == 4 then redis.call('SET', KEYS[4], ARGV[3]) end; return 'CLAIMED'
`;
const FINISH = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] or redis.call('GET', KEYS[3]) ~= ARGV[3] then return 0 end
if #KEYS == 4 and redis.call('GET', KEYS[4]) ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[4]); redis.call('DEL', KEYS[2]);
if #KEYS == 4 then redis.call('DEL', KEYS[4]) end; return 1
`;
/** Original team/heal rules and actual game payment/save helpers. The durable
 * command and match lock precede all effects. Duplicate or restarted requests
 * only read the original receipt, even when no effect was sent. Unknown outcomes
 * retain both records without TTL. Moves call the original handler, including
 * payouts, spectator settlement and tournament progression. Swallowed storage
 * failures still hold the command; a completed tournament move is read back. */
export function createPlaygroundActions(input: {
  store: PlaygroundMatchStore; now(): number; validUntil: number;
  game: {
    getMatch(id: string): Promise<PvpMatch | null>;
    getTournament(id: string): Promise<Tournament | null>;
    submitMove(challengeId: string, playerId: string, moveId: string): Promise<{status: number; ok: boolean; match?: PvpMatch}>;
    saveMatch(match: PvpMatch): Promise<void>;
    getHealConfig(): Promise<PvpHealRules>;
    spendREBEL(player: string, cost: number): Promise<number | null>;
  };
}) {
  function saved(value: unknown): Saved {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    if (!v || v.receipt?.schema !== "playground.raap.action-receipt.v1" ||
      v.receipt.commandId !== v.request?.commandId || v.receipt.requestCommitment !== playgroundActionDigest(v.request) ||
      !["OUTCOME_UNKNOWN", "APPLIED", "DECLINED"].includes(v.receipt.status)) unavailable();
    return v;
  }
  async function read(id: string) {
    if (!/^0x[0-9a-f]{64}$/.test(id)) unavailable();
    const value = await input.store.get(commandKey(id));
    return value === null ? null : saved(value);
  }
  return {
    read,
    async execute(request: PlaygroundActionRequest): Promise<PlaygroundActionReceipt> {
      const r = structuredClone(request), requestCommitment = playgroundActionDigest(r);
      const old = await read(r.commandId);
      if (old) { if (old.receipt.requestCommitment !== requestCommitment) unavailable(); return old.receipt; }
      if (input.now() >= r.validUntil || r.validUntil > input.validUntil) unavailable();
      const pending: Saved = { request: r, receipt: { schema: "playground.raap.action-receipt.v1", commandId: r.commandId,
        requestCommitment, challengeId: r.challengeId, before: r.stateCommitment, after: null,
        status: "OUTCOME_UNKNOWN", additionalPoints: null, committedAt: null } };
      async function declineUnclaimed() {
        const declined: Saved = {request:r,receipt:{...pending.receipt,status:"DECLINED",after:r.stateCommitment,additionalPoints:0,committedAt:input.now()}};
        const result=await input.store.eval(`
local old=redis.call('GET',KEYS[1]); if old then return old end
redis.call('SET',KEYS[1],ARGV[1]); return ARGV[1]
`,[commandKey(r.commandId)],[JSON.stringify(declined)]);
        const record=saved(result);if(record.receipt.requestCommitment!==requestCommitment)unavailable();return record.receipt;
      }
      const rawValue = await input.store.get<PvpMatch | string>(playgroundGameKey(r.challengeId));
      if (!rawValue) return declineUnclaimed();
      const before = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
      if (Buffer.byteLength(before) > 262144) unavailable();
      if (playgroundActionDigest(JSON.parse(before)) !== r.stateCommitment) return declineUnclaimed();
      const serialized = JSON.stringify(pending), token = "raap:" + r.commandId;
      const tournamentId = playgroundMatchTournament(before);
      const keys = [commandKey(r.commandId), playgroundMatchLockKey(r.challengeId), playgroundGameKey(r.challengeId),
        ...(tournamentId ? [playgroundTournamentLockKey(tournamentId)] : [])];
      const claim = await input.store.eval(CLAIM, keys, [before, serialized, token]);
      if (claim === "CONFLICT") return declineUnclaimed();
      if (claim !== "CLAIMED") {
        const prior = saved(claim); if (prior.receipt.requestCommitment !== requestCommitment) unavailable(); return prior.receipt;
      }
      // From here, failure never permits a new attempt. A proven pre-effect
      // rejection has its own terminal receipt; all ambiguous outcomes stay held.
      return withClaimedPlaygroundWriter(r.challengeId, token, before, () => withPlaygroundActionOutcome(async () => {
        let externalStarted = false, savedMatch: PvpMatch | undefined;
        async function finish(status: "APPLIED" | "DECLINED", points: number, expected: string) {
          assertPlaygroundActionConfirmed(); assertPlaygroundPointsConfirmed();
          const receipt: PlaygroundActionReceipt = { ...pending.receipt, status,
            after: status === "APPLIED" ? playgroundActionDigest(savedMatch) : r.stateCommitment,
            additionalPoints: points, committedAt: input.now() };
          const result = await input.store.eval(FINISH, keys,
            [serialized, token, expected, JSON.stringify({ request: r, receipt })]);
          return result === 1 ? receipt : pending.receipt;
        }
        try {
          if (input.now() >= r.validUntil) return await finish("DECLINED", 0, before);
          const player = "wallet:" + r.controller;
          const current = await input.game.getMatch(r.challengeId);
          if (!current || current.challengeId !== r.challengeId ||
            [current.challengerPlayerId, current.opponentPlayerId].filter(id => id === player).length !== 1) unavailable();
          if (r.action.kind === "MOVE") {
            if (r.configurationCommitment !== null || r.maximumAdditionalPoints !== 0) unavailable();
            const side=current.challengerPlayerId===player?"challenger":"opponent";
            const team=side==="challenger"?current.challengerTeam:current.opponentTeam;
            const index=side==="challenger"?current.challengerCurrentFactionIndex:current.opponentCurrentFactionIndex;
            const faction=FACTIONS[team[index]];
            if(current.status!=="active"||current.currentTurnPlayerId!==player||current.currentTurnSide!==side||
              !faction?.moves.some(move=>move.id===(r.action as {kind:"MOVE";moveId:string}).moveId))return await finish("DECLINED",0,before);
            if (input.now() >= r.validUntil) return await finish("DECLINED",0,before);
            const effects = createPlaygroundPointEffects({store:input.store,now:()=>Math.floor(input.now()/1000),validUntil:Math.floor(r.validUntil/1000)});
            externalStarted = true;
            return await withPlaygroundPointCommand({commandId:r.commandId,playerId:player,maximumDebit:0,effects,beforeSend:assertPlaygroundActionConfirmed},async()=>{
              const result = await input.game.submitMove(r.challengeId,player,(r.action as {kind:"MOVE";moveId:string}).moveId);
              assertPlaygroundActionConfirmed(); assertPlaygroundPointsConfirmed();
              if (result.status !== 200 || !result.ok || !result.match || result.match.challengeId !== r.challengeId) unavailable();
              savedMatch = result.match;
              if (savedMatch.status === "completed" && tournamentId && savedMatch.winnerPlayerId && savedMatch.loserPlayerId) {
                const tournament = await input.game.getTournament(tournamentId);
                const slots = tournament?.rounds.flatMap(round=>round.matches).filter(slot=>slot.challengeId===r.challengeId);
                if (!tournament || !slots || slots.length!==1 || slots[0].winner!==savedMatch.winnerPlayerId) unavailable();
              }
              return await finish("APPLIED",0,JSON.stringify(savedMatch));
            });
          }
          let cost = 0, next: PvpMatch;
          if (r.action.kind === "SELECT_TEAM") {
            if (r.configurationCommitment !== null || r.maximumAdditionalPoints !== 0) unavailable();
            next = applyPvpTeam(current, player, r.action.team, input.now());
          } else if (r.action.kind === "HEAL") {
            const config = await input.game.getHealConfig();
            if (playgroundActionDigest(config) !== r.configurationCommitment) unavailable();
            cost = quotePvpHeal(current, player, config).cost;
            if (!Number.isSafeInteger(cost) || cost < 0 || cost > r.maximumAdditionalPoints) unavailable();
            // The legacy balance helper resolves/creates Economy identities.
            // It is not a read-only preflight. Let the original atomic debit
            // run only after the durable effect claim below instead.
            next = applyPvpHeal(current, player, config, input.now()).match;
          } else unavailable();
          if (input.now() >= r.validUntil) return await finish("DECLINED", 0, before);
          const effects = createPlaygroundPointEffects({ store: input.store, now: () => Math.floor(input.now()/1000), validUntil: Math.floor(r.validUntil/1000) });
          return await withPlaygroundPointCommand({ commandId: r.commandId, playerId: player, maximumDebit: r.maximumAdditionalPoints, effects, beforeSend: assertPlaygroundActionConfirmed }, async () => {
            externalStarted = true;
            if (cost > 0 && await input.game.spendREBEL(player, cost) === null) unavailable();
            // Once an authorized debit starts, completing its exact game save is
            // settlement of that attempt, not a new action or renewed approval.
            savedMatch = next;
            await input.game.saveMatch(next);
            return await finish("APPLIED", cost, JSON.stringify(next));
          });
        } catch {
          if (!externalStarted) {
            try { return await finish("DECLINED", 0, before); } catch { /* retain intent/lock */ }
          }
          return pending.receipt;
        }
      })).catch(() => pending.receipt);
    },
  };
}
