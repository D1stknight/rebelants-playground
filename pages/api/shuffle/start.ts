// pages/api/shuffle/start.ts — begins a Queen's Egg Shuffle round (server-owned so the "did you track the marked egg?" bonus can't be spoofed)
// Returns the marked egg, the swap sequence the client must animate, favor meter, and whether this round is the daily Royal Egg.
import type { NextApiRequest, NextApiResponse } from "next";
import { redis } from "../../../lib/server/redis";
import { pointsConfig as DEFAULTS } from "../../../lib/pointsConfig";

const ECON_KEY = "ra:config:economy";
export const ROUND_KEY = (id: string) => `ra:shuffle:round:${id}`;
export const FAVOR_KEY = (pid: string) => `ra:shuffle:favor:${pid}`;
export const ROYAL_KEY = (pid: string, day: string) => `ra:shuffle:royal:${pid}:${day}`;
export const dayKey = () => new Date().toISOString().slice(0, 10);

export async function loadCfg() {
  const raw = await redis.get(ECON_KEY); const saved = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  return { ...(DEFAULTS as any), ...(saved || {}), rewards: { ...(DEFAULTS as any).rewards, ...((saved as any)?.rewards || {}) }, rarityWeights: { ...(DEFAULTS as any).rarityWeights, ...((saved as any)?.rarityWeights || {}) } } as any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    const playerId = String(body.playerId || "guest").trim().slice(0, 64) || "guest";
    const cfg = await loadCfg();
    const eggs = Math.max(3, Math.min(7, Number(cfg.shuffleEggCount ?? 5)));
    const nSwaps = Math.max(3, Math.min(20, Number(cfg.shuffleSwaps ?? 8)));
    const marked = Math.floor(Math.random() * eggs);
    // swaps are pairs of LANES (visual positions); the client animates them in order, faster toward the end
    const swaps: [number, number][] = [];
    for (let k = 0; k < nSwaps; k++) { let a = Math.floor(Math.random() * eggs), b = Math.floor(Math.random() * eggs); while (b === a) b = Math.floor(Math.random() * eggs); swaps.push([a, b]); }
    // royal egg: once per player per day, boosted ultra odds on that round
    const royalEnabled = cfg.shuffleRoyalEnabled !== false;
    const royalUsed = royalEnabled ? await redis.get(ROYAL_KEY(playerId, dayKey())) : "1";
    const royal = royalEnabled && !royalUsed;
    const favor = Number((await redis.get(FAVOR_KEY(playerId))) || 0);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
    await redis.set(ROUND_KEY(id), JSON.stringify({ playerId, marked, swaps, royal, ts: Date.now() }), { ex: 240 });
    return res.status(200).json({ ok: true, roundId: id, marked, swaps, royal, favor, favorMax: Math.max(1, Number(cfg.shuffleFavorPity ?? 5)), eggs });
  } catch (e) { console.error("shuffle/start", e); return res.status(500).json({ ok: false, error: "Server error" }); }
}
