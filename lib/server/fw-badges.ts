// Faction Wars PvP and tournament badges. A PvP match is decided on the server (lib/server/fwpvp-rules),
// so its record is trusted. Called when a match completes (submit-move, forfeit) and when a tournament
// moves on (onTournamentMatchComplete). Matches that pay no rewards (a guest, or one account on both
// sides) earn no badges, the same rule the boards use.
import { redis } from "./redis";
import { FACTIONS, type FactionId } from "../factionWarsCore";
import type { PvpMatch } from "../types/fwpvp";
import { matchAccounts, getPvpEconomyConfig } from "./fwpvp";
import { resolveByPlayerId } from "../economy";
import { sendBadges, type BadgeEvent, type BadgeOp } from "./badges";

const PVP_WINS = "ra:fw:lb:pvpWins";

export async function pvpMatchBadges(match: PvpMatch): Promise<void> {
  if (match.status !== "completed" || !match.winnerPlayerId || !match.loserPlayerId) return;
  if (!(await redis.set("ra:badge:fwmatch:" + match.challengeId, "1", { nx: true, ex: 30 * 86400 }).catch(() => null))) return; // once
  const { accounts } = await matchAccounts(match);
  if (!accounts) return;
  const [cUser, oUser] = accounts;
  const featured = await getPvpEconomyConfig().then((c: any) => String(c?.featuredMatchId || "") === match.challengeId).catch(() => false);
  const events: BadgeEvent[] = [];
  for (const side of ["challenger", "opponent"] as const) {
    const me = side === "challenger" ? match.challengerPlayerId : match.opponentPlayerId;
    const userId = side === "challenger" ? cUser : oUser;
    const won = match.winnerPlayerId === me;
    const forfeit = !!match.forfeitedBy;
    const award: string[] = [];
    const counters: BadgeOp[] = [{ key: "fw.winstreak", op: "streak", hit: won }];
    if (!forfeit) counters.push({ key: "fw.played", op: "add" });
    if (featured) award.push("fw.airwaves");
    const results = match.territoryResults || [];
    // territory wins with each faction (banners) and the hard-fought territory badges
    for (const t of results) {
      if (t.winnerSide !== side) continue;
      const mine = (side === "challenger" ? t.challengerFaction : t.opponentFaction) as FactionId;
      const theirs = (side === "challenger" ? t.opponentFaction : t.challengerFaction) as FactionId;
      const hp = side === "challenger" ? t.challengerHpFinal : t.opponentHpFinal;
      counters.push({ key: "fwb." + mine, op: "add" }, { key: "fw.factions", op: "distinct", item: mine });
      if (hp >= 100) award.push("fw.perfect");
      if (hp > 0 && hp <= 5) award.push("fw.laststand");
      if (FACTIONS[mine]?.weakTo?.includes(theirs)) award.push("fw.grain");
    }
    if (won) {
      const opp = side === "challenger" ? match.opponentPlayerId : match.challengerPlayerId;
      counters.push({ key: "fw.wins", op: "add" }, { key: "fw.foes", op: "distinct", item: side === "challenger" ? oUser : cUser });
      if (featured) award.push("fw.airwaveswin");
      const myWins = results.filter((t) => t.winnerSide === side);
      const sweep = results.length === 5 && myWins.length === 5;
      if (sweep) counters.push({ key: "fw.sweeps", op: "add" });
      if (sweep && myWins.every((t) => (side === "challenger" ? t.challengerHpFinal : t.opponentHpFinal) >= 50)) award.push("fw.flawless");
      if (sweep && myWins.every((t) => FACTIONS[(side === "challenger" ? t.challengerFaction : t.opponentFaction) as FactionId]?.weakTo?.includes((side === "challenger" ? t.opponentFaction : t.challengerFaction) as FactionId))) award.push("pgsecret.underdog");
      if (results.length >= 2 && results[0].winnerSide !== side && results[1].winnerSide !== side) counters.push({ key: "fw.comebacks", op: "add" });
      if (results.length === 5 && results.slice(0, 4).filter((t) => t.winnerSide === side).length === 2 && results[4].winnerSide === side) award.push("fw.fifth");
      const heals = side === "challenger" ? match.challengerHealsUsed : match.opponentHealsUsed;
      if (!forfeit && !heals) award.push("fw.noheal");
      const cursed = side === "challenger" ? match.opponentSpellUsed : match.challengerSpellUsed;
      if (cursed) award.push("fw.cursed");
      const last = results[results.length - 1];
      if (last && last.winnerSide === side) {
        const hp = side === "challenger" ? last.challengerHpFinal : last.opponentHpFinal;
        if (hp === 1) award.push("pgsecret.onehp");
        if (cursed && hp <= 10) award.push("fw.cursedlast");
      }
      const oppWins = Number((await redis.zscore(PVP_WINS, opp || "").catch(() => 0)) || 0);
      if (oppWins >= 25) award.push("fw.giant");
      if (oppWins >= 100) award.push("fw.titan");
      if (oppWins >= 25 && sweep) award.push("fw.giantsweep");
      if (match.winnerCrateRarity === "ultra") counters.push({ key: "ultras", op: "add" }, { key: "ultrasday", op: "dayAdd" });
    }
    events.push({ userId, award, counters, context: { game: "faction-wars", challengeId: match.challengeId } });
  }
  await sendBadges(events);
}

