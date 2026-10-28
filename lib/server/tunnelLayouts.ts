// Tunnel layouts: the client used to have an empty slot at index 10 (a stray comma), so "Pincer" played
// layout 1 and every layout after it was named one off. The client now has the 30 layouts in order.
// The server keeps its boards in the old 31-slot numbering so nothing already recorded moves:
// layout i (0..29) is stored in slot i for i < 10, slot i + 1 after. Slot 10 held layout-1 plays and is skipped.
export const TUNNEL_LAYOUT_COUNT = 30;
export const tunnelSlot = (layoutIndex: number) => (layoutIndex < 10 ? layoutIndex : layoutIndex + 1);
export const isRealTunnelSlot = (slot: string | number) => {
  const n = Number(slot);
  return Number.isInteger(n) && n >= 0 && n <= TUNNEL_LAYOUT_COUNT && n !== 10;
};
