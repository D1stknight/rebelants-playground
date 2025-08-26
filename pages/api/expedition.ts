import type { NextApiRequest, NextApiResponse } from 'next'
import { createHash, randomUUID } from 'crypto'

const SERVER_SEED = process.env.SERVER_SEED || 'dev-seed'

function rng01(serverSeed: string, userSeed: string, nonce: string) {
  const h = createHash('sha256')
    .update(serverSeed + '|' + userSeed + '|' + nonce)
    .digest('hex')
  const x = parseInt(h.slice(0, 8), 16) / 0xffffffff
  return { u: x, hash: h }
}

function pickPrize(u: number) {
  if (u < 0.60) return { label: '+10 $REBEL', type: 'points', amount: 10 as const }
  if (u < 0.88) return { label: '+25 $REBEL', type: 'points', amount: 25 as const }
  if (u < 0.96) return { label: 'Nothing this time', type: 'none' as const }
  if (u < 0.995) return { label: 'Common Loot Crate', type: 'crate' as const, rarity: 'common' as const }
  if (u < 0.999) return { label: 'Rare Loot Crate', type: 'crate' as const, rarity: 'rare' as const }
  return { label: 'Ultra Loot Crate', type: 'crate' as const, rarity: 'ultra' as const }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { seed } = req.body || {}
  const uid = typeof seed === 'string' && seed.trim() ? seed.trim() : 'guest-' + randomUUID()
  const day = new Date().toISOString().slice(0, 10)
  const nonce = `expedition|${uid}|${day}|${Math.floor(Date.now()/1000)}`
  const { u, hash } = rng01(SERVER_SEED, uid, nonce)
  const prize = pickPrize(u)
  res.status(200).json({ prize, proof: { hash, nonce, u } })
}
