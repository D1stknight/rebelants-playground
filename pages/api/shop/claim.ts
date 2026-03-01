// pages/api/shop/claim.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createPublicClient, http } from "viem";
import { redis } from "../../../lib/server/redis";
import { rateLimit } from "../../../lib/server/ratelimit";

const RPC_URL = process.env.APECHAIN_RPC_URL || "";
const SHOP_ADDRESS = (process.env.APECHAIN_SHOP_ADDRESS || "").toLowerCase();

// Packs (locked: 1 APE = 100 pts, no refunds)
const PACK_POINTS: Record<number, number> = {
  1: 2500,  // Starter
  2: 11000, // Value
  3: 60000, // Whale
};

// Our deployed contract emits:
// PointsPurchased(address indexed buyer, uint8 indexed packId, uint256 amountPaidWei)
// NOTE: buyer + packId are indexed => they live in topics[1] and topics[2].
const EVENT_SIG =
  "0x1f32a5903f43801a219f2d82e57bec771e9286fcd8c05b181aa38e09ce0d7930";

// ---------------- Redis keys ----------------
function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}
function claimedKey(txHash: string, logIndex: number) {
  return `ra:shop:claimed:${txHash.toLowerCase()}:${logIndex}`;
}
function walletToPlayerKey(wallet: string) {
  return `ra:shop:walletToPlayer:${wallet.toLowerCase()}`;
}
function playerToWalletKey(playerId: string) {
  return `ra:shop:playerToWallet:${playerId}`;
}

// ---------------- utils ----------------
function asStr(v: any) {
  return typeof v === "string" ? v : "";
}
function cleanPlayerId(v: any) {
  return String(v || "guest").trim().slice(0, 64) || "guest";
}
function cleanWallet(v: any) {
  return asStr(v).trim().toLowerCase();
}
function isHexTx(v: string) {
  return /^0x[a-f0-9]{64}$/i.test(v);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 🚫 never cache
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!RPC_URL) return res.status(500).json({ ok: false, error: "Missing APECHAIN_RPC_URL" });
    if (!SHOP_ADDRESS) return res.status(500).json({ ok: false, error: "Missing APECHAIN_SHOP_ADDRESS" });

        const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = cleanPlayerId(body.playerId);
    const walletAddress = cleanWallet(body.walletAddress);
    const txHash = asStr(body.txHash).trim();

    if (!walletAddress) return res.status(400).json({ ok: false, error: "Missing walletAddress" });
    if (!txHash || !isHexTx(txHash)) return res.status(400).json({ ok: false, error: "Invalid txHash" });

    // ✅ Abuse protection: rate limit by IP + wallet
    const ip =
      (asStr(req.headers["x-forwarded-for"]) || "").split(",")[0].trim() ||
      asStr(req.headers["x-real-ip"]) ||
      "unknown";

    const rl = await rateLimit({
      key: `shop-claim:${ip}:${walletAddress}`,
      limit: 12,        // 12 attempts
      windowSec: 60,    // per 60 seconds
    });

    if (!rl.ok) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try again in a minute." });
    }

    const client = createPublicClient({ transport: http(RPC_URL) });

        // Pull the receipt and decode our event from logs
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    // ✅ Receipt sanity checks
    if ((receipt as any)?.status && (receipt as any).status !== "success") {
      return res.status(400).json({ ok: false, error: "Transaction did not succeed" });
    }

    const toAddr = String((receipt as any)?.to || "").toLowerCase();
    if (!toAddr || toAddr !== SHOP_ADDRESS) {
      return res.status(400).json({ ok: false, error: "Transaction was not sent to the Shop contract" });
    }

    // Find matching shop events (address must match)
    const matches = (receipt.logs || []).filter(
      (l) => (l.address || "").toLowerCase() === SHOP_ADDRESS
    );

    if (!matches.length) {
      return res.status(400).json({ ok: false, error: "No shop logs found for this tx" });
    }

   // Find PointsPurchased emitted by SHOP_ADDRESS for this wallet
let found: { logIndex: number; packId: number; points: number } | null = null;

for (const log of matches) {
  const topics = (log.topics || []) as string[];

  // Must be our event signature
  if (!topics[0] || String(topics[0]).toLowerCase() !== EVENT_SIG) continue;

  // buyer is indexed => topics[1] ends with the buyer address (last 40 hex chars)
  const buyerTopic = String(topics[1] || "");
  const buyer = ("0x" + buyerTopic.slice(-40)).toLowerCase();
  if (buyer !== walletAddress) continue;

  // packId is indexed uint8 => topics[2], last byte is the packId
  const packTopic = String(topics[2] || "0x0");
  const packId = parseInt(packTopic.slice(-2), 16);

  const points = PACK_POINTS[packId] || 0;
  if (!points || points <= 0) {
    return res.status(400).json({ ok: false, error: "Could not determine points for this purchase" });
  }

  found = { logIndex: Number(log.logIndex ?? 0), packId, points };
  break;
}
    if (!found) {
      return res.status(400).json({ ok: false, error: "No matching PointsPurchased event for this wallet" });
    }

    // --------- Idempotency: claim ONCE per txHash+logIndex ----------
    // Use NX so multiple clicks can’t double-credit.
    const claimed = await redis.set(claimedKey(txHash, found.logIndex), "1", {
      nx: true,
      ex: 60 * 60 * 24 * 14, // keep claim markers 14 days
    });

    if (claimed === null) {
      // already claimed
      const balRaw = await redis.get<number>(balKey(playerId));
      const balance = Number(balRaw || 0);
      return res.status(200).json({
        ok: true,
        alreadyClaimed: true,
        playerId,
        walletAddress,
        packId: found.packId,
        points: found.points,
        balance,
      });
    }

    // --------- Save wallet <-> playerId mapping ----------
    await redis.set(walletToPlayerKey(walletAddress), playerId);
    await redis.set(playerToWalletKey(playerId), walletAddress);

    // --------- Credit points to player balance ----------
    const beforeRaw = await redis.get<number>(balKey(playerId));
    const before = Number(beforeRaw || 0);
    const after = before + found.points;
    await redis.set(balKey(playerId), after);

    return res.status(200).json({
      ok: true,
      playerId,
      walletAddress,
      packId: found.packId,
      points: found.points,
      balance: after,
    });
  } catch (err: any) {
    console.error("shop/claim error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
