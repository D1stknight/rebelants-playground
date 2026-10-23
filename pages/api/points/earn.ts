// pages/api/points/earn.ts
// A game's payout. The server decides it (lib/server/gameRuns.ts): only within a run
// the player's account paid the entry for, never more than that run can pay.
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { addToEarnedTotal, updateBalanceLeaderboard } from "../../../lib/server/leaderboards";
import { economyCredit, idemKey } from "../../../lib/economy";
import { actingPlayer } from "../../../lib/server/player-auth";
import { decidePayout, loadLiveConfig } from "../../../lib/server/gameRuns";

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
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { playerId, amount, game, runId } = (req.body ?? {}) as {
      playerId?: string;
      amount?: number;
      game?: string;
      runId?: string;
    };

    const claimed = (playerId || "guest").trim() || "guest";
    const amt = Number(amount || 0);

    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Rewards now credit the central economy ledger (shared balance).
    // Earning requires a signed-in identity; guests cannot mint points. Only a
    // player a signed session proves can earn (lib/server/player-auth.ts).
    const who = await actingPlayer(req, claimed);
    if (!who.ok) {
      return res
        .status(401)
        .json({ error: who.signIn ? "Sign in again to earn $REBEL." : "Sign in with Discord to earn $REBEL.", signIn: who.signIn });
    }
    const economyUser = who.user;
    const pid = who.playerId;

    const liveCfg = await loadLiveConfig();
    const decision = await decidePayout({ cfg: liveCfg, game, runId, userId: economyUser.userId, playerId: pid, asked: amt });
    if (!decision.ok) {
      return res.status(decision.status).json({ ok: false, error: decision.error, code: decision.code });
    }

    let newBalance = Number(economyUser.balance || 0);
    if (decision.amount > 0) {
      const credit = await economyCredit({
        userId: economyUser.userId,
        amount: decision.amount,
        reason: "Playground reward",
        idempotencyKey: idemKey([decision.key]),
        metadata: { playerId: pid, game: decision.run?.game, runId: decision.run?.id },
      });
      if (!credit.ok) {
        await decision.release();
        return res.status(502).json({ error: "Economy credit failed" });
      }
      newBalance = credit.balance;

      // ✅ Keep lifetime earned leaderboard accurate
      await addToEarnedTotal(pid, decision.amount);

      // ✅ Keep balance leaderboard accurate
      await updateBalanceLeaderboard(pid, Number(newBalance || 0));
    }

    // ✅ Return play-cap info WITHOUT modifying it
    const spentRaw = await redis.get<number>(spentTodayKey(pid));
    const spentToday = Number(spentRaw || 0);

    const capBankRaw = await redis.get<number>(capBankKey(pid));
    const capBank = Number(capBankRaw || 0);

    const dailyCap = Number((liveCfg as any).dailyEarnCap || 0);
    const remainingDaily = Math.max(0, dailyCap - spentToday);
    const totalPlayRoom = remainingDaily + capBank;

    return res.status(200).json({
      ok: true,
      playerId: pid,
      added: decision.amount,
      capped: decision.cut,
      balance: Number(newBalance || 0),
      earnedToday: spentToday,
      spentToday,
      dailyCap,
      remainingDaily,
      capBank,
      totalPlayRoom,
      totalEarnRoom: totalPlayRoom,
    });
  } catch (err: any) {
    console.error("earn error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
