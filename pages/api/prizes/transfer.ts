// pages/api/prizes/transfer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";

// NOTE: This assumes you have `ethers` installed.
// If your build errors on ethers v6 vs v5, tell me and I’ll swap it to match.
import { ethers } from "ethers";

function claimKey(id: string) {
  return `ra:claim:${id}`;
}
function transferLockKey(id: string) {
  return `ra:claim:${id}:transferLock`;
}

const ERC721_ABI = [
  "function safeTransferFrom(address from, address to, uint256 tokenId) external",
];

function getEnvForChain(chain: string) {
  const c = String(chain || "").toUpperCase();

  if (c === "APECHAIN") {
    return {
      rpcUrl: process.env.APECHAIN_RPC_URL || "",
      pk: process.env.TREASURY_PK_APECHAIN || "",
      from: process.env.TREASURY_ADDRESS || "",
    };
  }

  // default ETH
  return {
    rpcUrl: process.env.ETH_RPC_URL || "",
    pk: process.env.TREASURY_PK_ETH || "",
    from: process.env.TREASURY_ADDRESS || "",
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const rawBody = req.body;
const body =
  typeof rawBody === "string"
    ? (rawBody.trim() ? JSON.parse(rawBody) : {})
    : (rawBody ?? {});
    const claimId = String(body.claimId || "").trim();

    if (!claimId) return res.status(400).json({ ok: false, error: "Missing claimId" });

    // lock so we never double-send
    const locked = await redis.set(transferLockKey(claimId), "1", { nx: true, ex: 60 * 10 });
    if (!locked) {
      return res.status(200).json({ ok: true, alreadyRunning: true });
    }

    const raw: any = await redis.get<any>(claimKey(claimId));
if (!raw) return res.status(404).json({ ok: false, error: "Claim not found" });

const claim =
  typeof raw === "string"
    ? (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })()
    : raw;

if (!claim) {
  return res.status(500).json({ ok: false, error: "Claim payload invalid" });
}
    const prize = claim?.prize;
    const wallet = String(claim?.wallet || "").trim();

    if (!prize || prize.type !== "nft") {
      return res.status(400).json({ ok: false, error: "Claim is not an NFT prize" });
    }
    if (!wallet || !wallet.startsWith("0x") || wallet.length < 10) {
      return res.status(400).json({ ok: false, error: "Missing/invalid recipient wallet" });
    }

    const chain = String(prize?.meta?.chain || prize?.meta?.network || "ETH").toUpperCase();
    const contract = String(prize?.meta?.contract || "").trim();
    const tokenId = String(prize?.meta?.tokenId ?? "").trim();

    if (!contract || !tokenId) {
      return res.status(400).json({ ok: false, error: "Missing contract/tokenId in prize.meta" });
    }

    const env = getEnvForChain(chain);
    if (!env.rpcUrl || !env.pk || !env.from) {
      return res.status(500).json({ ok: false, error: "Missing RPC/treasury env vars" });
    }

    const provider = new ethers.JsonRpcProvider(env.rpcUrl);
    const signer = new ethers.Wallet(env.pk, provider);
    const nft = new ethers.Contract(contract, ERC721_ABI, signer);

    // execute transfer
    const tx = await nft.safeTransferFrom(env.from, wallet, BigInt(tokenId));
    const receipt = await tx.wait();

    // mark claim complete
    claim.status = "FULFILLED";
claim.fulfilledAt = Date.now();
claim.txHash = receipt?.hash || tx?.hash || null;

await redis.set(claimKey(claimId), JSON.stringify(claim));
await redis.expire(claimKey(claimId), 60 * 60 * 24 * 90);

/* ---------------------------------
   Remove NFT from inventory
---------------------------------- */

try {
  const invKey = "ra:inv:ultra:nft";
  const raw = await redis.lrange(invKey, 0, -1);

  const filtered = (raw || []).filter((item: any) => {
    try {
      const obj = typeof item === "string" ? JSON.parse(item) : item;
      return String(obj?.meta?.tokenId) !== String(tokenId);
    } catch {
      return true;
    }
  });

  await redis.del(invKey);

  if (filtered.length) {
    await redis.rpush(invKey, ...filtered);
  }
} catch (e) {
  console.warn("Inventory removal failed", e);
}

/* ---------------------------------
   Release transfer lock
---------------------------------- */

await redis.del(transferLockKey(claimId));

return res.status(200).json({ ok: true, txHash: claim.txHash });
  } catch (e: any) {
  console.error("prizes/transfer error:", e);

  // ✅ release lock if transfer fails
  try {
    const claimId = String(req.body?.claimId || "");
    if (claimId) {
      await redis.del(transferLockKey(claimId));
    }
  } catch {}

  return res.status(500).json({ ok: false, error: e?.message || "Server error" });
}
}
