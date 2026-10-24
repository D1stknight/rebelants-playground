// lib/server/prizeTable.ts
// The prize for a crate rarity, as the admin page sets it: points (rewards), merch from the rare pool, an
// NFT from the ultra inventory. Used by the prize roll (pages/api/prizes/roll.ts) and the Raid
// (pages/api/raid/launch.ts). An NFT is only peeked here; the claim takes it from the inventory.
import { redis } from "./redis";

const ULTRA_NFT_INVENTORY_KEY = "ra:inv:ultra:nft";

export type Rarity = "none" | "common" | "rare" | "ultra";

const ptsPrize = (pts: number, currency: string) =>
  pts > 0 ? { type: "points", points: pts, label: `${pts} ${currency}` } : { type: "none", label: "Nothing this time" };

// The prize for a rarity: points, or (pointsOnly false) merch from the rare pool / an NFT from the inventory.
export async function prizeFor(rarity: Rarity, cfg: any, currency: string, pointsOnly: boolean): Promise<any> {
  if (rarity === "common") return ptsPrize(Number(cfg?.rewards?.common ?? 0), currency);

  if (rarity === "rare") {
    // Check if there are any merch items configured in the prize pool
    const rarePools: any[] = Array.isArray(cfg?.prizePools?.rare) ? cfg.prizePools.rare : [];
    const merchItems = rarePools.filter((p: any) => String(p?.type || "").toUpperCase() === "MERCH" && p?.sku);

    // Only attempt a merch roll if merch items are actually configured
    if (!pointsOnly && merchItems.length > 0) {
      // Pick a weighted random merch item
      const totalWeight = merchItems.reduce((s: number, p: any) => s + (Number(p?.weight) || 1), 0);
      let rng = Math.random() * totalWeight;
      let picked = merchItems[0];
      for (const item of merchItems) {
        rng -= Number(item?.weight) || 1;
        if (rng <= 0) { picked = item; break; }
      }
      return { type: "merch", label: picked.label || "Merch Prize", meta: { sku: picked.sku, label: picked.label } };
    }

    // No merch configured — fall back to points
    return ptsPrize(Number(cfg?.rewards?.rare ?? 0), currency);
  }

  if (rarity === "ultra") {
    if (!pointsOnly) {
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
          const inventoryKey = String(meta?.inventoryKey || "").trim() || `ultra:${chain}:${contract}:${tokenId}`;
          return { type: "nft", label, meta: { chain, contract, tokenId, label, inventoryKey } };
        }
      }
    }

    // fallback to points if no NFT available/valid
    const ptsCfg = Number(cfg?.rewards?.ultra ?? 0);
    const min = Number(cfg?.ultraMinReward ?? 0);
    const pts = Math.max(ptsCfg, min);
    return { type: "points", points: pts, label: `${pts} ${currency}` };
  }

  return { type: "none", label: "Nothing this time" };
}

