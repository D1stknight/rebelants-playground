export type Prize = { label: string; type: 'points'|'crate'; rarity?: 'common'|'rare'|'ultra'; amount?: number; weight: number }
export const table: Prize[] = [
  { label: '+10 $REBEL', type: 'points', amount: 10, weight: 40 },
  { label: '+25 $REBEL', type: 'points', amount: 25, weight: 25 },
  { label: '+50 $REBEL', type: 'points', amount: 50, weight: 15 },
  { label: 'Common Loot Crate', type: 'crate', rarity: 'common', weight: 10 },
  { label: 'Rare Loot Crate', type: 'crate', rarity: 'rare', weight: 7 },
  { label: 'Ultra Loot Crate', type: 'crate', rarity: 'ultra', weight: 3 }
]
export function pick(u: number) {
  const total = table.reduce((a, p) => a + p.weight, 0)
  let roll = u * total
  for (const p of table) { if (roll < p.weight) return p; roll -= p.weight }
  return table[table.length-1]
}
