// lib/server/redis.ts
import { Redis } from "@upstash/redis";

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  throw new Error(
    "Missing Upstash env vars. Expected KV_REST_API_URL and KV_REST_API_TOKEN in Vercel Environment Variables."
  );
}

export const redis = new Redis({ url, token });
