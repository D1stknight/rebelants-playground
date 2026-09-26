import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

export interface PlaygroundMatchStore {
  get<T>(key: string): Promise<T | null>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}
export const playgroundMatchLockKey = (id: string) => `ra:raap:fwpvp:writer:${id}`;
export const playgroundGameKey = (id: string) => `ra:fwpvp:match:${id}`;
export const playgroundTournamentLockKey = (id: string) => `ra:raap:fwpvp:tournament-writer:${id}`;
export const playgroundTournamentKey = (id: string) => `ra:fwpvp:tournament:${id}`;
export function playgroundMatchTournament(raw: string | object | null): string | undefined {
  const m = typeof raw === "string" ? JSON.parse(raw) : raw;
  const id = (m as { tournamentId?: unknown } | null)?.tournamentId;
  if (id === undefined || id === null || id === "") return;
  if (typeof id !== "string" || !/^[a-z0-9]{12}$/.test(id)) throw Error("PLAYGROUND_TOURNAMENT_UNAVAILABLE");
  return id;
}
const writers = new AsyncLocalStorage<{ id?: string; token: string; before?: string; tournamentId?: string; tournamentBefore?: string }>();
const enabled = () => process.env.RAAP_PLAYGROUND_COORDINATION_ENABLED === "true";
const busy = () => Error("PLAYGROUND_MATCH_WRITE_HELD");
const CLAIM = `
for i=1,#KEYS do if redis.call('EXISTS', KEYS[i]) == 1 then return 0 end end
for i=1,#KEYS do redis.call('SET', KEYS[i], ARGV[1]) end; return 1
`;
const RELEASE = `
for i=1,#KEYS do if redis.call('GET', KEYS[i]) ~= ARGV[1] then return 0 end end
for i=1,#KEYS do redis.call('DEL', KEYS[i]) end; return 1
`;

/** One existing match writer at a time, including spectators placing bets.
 * Opt-in deployment prerequisite for action dispatch, not learning. No lease:
 * process death cannot allow a second writer while its point request is unknown.
 * A crashed human writer needs operator reconciliation; never expire its lock.
 * Keep coordination installed while any action or held writer exists. */
export async function withPlaygroundMatchWriter<T>(store: PlaygroundMatchStore, id: string, token: string,
  run: () => Promise<T>, retained = false): Promise<T> {
  if (!/^[a-z0-9]{12}$/.test(id) || !token || writers.getStore()) throw busy();
  const tournamentId = playgroundMatchTournament(await store.get<string|object>(playgroundGameKey(id)));
  const keys = [playgroundMatchLockKey(id), ...(tournamentId ? [playgroundTournamentLockKey(tournamentId)] : [])];
  if (await store.eval(CLAIM, keys, [token]) !== 1) throw busy();
  // A lost claim response leaves the writer held and never calls the handler.
  return writers.run({ id, token, tournamentId }, async () => {
    try { return await run(); }
    finally { if (!retained) await store.eval(RELEASE, keys, [token]); }
  });
}

/** For an action whose intent and lock were atomically claimed by its command
 * record. No client or ordinary game route can inject this internal scope. */
export function withClaimedPlaygroundWriter<T>(id: string, token: string, before: string, run: () => Promise<T>): Promise<T> {
  if (writers.getStore() || !/^[a-z0-9]{12}$/.test(id) || !token) throw busy();
  return writers.run({ id, token, before, tournamentId: playgroundMatchTournament(before) }, run);
}
export function capturePlaygroundWriterRead(id: string, raw: string | object) {
  const writer = writers.getStore();
  if (writer?.id === id && writer.before === undefined) writer.before = typeof raw === "string" ? raw : JSON.stringify(raw);
}

/** Save under the same writer and predecessor. New-match creation is allowed
 * only when the ID does not yet exist; it cannot overwrite an active command.
 * Undefined preserves the original save when coordination is not installed. */
