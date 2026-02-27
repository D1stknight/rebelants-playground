// pages/api/shop/claim.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import { redis } from "../../../lib/server/redis";

const RPC_URL = process.env.APECHAIN_RPC_URL || "";
const SHOP_ADDRESS = (process.env.SHOP_CONTRACT_ADDRESS || "").toLowerCase();

function balKey(playerId: string) {
  return `ra:points:bal:${playerId}`;
}

function claimedKey(txHash: string) {
  return `ra:shop:claimed:${txHash.toLowerCase()}`;
}

const eventAbi = parseAbiItem(
  "event PointsPurchased(address indexed buyer, uint256 indexed packId, uint256 apePaid, uint256 pointsOut)"
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!RPC_URL || !SHOP_ADDRESS) {
      return res.status(500).json({ ok: false, error: "Missing RPC/SHOP env" });
    }

    const { txHash } = (req.body ?? {}) as { txHash?: string };
    const hash = String(txHash || "").trim();
    if (!hash || !hash.startsWith("0x")) {
      return res.status(400).json({ ok: false, error: "Invalid txHash" });
    }

    // prevent double claim
    const already = await redis.get(claimedKey(hash));
    if (already) {
      return res.status(200).json({ ok: true, alreadyClaimed: true });
    }

    const client = createPublicClient({ transport: http(RPC_URL) });

    const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });

    // find our event log emitted by our shop contract
    const shopLogs = receipt.logs.filter((l) => (l.address || "").toLowerCase() === SHOP_ADDRESS);
    if (!shopLogs.length) {
      return res.status(400).json({ ok: false, error: "No shop logs found in tx" });
    }

    // decode the PointsPurchased event
    let buyer: string | null = null;
    let pointsOut = 0;

    for (const log of shopLogs) {
      try {
      const decoded = decodeEventLog({
  abi: [eventAbi],
  data: log.data,
  topics: log.topics,
});

        if (decoded.eventName === "PointsPurchased") {
          const args = decoded.args as any;
          buyer = String(args.buyer || "").toLowerCase();
          pointsOut = Number(args.pointsOut || 0);
          break;
        }
      } catch {
        // ignore other logs
      }
    }

    if (!buyer || !pointsOut || pointsOut <= 0) {
      return res.status(400).json({ ok: false, error: "PointsPurchased event not found" });
    }

    // credit points to playerId = wallet address
    const newBal = await redis.incrby(balKey(buyer), pointsOut);

    // mark claimed forever (or you can set TTL if you prefer)
    await redis.set(claimedKey(hash), JSON.stringify({ buyer, pointsOut, ts: Date.now() }));

    return res.status(200).json({
      ok: true,
      playerId: buyer,
      credited: pointsOut,
      balance: Number(newBal || 0),
      txHash: hash,
    });
  } catch (e: any) {
    console.error("shop claim error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
