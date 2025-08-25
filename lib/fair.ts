import crypto from 'crypto'

export function hashSeed(seed: string) {
  return crypto.createHash('sha256').update(seed, 'utf8').digest('hex')
}

export function rng01(serverSeed: string, userSeed: string, nonce: number) {
  const hash = crypto.createHash('sha256').update(`${serverSeed}:${userSeed}:${nonce}`).digest('hex')
  const slice = hash.slice(0, 16)
  const int = BigInt('0x' + slice)
  const max = BigInt('0xffffffffffffffff')
  return Number(int) / Number(max)
}
