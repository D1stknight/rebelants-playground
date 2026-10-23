// pages/api/prizes/roll.ts
// The prize roll. The server decides it:
//  - a player's Queen's Egg Shuffle roll is paid for: the entry fee opened a run (points/spend). One roll
//    per run, and the roll pays its own points.
//  - Faction Wars (played in the browser) rolls its crate against its own run, in points only: its points
//    were already paid within the run (points/earn), and a battle the server did not see wins no NFT or merch.
//  - only the admin page and the server's own code (RAAP's solo campaign) may name the rarity (?force=).
// An NFT or merch prize is saved as won (lib/server/prizesWon.ts); a claim takes the prize from there.
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultConfig } from "../../../lib/pointsConfig";
import { ROUND_KEY, FAVOR_KEY, ROYAL_KEY, dayKey } from "../shuffle/start";
import { actingPlayer, isAdminRequest, isInternalRequest } from "../../../lib/server/player-auth";
import { readRun, type Run } from "../../../lib/server/gameRuns";
import { saveWonPrize } from "../../../lib/server/prizesWon";
import { prizeFor } from "../../../lib/server/prizeTable";
import { economyCredit, idemKey } from "../../../lib/economy";
import { addToEarnedTotal, updateBalanceLeaderboard } from "../../../lib/server/leaderboards";

const ECON_KEY = "ra:config:economy";

const RARITIES = ["none", "common", "rare", "ultra"] as const;
type Rarity = (typeof RARITIES)[number];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function rollFromWeights(
  weights: Record<string, any> | undefined,
  order: string[],
  fallback: "none" | "common" | "rare" | "ultra"
): "none" | "common" | "rare" | "ultra" {
  if (!weights) return fallback;

  const pairs = order.map((k) => [
    k,
    Math.max(0, Number(weights[k] ?? 0)),
  ] as const);

  const total = pairs.reduce((s, [, v]) => s + v, 0);

  if (!Number.isFinite(total) || total <= 0) return fallback;

  let r = Math.random() * total;

  for (const [k, v] of pairs) {
    r -= v;
    if (r <= 0) return k as any;
  }

  return pairs[pairs.length - 1][0] as any;
}

const ROLL_KEY = (runId: string) => `ra:run:${runId}:roll`;
const ROLLING_KEY = (runId: string) => `ra:run:${runId}:rolling`;
const RUN_TTL = 6 * 60 * 60;

