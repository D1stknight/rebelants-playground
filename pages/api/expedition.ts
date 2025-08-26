import type { NextApiRequest, NextApiResponse } from 'next'

type Prize =
  | { type: 'crate'; label: string; rarity: 'common' | 'rare' | 'ultra' }
  | { type: 'none'; label: string }

// simple seeded-ish random
function rnd(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0
  return () => {
    h = Math.imul(48271, h) | 0
    return ((h >>> 0) % 1000) / 1000
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse<Prize>) {
  const s = (req.body?.seed as string) || 'guest'
  const rand = rnd(s + Date.now())

  const u = rand()
  if (u > 0.85) {
    // 15% chance to win a crate (weighted)
    const r = rand()
    if (r > 0.8) return res.status(200).json({ type: 'crate', label: 'Ultra Loot Crate', rarity: 'ultra' })
    if (r > 0.4) return res.status(200).json({ type: 'crate', label: 'Rare Loot Crate', rarity: 'rare' })
    return res.status(200).json({ type: 'crate', label: 'Common Loot Crate', rarity: 'common' })
  }

  return res.status(200).json({ type: 'none', label: 'Nothing this time' })
}
