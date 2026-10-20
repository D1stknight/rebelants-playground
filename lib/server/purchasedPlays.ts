// lib/server/purchasedPlays.ts
// Points bought in the Rebel Economy shop add to the player's bonus plays (the cap bank: play past the
// daily limit), the way the old in-Playground APE packs did (pages/api/shop/claim.ts). The economy lists
// the account's purchases (/api/internal/purchases); a cursor per account counts each one once.
import { redis } from "./redis";
import { economyPurchases } from "../economy";

// the dollar packs opened Oct 20, 2026; purchases before that were the old packs, already counted when claimed here
const SHOP_OPENED = "2026-10-20T00:00:00.000Z|";
const seenKey = (userId: string) => `ra:shop:plays-seen:${userId}`;
const lockKey = (userId: string) => `ra:shop:plays-lock:${userId}`;
const capBankKey = (playerId: string) => `ra:points:capbank:${playerId}`;

// adds the points of purchases not counted yet to this player's cap bank; returns how many were added
export async function syncPurchasedPlays(playerId: string, userId: string): Promise<number> {
  if (!playerId || !userId || playerId.startsWith("guest")) return 0;
  const locked = await redis.set(lockKey(userId), "1", { nx: true, ex: 20 });
  if (locked === null) return 0; // another request is counting them right now
  let added = 0;
  try {
    let after = (await redis.get<string>(seenKey(userId))) || SHOP_OPENED;
    for (let page = 0; page < 10; page++) {
      const r = await economyPurchases(userId, after);
      if (!r || !r.purchases.length || !r.next) break;
      const sum = r.purchases.reduce((a, p) => a + Math.max(0, Math.floor(Number(p.amount) || 0)), 0);
      // the plays and the cursor move together, so a purchase is never counted twice or lost
      const tx = redis.multi();
      if (sum > 0) tx.incrby(capBankKey(playerId), sum);
      tx.set(seenKey(userId), r.next);
      await tx.exec();
      added += sum;
      after = r.next;
      if (!r.more) break;
    }
  } finally {
    await redis.del(lockKey(userId));
  }
  return added;
}