// A Shuffle roll's points go to the run's account once (the same idempotency key on a retry).
async function payRoll(run: Run, result: any): Promise<{ ok: boolean; credited: number; balance?: number }> {
  const pts = result?.prize?.type === "points" ? Math.max(0, Math.floor(Number(result.prize.points || 0))) : 0;
  if (pts <= 0) return { ok: true, credited: 0 };
  const credit = await economyCredit({
    userId: run.userId,
    amount: pts,
    reason: "Playground Shuffle prize",
    idempotencyKey: idemKey(["run", run.id, "roll"]),
    metadata: { playerId: run.playerId, game: "shuffle", runId: run.id, rarity: result.rarity },
  });
  if (!credit.ok) return { ok: false, credited: 0 };
  return { ok: true, credited: pts, balance: credit.balance };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  let rolling: string | null = null;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const trusted = isAdminRequest(req) || isInternalRequest(req);
    const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    let playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";

    // ✅ Load Admin-config from Redis, fallback to defaults
    const raw = await redis.get(ECON_KEY);
    const saved = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;

    // merge: defaults first, then saved overrides
    const cfg: any = {
      ...(defaultConfig as any),
      ...(saved || {}),
      rewards: {
        ...(defaultConfig as any)?.rewards,
        ...(saved as any)?.rewards,
      },
      rarityWeights: {
        ...(defaultConfig as any)?.rarityWeights,
        ...(saved as any)?.rarityWeights,
      },
    };
    const currency = cfg.currency || "REBEL";

    let force: string = trusted ? String(req.query.force || "").toLowerCase() : "";
    let run: Run | null = null;
    if (!trusted) {
      // a player's roll: paid for by the run its entry fee opened, for the player a signed session proves
      const who = await actingPlayer(req, playerId);
      if (!who.ok) {
        return res.status(401).json({ ok: false, error: who.signIn ? "Sign in again to play." : "Sign in to play.", signIn: who.signIn });
      }
      playerId = who.playerId;
      run = await readRun(body.runId);
      if (!run || run.userId !== who.user.userId || (run.game !== "shuffle" && run.game !== "faction-wars")) {
        return res.status(403).json({ ok: false, code: "no_run", error: "Pay the entry to roll: reload the page and play again." });
      }
      // one roll per run; asking again answers the roll the run made (and pays it if that had failed)
      const prevRaw = await redis.get(ROLL_KEY(run.id));
      if (prevRaw) {
        const prev = typeof prevRaw === "string" ? JSON.parse(prevRaw) : prevRaw;
        const pay = run.game === "shuffle" ? await payRoll(run, prev) : { ok: true, credited: 0 };
        if (!pay.ok) return res.status(502).json({ ok: false, error: "Economy credit failed: pick again in a moment." });
        return res.status(200).json({ ...prev, credited: pay.credited, balance: pay.balance, repeat: true });
      }
      if (!(await redis.set(ROLLING_KEY(run.id), "1", { nx: true, ex: RUN_TTL }))) {
        return res.status(409).json({ ok: false, code: "run_done", error: "This run is rolling already." });
      }
      rolling = run.id;
      // Faction Wars names the rarity its battle reached (paid in points only, below)
      if (run.game === "faction-wars") {
        const r = String(body.rarity || "").toLowerCase();
        force = (RARITIES as readonly string[]).includes(r) ? r : "none";
      }
    }

    let extra: Record<string, unknown> = { tracked: false, blessed: false, pity: false, royal: false };
    let rarity: Rarity;
    if ((RARITIES as readonly string[]).includes(force)) {
      rarity = force as Rarity;
    } else {
      // ── shell-game round (pages/api/shuffle/start): did the player pick the marked egg? is this the daily Royal Egg?
      let tracked = false, royal = false, roundOk = false;
      if (body.roundId) {
        const rawRound = await redis.get(ROUND_KEY(String(body.roundId)));
        const round: any = rawRound ? (typeof rawRound === "string" ? JSON.parse(rawRound) : rawRound) : null;
        if (round && round.playerId === playerId) {
          roundOk = true; tracked = Number(body.pick) === Number(round.marked); royal = !!round.royal;
          await redis.del(ROUND_KEY(String(body.roundId)));            // one roll per round
          if (royal) await redis.set(ROYAL_KEY(playerId, dayKey()), "1", { ex: 60 * 60 * 36 });
        }
      }
      const weights: any = { ...(cfg?.rarityWeights || {}) };
      if (royal) weights.ultra = Math.max(0, Number(weights.ultra ?? 0)) * Math.max(1, Number(cfg.shuffleRoyalUltraMult ?? 3));
      // Use Admin-controlled rarity weights if present
      let rolledRarity = rollFromWeights(weights, ["ultra", "rare", "common", "none"], "none");
      // tracked the marked egg → the queen's blessing: a "none" becomes "common" (and a "common" becomes "rare" at a third of the odds)
      const trackBonus = clamp(Number(cfg.shuffleTrackBonus ?? 50) / 100, 0, 1);
      let blessed = false;
      if (tracked && roundOk) {
        if (rolledRarity === "none" && Math.random() < trackBonus) { rolledRarity = "common"; blessed = true; }
        else if (rolledRarity === "common" && Math.random() < trackBonus / 3) { rolledRarity = "rare"; blessed = true; }
      }
      // queen's favor (pity): consecutive empty eggs fill the meter; a full meter guarantees at least a common and resets
      const favorMax = Math.max(1, Number(cfg.shuffleFavorPity ?? 5)); let favor = Number((await redis.get(FAVOR_KEY(playerId))) || 0); let pity = false;
      if (rolledRarity === "none") { favor += 1; if (favor >= favorMax) { rolledRarity = "common"; pity = true; favor = 0; } } else favor = 0;
      await redis.set(FAVOR_KEY(playerId), String(favor), { ex: 60 * 60 * 24 * 30 });
      rarity = rolledRarity;
      extra = { tracked: tracked && roundOk, blessed, pity, royal, favor, favorMax };
    }

    const prize = await prizeFor(rarity, cfg, currency, run?.game === "faction-wars");
    if (prize.type === "nft" || prize.type === "merch") {
      prize.wonId = await saveWonPrize({ playerId, userId: run?.userId || null, game: String(run?.game || body.game || "shuffle").slice(0, 32), rarity, prize });
    }
    const result = { ok: true, ...extra, rarity, prize };

    if (!run) return res.status(200).json(result);
    await redis.set(ROLL_KEY(run.id), JSON.stringify(result), { ex: RUN_TTL });
    rolling = null; // rolled: a repeat answers this result
    if (run.game !== "shuffle") return res.status(200).json({ ...result, credited: 0 });
    const pay = await payRoll(run, result);
    if (!pay.ok) return res.status(502).json({ ok: false, error: "Economy credit failed: pick again in a moment." });
    if (pay.credited > 0) {
      await addToEarnedTotal(playerId, pay.credited).catch(() => {});
      await updateBalanceLeaderboard(playerId, Number(pay.balance || 0)).catch(() => {});
    }
    return res.status(200).json({ ...result, credited: pay.credited, balance: pay.balance });
  } catch (err: any) {
    // a roll that broke before it was saved can be rolled again
    if (rolling) await redis.del(ROLLING_KEY(rolling)).catch(() => 0);
    console.error("prizes/roll error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
