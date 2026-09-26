import { withPlaygroundHumanWriter } from "./raap-pvp-coordination";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { PvpMatch } from "../types/fwpvp";
import { inspectPlaygroundLearningSession } from "./raap-player-connection";
import { raapDiscordPlayerSettings, readRaapDiscordPlayer } from "./raap-discord-player";
import type { PlaygroundRebelSelection } from "./raap-rebel-selection";

type Selection = ReturnType<typeof inspectPlaygroundLearningSession>;
type Operation = "create" | "accept" | "select-team" | "submit-move" | "heal" | "cast-spell" | "cancel" | "decline" | "forfeit";
interface Capture { operation: Operation; playerId?: string; selection?: Selection; before: Map<string, string> }
export interface PlaygroundMatchExperience {
  schema: "rebel.playground.pvp-experience.v1";
  challengeId: string;
  revision: number;
  matchDigest: string;
  intact: boolean;
  assignments: Array<{ playerId: string; selection: Selection; moves: number }>;
  completed: null | { at: number; kind: "PLAYED" | "FORFEIT"; winnerPlayerId: string | null };
}
const capture = new AsyncLocalStorage<Capture>();
const hash = (text: string) => "0x" + createHash("sha256").update(text).digest("hex");
export const playgroundMatchExperienceKey = (id: string) => `ra:raap:fwpvp:experience:${id}`;
export type PlaygroundCompletedExperience = Awaited<ReturnType<typeof readPlaygroundCompletedExperience>>;
const enabled = () => process.env.RAAP_REBEL_MATCH_RECORDING_ENABLED === "true" &&
  process.env.RAAP_REBEL_CONNECTION_ENABLED === "true" &&
  Number.isSafeInteger(Number(process.env.RAAP_REBEL_CONNECTION_VALID_UNTIL)) &&
  Date.now() / 1000 < Number(process.env.RAAP_REBEL_CONNECTION_VALID_UNTIL);

/** This adds attribution to a normal human request, never permission to execute
 * it. Invalid/missing learning identity cannot break the existing game handler.
 * No chain/source/provider call is performed on an individual move. */
export function withPlaygroundMatchExperience(operation: Operation,
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown) {
  return withPlaygroundHumanWriter((req: NextApiRequest, res: NextApiResponse) => {
    if (!enabled() || req.method !== "POST") return handler(req, res);
    const context: Capture = { operation, before: new Map() };
    const settings = raapDiscordPlayerSettings(process.env);
    try {
      if (!settings || req.headers.origin !== settings.origin || req.headers["sec-fetch-site"] !== "same-origin") throw Error();
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const field = operation === "create" ? "challengerPlayerId" : operation === "accept" ? "opponentPlayerId" : "playerId";
      const claimed = String(body?.[field] || "").trim().slice(0, 64);
      const cookies = req.headers.cookie ?? "";
      let selected: Selection | undefined;
      try { selected = inspectPlaygroundLearningSession(new Request(settings.origin, { headers: { cookie: cookies } }), {
        cookieKey: settings.key, validUntil: settings.validUntil, now: settings.now,
      }); } catch { /* Ordinary players need no RAAP selection. */ }
      const discord = readRaapDiscordPlayer(cookies, settings);
      if (!claimed || claimed !== discord && claimed !== (selected ? `wallet:${selected.controller}` : undefined)) throw Error();
      context.playerId = claimed; context.selection = selected;
    } catch { /* Preserve gameplay; an unsigned write cannot produce verified learning. */ }
    finally { settings?.key.fill(0); }
    return capture.run(context, () => handler(req, res));
  });
}

export function capturePlaygroundMatchRead(id: string, raw: string | object) {
  if (enabled()) capture.getStore()?.before.set(id, typeof raw === "string" ? raw : JSON.stringify(raw));
}

/** Pure attribution over actual server state. The separate observation is not
 * a reward, a source signature, proof of payment or a replacement game engine. */
