// lib/pointsConfig.ts
export type PointsCurrency = "REBEL" | "RANT";

export const pointsConfig = {
  currency: "REBEL" as PointsCurrency,

  // COST to play 1 shuffle
  shuffleCost: 500,

  // REWARDS on result (tune anytime)
  rewards: {
    none: 0,
    common: 50,
    rare: 100,
    ultra: 200,
  },

  // Optional: prevent infinite farming in one day (tune anytime)
  dailyEarnCap: 500,
};
