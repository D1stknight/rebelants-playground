// lib/pointsConfig.ts
export type PointsCurrency = "REBEL" | "RANT";

export type PrizeType = "points" | "nft" | "ape" | "merch" | "none";

export type Prize = {
  id: string;            // unique id for this prize option
  type: PrizeType;       // points | nft | ape | merch | none
  label: string;         // what players see (ex: "50 REBEL", "Rebel Ants Tee", "NFT: Ronin #42")
  weight: number;        // higher = more likely
  amount?: number;       // for points/ape (ex: 50)
  meta?: Record<string, any>; // optional extra data (contract, size, sku, shipping notes, etc.)
};

export type PrizePools = {
  none: Prize[];
  common: Prize[];
  rare: Prize[];
  ultra: Prize[];
};

export const pointsConfig = {
  currency: "REBEL" as PointsCurrency,

  // COST to play 1 shuffle
  shuffleCost: 500,

  // CURRENT POINTS REWARDS (keep working for now)
  rewards: {
    none: 0,
    common: 50,
    rare: 100,
    ultra: 200,
  },

  // NEW: future prize pools (Admin-editable)
  // NOTE: Shuffle will NOT use these yet — we’re only wiring Admin + storage first.
  prizePools: {
    none: [
      { id: "none-1", type: "none", label: "Nothing", weight: 1 },
    ],
    common: [
      { id: "c-pts-50", type: "points", label: "50 REBEL", amount: 50, weight: 100 },
      { id: "c-none-1", type: "none", label: "Nothing", weight: 20 },
    ],
    rare: [
      { id: "r-pts-100", type: "points", label: "100 REBEL", amount: 100, weight: 100 },
      { id: "r-merch-tee", type: "merch", label: "Rebel Ants Tee", weight: 5, meta: { sizes: ["S","M","L","XL","2XL"] } },
      { id: "r-none-1", type: "none", label: "Nothing", weight: 10 },
    ],
    ultra: [
      { id: "u-pts-200", type: "points", label: "200 REBEL", amount: 200, weight: 100 },
      { id: "u-nft-1", type: "nft", label: "NFT Prize (manual delivery)", weight: 3, meta: { note: "Deliver manually for now" } },
      { id: "u-ape-1", type: "ape", label: "APE Prize (manual delivery)", weight: 2, meta: { note: "Deliver manually for now" } },
      { id: "u-merch-hat", type: "merch", label: "Rebel Ants Hat", weight: 6 },
    ],
  } as PrizePools,

  // Optional: prevent infinite farming in one day (tune anytime)
  dailyClaim: 200,
  dailyEarnCap: 500,
} as const;
