// components/HiveDescent/MobileControls.tsx
// Touch overlay: D-pad on the left, attack/special buttons on the right.
// Uses onPointerDown for the same single-fire pattern Tunnel uses (avoids click+touch double-firing on iOS).

import React, { useEffect, useRef, useState } from "react";

export type DescentInput = {
  // Continuous (held): pressed flags read by the engine each tick
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  // Edge events (one-shot triggers consumed by the engine and reset)
  attackPulse: number;   // increments on each attack tap
  specialPulse: number;
  dodgePulse: number;
};

type Props = {
  inputRef: React.MutableRefObject<DescentInput>;
};

const MobileControls: React.FC<Props> = ({ inputRef }) => {
  const [, force] = useState(0);
  const padRef = useRef<HTMLDivElement>(null);

  // Touch a state slice so the visual highlights re-render — but only on pointer events,
  // never on the tick loop, so we don't impact the game loop.
  function press(dir: "up" | "down" | "left" | "right", on: boolean) {
    inputRef.current[dir] = on;
    force((n) => n + 1);
  }

  // Visual D-pad with 4 buttons. Each button uses pointerdown/up/cancel/leave to track.
  const btnBase: React.CSSProperties = {
    position: "absolute",
    width: 56, height: 56, borderRadius: 12,
    background: "rgba(0,0,0,0.55)",
    border: "1.5px solid rgba(255,255,255,0.25)",
    color: "#fff", fontSize: 22, fontWeight: 800,
    display: "flex", alignItems: "center", justifyContent: "center",
    userSelect: "none", WebkitUserSelect: "none",
    touchAction: "none",
  };

  const arrow = (dir: "up" | "down" | "left" | "right", style: React.CSSProperties, label: string) => (
    <div
      key={dir}
      onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); press(dir, true); }}
      onPointerUp={(e) => { press(dir, false); }}
      onPointerCancel={() => press(dir, false)}
      onPointerLeave={() => press(dir, false)}
      style={{
        ...btnBase, ...style,
        background: inputRef.current[dir] ? "rgba(255,102,204,0.5)" : btnBase.background,
        borderColor: inputRef.current[dir] ? "#ff66cc" : btnBase.borderColor,
      }}
    >{label}</div>
  );

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 12 }}>
      {/* D-pad cluster — bottom-left */}
      <div ref={padRef} style={{
        position: "absolute", left: 16, bottom: 16,
        width: 180, height: 180, pointerEvents: "auto",
      }}>
        {arrow("up",    { left: 62, top: 0 },   "▲")}
        {arrow("down",  { left: 62, top: 124 }, "▼")}
        {arrow("left",  { left: 0,  top: 62 },  "◀")}
        {arrow("right", { left: 124, top: 62 }, "▶")}
      </div>

      {/* Action buttons — bottom-right */}
      <div style={{
        position: "absolute", right: 16, bottom: 16,
        display: "flex", flexDirection: "column", gap: 10,
        pointerEvents: "auto",
      }}>
        <div
          onPointerDown={(e) => { e.preventDefault(); inputRef.current.specialPulse++; force(n => n + 1); }}
          style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "linear-gradient(180deg, #ffd700 0%, #aa6600 100%)",
            border: "2px solid #ffd700",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#000", fontWeight: 900, fontSize: 22,
            boxShadow: "0 0 16px #ffd70088",
            userSelect: "none", touchAction: "none",
          }}
        >⚡</div>
        <div
          onPointerDown={(e) => { e.preventDefault(); inputRef.current.dodgePulse++; force(n => n + 1); }}
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "rgba(80,80,200,0.7)",
            border: "2px solid #aaccff",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 900, fontSize: 16,
            userSelect: "none", touchAction: "none",
          }}
        >↯</div>
        <div
          onPointerDown={(e) => { e.preventDefault(); inputRef.current.attackPulse++; force(n => n + 1); }}
          style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "linear-gradient(180deg, #ff3399 0%, #aa0066 100%)",
            border: "2px solid #ff66cc",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 900, fontSize: 28,
            boxShadow: "0 0 24px #ff339988",
            userSelect: "none", touchAction: "none",
          }}
        >⚔</div>
      </div>
    </div>
  );
};

export default MobileControls;