/** A challenge was accepted: the challenger has thrown down a gauntlet someone picked up. */
export async function gauntletBadge(challengerPlayerId: string): Promise<void> {
  const u = await resolveByPlayerId(challengerPlayerId).catch(() => null);
  if (u?.userId) await sendBadges([{ userId: u.userId, counters: [{ key: "fw.duels", op: "add" }] }]);
}

/** A tournament moved on: semifinal, final and champion badges. */
export async function tournamentBadges(t: { id: string; size: number; rounds: { matches: unknown[] }[]; participants: { playerId: string; eliminatedRound?: number | null }[]; championPlayerId?: string | null; status: string }, roundIndex: number, winnerPlayerId: string, loserPlayerId: string): Promise<void> {
  const total = t.rounds.length;
  const events: BadgeEvent[] = [];
  const uid = async (pid: string) => (await resolveByPlayerId(pid).catch(() => null))?.userId || null;
  const w = await uid(winnerPlayerId), l = await uid(loserPlayerId);
  // reaching the semifinal = playing a match in the round before the final; the final = the last round
  if (roundIndex === total - 2) for (const u of [w, l]) if (u) events.push({ userId: u, award: ["fwt.semi"] });
  if (roundIndex === total - 1) {
    for (const u of [w, l]) if (u) events.push({ userId: u, counters: [{ key: "fwt.finals", op: "add" }] });
    if (w) events.push({ userId: w, award: t.size >= 32 ? ["fwt.champ32"] : [], counters: [{ key: "fwt.champs", op: "add" }, { key: "fwt.champstreak", op: "streak", hit: true }] });
    for (const p of t.participants) {
      if (p.playerId === winnerPlayerId) continue;
      const u = await uid(p.playerId);
      if (u) events.push({ userId: u, counters: [{ key: "fwt.champstreak", op: "streak", hit: false }] });
    }
  }
  await sendBadges(events);
}

/** A tournament was seeded: everyone in it played in a seeded tournament. */
export async function tournamentSeededBadges(participants: { playerId: string }[]): Promise<void> {
  const events: BadgeEvent[] = [];
  for (const p of participants) {
    const u = await resolveByPlayerId(p.playerId).catch(() => null);
    if (u?.userId) events.push({ userId: u.userId, counters: [{ key: "fwt.played", op: "add" }] });
  }
  await sendBadges(events);
}

/**
 * The Rebel Campaign (Faction Wars solo with a connected Rebel, run on the server by the RAAP solo
 * engine). Call once when a campaign reaches its final result, with the economy userId of the player
 * and the campaign state; `withRebel` = the Rebel made at least one move (raapActionCount > 0).
 * Not wired yet: the call belongs in the RAAP solo settle step, which only the RAAP side changes.
 */
export async function soloCampaignBadges(userId: string, s: { team: string[]; results: { won: boolean; rounds: { playerMove?: { id?: string } }[] }[]; rarity: string; healUsed: number; strategicRetreatUsed?: boolean }, withRebel: boolean): Promise<void> {
  const award: string[] = [];
  const counters: BadgeOp[] = [{ key: "fwc.campaigns", op: "add" }];
  const wins = s.results.filter((t) => t.won).length;
  if (s.rarity === "ultra") {
    counters.push({ key: "fwc.legends", op: "add" });
    for (const f of s.team) counters.push({ key: "fwc.ultrafactions", op: "distinct", item: f });
    if (s.team.includes("shogun")) award.push("fwc.divine");
    if (!s.healUsed) award.push("fwc.untended");
  }
  if (wins === 0 && s.rarity === "common" && s.strategicRetreatUsed) award.push("fwc.retreat");
  if (s.results.some((t) => t.won && t.rounds.length && t.rounds[t.rounds.length - 1]?.playerMove?.id === "berserker_rage")) award.push("fwc.berserker");
  if (withRebel && wins >= 3) award.push("fwc.together");
  await sendBadges([{ userId, award, counters, context: { game: "faction-wars", mode: "rebel-campaign" } }]);
}
