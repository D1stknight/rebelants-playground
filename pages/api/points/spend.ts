// pages/api/points/spend.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { economyDebit, idemKey } from "../../../lib/economy";
import { actingPlayer } from "../../../lib/server/player-auth";
import { RUN_RULES, isRunGame, loadLiveConfig, openRun } from "../../../lib/server/gameRuns";

function capBankKey(playerId: string) {
  return `ra:points:capbank:${playerId}`;
}

function spentTodayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:spent:${playerId}:${yyyy}-${mm}-${dd}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const claimed = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const amountRaw = body.amount;
    let reason = String(body.reason || "").trim();

    // ✅ the live config the admin page saves (ra:config:economy), over the defaults
    const liveCfg = await loadLiveConfig();

    const amt = Number(amountRaw || 0);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    // The Raid is played on the server now (pages/api/raid/launch.ts): an older page that still pays here would
    // pay and win nothing.
    if (reason === "expedition") {
      return res.status(409).json({ ok: false, code: "reload", error: "The Raid has been updated: reload the page to play." });
    }

    // ✅ A game's entry fee: only the fee the game takes (the live config), and it opens the game's run
    // (lib/server/gameRuns.ts), so the game's payout is the server's to decide.
    const healCost = Number(liveCfg.factionWarsHealCost ?? 25);
    let game = isRunGame(reason) ? reason : null;
    if (game) {
      const entries = RUN_RULES[game].entries(liveCfg);
      if (!entries.includes(amt)) {
        // a Faction Wars heal from an older page (newer pages say "faction-wars-heal")
        if (game === "faction-wars" && amt === healCost) {
          game = null;
          reason = "faction-wars-heal";
        } else {
          return res.status(400).json({
            ok: false,
            error: `Invalid ${RUN_RULES[game].label} cost. Expected ${entries[0]}, got ${amt}`,
            expected: entries[0],
            got: amt,
          });
        }
      }
    }
    if (reason === "faction-wars-heal" && amt !== healCost) {
      return res.status(400).json({ ok: false, error: `Invalid heal cost. Expected ${healCost}, got ${amt}`, expected: healCost, got: amt });
    }

    // Current balance now comes from the central economy ledger.
    // Spending requires a signed-in identity (no guest spends). Only a player a
    // signed session proves can spend (lib/server/player-auth.ts).
    const who = await actingPlayer(req, claimed);
    if (!who.ok) {
      return res
        .status(401)
        .json({ ok: false, error: who.signIn ? "Sign in again to play." : "Sign in with Discord to play.", signIn: who.signIn });
    }
    const economyUser = who.user;
    const playerId = who.playerId;
    const bal = economyUser.balance;

    if (bal < amt) {
      return res.status(400).json({ ok: false, error: "Insufficient balance", balance: bal });
    }

    // ✅ Shared play-cap enforcement for all gameplay spends
    let spentToday = 0;
    let capBank = 0;
    let dailyCap = Number(liveCfg.dailyEarnCap || 0);
    let remainingDaily = dailyCap;
    let totalPlayRoom = dailyCap;

    if (reason === "shuffle" || reason === "tunnel") {
      const spentRaw = await redis.get<number>(spentTodayKey(playerId));
      spentToday = Number(spentRaw || 0);

      const capBankRaw = await redis.get<number>(capBankKey(playerId));
      capBank = Number(capBankRaw || 0);

      remainingDaily = Math.max(0, dailyCap - spentToday);
      totalPlayRoom = remainingDaily + capBank;

      if (amt > totalPlayRoom) {
        return res.status(400).json({
          ok: false,
          error: "No play room left today",
          balance: bal,
          spentToday,
          dailyCap,
          remainingDaily,
          capBank,
          totalPlayRoom,
        });
      }

      const useFromDaily = Math.min(amt, remainingDaily);
      const useFromBank = Math.max(0, amt - useFromDaily);

      if (useFromDaily > 0) {
        await redis.incrby(spentTodayKey(playerId), useFromDaily);
        await redis.expire(spentTodayKey(playerId), 60 * 60 * 48);
      }

      if (useFromBank > 0) {
        await redis.decrby(capBankKey(playerId), useFromBank);
      }

      const updatedSpentRaw = await redis.get<number>(spentTodayKey(playerId));
      spentToday = Number(updatedSpentRaw || 0);

      const updatedCapBankRaw = await redis.get<number>(capBankKey(playerId));
      capBank = Number(updatedCapBankRaw || 0);

      remainingDaily = Math.max(0, dailyCap - spentToday);
      totalPlayRoom = remainingDaily + capBank;
    }

    // Deduct from the central economy ledger (shared balance).
    const debit = await economyDebit({
      userId: economyUser.userId,
      amount: amt,
      reason: reason || "Playground spend",
      idempotencyKey: idemKey(["spend", economyUser.userId, Date.now(), amt, reason || "play"]),
      metadata: { playerId, reason: reason || undefined },
    });
    if (!debit.ok) {
      return res
        .status(502)
        .json({ ok: false, error: "Economy debit failed" });
    }
    const newBal = debit.balance;

    // the entry is paid: the run the game's payout (or the Shuffle's prize roll) is decided against
    const run = game ? await openRun({ game, userId: economyUser.userId, playerId, entry: amt, cfg: liveCfg }) : null;

    return res.status(200).json({
      ok: true,
      playerId,
      spent: amt,
      reason: reason || undefined,
      runId: run?.id,
      runMax: run ? run.max : undefined,
      balance: Number(newBal || 0),
      spentToday,
      dailyCap,
      remainingDaily,
      capBank,
      totalPlayRoom,
      totalEarnRoom: totalPlayRoom,
    });
  } catch (err: any) {
    console.error("spend error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