export function advancePlaygroundMatchExperience(previous: PlaygroundMatchExperience | null, match: PvpMatch,
  before: string | undefined, context: Pick<Capture, "operation" | "playerId" | "selection"> | undefined,
  at: number): PlaygroundMatchExperience | null {
  const value = JSON.stringify(match);
  const old: PvpMatch | undefined = before ? JSON.parse(before) : undefined;
  const participant = context?.playerId && [match.challengerPlayerId, match.opponentPlayerId].includes(context.playerId);
  const canSelect = participant && context?.selection &&
    (!old && context.operation === "create" && match.status === "pending" || old && ["pending", "team_selection"].includes(old.status));
  if (!previous && !canSelect) return null;
  const next: PlaygroundMatchExperience = previous ? structuredClone(previous) : {
    schema: "rebel.playground.pvp-experience.v1", challengeId: match.challengeId, revision: 0,
    matchDigest: "", intact: true, assignments: [], completed: null,
  };
  if (next.challengeId !== match.challengeId || previous && (!before || previous.matchDigest !== hash(before)) ||
    !participant || previous?.completed || !Number.isSafeInteger(at) || at <= 0) next.intact = false;
  if (canSelect && !next.assignments.some(entry => entry.playerId === context!.playerId)) {
    if (next.assignments.length >= 2) next.intact = false;
    else next.assignments.push({ playerId: context!.playerId!, selection: structuredClone(context!.selection!), moves: 0 });
  }
  const actingAssignment = next.assignments.find(entry => entry.playerId === context?.playerId);
  if (actingAssignment && (!context?.selection ||
    context.selection.selectionId !== actingAssignment.selection.selectionId ||
    context.selection.controller !== actingAssignment.selection.controller ||
    context.selection.epoch !== actingAssignment.selection.epoch || context.selection.validUntil <= at)) next.intact = false;
  if (context?.operation === "submit-move") {
    const assigned = next.assignments.find(entry => entry.playerId === context.playerId);
    if (assigned) assigned.moves++;
  }
  next.revision++; next.matchDigest = hash(value);
  if (match.status === "completed") next.completed = { at, kind: match.forfeitedBy ? "FORFEIT" : "PLAYED",
    winnerPlayerId: match.winnerPlayerId || null };
  return next;
}

// Game save remains the original operation. This CAS only writes its separate
// observation; a raced/lost/missing predecessor invalidates learning, not play.
const SAVE_OBSERVATION = `
local current = redis.call('GET', KEYS[1])
local prior = redis.call('GET', KEYS[2])
if current ~= ARGV[1] or (prior or '') ~= ARGV[2] then
  local failed = cjson.decode(ARGV[3])
  if prior then
    local ok, existing = pcall(cjson.decode, prior)
    if ok and type(existing) == 'table' then failed = existing end
  end
  failed.intact = false
  redis.call('SET', KEYS[2], cjson.encode(failed), 'EX', ARGV[4]); return 0
end
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4]); return 1
`;
export async function recordPlaygroundMatchExperience(match: PvpMatch, store: {
  get<T>(key: string): Promise<T | null>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}, ttl: number) {
  if (!enabled()) return;
  const context = capture.getStore(), key = playgroundMatchExperienceKey(match.challengeId);
  const write = async () => {
    const raw = await store.get<string | PlaygroundMatchExperience>(key);
    const prior = typeof raw === "string" ? JSON.parse(raw) : raw;
    const next = advancePlaygroundMatchExperience(prior, match, context?.before.get(match.challengeId), context, Math.floor(Date.now() / 1000));
    if (!next) return;
    // Upstash auto-deserializes JSON; preserve its stored property order. Any
    // serialization mismatch conservatively invalidates this observation.
    const value = JSON.stringify(match), previous = raw === null ? "" : typeof raw === "string" ? raw : JSON.stringify(raw);
    await store.eval(SAVE_OBSERVATION, [`ra:fwpvp:match:${match.challengeId}`, key], [value, previous, JSON.stringify(next), ttl]);
    context?.before.set(match.challengeId, value);
  };
  // Optional recording gets a finite response budget. A late metadata-only write
  // still passes the CAS above; it cannot change a game record or emit a reward.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([write(), new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); })]); }
  catch { /* Missing/mismatched source stays unqualified; preserve gameplay. */ }
  finally { if (timer) clearTimeout(timer); }
}

