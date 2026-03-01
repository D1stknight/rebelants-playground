// pages/api/identity/link-wallet.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { recoverMessageAddress } from "viem";

function normalizeWallet(w: any) {
  const s = String(w || "").trim().toLowerCase();
  if (!s.startsWith("0x")) return "";
  if (s.length < 10) return "";
  return s;
}

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function todayKey(playerId: string) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `ra:points:earned:${playerId}:${yyyy}-${mm}-${dd}`;
}

function nonceKey(guestId: string, wallet: string) {
  return `ra:identity:nonce:${guestId}:${wallet}`;
}

function linkedKey(wallet: string) {
  return `ra:identity:linked:wallet:${wallet}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const guestId = String(body.guestId || "").trim().slice(0, 64);
    const wallet = normalizeWallet(body.walletAddress);
    const signature = String(body.signature || "").trim();
    const nonce = String(body.nonce || "").trim();

    if (!guestId) return res.status(400).json({ ok: false, error: "Missing guestId" });
    if (!wallet) return res.status(400).json({ ok: false, error: "Invalid walletAddress" });
    if (!signature) return res.status(400).json({ ok: false, error: "Missing signature" });
    if (!nonce) return res.status(400).json({ ok: false, error: "Missing nonce" });

    // ✅ reject if already linked
    const already = await redis.get(linkedKey(wallet));
    if (already) {
      return res.status(200).json({ ok: true, alreadyLinked: true, playerId: `wallet:${wallet}` });
    }

    // ✅ validate nonce matches what we issued
    const storedNonceRaw = await redis.get<string>(nonceKey(guestId, wallet));
    const storedNonce = String(storedNonceRaw || "");
    if (!storedNonce || storedNonce !== nonce) {
      return res.status(400).json({ ok: false, error: "Invalid or expired nonce" });
    }

    // ✅ verify signature
    const message =
      `Rebel Ants Link Wallet\n` +
      `Guest: ${guestId}\n` +
      `Wallet: ${wallet}\n` +
      `Nonce: ${nonce}`;

    const recovered = (await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    })).toLowerCase();

    if (recovered !== wallet) {
      return res.status(400).json({ ok: false, error: "Signature does not match wallet" });
    }

    const walletPid = `wallet:${wallet}`;

    // ✅ migrate balance
    const guestBalRaw = await redis.get<number>(balKey(guestId));
    const guestBal = Number(guestBalRaw || 0);

    if (guestBal > 0) {
      await redis.incrby(balKey(walletPid), guestBal);
      await redis.set(balKey(guestId), 0);
    }

    // ✅ migrate today's earned tally (so cap works correctly)
    const gEarnKey = todayKey(guestId);
    const wEarnKey = todayKey(walletPid);

    const guestEarnRaw = await redis.get<number>(gEarnKey);
    const guestEarn = Number(guestEarnRaw || 0);

    if (guestEarn > 0) {
      await redis.incrby(wEarnKey, guestEarn);
      await redis.set(gEarnKey, 0);
    }

    // ✅ mark linked
    await redis.set(linkedKey(wallet), walletPid);

    // ✅ burn nonce
    await redis.del(nonceKey(guestId, wallet));

    const newBalRaw = await redis.get<number>(balKey(walletPid));
    const newBal = Number(newBalRaw || 0);

    return res.status(200).json({
      ok: true,
      playerId: walletPid,
      migrated: { balance: guestBal, earnedToday: guestEarn },
      balance: newBal,
    });
  } catch (e: any) {
    console.error("link-wallet error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
