import type { NextApiRequest, NextApiResponse } from 'next'
import { rng01, hashSeed } from '../../lib/fair'
import { table as tableTunnel, pick as pickTunnel } from '../../lib/prizesTunnel'

const startOfDay = () => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime() }

let nonceByIp: Record<string, number> = {}
let cooldownByIp: Record<string, number> = {}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })
  const { userSeed } = req.body || {}
  if (!userSeed || typeof userSeed !== 'string') return res.status(400).json({ ok: false, error: 'Missing userSeed' })

  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
  const now = Date.now()
  const cdSeconds = parseInt(process.env.PLAY_COOLDOWN_SECONDS || '15', 10)
  const nextPlayable = cooldownByIp[ip] || 0
  if (now < nextPlayable) return res.status(429).json({ ok:false, error:'Cooldown active', nextPlayableAt: nextPlayable })

  const serverSeed = process.env.SERVER_SEED || 'dev-seed-change-me'
  const dayNonceBase = Math.floor(startOfDay()/1000)
  const nonce = (nonceByIp[ip] ?? 0) + 1; nonceByIp[ip] = nonce

  const u = rng01(serverSeed, userSeed, dayNonceBase + nonce)
  const prize = pickTunnel(u)
  const serverSeedHash = hashSeed(serverSeed)
  cooldownByIp[ip] = now + cdSeconds * 1000

  res.json({ ok:true, prizeLabel: prize.label, prizeType: prize.type, amount: prize.amount ?? null, serverSeedHash, userSeed, nonce: dayNonceBase + nonce, u01: u, nextPlayableAt: cooldownByIp[ip] })
}