/** One atomic read of the actual game and its attribution record. The caller
 * must supply the freshly authenticated app selection, not request JSON. This
 * is a recorded game fact; Life signing/reward admission remains separate. */
export async function readPlaygroundCompletedExperience(input: {
  challengeId: string; playerId: string; selection: PlaygroundRebelSelection; now(): number;
  store: { eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> };
}) {
  if (!/^[a-z0-9]{12}$/.test(input.challengeId)) throw Error("PLAYGROUND_MATCH_UNAVAILABLE");
  const values = await input.store.eval("return {redis.call('GET', KEYS[1]) or '', redis.call('GET', KEYS[2]) or ''}",
    [`ra:fwpvp:match:${input.challengeId}`, playgroundMatchExperienceKey(input.challengeId)], []);
  if (!Array.isArray(values) || values.length !== 2) throw Error("PLAYGROUND_MATCH_UNAVAILABLE");
  const raw = typeof values[0] === "string" ? values[0] : JSON.stringify(values[0]);
  const rawRecord = typeof values[1] === "string" ? values[1] : JSON.stringify(values[1]);
  if (!raw || !rawRecord || Buffer.byteLength(raw) > 262144 || Buffer.byteLength(rawRecord) > 8192) throw Error("PLAYGROUND_MATCH_UNAVAILABLE");
  const match = JSON.parse(raw) as PvpMatch, record = JSON.parse(rawRecord) as PlaygroundMatchExperience;
  const selection = input.selection, at = input.now();
  if (!Number.isSafeInteger(at) || record.schema !== "rebel.playground.pvp-experience.v1" ||
    record.challengeId !== input.challengeId || match.challengeId !== input.challengeId || match.status !== "completed" ||
    record.intact !== true || record.matchDigest !== hash(raw) || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
    !record.completed || !Number.isSafeInteger(record.completed.at) || record.completed.at > at ||
    record.completed.at < selection.validAfter || record.completed.at >= selection.validUntil || at >= selection.validUntil ||
    record.completed.kind !== (match.forfeitedBy ? "FORFEIT" : "PLAYED") || record.completed.winnerPlayerId !== match.winnerPlayerId ||
    ![match.challengerPlayerId, match.opponentPlayerId].includes(input.playerId) ||
    !Array.isArray(record.assignments) || record.assignments.length > 2 ||
    selection.status !== "ACTIVE" || selection.publicExperienceConsent !== true) throw Error("PLAYGROUND_MATCH_UNAVAILABLE");
  const found = record.assignments.filter(entry => entry.playerId === input.playerId && entry.selection.selectionId === selection.selectionId);
  if (found.length !== 1 || !Number.isSafeInteger(found[0].moves) || found[0].moves < 1 ||
    found[0].selection.controller !== selection.controller || found[0].selection.epoch !== selection.controllerEpoch ||
    found[0].selection.validUntil > selection.validUntil) throw Error("PLAYGROUND_MATCH_UNAVAILABLE");
  return {
    schema: "rebel.playground.completed-match-snapshot.v1" as const,
    sourceActivityDigest: hash(JSON.stringify(["rebel.playground.pvp-owner-completion.v1", input.challengeId, input.playerId])),
    evidenceDigest: hash(rawRecord), selectionId: selection.selectionId, controllerEpoch: selection.controllerEpoch,
    asset: structuredClone(selection.asset), gameId: "PLAYGROUND_FACTION_WARS" as const, mode: "PVP" as const,
    actor: "OWNER_PLAYED" as const, completedAt: record.completed.at, completion: record.completed.kind,
    won: match.winnerPlayerId === input.playerId, lifeRecorded: false as const, rewardIssued: false as const,
  };
}
