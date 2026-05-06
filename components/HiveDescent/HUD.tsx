// components/HiveDescent/HUD.tsx
// Overlay UI shown during an active run. Read-only props from the engine.

import React from "react";
import type { Biome } from "./biomes";

type Props = {
  hp: number;
  maxHp: number;
  rebel: number;
  floor: number;
  totalFloors: number;
  biome: Biome;
  factionName: string;
  specialName: string;
  specialReadyAt: number;     // engine timestamp ms when special is ready
  nowMs: number;              // current engine timestamp
  enemiesAlive: number;
  onAbandon: () => void;
};

const HUD: React.FC<Props> = ({
  hp, maxHp, rebel, floor, totalFloors, biome,
  factionName, specialName, specialReadyAt, nowMs,
  enemiesAlive, onAbandon,
}) => {
  const hpPct = Math.max(0, Math.min(1, hp / maxHp));
  const specialCooldown = Math.max(0, specialReadyAt - nowMs);
  const specialReady = specialCooldown <= 0;
  const hpBarColor =
    hpPct > 0.6 ? "#44dd66" :
    hpPct > 0.3 ? "#ffaa33" : "#ff3366";

  return (
    <div style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      color: "#fff", fontFamily: "system-ui, -apple-system, sans-serif",
      zIndex: 10,
    }}>
      {/* Top bar */}
      <div style={{
        position: "absolute", top: 12, left: 12, right: 12,
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        gap: 12, flexWrap: "wrap",
      }}>
        {/* Left: faction + floor */}
        <div style={{
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
          border: "1px solid " + biome.particleColor + "40",
          borderRadius: 10, padding: "8px 12px", pointerEvents: "auto",
        }}>
          <div style={{
            fontSize: 9, letterSpacing: "0.25em", color: biome.particleColor,
            fontWeight: 700,
          }}>
            FLOOR {floor} / {totalFloors} · {biome.name.toUpperCase()}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>
            🐜 {factionName.toUpperCase()}
          </div>
        </div>

        {/* Right: REBEL + abandon */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 999, padding: "8px 14px",
            fontSize: 13, fontWeight: 800, letterSpacing: "0.05em",
          }}>
            💎 +{rebel.toLocaleString()}
          </div>
          <button onClick={onAbandon} style={{
            pointerEvents: "auto", background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,80,80,0.4)", borderRadius: 8,
            padding: "8px 12px", color: "#ff8888", fontWeight: 700,
            fontSize: 11, letterSpacing: "0.1em", cursor: "pointer",
          }}>
            ✕ ABANDON
          </button>
        </div>
      </div>

      {/* Enemies remaining badge (top-center) */}
      {enemiesAlive > 0 && (
        <div style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
          border: "1px solid #ff336666", borderRadius: 999,
          padding: "6px 14px", fontSize: 11, fontWeight: 800, letterSpacing: "0.15em",
        }}>
          ⚔ {enemiesAlive} ENEMIES REMAIN
        </div>
      )}

      {/* Bottom-left: HP bar */}
      <div style={{
        position: "absolute", bottom: 16, left: 16,
        width: "min(280px, 50vw)", pointerEvents: "none",
      }}>
        <div style={{
          fontSize: 10, color: "rgba(255,255,255,0.7)",
          letterSpacing: "0.2em", marginBottom: 4, fontWeight: 700,
        }}>
          HP · {Math.ceil(hp)} / {maxHp}
        </div>
        <div style={{
          width: "100%", height: 12, borderRadius: 6,
          background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)",
          overflow: "hidden", boxShadow: "inset 0 1px 0 rgba(0,0,0,0.6)",
        }}>
          <div style={{
            width: (hpPct * 100) + "%", height: "100%",
            background: "linear-gradient(180deg, " + hpBarColor + " 0%, " + hpBarColor + "aa 100%)",
            transition: "width 0.15s ease-out, background 0.3s",
            boxShadow: "0 0 12px " + hpBarColor + "88",
          }} />
        </div>
      </div>

      {/* Bottom-right: special ability indicator */}
      <div style={{
        position: "absolute", bottom: 16, right: 16,
        textAlign: "right", pointerEvents: "none",
      }}>
        <div style={{
          fontSize: 10, color: specialReady ? "#ffd700" : "rgba(255,255,255,0.4)",
          letterSpacing: "0.2em", marginBottom: 4, fontWeight: 700,
        }}>
          ⚡ {specialName.toUpperCase()}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 900, color: specialReady ? "#ffd700" : "rgba(255,255,255,0.5)",
          textShadow: specialReady ? "0 0 8px #ffd700" : "none",
        }}>
          {specialReady ? "READY · SPACE" : (specialCooldown / 1000).toFixed(1) + "s"}
        </div>
      </div>
    </div>
  );
};

export default HUD;
