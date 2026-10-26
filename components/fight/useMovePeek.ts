// components/fight/useMovePeek.ts — one-tap move cards: a tap plays the move, hovering (mouse) or
// pressing and holding (touch) shows what it does without playing it. A hold never ends in a strike.
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE, type MouseEvent as RME, type CSSProperties } from "react";

const HOLD_MS = 380;

export function useMovePeek<M>() {
  const [peek, setPeek] = useState<M | null>(null);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);

  /** props for one move card; `onTap` runs only on a real tap */
  const bind = useCallback((m: M, onTap: () => void) => ({
    onPointerDown: (e: RPE) => {
      held.current = false; clear();
      if (e.pointerType === "mouse") return;
      timer.current = window.setTimeout(() => { held.current = true; setPeek(m); }, HOLD_MS);
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: (e: RPE) => { clear(); if (e.pointerType === "mouse") setPeek(null); },
    onPointerEnter: (e: RPE) => { if (e.pointerType === "mouse") setPeek(m); },
    onContextMenu: (e: RME) => e.preventDefault(),   // no copy / share menu on a long press
    onClick: (e: RME) => {
      if (held.current) { held.current = false; e.preventDefault(); return; }   // that was a hold, not a tap
      onTap();
    },
  }), []);

  return { peek, setPeek, bind };
}

/** keeps a long press from selecting text or popping the iOS callout */
export const noTouchSelect: CSSProperties = { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "manipulation" } as CSSProperties;
