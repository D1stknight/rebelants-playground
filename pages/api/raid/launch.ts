// pages/api/raid/launch.ts
// The Raid, fought on the server: it charges the entry (the live raidCost + the squad's role costs), rolls
// each ant's survival (lib/raidRules.ts), picks the crate's prize (lib/server/prizeTable.ts) and pays its
// points. The page only shows the battle it is sent. POST { playerId, squad } → { raidId, slots, rarity,
// prize, credited, balance }. If the prize's credit failed (502 with raidId), POST { playerId, raidId }
// pays it (the same idempotency key, so never twice).
import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { redis } from "../../../lib/server/redis";
import { actingPlayer } from "../../../lib/server/player-auth";
import { economyCredit, economyDebit, idemKey } from "../../../lib/economy";
import { isFirstMinuteAfterMidnight, runEvent, sendBadges, type BadgeOp } from "../../../lib/server/badges";
import { loadLiveConfig } from "../../../lib/server/gameRuns";
import { prizeFor } from "../../../lib/server/prizeTable";
import { saveWonPrize } from "../../../lib/server/prizesWon";
import { addToEarnedTotal, updateBalanceLeaderboard } from "../../../lib/server/leaderboards";
import { calcSquadCost, isSquad, raidRarity, simulateBattle } from "../../../lib/raidRules";

const RESULT_KEY = (id: string) => `ra:raid:result:${id}`;
const LAST_KEY = (userId: string) => `ra:raid:last:${userId}`;

async function payPrize(result: any): Promise<{ ok: boolean; credited: number; balance?: number }> {
  const pts = result.prize?.type === "points" ? Math.max(0, Math.floor(Number(result.prize.points || 0))) : 0;
  if (pts <= 0) return { ok: true, credited: 0 };
  const credit = await economyCredit({
    userId: result.userId,
    amount: pts,
    reason: "Playground Raid crate",
    idempotencyKey: idemKey(["raid", result.raidId, "prize"]),
    metadata: { playerId: result.playerId, game: "expedition", raidId: result.raidId, rarity: result.rarity },
  });
  return credit.ok ? { ok: true, credited: pts, balance: credit.balance } : { ok: false, credited: 0 };
}

