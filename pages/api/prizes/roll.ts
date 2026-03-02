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
      // ✅ Pull from the SAME list admin writes to
      const raw = await redis.rpop<string>(ULTRA_NFT_INVENTORY_KEY);

      if (raw) {
        // raw is JSON string written by admin add endpoint
        let meta: any = null;
        try {
          meta = JSON.parse(String(raw));
        } catch {
          meta = null;
        }

        // If parsing failed, still show something, but don't break the game
        if (meta && meta.contract && meta.tokenId) {
          return res.status(200).json({
            ok: true,
            rarity,
            prize: {
              type: "nft",
              label: meta.label || "NFT Prize",
              meta: {
                chain: String(meta.chain || "ETH"),
                contract: String(meta.contract),
                tokenId: String(meta.tokenId),
                label: meta.label || "NFT Prize",
              },
            },
          });
        }

        return res.status(200).json({
          ok: true,
          rarity,
          prize: {
            type: "nft",
            label: "NFT Prize",
            meta: { raw: String(raw) },
          },
        });
      }

      // fallback points if no NFT available
      const ptsCfg = Number(cfg?.rewards?.ultra ?? 0);
      const min = Number(cfg?.ultraMinReward ?? 0);
      const pts = Math.max(ptsCfg, min, 300);

      return res.status(200).json({
        ok: true,
        rarity,
        prize: { type: "points", points: pts, label: `${pts} ${currency}` },
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
