import type { NextApiRequest, NextApiResponse } from 'next';

type Rarity = 'common' | 'rare' | 'ultra' | null;
type Prize = { label: string; type: 'crate' | 'none'; rarity: Rarity; sub?: string | null };

function rollPrize(): Prize {
  // TEMP: generous odds while we test in staging
  // 35% win: 26% common, 7% rare, 2% ultra
  const r = Math.random();
  if (r < 0.35) {
    const rr = Math.random();
    if (rr < 0.26 / 0.35) return { label: 'Common Crate', type: 'crate', rarity: 'common' };
    if (rr < (0.26 + 0.07) / 0.35) return { label: 'Rare Crate', type: 'crate', rarity: 'rare' };
    return { label: 'Ultra Loot Crate', type: 'crate', rarity: 'ultra' };
  }
  return { label: 'Nothing this time', type: 'none', rarity: null, sub: 'Try again soon.' };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const p = rollPrize();
  // Shape expected by the frontend Shuffle component
  return res.json({
    ok: true,
    prizeLabel: p.label,
    type: p.type,
    rarity: p.rarity,
    sub: p.sub ?? null,
  });
}