const view = (r: any, pay: { credited: number; balance?: number }) => ({
  ok: true, raidId: r.raidId, slots: r.slots, rarity: r.rarity, prize: r.prize, cost: r.cost, repeat: r.repeat,
  credited: pay.credited, balance: pay.balance,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const who = await actingPlayer(req, String(body.playerId || "guest").trim().slice(0, 64) || "guest");
    if (!who.ok) return res.status(401).json({ ok: false, error: who.signIn ? "Sign in again to raid." : "Sign in to raid.", signIn: who.signIn });
    const userId = who.user.userId;

    // a raid whose crate did not get paid: pay it now
    if (body.raidId) {
      const raw = await redis.get(RESULT_KEY(String(body.raidId).slice(0, 40)));
      const r: any = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
      if (!r || r.userId !== userId) return res.status(404).json({ ok: false, error: "Raid not found" });
      const pay = await payPrize(r);
      if (!pay.ok) return res.status(502).json({ ok: false, raidId: r.raidId, error: "Your crate is safe: its REBEL could not be paid yet. Try again in a moment." });
      return res.status(200).json(view(r, pay));
    }

    if (!isSquad(body.squad)) return res.status(400).json({ ok: false, error: "A raid needs a full squad of 20 ants." });
    const squad = body.squad;
    const cfg = await loadLiveConfig();
    const cost = Math.max(0, Math.floor(Number(cfg.raidCost ?? 600))) + calcSquadCost(squad);
    if (Number(who.user.balance) < cost) return res.status(400).json({ ok: false, error: "Not enough REBEL for this raid.", balance: who.user.balance, cost });

    const raidId = `x${Date.now().toString(36)}${randomBytes(9).toString("hex")}`;
    const debit = await economyDebit({
      userId,
      amount: cost,
      reason: "expedition",
      idempotencyKey: idemKey(["raid", raidId, "entry"]),
      metadata: { playerId: who.playerId, reason: "expedition", raidId },
    });
    if (!debit.ok) return res.status(502).json({ ok: false, error: "Couldn't charge the raid: check your REBEL balance." });

    // the same squad as this account's last raid marches a little worse (0.9)
    const sq = JSON.stringify(squad);
    const last = await redis.get(LAST_KEY(userId));
    const repeat = (typeof last === "string" ? last : last ? JSON.stringify(last) : "") === sq;
    await redis.set(LAST_KEY(userId), sq, { ex: 30 * 24 * 60 * 60 });

    const slots = simulateBattle(squad, cfg, repeat ? 0.9 : 1.0);
    let rarity: string = raidRarity(slots, cfg);
    const prize = await prizeFor(rarity as any, cfg, cfg.currency || "REBEL", false);
    if (prize.type === "none") rarity = "none";
    if (prize.type === "nft" || prize.type === "merch") {
      prize.wonId = await saveWonPrize({ playerId: who.playerId, userId, game: "expedition", rarity, prize });
    }
    const result = { raidId, userId, playerId: who.playerId, cost, repeat, slots, rarity, prize, at: Date.now() };
    await redis.set(RESULT_KEY(raidId), JSON.stringify(result), { ex: 7 * 24 * 60 * 60 });

    const pay = await payPrize(result);
    await raidBadges(userId, result).catch(() => undefined);
    if (!pay.ok) return res.status(502).json({ ok: false, raidId, error: "Your crate is safe: its REBEL could not be paid yet. Try again in a moment." });
    if (pay.credited > 0) {
      await addToEarnedTotal(who.playerId, pay.credited).catch(() => {});
      await updateBalanceLeaderboard(who.playerId, Number(pay.balance || 0)).catch(() => {});
    }
    return res.status(200).json(view(result, { credited: pay.credited, balance: pay.ok && pay.credited > 0 ? pay.balance : debit.balance }));
  } catch (e) {
    console.error("raid/launch", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

/** Badges from a raid (decided on the server above). */
async function raidBadges(userId: string, r: { raidId: string; repeat: boolean; slots: { role: string; survived: boolean | null }[]; rarity: string; prize: any }) {
  const award: string[] = [];
  const counters: BadgeOp[] = [{ key: "raid.raids", op: "add" }, { key: "raid.ultrastreak", op: "streak", hit: r.rarity === "ultra" }, { key: "raid.freshstreak", op: "streak", hit: !r.repeat }];
  const slots = r.slots;
  const crate = r.rarity !== "none";
  const carriers = slots.filter((s) => s.role === "carrier");
  const carriersHome = carriers.filter((s) => s.survived).length;
  const survivors = slots.filter((s) => s.survived).length;
  if (r.rarity === "rare") counters.push({ key: "raid.rares", op: "add" });
  if (r.rarity === "ultra") counters.push({ key: "raid.ultras", op: "add" }, { key: "ultras", op: "add" }, { key: "ultrasday", op: "dayAdd" });
  if (carriers.length >= 4 && carriersHome === carriers.length) counters.push({ key: "raid.carriers", op: "add" });
  if (slots.filter((s) => s.role !== "bomber").every((s) => s.survived)) counters.push({ key: "raid.nobody", op: "add" });
  if (carriers.length && slots.every((s, i) => s.role !== "carrier" || (s.survived && slots[i - 1]?.role === "guard" && slots[i + 1]?.role === "guard"))) award.push("raid.wall");
  if (crate && slots.slice(0, 4).every((s) => s.role === "scout")) award.push("raid.scouts");
  if (crate && slots.filter((s) => s.role === "bomber").length >= 3) award.push("raid.bombers");
  if (r.rarity === "rare" && carriersHome === 1) award.push("raid.lone");
  if (r.rarity === "ultra" && !slots.some((s) => s.role === "guard")) award.push("raid.boldultra");
  if (crate && slots.every((s) => s.role === "soldier")) award.push("pgsecret.allsoldiers");
  if (survivors === 0) counters.push({ key: "raid.mourns", op: "add" });
  if (isFirstMinuteAfterMidnight()) award.push("pgsecret.midnight");
  // the first raid of the (Eastern) day earned a crate: counts once a day
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const first = await redis.set("ra:badge:raidday:" + userId + ":" + day, "1", { nx: true, ex: 36 * 3600 }).catch(() => null);
  if (first && crate) counters.push({ key: "raid.morning", op: "dayCount" });
  if (r.prize?.type === "nft") { award.push("raid.nft"); counters.push({ key: "treasures", op: "add" }); }
  else if (r.prize?.type === "merch") counters.push({ key: "treasures", op: "add" });
  await sendBadges([runEvent(userId, "raid", { award, counters, context: { raidId: r.raidId, rarity: r.rarity } })]);
}
