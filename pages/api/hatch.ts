import type { NextApiRequest, NextApiResponse } from 'next'
import { rng01 } from '../../lib/fair'
import { pick as pickHatch } from '../../lib/prizesHatch'

const startOfDay = () => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() }
let nonceByIp: Record<string, number> = {}
let cooldownByIp: Record<string, number> = {}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
  const now = Date.now()
  const cdSeconds = parseInt(process.env.PLAY_COOLDOWN_SECONDS || '15', 10)
  const nextPlayable = cooldownByIp[ip] || 0
  if (now < nextPlayable) return res.status(429).json({ ok:false, error:'Cooldown active', nextPlayableAt: nextPlayable })

  const serverSeed = process.env.SERVER_SEED || 'dev-seed-change-me'
  // For Egg Hatch we don't require a userSeed; using IP-based nonce keeps it simple for MVP
  const dayNonceBase = Math.floor(startOfDay()/1000)
  const nonce = (nonceByIp[ip] ?? 0) + 1; nonceByIp[ip] = nonce

  const prize = { label: 'Ultra Loot Crate', type: 'crate', rarity: 'ultra' as const }
  cooldownByIp[ip] = now + cdSeconds * 1000

  res.json({ ok:true, prizeLabel: prize.label, rarity: prize.rarity ?? null, nextPlayableAt: cooldownByIp[ip] })
}
