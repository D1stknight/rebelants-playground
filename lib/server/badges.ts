// Badges: the Playground reports what happened in a game, after the server has decided it, and the
// Rebel Economy keeps the badges (they live on the player's economy account, shared with The
// Underground and every other Rebel Ants app). Only server results go out: the game decided it on
// the server (S), or the server checked and capped what the game reported (C, see the catalog).
// A badge never slows or breaks a game: a call waits at most 1.5 s and never throws.

import { redis } from "./redis";

const ECONOMY_BASE_URL = process.env.ECONOMY_BASE_URL || "https://economy.rebelants.io";
const NEW_KEY = (userId: string) => "ra:badge:new:" + userId;
const SERVICE_API_KEY = process.env.SERVICE_API_KEY || "";

export type BadgeOp =
  | { key: string; op: "add"; by?: number }
  | { key: string; op: "max"; by: number }
  | { key: string; op: "streak"; hit: boolean }
  | { key: string; op: "day" }
  | { key: string; op: "distinct"; item: string }
  | { key: string; op: "dayAdd"; by?: number }
  | { key: string; op: "dayDistinct"; item: string }
  | { key: string; op: "dayCount" };
export type BadgeEvent = { userId: string; award?: string[]; counters?: BadgeOp[]; context?: Record<string, unknown> };

export type PgGame = "faction-wars" | "raid" | "tunnel" | "shuffle" | "descent" | "bounty" | "grand-prix" | "siege";

/** Report events; returns when sent or after 1.5 s, whichever is first. */
export async function sendBadges(events: BadgeEvent[]): Promise<void> {
  const list = events.filter((e) => e && e.userId && ((e.award && e.award.length) || (e.counters && e.counters.length)));
  if (!list.length || !SERVICE_API_KEY) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const chunk = list.slice(0, 50);
    const r = await fetch(ECONOMY_BASE_URL + "/api/internal/badges", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + SERVICE_API_KEY },
      body: JSON.stringify(chunk.length === 1 ? chunk[0] : { events: chunk }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const data: any = await r.json().catch(() => null);
    const results: any[] = chunk.length === 1 ? [data] : data?.results || [];
    // new badges wait for the player's screen (the badge pop-up), at most 20, a week
    for (let i = 0; i < results.length; i++) {
      const got = results[i]?.awarded;
      if (!Array.isArray(got) || !got.length) continue;
      const key = NEW_KEY(chunk[i].userId);
      await redis.rpush(key, ...got.map((a: any) => JSON.stringify({ id: a.id, name: a.name, tier: a.tier, tierLabel: a.tierLabel })));
      await redis.ltrim(key, -20, -1);
      await redis.expire(key, 7 * 86400);
    }
  } catch {
    /* a badge is a bonus */
  } finally {
    clearTimeout(timer);
  }
}

function etParts(t = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { h: Number(p.hour) % 24, min: Number(p.minute) };
}

/** What every paid run anywhere in the Playground counts toward. */
export function runEvent(userId: string, game: PgGame, extra: { award?: string[]; counters?: BadgeOp[]; context?: Record<string, unknown> } = {}): BadgeEvent {
  const t = etParts();
  const award = [...(extra.award || [])];
  if (t.h === 3) award.push("pgsecret.graveyard");
  return {
    userId,
    award,
    counters: [
      { key: "runs", op: "add" },
      { key: "runsday", op: "dayAdd" },
      { key: "games", op: "distinct", item: game },
      { key: "gamesday", op: "dayDistinct", item: game },
      ...(extra.counters || []),
    ],
    context: { game, ...(extra.context || {}) },
  };
}

/** A game result (not a new run): its own counters and awards only. */
export function resultEvent(userId: string, game: PgGame, extra: { award?: string[]; counters?: BadgeOp[]; context?: Record<string, unknown> }): BadgeEvent {
  return { userId, award: extra.award || [], counters: extra.counters || [], context: { game, ...(extra.context || {}) } };
}

export const isFirstMinuteAfterMidnight = () => { const t = etParts(); return t.h === 0 && t.min === 0; };

/** The new badges for a player's screen, once. */
export async function takeNewBadges(userId: string): Promise<{ id: string; name: string; tier: string; tierLabel: string }[]> {
  const key = NEW_KEY(userId);
  const raw = ((await redis.lrange(key, 0, -1).catch(() => [])) || []) as any[];
  if (raw.length) await redis.del(key).catch(() => 0);
  return raw.map((x) => (typeof x === "string" ? JSON.parse(x) : x)).filter((x) => x && x.id);
}
