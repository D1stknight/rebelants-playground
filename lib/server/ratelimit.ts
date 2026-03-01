// lib/server/ratelimit.ts
import { redis } from "./redis";

export async function rateLimit({
  key,
  limit,
  windowSec,
}: {
  key: string;
  limit: number;
  windowSec: number;
}) {
  const count = await redis.incr(key);

  // first hit: start window timer
  if (count === 1) {
    await redis.expire(key, windowSec);
  }

  const allowed = count <= limit;
  return { allowed, count, limit };
}
