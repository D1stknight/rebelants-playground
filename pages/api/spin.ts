import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'

function rng(seed: string) {
  let h = crypto.createHash('sha256').update(seed).digest()
  const n =
    (h[0] & 0x1f) * 2 ** 48 +
    h[1] * 2 ** 40 +
    h[2] * 2 ** 32 +
    h[3] * 2 ** 24 +
    h[4] * 2 ** 16 +
    h[5] * 2 ** 8 +
    h[6]
  return (n % 9_007_199_254_740_992) / 9_007_199_254_740_992
}

function startOfDay() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }
  const clientSeed = (req.body?.seed as string) || 'guest'
  const serverSeed = process.env.SERVER_SEED || 'rebel-ants-dev-seed-change-me'
  const day = startOfDay()

  const roll = rng(`${serverSeed}:${clientSeed}:${day}`)

  // Odds: 70% nothing, 25% common, 4% rare, 1% ultra
  let prizeLabel = 'Nothing this time'
  let rarity: 'common' | 'rare' | 'ultra' | null = null

  if (roll >= 0.70 && roll < 0.95) {
    prizeLabel = 'Common Loot Crate'
    rarity = 'common'
  } else if (roll >= 0.95 && roll < 0.99) {
    prizeLabel = 'Rare Loot Crate'
    rarity = 'rare'
  } else if (roll >= 0.99) {
    prizeLabel = 'Ultra Loot Crate'
    rarity = 'ultra'
  }

  return res.json({ ok: true, prizeLabel, rarity })
}
