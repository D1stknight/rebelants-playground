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

    const force = String(req.query.force || "").toLowerCase();
const rarity =
  force === "ultra" ? "ultra" :
  force === "rare" ? "rare" :
  force === "common" ? "common" :
  force === "none" ? "none" :
  rollRarity();
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
      // Try to pull NFT inventory safely
      for (let i = 0; i < 10; i++) {
        const nftRaw = await redis.rpop(ULTRA_NFT_INVENTORY_KEY);
        if (!nftRaw) break;

              // Upstash can return a string OR an already-parsed object depending on client config
        let item: any = nftRaw;

        if (typeof nftRaw === "string") {
          try {
            item = JSON.parse(nftRaw);
          } catch {
            item = null;
          }
        } else if (!item || typeof item !== "object") {
          item = null;
        }

        const chain = String(item?.chain || "ETH").toUpperCase();
        const contract = String(item?.contract || "").trim();
        const tokenId = String(item?.tokenId ?? "").trim();
        const label = String(item?.label || "NFT Prize").trim();

        if (contract && contract.startsWith("0x") && tokenId) {
          const inventoryKey =
            String(item?.inventoryKey || "").trim() ||
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

      // fallback to points
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