export function saveCoordinatedPlaygroundMatch(store: PlaygroundMatchStore, id: string, value: string, ttl: number): Promise<void> | undefined {
  const writer = writers.getStore();
  if (!enabled() && !writer) return;
  return (async () => {
    const own = writer?.id === id ? writer : undefined;
    const saved = await store.eval(`
local lock = redis.call('GET', KEYS[1])
local old = redis.call('GET', KEYS[2])
if ARGV[1] == '' then
  if lock or old then return 0 end
else
  if lock ~= ARGV[1] or (old or '') ~= ARGV[2] then return 0 end
end
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4]); return 1
`, [playgroundMatchLockKey(id), playgroundGameKey(id)], [own?.token ?? "", own?.before ?? "", value, ttl]);
    if (saved !== 1) throw busy();
    if (own) own.before = value;
  })();
}

export function capturePlaygroundTournamentRead(id: string, raw: string | object) {
  const writer = writers.getStore();
  if (writer?.tournamentId === id && writer.tournamentBefore === undefined) writer.tournamentBefore = typeof raw === "string" ? raw : JSON.stringify(raw);
}
export function saveCoordinatedPlaygroundTournament(store: PlaygroundMatchStore, id: string, value: string): Promise<void> | undefined {
  const writer = writers.getStore(); if (!enabled() && !writer) return;
  return (async () => {
    const own = writer?.tournamentId === id ? writer : undefined;
    const result = await store.eval(`
local lock = redis.call('GET', KEYS[1]); local old = redis.call('GET', KEYS[2])
if ARGV[1] == '' then if lock or old then return 0 end
else if lock ~= ARGV[1] or (old or '') ~= ARGV[2] then return 0 end end
redis.call('SET', KEYS[2], ARGV[3]); return 1
`, [playgroundTournamentLockKey(id), playgroundTournamentKey(id)], [own?.token ?? "", own?.tournamentBefore ?? "", value]);
    if (result !== 1) throw busy(); if (own) own.tournamentBefore = value;
  })();
}
export async function withPlaygroundTournamentWriter<T>(store: PlaygroundMatchStore, id: string, token: string, run: () => Promise<T>): Promise<T> {
  if (!/^[a-z0-9]{12}$/.test(id) || !token || writers.getStore()) throw busy();
  const keys = [playgroundTournamentLockKey(id)];
  if (await store.eval(CLAIM, keys, [token]) !== 1) throw busy();
  return writers.run({token,tournamentId:id}, async () => {
    try { return await run(); } finally { await store.eval(RELEASE,keys,[token]); }
  });
}
export function withPlaygroundHumanTournamentWriter(handler: (req: NextApiRequest, res: NextApiResponse) => unknown) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (!enabled() || req.method !== "POST") return handler(req,res);
    const id = String(req.body?.tournamentId ?? "").trim();
    if (!/^[a-z0-9]{12}$/.test(id)) return handler(req,res);
    try {
      const {redis} = await import("./redis.js");
      return await withPlaygroundTournamentWriter(redis,id,"human:"+randomUUID(),async()=>handler(req,res));
    } catch {
      if (!res.headersSent) return res.status(409).json({ok:false,error:"This tournament has a pending action. Check its status before trying again."});
    }
  };
}

/** Same request/response and original game handler. No new wallet prompt or
 * ownership request on a human move. Invalid requests retain their old errors. */
export function withPlaygroundHumanWriter(handler: (req: NextApiRequest, res: NextApiResponse) => unknown) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (!enabled() || req.method !== "POST") return handler(req, res);
    let id: string;
    try { const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; id = String(body?.challengeId ?? "").trim().slice(0,64); }
    catch { return handler(req, res); }
    if (!/^[a-z0-9]{12}$/.test(id)) return handler(req, res);
    try {
      const { redis } = await import("./redis.js");
      return await withPlaygroundMatchWriter(redis, id, "human:" + randomUUID(), async () => handler(req, res));
    } catch {
      if (!res.headersSent) return res.status(409).json({ ok: false, error: "This match has a pending action. Check its status before trying again." });
    }
  };
}
