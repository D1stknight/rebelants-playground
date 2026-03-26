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

export type PointsConfig = {
  currency: PointsCurrency;
  shuffleCost: number;

  rewards: {
    none: number;
    common: number;
    rare: number;
    ultra: number;
  };

  // ✅ PRO: rarity weights (percent-style numbers; treated as weights)
  // Higher = more likely. Does NOT need to add to 100.
  rarityWeights?: {
    none: number;
    common: number;
    rare: number;
    ultra: number;
  };

  // ✅ PRO: Rare → Merch chance as a percent (ex: 10 = 10%)
  rareMerchChancePercent?: number;

  // ✅ Legacy (keep for backward compat)
  // example: 0.01 = 1%
  rareMerchChance: number;

  // ✅ Ultra must always award at least this many points (Model C fallback safety)
  ultraMinReward: number;

  prizePools: PrizePools;

    dailyClaim: number;
  dailyEarnCap: number;

  tunnelCost: number;
  tunnelRunSeconds: number;
  tunnelCrystalCount: number;
  tunnelSugarCount: number;
  tunnelCrumbCount: number;
  tunnelWallBreaks: number;
  tunnelSpiderSpeedMs: number;
};

export const pointsConfig: PointsConfig = {
  currency: "REBEL",

  // COST to play 1 shuffle
  shuffleCost: 500,

  // ✅ Model C default points (you can override in Admin anytime)
  rewards: {
    none: 0,
    common: 50,
    rare: 100,
    ultra: 300,
  },

  // ✅ PRO: rarity weights (percent-style numbers; treated as weights)
  // Higher = more likely. Does NOT need to add to 100.
  rarityWeights: {
    none: 45,
    common: 37,
    rare: 15,
    ultra: 3,
  },

  // ✅ PRO: Rare → Merch chance percent (ex: 10 = 10%)
  rareMerchChancePercent: 1,

  // ✅ Legacy (keep for backward compat)
  // ✅ 1% rare merch attempt
  rareMerchChance: 0.01,

  // ✅ Ultra fallback floor (should be >= rare)
  ultraMinReward: 300,

  // ✅ Prize pools are Admin-editable.
  // We keep them aligned with Model C to avoid confusion:
  // - common: points only
  // - rare: points + merch
  // - ultra: NFTs only (points fallback handled by code)
  prizePools: {
    none: [{ id: "none-1", type: "none", label: "Nothing", weight: 1 }],

    common: [
      { id: "c-pts-50", type: "points", label: "50 REBEL", amount: 50, weight: 100 },
    ],

    rare: [
      { id: "r-pts-100", type: "points", label: "100 REBEL", amount: 100, weight: 100 },
      {
        id: "r-merch-tee",
        type: "merch",
        label: "Rebel Ants Tee",
        weight: 5,
        meta: { sizes: ["S", "M", "L", "XL", "2XL"] },
      },
    ],

    ultra: [
      {
        id: "u-nft-1",
        type: "nft",
        label: "NFT Prize (manual delivery)",
        weight: 3,
        meta: { note: "Deliver manually for now" },
      },
    ],
  },

   dailyClaim: 200,
  dailyEarnCap: 500,

  tunnelCost: 50,
  tunnelRunSeconds: 60,
  tunnelCrystalCount: 8,
  tunnelSugarCount: 18,
  tunnelCrumbCount: 95,
  tunnelWallBreaks: 5,
  tunnelSpiderSpeedMs: 160,
};
