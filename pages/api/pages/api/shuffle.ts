import type { NextApiRequest, NextApiResponse } from 'next'
import { createHash } from 'crypto'

const SERVER_SEED = process.env.SERVER_SEED || 'dev-seed'

function rng01(serverSeed: string, userSeed: string, nonce: string) {
  const h = createHash('sha256').update(serverSeed + '|' + userSeed + '|' + nonce).digest('hex')
  const x = parseInt(h.slice(0, 8), 16) / 0xffffffff
  return { u: x, hash: h }
}

function prizeFromPick(u: number) {
  if (u < 0.50) return { label: '+15 $REBEL', type: 'points', amount: 15 as const }
  if (u < 0.80) return { label: '+35 $REBEL', type: 'points', amount: 35 as const }
  if (u < 0.93) return { label: 'Nothing this time', type: 'none' as const }
  if (u < 0.985) return { label: 'Common Loot Crate', type: 'crate' as const, rarity: 'common' as const }
  if (u < 0.997) return { label: 'Rare Loot Crate', type: 'crate' as const, rarity: 'rare' as const }
  return { label: 'Ultra Loot Crate', type: 'crate' as const, rarity: 'ultra' as const }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { seed, pick } = req.body || {}
  const p = typeof pick === 'number' && pick >= 0 && pick <= 2 ? pick : 0
  const userSeed = String(seed || 'guest')
  const nonce = `shuffle|pick:${p}|${new Date().toISOString().slice(0,10)}`
  const { u, hash } = rng01(SERVER_SEED, userSeed, nonce)
  const prize = prizeFromPick(u)
  res.status(200).json({ prize, proof: { hash, nonce, u, pick: p } })
}
