// pages/api/spin.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Rarity = 'common' | 'rare' | 'ultra' | null;

function rollPrize() {
  // TEMP odds while testing: 35% win → 26% common, 7% rare, 2% ultra
  const r = Math.random();
  if (r < 0.35) {
    const rr = Math.random();
    if (rr < 0.26 / 0.35) return { label: 'Common Loot Crate', type: 'crate' as const, rarity: 'common' as Rarity };
    if (rr < (0.26 + 0.07) / 0.35) return { label: 'Rare Loot Crate', type: 'crate' as const, rarity: 'rare' as Rarity };
    return { label: 'Ultra Loot Crate', type: 'crate' as const, rarity: 'ultra' as Rarity };
  }
  return { label: 'Nothing this time', type: 'none' as const, rarity: null as Rarity };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const p = rollPrize();
  return res.json({
    ok: true,
    prizeLabel: p.label,
    type: p.type,
    rarity: p.rarity,
    sub: null,
  });
}
