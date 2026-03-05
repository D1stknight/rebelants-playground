// pages/api/prizes/roll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultConfig } from "../../../lib/pointsConfig";

const ECON_KEY = "ra:config:economy";

const ULTRA_NFT_INVENTORY_KEY = "ra:inv:ultra:nft";

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

function percentToChance(p: any, fallback = 0.01) {
  const n = Number(p);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n / 100, 0, 1);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

const force = String(req.query.force || "").toLowerCase();

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

// Use Admin-controlled rarity weights if present
const rolledRarity = rollFromWeights(
  cfg?.rarityWeights,
  ["ultra", "rare", "common", "none"],
  "none"
);

const rarity =
  force === "ultra" ? "ultra" :
  force === "rare" ? "rare" :
  force === "common" ? "common" :
  force === "none" ? "none" :
  rolledRarity;

    // ---------- COMMON ----------
    if (rarity === "common") {
      const pts = Number(cfg?.rewards?.common ?? 0);
      return res.status(200).json({
        ok: true,
        rarity,
        prize:
          pts > 0
            ? { type: "points", points: pts, label: `${pts} ${currency}` }
            : { type: "none", label: "Nothing this time" },
      });
    }

    // ---------- RARE ----------
  if (rarity === "rare") {
  // cfg.rareMerchChance must be decimal 0..1
  const merchChanceRaw = Number(cfg?.rareMerchChance ?? 0.01);
  const merchChance = Math.max(0, Math.min(1, merchChanceRaw));

  // ✅ hard guarantee for testing
  if (merchChance >= 1) {
    return res.status(200).json({
      ok: true,
      rarity,
      prize: { type: "merch", label: "Merch Prize" },
      debug: { merchChanceRaw, merchChance },
    });
  }

  const roll = Math.random();

  if (roll < merchChance) {
    return res.status(200).json({
      ok: true,
      rarity,
      prize: { type: "merch", label: "Merch Prize" },
      debug: { merchChanceRaw, merchChance, roll },
    });
  }

  const pts = Number(cfg?.rewards?.rare ?? 0);
  return res.status(200).json({
    ok: true,
    rarity,
    prize:
      pts > 0
        ? { type: "points", points: pts, label: `${pts} ${currency}` }
        : { type: "none", label: "Nothing this time" },
    debug: { merchChanceRaw, merchChance, roll },
  });
}

// ---------- ULTRA ----------
if (rarity === "ultra") {
  // ✅ PEEK inventory (do NOT consume here — claim will consume)
  const peek = await redis.lrange<any>(ULTRA_NFT_INVENTORY_KEY, 0, 0);
  const nftRaw = Array.isArray(peek) && peek.length ? peek[0] : null;

  if (nftRaw) {
    // Upstash can return a string OR an object depending on client/typing
    const item =
      typeof nftRaw === "string"
        ? (() => {
            try {
              return JSON.parse(nftRaw);
            } catch {
              return null;
            }
          })()
        : nftRaw;

       // ✅ Inventory items are stored as { type, label, meta:{ chain, contract, tokenId, inventoryKey } }
    const meta = (item as any)?.meta || item;

    const chain = String(meta?.chain || "ETH").toUpperCase();
    const contract = String(meta?.contract || "").trim();
    const tokenId = String(meta?.tokenId ?? "").trim();
    const label = String(meta?.label || item?.label || "NFT Prize").trim();

    if (contract && contract.startsWith("0x") && tokenId) {
      const inventoryKey =
        String(meta?.inventoryKey || "").trim() ||
        `ultra:${chain}:${contract}:${tokenId}`;

      return res.status(200).json({
        ok: true,
        rarity,
        prize: {
          type: "nft",
          label,
          meta: {
            chain,
            contract,
            tokenId,
            label,
            inventoryKey,
          },
        },
      });
    }
  }

  // fallback to points if no NFT available/valid
  const ptsCfg = Number(cfg?.rewards?.ultra ?? 0);
  const min = Number(cfg?.ultraMinReward ?? 0);
  const pts = Math.max(ptsCfg, min);

  return res.status(200).json({
    ok: true,
    rarity,
    prize: {
      type: "points",
      points: pts,
      label: `${pts} ${currency}`,
    },
  });
}
    // ---------- NONE ----------
    return res.status(200).json({
      ok: true,
      rarity,
      prize: { type: "none", label: "Nothing this time" },
    });
  } catch (err: any) {
    console.error("prizes/roll error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
