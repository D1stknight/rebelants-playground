// components/HiveDescent/HiveDescent.tsx
// Phase A: cinematic lobby + faction picker + 'descent in progress' placeholder.
// Real play consumption + 3D engine wires in during Phase B+.

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePoints } from "../../lib/usePoints";
import {
  DESCENT_PLAY_COST,
  DESCENT_TOTAL_FLOORS,
  DESCENT_FACTIONS,
} from "../../lib/descentConfig";
import { BIOMES } from "./biomes";

const FactionPicker = dynamic(() => import("./FactionPicker"), { ssr: false });

type RunState = "lobby" | "picking" | "running" | "reward" | "dead" | "victory";

const PLAYER_ID_KEY = "rebelants_player_id";
function getPlayerId(): string {
  if (typeof window === "undefined") return "anon";
  let id = window.localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = "p_" + Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

const HiveDescent: React.FC = () => {
  const [playerId, setPlayerId] = useState<string>("anon");
  useEffect(() => { setPlayerId(getPlayerId()); }, []);

  const {
    balance, remainingDaily, capBank, dailyCap, totalEarnRoom, refresh,
  } = usePoints(playerId);

  const [runState, setRunState] = useState<RunState>("lobby");
  const [factionId, setFactionId] = useState<string | null>(null);
  const [currentFloor, setCurrentFloor] = useState<number>(1);

  const playsAvailable = (remainingDaily || 0) + (capBank || 0);
  const canStart = playsAvailable >= DESCENT_PLAY_COST;

  const selectedFaction = useMemo(
    () => DESCENT_FACTIONS.find((f) => f.id === factionId) || null,
    [factionId]
  );

  function handleStart() {
    if (!canStart) return;
    setRunState("picking");
  }

  function handleConfirmFaction(id: string) {
    // NOTE: Phase A does not yet consume plays — the run-start API lands in Phase G.
    setFactionId(id);
    setCurrentFloor(1);
    setRunState("running");
    void refresh();
  }

  function handleAbandon() {
    setRunState("lobby");
    setFactionId(null);
    setCurrentFloor(1);
  }

  // ===================== LOBBY =====================
  if (runState === "lobby") {
    return (
      <div style={{
        minHeight: "100vh", color: "#fff", overflowX: "hidden",
        background: "radial-gradient(ellipse at 50% 0%, #2a0830 0%, #0a0210 50%, #000 100%)",
        position: "relative",
      }}>
        {/* Ambient particle layer */}
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.6,
          backgroundImage:
            "radial-gradient(2px 2px at 20% 30%, #ff66cc, transparent 50%)," +
            "radial-gradient(1px 1px at 80% 20%, #aa66ff, transparent 50%)," +
            "radial-gradient(1.5px 1.5px at 60% 70%, #ff88dd, transparent 50%)," +
            "radial-gradient(1px 1px at 10% 80%, #cc55ee, transparent 50%)," +
            "radial-gradient(2px 2px at 90% 60%, #ff99dd, transparent 50%)",
          backgroundSize: "100% 100%",
        }} />

        {/* Top bar — REBEL balance + back link */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", position: "relative", zIndex: 2,
        }}>
          <a href="/" style={{
            color: "rgba(255,255,255,0.6)", textDecoration: "none",
            fontSize: 13, fontWeight: 700, letterSpacing: "0.1em",
          }}>← PLAYGROUND</a>
          <div style={{
            background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,102,204,0.3)",
            borderRadius: 999, padding: "6px 14px",
            fontSize: 13, fontWeight: 800, letterSpacing: "0.05em",
          }}>
            💎 {(balance || 0).toLocaleString()} REBEL
          </div>
        </div>

        {/* Hero */}
        <div style={{
          textAlign: "center", padding: "30px 16px 20px", position: "relative", zIndex: 2,
        }}>
          <div style={{
            fontSize: 11, color: "#ff66cc", letterSpacing: "0.5em",
            textTransform: "uppercase", marginBottom: 10, fontWeight: 700,
          }}>
            ◆ Rebel Ants Playground ◆
          </div>
          <h1 style={{
            fontSize: "clamp(38px, 9vw, 88px)", margin: 0,
            fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 0.95,
            background: "linear-gradient(180deg, #fff 0%, #ff99dd 60%, #aa3388 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            textShadow: "0 0 40px rgba(255,102,204,0.3)",
          }}>
            THE HIVE
          </h1>
          <h1 style={{
            fontSize: "clamp(38px, 9vw, 88px)", margin: 0,
            fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 0.95,
            background: "linear-gradient(180deg, #ff99dd 0%, #aa3388 50%, #4a0a30 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            DESCENT
          </h1>
          <div style={{
            fontSize: "clamp(13px, 2vw, 16px)", color: "rgba(255,255,255,0.7)",
            marginTop: 18, maxWidth: 580, marginLeft: "auto", marginRight: "auto",
            fontStyle: "italic", lineHeight: 1.5,
          }}>
            "The Queen has been corrupted. The hive bleeds. Ten floors stand between you and her throne. Death is final. Glory is forever."
          </div>
        </div>

        {/* Plays / cap section — same pattern as Tunnel/Raid/Shuffle */}
        <div style={{
          maxWidth: 720, margin: "24px auto 0", padding: "0 16px",
          position: "relative", zIndex: 2,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "linear-gradient(180deg, rgba(60,20,80,0.4) 0%, rgba(20,8,30,0.6) 100%)",
            border: "1px solid rgba(255,102,204,0.2)",
            borderRadius: 12, padding: "12px 16px", gap: 10, flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                background: "rgba(255,102,204,0.15)", color: "#ff99dd",
                padding: "6px 12px", borderRadius: 999,
                fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              }}>
                PLAYS TODAY · {remainingDaily ?? 0}/{dailyCap ?? 0}
              </span>
              <span style={{
                background: "rgba(170,102,255,0.15)", color: "#cc99ff",
                padding: "6px 12px", borderRadius: 999,
                fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              }}>
                BONUS BANK · {capBank ?? 0}
              </span>
              <span style={{
                background: "rgba(255,255,255,0.08)", color: "#fff",
                padding: "6px 12px", borderRadius: 999,
                fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              }}>
                TOTAL LEFT · {playsAvailable}
              </span>
            </div>
          </div>
          <div style={{
            fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em",
            textAlign: "center", marginTop: 8,
          }}>
            🔄 Free plays reset daily · 💎 Buying REBEL raises your daily cap permanently + adds to your bonus bank (never expires)
          </div>
        </div>

        {/* The 10 floors preview */}
        <div style={{
          maxWidth: 980, margin: "32px auto 0", padding: "0 16px",
          position: "relative", zIndex: 2,
        }}>
          <div style={{
            fontSize: 11, color: "#ff66cc", letterSpacing: "0.4em",
            textTransform: "uppercase", textAlign: "center", marginBottom: 12,
          }}>
            ⛓ Ten Floors of Hell ⛓
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 8,
          }}>
            {BIOMES.map((b) => (
              <div key={b.floor} style={{
                background: "linear-gradient(180deg, " + b.skyTop + " 0%, " + b.skyBottom + " 100%)",
                border: b.kind === "final_boss"
                  ? "2px solid #ff3399"
                  : b.kind === "mini_boss"
                  ? "1.5px solid " + b.particleColor
                  : "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8, padding: "10px 12px", position: "relative",
                boxShadow: b.kind === "final_boss" ? "0 0 16px rgba(255,51,153,0.4)" : "none",
              }}>
                <div style={{
                  fontSize: 9, letterSpacing: "0.2em", fontWeight: 700,
                  color: b.kind === "combat" ? "rgba(255,255,255,0.45)" : b.particleColor,
                }}>
                  FLOOR {b.floor}{b.kind === "mini_boss" ? " · BOSS" : b.kind === "final_boss" ? " · FINAL" : ""}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 800, color: "#fff", marginTop: 2,
                }}>{b.name}</div>
                <div style={{
                  fontSize: 10, color: "rgba(255,255,255,0.55)",
                  fontStyle: "italic", marginTop: 2,
                }}>{b.subtitle}</div>
                <div style={{
                  fontSize: 10, color: b.particleColor, marginTop: 4, fontWeight: 700,
                }}>+{b.rebelReward} REBEL</div>
              </div>
            ))}
          </div>
        </div>

        {/* The big START button */}
        <div style={{
          maxWidth: 720, margin: "36px auto 24px", padding: "0 16px",
          textAlign: "center", position: "relative", zIndex: 2,
        }}>
          <button onClick={handleStart} disabled={!canStart} style={{
            width: "100%", padding: "22px 24px", fontSize: "clamp(18px, 4vw, 24px)",
            fontWeight: 900, letterSpacing: "0.15em",
            color: "#fff", border: "none", borderRadius: 14,
            background: canStart
              ? "linear-gradient(180deg, #ff3399 0%, #aa0066 50%, #5a0033 100%)"
              : "linear-gradient(180deg, rgba(80,30,80,0.5) 0%, rgba(40,10,40,0.7) 100%)",
            cursor: canStart ? "pointer" : "not-allowed",
            boxShadow: canStart
              ? "0 0 40px rgba(255,51,153,0.5), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
            opacity: canStart ? 1 : 0.6,
            transition: "all 0.2s",
          }}>
            ⚔ DESCEND · COST: {DESCENT_PLAY_COST} PLAYS ⚔
          </button>
          {!canStart && (
            <div style={{
              marginTop: 10, fontSize: 12, color: "#ff99aa",
            }}>
              ⚠ Need {DESCENT_PLAY_COST} plays to descend. You have {playsAvailable}.
            </div>
          )}
          <div style={{
            marginTop: 14, fontSize: 11, color: "rgba(255,255,255,0.5)",
            letterSpacing: "0.05em", lineHeight: 1.6,
          }}>
            🐜 Choose 1 of 11 factions · ⚡ Each has a unique special ability<br/>
            ❤️ 100 HP · ⚔ Real-time combat · 💀 Death is permanent<br/>
            💎 Up to 3,030 REBEL on a perfect run
          </div>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: "center", padding: "20px 16px 30px",
          fontSize: 10, color: "rgba(255,255,255,0.25)",
          letterSpacing: "0.1em", position: "relative", zIndex: 2,
        }}>
          © 2025 Rebel Ants Playground · Hive Descent
        </div>
      </div>
    );
  }

  // ===================== PICKING =====================
  if (runState === "picking") {
    return (
      <FactionPicker
        onConfirm={handleConfirmFaction}
        onCancel={() => setRunState("lobby")}
      />
    );
  }

  // ===================== RUNNING (placeholder until Phase B engine) =====================
  if (runState === "running") {
    const biome = BIOMES[Math.min(currentFloor - 1, BIOMES.length - 1)];
    return (
      <div style={{
        minHeight: "100vh", color: "#fff",
        background: "linear-gradient(180deg, " + biome.skyTop + " 0%, " + biome.skyBottom + " 100%)",
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 20, textAlign: "center",
      }}>
        <div style={{
          fontSize: 11, color: biome.particleColor, letterSpacing: "0.4em",
          textTransform: "uppercase", marginBottom: 8,
        }}>
          Floor {biome.floor} of {DESCENT_TOTAL_FLOORS}
        </div>
        <h1 style={{
          fontSize: "clamp(32px, 6vw, 56px)", margin: 0, fontWeight: 900,
          letterSpacing: "-0.01em",
          color: "#fff",
          textShadow: "0 0 30px " + biome.particleColor,
        }}>
          {biome.name}
        </h1>
        <div style={{
          fontSize: 14, color: "rgba(255,255,255,0.7)", fontStyle: "italic",
          marginTop: 10, maxWidth: 480,
        }}>
          "{biome.subtitle}"
        </div>
        <div style={{
          marginTop: 28, padding: "14px 24px",
          background: "rgba(0,0,0,0.5)", border: "1px solid " + biome.particleColor,
          borderRadius: 12, maxWidth: 460,
        }}>
          <div style={{ fontSize: 11, color: biome.particleColor, letterSpacing: "0.2em", marginBottom: 6 }}>
            ⚙ ENGINE LOADING ⚙
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
            The Three.js combat engine arrives in Phase B.<br/>
            For now, you can step through floors to preview the cinematic.
          </div>
        </div>

        <div style={{
          marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center",
        }}>
          {currentFloor < DESCENT_TOTAL_FLOORS && (
            <button onClick={() => setCurrentFloor((f) => Math.min(f + 1, DESCENT_TOTAL_FLOORS))} style={{
              padding: "12px 22px", border: "none", borderRadius: 10,
              background: "linear-gradient(180deg, " + biome.particleColor + " 0%, " + biome.fogColor + " 100%)",
              color: "#fff", fontWeight: 800, fontSize: 13, letterSpacing: "0.1em", cursor: "pointer",
              boxShadow: "0 0 20px " + biome.particleColor + "66",
            }}>
              ⏷ DESCEND TO FLOOR {currentFloor + 1}
            </button>
          )}
          {currentFloor === DESCENT_TOTAL_FLOORS && (
            <button onClick={() => setRunState("victory")} style={{
              padding: "12px 22px", border: "none", borderRadius: 10,
              background: "linear-gradient(180deg, #ffd700 0%, #aa6600 100%)",
              color: "#000", fontWeight: 900, fontSize: 13, letterSpacing: "0.1em", cursor: "pointer",
              boxShadow: "0 0 24px #ffd700aa",
            }}>
              ★ DEFEAT THE QUEEN ★
            </button>
          )}
          <button onClick={handleAbandon} style={{
            padding: "12px 18px", borderRadius: 10,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "#fff", fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", cursor: "pointer",
          }}>
            ✕ ABANDON
          </button>
        </div>

        {selectedFaction && (
          <div style={{
            position: "absolute", top: 14, left: 14,
            background: "rgba(0,0,0,0.5)", padding: "6px 12px", borderRadius: 8,
            fontSize: 11, letterSpacing: "0.1em", fontWeight: 700,
          }}>
            🐜 {selectedFaction.name.toUpperCase()} · ⚡ {selectedFaction.specialName}
          </div>
        )}
      </div>
    );
  }

  // ===================== VICTORY =====================
  if (runState === "victory") {
    return (
      <div style={{
        minHeight: "100vh", color: "#fff",
        background: "radial-gradient(ellipse at center, #4a3300 0%, #1a0f00 50%, #000 100%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 20, textAlign: "center",
      }}>
        <div style={{
          fontSize: 14, color: "#ffd700", letterSpacing: "0.5em", marginBottom: 14,
        }}>★ ★ ★ VICTORY ★ ★ ★</div>
        <h1 style={{
          fontSize: "clamp(40px, 9vw, 96px)", margin: 0, fontWeight: 900,
          background: "linear-gradient(180deg, #fff 0%, #ffd700 50%, #aa6600 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          textShadow: "0 0 40px #ffd700",
        }}>
          THE QUEEN FALLS
        </h1>
        <div style={{ fontSize: 16, color: "rgba(255,255,255,0.8)", marginTop: 16, fontStyle: "italic" }}>
          You have descended where no rebel has returned.
        </div>
        <button onClick={handleAbandon} style={{
          marginTop: 30, padding: "14px 28px", border: "none", borderRadius: 12,
          background: "linear-gradient(180deg, #ffd700 0%, #aa6600 100%)",
          color: "#000", fontWeight: 900, fontSize: 14, letterSpacing: "0.15em", cursor: "pointer",
        }}>
          ↻ RETURN TO LOBBY
        </button>
      </div>
    );
  }

  // ===================== DEAD =====================
  if (runState === "dead") {
    return (
      <div style={{
        minHeight: "100vh", color: "#fff",
        background: "radial-gradient(ellipse at center, #2a0010 0%, #0a0006 60%, #000 100%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 20, textAlign: "center",
      }}>
        <div style={{ fontSize: 14, color: "#ff3366", letterSpacing: "0.5em", marginBottom: 14 }}>
          ☠ DEFEATED ☠
        </div>
        <h1 style={{
          fontSize: "clamp(40px, 9vw, 96px)", margin: 0, fontWeight: 900, color: "#ff3366",
          textShadow: "0 0 30px rgba(255,51,102,0.6)",
        }}>
          THE HIVE CLAIMS YOU
        </h1>
        <button onClick={handleAbandon} style={{
          marginTop: 30, padding: "14px 28px", border: "none", borderRadius: 12,
          background: "linear-gradient(180deg, #ff3366 0%, #770022 100%)",
          color: "#fff", fontWeight: 900, fontSize: 14, letterSpacing: "0.15em", cursor: "pointer",
        }}>
          ↻ TRY AGAIN
        </button>
      </div>
    );
  }

  return null;
};

export default HiveDescent;
