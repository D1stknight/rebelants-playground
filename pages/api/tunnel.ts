// pages/api/tunnel.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const pick = <T,>(arr:T[]) => arr[Math.floor(Math.random()*arr.length)];

export default function handler(req:NextApiRequest, res:NextApiResponse) {
  const roll = Math.random();
  if (roll > 0.7) {
    const rarity = pick(['common','rare','ultra']);
    return res.status(200).json({ type:'crate', rarity });
  }
  return res.status(200).json({ type:'none' });
}
