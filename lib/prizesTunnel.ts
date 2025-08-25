export type Prize = { label: string; type: 'points'|'nft'|'nowin'; amount?: number; weight: number }
export const table: Prize[] = [
  { label: '+10 $REBEL', type: 'points', amount: 10, weight: 40 },
  { label: '+25 $REBEL', type: 'points', amount: 25, weight: 22 },
  { label: '+50 $REBEL', type: 'points', amount: 50, weight: 10 },
  { label: 'Common Loot Crate', type: 'nft', weight: 7 },
  { label: 'Rare Loot Crate', type: 'nft', weight: 2 },
  { label: 'Nothing this time', type: 'nowin', weight: 19 }
]
export function pick(u: number) {
  const total = table.reduce((a, p) => a + p.weight, 0)
  let roll = u * total
  for (const p of table) { if (roll < p.weight) return p; roll -= p.weight }
  return table[table.length-1]
}
