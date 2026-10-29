// lib/server/prizeTable.ts
// The prize for a crate rarity, as the admin page sets it: points (rewards), merch from the rare pool, an
// NFT from the ultra inventory. Used by the prize roll (pages/api/prizes/roll.ts) and the Raid
// (pages/api/raid/launch.ts). An NFT is held here for its winner; the claim takes it from the inventory.
import { redis } from "./redis";

const ULTRA_NFT_INVENTORY_KEY = "ra:inv:ultra:nft";

export type Rarity = "none" | "common" | "rare" | "ultra";

const ptsPrize = (pts: number, currency: string) =>
  pts > 0 ? { type: "points", points: pts, label: `${pts} ${currency}` } : { type: "none", label: "Nothing this time" };

// Real merch (t-shirts, toys…) lives in the crate pools as { type: "MERCH", label, sku, weight } items:
// prizePools.rare for rare crates, prizePools.ultra for ultra crates. Stock is counted per SKU in
// ra:inv:merchstock:<sku> (no key = no limit); a win takes one, and an item at 0 is skipped.
// rareMerchChance / ultraMerchChance (0–1) = how often a crate of that rarity gives merch when some is in stock.
export const merchStockKey = (sku: string) => `ra:inv:merchstock:${String(sku).trim().slice(0, 40)}`;
// An ultra NFT is held for its winner for 7 days (so two winners never get the same NFT); the claim takes it.
export const nftHoldKey = (inventoryKey: string) => `ra:inv:ultra:held:${inventoryKey}`;
const HOLD_SECONDS = 7 * 24 * 3600;

const chanceOf = (v: unknown, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n > 1 ? n / 100 : n)) : dflt;
};

// Picks a merch item by weight and takes one from its stock. null = none in stock (or none set up).
async function takeMerch(pool: any[]): Promise<any | null> {
  let items = (Array.isArray(pool) ? pool : []).filter((p: any) => String(p?.type || "").toUpperCase() === "MERCH" && p?.sku);
  while (items.length) {
    const total = items.reduce((s: number, p: any) => s + (Number(p?.weight) || 1), 0);
    let rng = Math.random() * total;
    let picked = items[items.length - 1];
    for (const item of items) {
      rng -= Number(item?.weight) || 1;
      if (rng <= 0) { picked = item; break; }
    }
    const key = merchStockKey(picked.sku);
    const limited = (await redis.get(key)) !== null;
    if (!limited) return picked;
    const left = Number(await redis.decr(key));
    if (left >= 0) return picked;
    await redis.incr(key); // it was already at 0: put it back and try another item
    items = items.filter((x: any) => x !== picked);
  }
  return null;
}

const merchPrize = (m: any) => ({ type: "merch", label: m.label || "Merch Prize", meta: { sku: m.sku, label: m.label } });

// The next ultra NFT nobody is holding, held now for this winner.
async function holdNft(): Promise<any | null> {
  const list = await redis.lrange<any>(ULTRA_NFT_INVENTORY_KEY, 0, 99);
  for (const raw of Array.isArray(list) ? list : []) {
    // Upstash can return a string OR an object depending on client/typing
    const item = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    if (!item) continue;
    // Inventory items are stored as { type, label, meta:{ chain, contract, tokenId, inventoryKey } }
    const meta = (item as any)?.meta || item;
    const chain = String(meta?.chain || "ETH").toUpperCase();
    const contract = String(meta?.contract || "").trim();
    const tokenId = String(meta?.tokenId ?? "").trim();
    const label = String(meta?.label || item?.label || "NFT Prize").trim();
    if (!(contract && contract.startsWith("0x") && tokenId)) continue;
    const inventoryKey = String(meta?.inventoryKey || "").trim() || `ultra:${chain}:${contract}:${tokenId}`;
    const held = await redis.set(nftHoldKey(inventoryKey), String(Date.now()), { nx: true, ex: HOLD_SECONDS });
    if (held) return { type: "nft", label, meta: { chain, contract, tokenId, label, inventoryKey } };
  }
  return null;
}

// The prize for a rarity: points, or (pointsOnly false) merch from the crate's pool / an NFT from the inventory.
export async function prizeFor(rarity: Rarity, cfg: any, currency: string, pointsOnly: boolean): Promise<any> {
  if (rarity === "common") return ptsPrize(Number(cfg?.rewards?.common ?? 0), currency);

  if (rarity === "rare") {
    if (!pointsOnly && Math.random() < chanceOf(cfg?.rareMerchChance, 0.01)) {
      const m = await takeMerch(cfg?.prizePools?.rare);
      if (m) return merchPrize(m);
    }
    return ptsPrize(Number(cfg?.rewards?.rare ?? 0), currency);
  }

  if (rarity === "ultra") {
    if (!pointsOnly) {
      if (Math.random() < chanceOf(cfg?.ultraMerchChance, 0)) {
        const m = await takeMerch(cfg?.prizePools?.ultra);
        if (m) return merchPrize(m);
      }
      const nft = await holdNft();
      if (nft) return nft;
    }
    // no NFT free: ultra points (never less than the ultra minimum)
    const ptsCfg = Number(cfg?.rewards?.ultra ?? 0);
    const min = Number(cfg?.ultraMinReward ?? 0);
    const pts = Math.max(ptsCfg, min);
    return { type: "points", points: pts, label: `${pts} ${currency}` };
  }

  return { type: "none", label: "Nothing this time" };
}
