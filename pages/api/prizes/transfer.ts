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

function safeJsonParse(v: any) {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
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

  // Load claim first (so we can be idempotent)
const raw1: any = await redis.get<any>(claimKey(claimId));
if (!raw1) return res.status(404).json({ ok: false, error: "Claim not found" });

let claim: any = safeJsonParse(raw1) ?? raw1;
if (!claim || typeof claim !== "object") {
  return res.status(500).json({ ok: false, error: "Claim payload invalid" });
}

// ✅ If already fulfilled, do NOT require unlock. Just return the txHash.
if (String(claim.status || "").toUpperCase() === "FULFILLED") {
  await redis.del(transferLockKey(claimId)); // safety cleanup
  return res.status(200).json({ ok: true, alreadyFulfilled: true, txHash: claim.txHash || "" });
}

// lock so we never double-send
const locked = await redis.set(transferLockKey(claimId), "1", { nx: true, ex: 60 * 10 });
if (!locked) {
  return res.status(200).json({ ok: true, alreadyRunning: true });
}

// Re-load claim after lock (in case something changed)
const raw2: any = await redis.get<any>(claimKey(claimId));
if (!raw2) {
  await redis.del(transferLockKey(claimId));
  return res.status(404).json({ ok: false, error: "Claim not found" });
}

claim = safeJsonParse(raw2) ?? raw2;
if (!claim || typeof claim !== "object") {
  await redis.del(transferLockKey(claimId));
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
   Remove NFT from inventory (remove EXACTLY ONE)
   Match by inventoryKey first (best), else contract+tokenId
---------------------------------- */

try {
  const invKey = "ra:inv:ultra:nft";

  const wantedInvKey = String(prize?.meta?.inventoryKey || "").trim();
  const wantedContract = String(prize?.meta?.contract || contract || "").trim().toLowerCase();
  const wantedTokenId = String(prize?.meta?.tokenId ?? tokenId ?? "").trim();

  const list = await redis.lrange(invKey, 0, -1);

  let removed = false;
  const kept: string[] = [];

  for (const item of list || []) {
    // Upstash returns strings here (your debug shows raw is a string)
    const s = typeof item === "string" ? item : JSON.stringify(item);

    try {
      const obj = JSON.parse(s);

      const invKeyInItem = String(obj?.meta?.inventoryKey || "").trim();
      const cInItem = String(obj?.meta?.contract || "").trim().toLowerCase();
      const tInItem = String(obj?.meta?.tokenId ?? "").trim();

      const isMatch =
        (wantedInvKey && invKeyInItem && invKeyInItem === wantedInvKey) ||
        (!!wantedContract && !!wantedTokenId && cInItem === wantedContract && tInItem === wantedTokenId);

      if (!removed && isMatch) {
        removed = true; // skip exactly one matching item
        continue;
      }
    } catch {
      // if a row is malformed, keep it (don’t delete unknown data)
    }

    kept.push(s);
  }

  // Rebuild list only if we actually removed something
  if (removed) {
    await redis.del(invKey);
    if (kept.length) await redis.rpush(invKey, ...kept);
    console.log("✅ Inventory removed:", { wantedInvKey, wantedContract, wantedTokenId });
  } else {
    console.warn("⚠️ Inventory item NOT found to remove:", { wantedInvKey, wantedContract, wantedTokenId });
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
