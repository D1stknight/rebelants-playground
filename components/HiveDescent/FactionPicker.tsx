// components/HiveDescent/FactionPicker.tsx
// Pre-run faction selection. Cinematic grid of 11 factions with their special ability.

import React, { useState } from "react";
import { DESCENT_FACTIONS } from "../../lib/descentConfig";

type Props = {
  onConfirm: (factionId: string) => void;
  onCancel: () => void;
};

const FactionPicker: React.FC<Props> = ({ onConfirm, onCancel }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = DESCENT_FACTIONS.find((f) => f.id === selected) || null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "radial-gradient(ellipse at center, #1a0820 0%, #050008 70%, #000 100%)",
      display: "flex", flexDirection: "column", padding: "24px 16px",
      overflowY: "auto",
    }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{
          fontSize: 11, color: "#ff66cc", letterSpacing: "0.4em",
          textTransform: "uppercase", marginBottom: 6,
        }}>
          ⚜ Choose Your Champion ⚜
        </div>
        <h1 style={{
          fontSize: "clamp(22px, 4vw, 36px)", margin: 0,
          background: "linear-gradient(180deg, #fff 0%, #ff99dd 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          fontWeight: 900, letterSpacing: "0.02em",
        }}>
          THE HIVE AWAITS
        </h1>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 6 }}>
          Each faction wields a unique special ability. Choose wisely — death is final.
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 10, maxWidth: 980, margin: "0 auto", width: "100%",
      }}>
        {DESCENT_FACTIONS.map((f) => {
          const isSel = selected === f.id;
          return (
            <button key={f.id} onClick={() => setSelected(f.id)} style={{
              background: isSel
                ? "linear-gradient(180deg, rgba(255,102,204,0.25) 0%, rgba(80,20,80,0.6) 100%)"
                : "linear-gradient(180deg, rgba(40,20,50,0.6) 0%, rgba(20,8,30,0.8) 100%)",
              border: isSel ? "2px solid #ff66cc" : "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10, padding: "12px 10px", cursor: "pointer",
              color: "#fff", textAlign: "left",
              boxShadow: isSel ? "0 0 24px rgba(255,102,204,0.5)" : "none",
              transition: "all 0.15s",
            }}>
              <div style={{
                fontSize: 13, fontWeight: 800, letterSpacing: "0.05em",
                color: isSel ? "#ff99dd" : "#fff",
              }}>{f.name.toUpperCase()}</div>
              <div style={{
                fontSize: 10, color: isSel ? "#ffccee" : "rgba(255,255,255,0.6)",
                marginTop: 4, fontWeight: 700,
              }}>⚡ {f.specialName}</div>
            </button>
          );
        })}
      </div>

      {sel && (
        <div style={{
          maxWidth: 600, margin: "20px auto 0",
          background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,102,204,0.3)",
          borderRadius: 12, padding: 16, textAlign: "center",
        }}>
          <div style={{ fontSize: 11, color: "#ff66cc", letterSpacing: "0.2em", marginBottom: 4 }}>
            SPECIAL ABILITY
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 6 }}>
            ⚡ {sel.specialName}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", fontStyle: "italic" }}>
            "{sel.blurb}"
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>
            Cooldown: {(sel.specialCooldownMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
        <button onClick={onCancel} style={{
          padding: "12px 24px", background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
          color: "#fff", fontWeight: 700, cursor: "pointer",
        }}>Cancel</button>
        <button
          onClick={() => selected && onConfirm(selected)}
          disabled={!selected}
          style={{
            padding: "12px 32px",
            background: selected
              ? "linear-gradient(180deg, #ff66cc 0%, #aa2266 100%)"
              : "rgba(80,40,80,0.4)",
            border: "none", borderRadius: 8,
            color: "#fff", fontWeight: 900, fontSize: 14,
            letterSpacing: "0.1em", cursor: selected ? "pointer" : "not-allowed",
            boxShadow: selected ? "0 0 24px rgba(255,102,204,0.6)" : "none",
            opacity: selected ? 1 : 0.5,
          }}
        >
          ⚔ BEGIN DESCENT ⚔
        </button>
      </div>
    </div>
  );
};

export default FactionPicker;
