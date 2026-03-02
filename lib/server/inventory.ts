// lib/server/inventory.ts
import { redis } from "./redis";

export type Chain = "ETH" | "APECHAIN";

export type NftInvItem = {
  chain: Chain;
  contract: string; // 0x...
  tokenId: string;  // "123"
  label?: string;   // e.g. "Ronin #123"
};

export type MerchInvItem = {
  sku: string;
  label: string;
  qty: number;
};

const keyNftAvailable = (chain: Chain, contract: string) =>
  `ra:inv:nft:${chain}:${String(contract || "").toLowerCase()}:available`;

const keyNftClaimed = (chain: Chain, contract: string) =>
  `ra:inv:nft:${chain}:${String(contract || "").toLowerCase()}:claimed`;

const keyMerchStock = (sku: string) => `ra:inv:merch:${String(sku || "").toLowerCase()}:qty`;

// ---------- NFT ----------
export async function addNftInventory(items: NftInvItem[]) {
  const clean = (items || [])
    .map((x) => ({
      chain: (String(x.chain || "").toUpperCase() as Chain) || "ETH",
      contract: String(x.contract || "").trim(),
      tokenId: String(x.tokenId || "").trim(),
      label: x.label ? String(x.label) : undefined,
    }))
    .filter((x) => (x.chain === "ETH" || x.chain === "APECHAIN") && x.contract && x.tokenId);

  if (!clean.length) return { added: 0 };

  // push each item as JSON into its collection list (available)
  for (const it of clean) {
    await redis.rpush(keyNftAvailable(it.chain, it.contract), JSON.stringify(it));
  }

  return { added: clean.length };
}

export async function reserveNextNft(chain: Chain, contract: string): Promise<NftInvItem | null> {
  const raw = await redis.lpop<string>(keyNftAvailable(chain, contract));
  if (!raw) return null;

  try {
    const it = JSON.parse(String(raw)) as NftInvItem;
    // mark claimed list for visibility
    await redis.lpush(keyNftClaimed(chain, contract), JSON.stringify({ ...it, ts: Date.now() }));
    await redis.ltrim(keyNftClaimed(chain, contract), 0, 499);
    return it;
  } catch {
    return null;
  }
}

export async function getNftInventorySummary() {
  // This is “best effort” (Upstash doesn’t support scanning keys cheaply in all setups).
  // We keep a simple registry of collections.
  const regKey = "ra:inv:nft:collections";
  const collections = (await redis.smembers<string[]>(regKey)) || [];
  const out: any[] = [];
  for (const c of collections) {
    // c is "ETH|0xabc..." or "APECHAIN|0xabc..."
    const [chain, contract] = String(c).split("|");
    const available = await redis.llen(keyNftAvailable(chain as Chain, contract));
    const claimed = await redis.llen(keyNftClaimed(chain as Chain, contract));
    out.push({ chain, contract, available, claimed });
  }
  return out;
}

export async function registerNftCollection(chain: Chain, contract: string) {
  const regKey = "ra:inv:nft:collections";
  const entry = `${chain}|${String(contract || "").toLowerCase()}`;
  await redis.sadd(regKey, entry);
}

// ---------- Merch ----------
export async function addMerchStock(sku: string, qty: number, label?: string) {
  const s = String(sku || "").toLowerCase().trim();
  const q = Math.floor(Number(qty || 0));
  if (!s || !Number.isFinite(q) || q <= 0) return { ok: false };

  const next = await redis.incrby(keyMerchStock(s), q);

  // optional: store label for UI
  if (label) await redis.set(`ra:inv:merch:${s}:label`, String(label));

  return { ok: true, sku: s, qty: Number(next || 0) };
}

export async function reserveMerch(sku: string, qty: number = 1) {
  const s = String(sku || "").toLowerCase().trim();
  const q = Math.floor(Number(qty || 1));
  if (!s || !Number.isFinite(q) || q <= 0) return { ok: false };

  const current = Number((await redis.get<number>(keyMerchStock(s))) || 0);
  if (current < q) return { ok: false, error: "OUT_OF_STOCK", current };

  const next = await redis.incrby(keyMerchStock(s), -q);
  return { ok: true, sku: s, remaining: Number(next || 0) };
}

export async function getMerchSummary() {
  const regKey = "ra:inv:merch:skus";
  const skus = (await redis.smembers<string[]>(regKey)) || [];
  const out: any[] = [];
  for (const sku of skus) {
    const qty = Number((await redis.get<number>(keyMerchStock(sku))) || 0);
    const label = String((await redis.get<string>(`ra:inv:merch:${sku}:label`)) || sku);
    out.push({ sku, label, qty });
  }
  return out;
}

export async function registerMerchSku(sku: string) {
  const regKey = "ra:inv:merch:skus";
  await redis.sadd(regKey, String(sku || "").toLowerCase().trim());
}
