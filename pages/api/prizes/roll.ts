// pages/api/prizes/roll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as defaultConfig } from "../../../lib/pointsConfig";

const ULTRA_NFT_INVENTORY_KEY = "ra:inv:ultra:nft";

function rollRarity(): "none" | "common" | "rare" | "ultra" {
  const r = Math.random();
  if (r < 0.01) return "ultra"; // 1%
  if (r < 0.18) return "rare";
  if (r < 0.55) return "common";
  return "none";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const rarity = rollRarity();
    const cfg: any = defaultConfig;
    const currency = cfg.currency || "REBEL";

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
      const merchChance = Number(cfg?.rareMerchChance ?? 0.01);
      const roll = Math.random();

      if (roll < merchChance) {
        return res.status(200).json({
          ok: true,
          rarity,
          prize: { type: "merch", label: "Merch Prize" },
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
      });
    }

 // ---------- ULTRA ----------
if (rarity === "ultra") {
  // 🔥 Try to pull an NFT from inventory (atomic)
  const raw = await redis.rpop(ULTRA_NFT_INVENTORY_KEY);

  // Upstash can return either a JSON string OR an already-parsed object depending on client usage.
  let nft: any = null;

  if (raw) {
    if (typeof raw === "string") {
      try {
        nft = JSON.parse(raw);
      } catch {
        nft = null;
      }
    } else if (typeof raw === "object") {
      nft = raw;
    }
  }

  const chain = String(nft?.chain || "ETH").trim().toUpperCase();
  const contract = String(nft?.contract || "").trim();
  const tokenId = String(nft?.tokenId ?? "").trim();
  const label = String(nft?.label || "NFT Prize").trim();

  if (contract && tokenId) {
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
        },
      },
    });
  }

  // fallback to points if no NFT available (or inventory item was malformed)
  const ptsCfg = Number(cfg.rewards.ultra || 0);
  const min = Number(cfg.ultraMinReward || 0);
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
