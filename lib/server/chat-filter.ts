// PvP match chat: the automatic language filter (Oct 28, 2026; switch: factionWarsChatFilter, on by default).
// - Swear words are starred out (f***) and the message still posts.
// - Slurs and hate words block the message and mute the player in that match for 24 hours.
// - A third starred message from the same player in 24 hours mutes them in that match for 1 hour.
// Everything the filter does is logged for the Rebel Console (ra:fwpvp:chat:modlog, newest 300), with the
// original text, so an admin can review it. Players never see the log.
import { redis } from "./redis";
import { setMute } from "./fwpvp";

// Matched as whole words (after undoing l33t spelling and stretched letters), so "class" or "Scunthorpe" pass.
const SWEARS = [
  "fuck", "fucks", "fucked", "fucker", "fuckers", "fucking", "fuckin", "fuk", "fck", "fcking", "motherfucker", "motherfuckers", "mf", "mofo",
  "shit", "shits", "shitty", "shitting", "bullshit", "horseshit", "dipshit",
  "bitch", "bitches", "bitching", "biatch",
  "cunt", "cunts", "twat", "twats",
  "dick", "dicks", "dickhead", "cock", "cocks", "cocksucker", "prick", "pricks",
  "pussy", "pussies", "asshole", "assholes", "ass", "arse", "arsehole", "jackass", "dumbass", "badass",
  "bastard", "bastards", "slut", "sluts", "whore", "whores", "wanker", "wankers", "bollocks", "douche", "douchebag",
  "stfu", "gtfo", "wtf", "kys",
];
// Blocked outright. Matched anywhere in the message (spaces, dots and l33t spelling removed).
const SLURS = [
  "nigger", "nigga", "niggas", "faggot", "fagget", "chink", "spic", "kike", "tranny", "wetback", "beaner",
  "gook", "raghead", "towelhead", "retard", "retarded", "coon", "dyke", "paki", "zipperhead", "sandnigger", "kill yourself",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b", "+": "t" };
const norm = (s: string) =>
  s.toLowerCase().replace(/[0-9!@$+]/g, (c) => LEET[c] || c).replace(/(.)\1{2,}/g, "$1$1");
const squash = (s: string) => norm(s).replace(/[^a-z]/g, "");

const SWEAR_SET = new Set(SWEARS);
// "fuuuuck" → "fuuck" after norm; also try with every double letter made single
const single = (w: string) => w.replace(/(.)\1+/g, "$1");
const SWEAR_SINGLE = new Set(SWEARS.map(single));
// short slurs must be whole words (spic, coon, paki, gook, dyke); the rest can hide inside other text
const WORD_ONLY = ["spic", "coon", "paki", "gook", "dyke", "chink", "kike", "retard", "retarded", "beaner"];
const SLUR_WORDS = new Set(WORD_ONLY);
const SLUR_INSIDE = SLURS.filter((s) => !WORD_ONLY.includes(s)).map(squash);

export type FilterResult = { text: string; swears: number; slur: boolean };

export function filterChat(text: string): FilterResult {
  const squashed = squash(text);
  let slur = SLUR_INSIDE.some((s) => squashed.includes(s));
  let swears = 0;
  const out = text.replace(/[\p{L}\p{N}@$!+*]+/gu, (word) => {
    const w = norm(word).replace(/[^a-z]/g, "");
    if (!w) return word;
    if (SLUR_WORDS.has(w) || SLUR_WORDS.has(single(w))) { slur = true; return word; }
    if (SWEAR_SET.has(w) || SWEAR_SINGLE.has(single(w))) {
      swears++;
      return word[0] + "*".repeat(Math.max(2, word.length - 1));
    }
    return word;
  });
  return { text: out, swears, slur };
}

const MODLOG = "ra:fwpvp:chat:modlog";
const strikesKey = (cid: string, pid: string) => `ra:fwpvp:chat:strikes:${cid}:${pid}`;
const HOUR = 3600 * 1000;

export type ModEvent = { at: number; challengeId: string; playerId: string; displayName: string; kind: "starred" | "blocked" | "auto_mute"; text: string; muteMs?: number };

async function logMod(e: ModEvent) {
  try {
    await redis.lpush(MODLOG, JSON.stringify(e));
    await redis.ltrim(MODLOG, 0, 299);
  } catch {}
}

export async function readModLog(limit = 100): Promise<ModEvent[]> {
  const raw: any[] = (await redis.lrange(MODLOG, 0, Math.max(0, limit - 1)).catch(() => [])) || [];
  return raw.map((r) => (typeof r === "string" ? (() => { try { return JSON.parse(r); } catch { return null; } })() : r)).filter(Boolean);
}

/** What happens after the filter looked at a message. Returns a mute (ms) if the player was muted. */
export async function applyFilter(o: { challengeId: string; playerId: string; displayName: string; original: string; result: FilterResult }): Promise<number> {
  const base = { at: Date.now(), challengeId: o.challengeId, playerId: o.playerId, displayName: o.displayName, text: o.original.slice(0, 280) };
  if (o.result.slur) {
    await setMute(o.challengeId, o.playerId, 24 * HOUR, o.displayName).catch(() => {});
    await logMod({ ...base, kind: "blocked", muteMs: 24 * HOUR });
    return 24 * HOUR;
  }
  if (o.result.swears > 0) {
    await logMod({ ...base, kind: "starred" });
    let n = 0;
    try {
      n = Number(await redis.incr(strikesKey(o.challengeId, o.playerId)));
      if (n === 1) await redis.expire(strikesKey(o.challengeId, o.playerId), 24 * 3600);
    } catch {}
    if (n >= 3) {
      await setMute(o.challengeId, o.playerId, HOUR, o.displayName).catch(() => {});
      await redis.del(strikesKey(o.challengeId, o.playerId)).catch(() => {});
      await logMod({ ...base, kind: "auto_mute", muteMs: HOUR });
      return HOUR;
    }
  }
  return 0;
}
