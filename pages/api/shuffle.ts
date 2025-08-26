// pages/api/shuffle.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const prizes = [
  { label: 'Common Crate', rarity: 'common' },
  { label: 'Rare Crate', rarity: 'rare' },
  { label: 'Ultra Loot Crate', rarity: 'ultra' },
  { label: 'Nothing this time', rarity: 'none' },
];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // pick random prize
  const prize = prizes[Math.floor(Math.random() * prizes.length)];
  res.status(200).json({ prize });
}
