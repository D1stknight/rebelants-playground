// pages/api/points/claim.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { etDay, nextEtMidnight } from "../../../lib/server/day";
import { redis } from "../../../lib/server/redis";
import { loadLiveConfig } from "../../../lib/server/gameRuns";
import { economyCredit, idemKey } from "../../../lib/economy";
import { sendBadges } from "../../../lib/server/badges";
import { actingPlayer } from "../../../lib/server/player-auth";

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function claimKey(playerId: string) {
  return `ra:points:claimed:${playerId}:${etDay()}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const claimedId =
      String((req.method === "GET" ? req.query.playerId : (req.body ?? {}).playerId) || "guest")
        .trim()
        .slice(0, 64) || "guest";
    let playerId = claimedId;
    let key = claimKey(playerId);

    // ✅ GET = status only (claimed today?) + next claim timer
    if (req.method === "GET") {
      const exists = await redis.get<number>(key);

      const now = new Date();
      const nextUtcMidnight = nextEtMidnight(now.getTime()); // the day resets at midnight ET (lib/server/day.ts)

      const nextClaimAt = nextUtcMidnight.toISOString();
      const msUntilNextClaim = Math.max(0, nextUtcMidnight.getTime() - now.getTime());

      return res.status(200).json({
        ok: true,
        playerId,
        claimed: !!exists,
        nextClaimAt,
        msUntilNextClaim,
      });
    }

    // ✅ POST = attempt claim (server enforces once/day)
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // the server decides the claim amount: the live config's dailyClaim, never the request's (0 = no claim)
    const liveCfg = await loadLiveConfig();
    const amount = Math.floor(Number((liveCfg as any).dailyClaim || 0));

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "The daily claim is off right now." });
    }

    // Daily claim now credits the central economy ledger.
    // Requires a signed-in identity (no guest claims): the player a signed session
    // proves (lib/server/player-auth.ts), and the once-a-day key is that player's.
    const who = await actingPlayer(req, claimedId);
    if (!who.ok) {
      return res
        .status(401)
        .json({ ok: false, error: who.signIn ? "Sign in again to claim daily $REBEL." : "Sign in with Discord to claim daily $REBEL.", signIn: who.signIn });
    }
    const economyUser = who.user;
    playerId = who.playerId;
    key = claimKey(playerId);

    // ✅ once-per-day guard (atomic), per Rebel Economy account: a Discord id and the wallet the economy keeps
    // on the same account claim once between them (the player's own key still answers the GET above)
    // SETNX-like: only set if not exists
    const acctKey = claimKey(`u:${economyUser.userId}`);
    const set = await redis.set(acctKey, 1, { nx: true, ex: 60 * 60 * 48 }); // keep 48h
    if (set) await redis.set(key, 1, { ex: 60 * 60 * 48 });

    if (!set) {
      // already claimed today
      const balNow = economyUser.balance;
      return res.status(409).json({
        ok: false,
        error: "already_claimed",
        playerId,
        claimed: true,
        alreadyClaimed: true,
        added: 0,
        balance: balNow,
      });
    }

    // Credit the central economy ledger (shared balance).
    const credit = await economyCredit({
      userId: economyUser.userId,
      amount,
      reason: "Playground daily claim",
      type: "claim_code",
      idempotencyKey: idemKey(["dailyclaim", economyUser.userId, key]),
      metadata: { playerId },
    });
    if (!credit.ok) {
      // Roll back the once-per-day lock so the user can retry.
      try { await redis.del(key, acctKey); } catch {}
      return res.status(502).json({ ok: false, error: "Economy credit failed" });
    }
    const newBal = credit.balance;
    await sendBadges([{ userId: economyUser.userId, counters: [{ key: "claims", op: "dayCount" }], context: { game: "daily-claim" } }]);

    return res.status(200).json({
      ok: true,
      playerId,
      claimed: true,
      alreadyClaimed: false,
      added: amount,
      balance: Number(newBal || 0),
    });
  } catch (e: any) {
    console.error("claim error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
