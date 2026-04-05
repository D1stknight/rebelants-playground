  const [lastSquad, setLastSquad] = useState<AntRole[] | null>(() => { try { const v = localStorage.getItem("ra:raid:lastSquad"); return v ? JSON.parse(v) : null; } catch { return null; } });
const LAST_SQUAD_KEY = "ra:raid:lastSquad";
function saveLastSquad(s: AntRole[]) { try { localStorage.setItem(LAST_SQUAD_KEY, JSON.stringify(s)); } catch {} }
function loadLastSquad(): AntRole[] | null { try { const v = localStorage.getItem(LAST_SQUAD_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
// components/Raid.tsx — THE RAID (Epic Edition v3)
import React, { useState, useEffect, useRef, useCallback } from "react";
// components/Raid.tsx — THE RAID (Epic Edition v2)

import Link from "next/link";
import { pointsConfig as defaultPointsConfig } from "../lib/pointsConfig";
import { usePoints } from "../lib/usePoints";
import { loadProfile, saveProfile, getEffectivePlayerId } from "../lib/profile";

// ── Raid Audio ────────────────────────────────────────────────────────────────
function useRaidAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:raid:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted);
  mutedRef.current = muted;
  const marchRef = React.useRef<HTMLAudioElement | null>(null);

  const play = React.useCallback((src: string, volume = 1) => {
    if (typeof window === "undefined") return;
    try { const a = new Audio(src); a.volume = volume; void a.play().catch(()=>{}); } catch {}
  }, []);

  const startMarch = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (marchRef.current) { marchRef.current.pause(); marchRef.current = null; }
    try {
      const a = new Audio("/audio/raid-march.mp3");
      a.loop = true; a.volume = mutedRef.current ? 0 : 0.4;
      void a.play().catch(()=>{}); marchRef.current = a;
    } catch {}
  }, []);

  const stopMarch = React.useCallback(() => {
    if (marchRef.current) { marchRef.current.pause(); marchRef.current.currentTime = 0; marchRef.current = null; }
  }, []);

  const toggleMute = React.useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { localStorage.setItem("ra:raid:muted", next ? "1" : "0"); } catch {}
      if (marchRef.current) marchRef.current.volume = next ? 0 : 0.4;
      return next;
    });
  }, []);

  const sfx = React.useMemo(() => ({
    survive: () => { if (!mutedRef.current) play("/audio/ant-survive.mp3", 0.6); },
    die:     () => { if (!mutedRef.current) play("/audio/ant-die.mp3",     0.3); },
    ultra:   () => { if (!mutedRef.current) { stopMarch(); play("/audio/raid-ultra.mp3", 0.9); } },
    fail:    () => { if (!mutedRef.current) { stopMarch(); play("/audio/raid-fail.mp3",  0.7); } },
  }), [play, stopMarch]);

  return { muted, toggleMute, startMarch, stopMarch, sfx };
}
import { addWin } from "../lib/winsStore";
import BuyPointsModal from "./BuyPointsModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "idle" | "launching" | "battling" | "revealed";
type Rarity = "none" | "common" | "rare" | "ultra";
type AntRole = "scout" | "soldier" | "carrier" | "guard" | "bomber";

type AntSlot = {
  role: AntRole;
  survived: boolean | null;
  boosted?: boolean;
};

type Prize =
  | { type: "none"; label: string }
  | { type: "points"; label: string; points: number }
  | { type: "nft"; label: string; meta?: any }
  | { type: "merch"; label: string; meta?: any };

type RaidLeaderboards = {
  topCommanders: { playerId: string; playerName?: string; score: number }[];
  brutalRaids:   { playerId: string; playerName?: string; score: number }[];
  ultraHaul:     { playerId: string; playerName?: string; ts: number }[];
  recentRaids:   { playerId: string; playerName?: string; rarity: Rarity; survivors: number; ts: number; pointsAwarded: number }[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SQUAD_SIZE   = 20;
const REVEAL_MS    = 700; // slower = more drama

// Default survival odds (can be overridden by admin via pointsConfig)
const BASE_SURVIVAL: Record<AntRole, number> = {
  scout:   0.62,
  soldier: 0.48,
  carrier: 0.20, // brutal — needs guards
  guard:   0.58,
  bomber:  0.08,
};

// Default crate thresholds (can be overridden by admin)
const DEFAULT_ULTRA_CARRIERS   = 4;
const DEFAULT_ULTRA_RATIO      = 0.65;
const DEFAULT_RARE_CARRIERS    = 1;
const DEFAULT_RARE_RATIO       = 0.40;
const DEFAULT_COMMON_SURVIVORS = 5;

const ROLE_META: Record<AntRole, {
  emoji: string; label: string; desc: string;
  color: string; bgColor: string; survivalDisplay: string;
}> = {
  scout:   { emoji: "🔍", label: "Scout",   desc: "Reveals path, boosts squad behind it",  color: "#60a5fa", bgColor: "rgba(96,165,250,0.15)",  survivalDisplay: "62%" },
  soldier: { emoji: "⚔️",  label: "Soldier", desc: "Fights through enemy guards",           color: "#f87171", bgColor: "rgba(248,113,113,0.15)",  survivalDisplay: "48%" },
  carrier: { emoji: "🎒", label: "Carrier", desc: "Brings loot — MUST survive for crates", color: "#fbbf24", bgColor: "rgba(251,191,36,0.15)",   survivalDisplay: "cfg" },
  guard:   { emoji: "🛡️",  label: "Guard",   desc: "Protects adjacent Carriers (+25%)",     color: "#34d399", bgColor: "rgba(52,211,153,0.15)",   survivalDisplay: "58%" },
  bomber:  { emoji: "💥", label: "Bomber",  desc: "Dies but clears path for next 3 ants",  color: "#f472b6", bgColor: "rgba(244,114,182,0.15)",  survivalDisplay: "8%"  },
};

// Role costs (REBEL) - added to squad total before raid launch
const ROLE_COST: Record<AntRole, number> = {
  scout:   10,
  soldier: 15,
  guard:   20,
  carrier: 30,
  bomber:   5,
};

function calcSquadCost(squad: AntRole[]): number {
  return squad.reduce((sum, role) => sum + ROLE_COST[role], 0);
}

const DEFAULT_SQUAD: AntRole[] = [
  "scout","scout","soldier","soldier","bomber",
  "guard","carrier","guard","carrier","soldier",
  "scout","soldier","guard","carrier","bomber",
  "guard","carrier","soldier","scout","soldier",
];

// ── Battle Engine ─────────────────────────────────────────────────────────────

function simulateBattle(squad: AntRole[], cfg: any, survivalMult = 1.0): AntSlot[] {
  const slots: AntSlot[] = squad.map(role => ({ role, survived: null, boosted: false }));

  // Pull survival overrides from admin config if present
  const carrierSurvival = Number(cfg?.raidCarrierSurvival ?? BASE_SURVIVAL.carrier);

  const survival: Record<AntRole, number> = {
    ...BASE_SURVIVAL,
    carrier: carrierSurvival,
  };

  const frontScouts = squad.slice(0, 4).filter(r => r === "scout").length;
  const scoutBonus = frontScouts * 0.04;
  let bomberBoostRemaining = 0;

  for (let i = 0; i < slots.length; i++) {
    const role = slots[i].role;
    let chance = survival[role] + scoutBonus;

    if (bomberBoostRemaining > 0 && role !== "bomber") {
      chance += 0.30;
      slots[i].boosted = true;
      bomberBoostRemaining--;
    }

    if (role === "carrier") {
      if (i > 0 && squad[i - 1] === "guard") chance += 0.25;
      if (i < squad.length - 1 && squad[i + 1] === "guard") chance += 0.25;
    }

    if (role === "bomber") {
      slots[i].survived = false;
      bomberBoostRemaining = 3;
      continue;
    }

    slots[i].survived = Math.random() < Math.min(chance * survivalMult, 0.88);
  }

  return slots;
}

function calcPrize(slots: AntSlot[], cfg: any): { rarity: Rarity; prize: Prize } {
  const currency  = cfg?.currency || "REBEL";
  const survivors = slots.filter(s => s.survived).length;
  const carriers  = slots.filter(s => s.role === "carrier" && s.survived).length;
  const ratio     = survivors / slots.length;

  const ultraCarriers = Number(cfg?.raidUltraCarriers ?? DEFAULT_ULTRA_CARRIERS);
  const ultraRatio    = Number(cfg?.raidUltraRatio    ?? DEFAULT_ULTRA_RATIO);
  const rareCarriers  = Number(cfg?.raidRareCarriers  ?? DEFAULT_RARE_CARRIERS);
  const rareRatio     = Number(cfg?.raidRareRatio     ?? DEFAULT_RARE_RATIO);
  const commonMin     = Number(cfg?.raidCommonSurvivors ?? DEFAULT_COMMON_SURVIVORS);

  let rarity: Rarity = "none";
  if (carriers >= ultraCarriers && ratio >= ultraRatio)    rarity = "ultra";
  else if (carriers >= rareCarriers && ratio >= rareRatio) rarity = "rare";
  else if (survivors >= commonMin)                          rarity = "common";

  const pts =
    rarity === "ultra"  ? Number(cfg?.rewards?.ultra  ?? 300) :
    rarity === "rare"   ? Number(cfg?.rewards?.rare   ?? 100) :
    rarity === "common" ? Number(cfg?.rewards?.common ?? 50)  : 0;

  if (pts > 0) return { rarity, prize: { type: "points", label: `+${pts} ${currency}`, points: pts } };
  return { rarity: "none", prize: { type: "none", label: "The colony repelled your forces." } };
}

// ── Role Picker ───────────────────────────────────────────────────────────────

function RolePicker({ squad, onChange, disabled, carrierPct }: {
  squad: AntRole[]; onChange: (n: AntRole[]) => void; disabled: boolean; carrierPct: number;
}) {
  const roles = Object.keys(ROLE_META) as AntRole[];

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, opacity: 0.9, letterSpacing: "0.05em" }}>
        🐜 ASSEMBLE YOUR SQUAD — {squad.length}/{SQUAD_SIZE} ANTS · Squad Cost: {calcSquadCost(squad)} REBEL
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 12 }}>
        {roles.map(role => {
          const m = ROLE_META[role];
          const count = squad.filter(r => r === role).length;
          const canAdd = squad.length < SQUAD_SIZE && !disabled;
          return (
            <button key={role} disabled={!canAdd} title={m.desc}
              onClick={() => canAdd && onChange([...squad, role])}
              style={{
                padding: "10px 4px", borderRadius: 12,
                border: `1px solid ${m.color}55`,
                background: m.bgColor, color: "white",
                cursor: canAdd ? "pointer" : "not-allowed",
                fontSize: 11, fontWeight: 700, textAlign: "center",
                opacity: disabled ? 0.5 : 1,
              }}>
              <div style={{ fontSize: 22, marginBottom: 2 }}>{m.emoji}</div>
              <div style={{ color: m.color, fontSize: 10, fontWeight: 900 }}>{m.label}</div>
              <div style={{ opacity: 0.55, fontSize: 9, marginTop: 1 }}>survive: {role === "carrier" ? carrierPct + "%" : m.survivalDisplay}</div>
              <div style={{ color: m.color, fontSize: 9, marginTop: 1, fontWeight: 900 }}>{ROLE_COST[role]} REBEL</div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 900, color: count > 0 ? m.color : "rgba(255,255,255,.3)" }}>×{count}</div>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6, fontWeight: 700, letterSpacing: "0.06em" }}>
        🪖 MARCHING ORDER (click ant to remove)
      </div>

      <div style={{
        display: "flex", gap: 3, flexWrap: "wrap",
        padding: 10, borderRadius: 12,
        background: "rgba(0,0,0,.35)", border: "1px solid rgba(255,255,255,.08)", minHeight: 54,
      }}>
        {squad.map((role, i) => {
          const m = ROLE_META[role];
          return (
            <button key={i} disabled={disabled}
              title={`#${i+1} ${m.label} — click to remove`}
              onClick={() => { if (!disabled) { const n=[...squad]; n.splice(i,1); onChange(n); }}}
              style={{
                width: 32, height: 38, borderRadius: 8,
                border: `1px solid ${m.color}44`, background: m.bgColor,
                cursor: disabled ? "default" : "pointer",
                fontSize: 14, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", position: "relative",
              }}>
              <span>{m.emoji}</span>
              <span style={{ fontSize: 7, opacity: 0.55, marginTop: 1 }}>{i+1}</span>
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, SQUAD_SIZE - squad.length) }, (_, i) => (
          <div key={`e${i}`} style={{
            width: 32, height: 38, borderRadius: 8,
            border: "1px dashed rgba(255,255,255,.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, opacity: 0.18,
          }}>🐜</div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={disabled} onClick={() => onChange([...DEFAULT_SQUAD])}
          style={{ fontSize: 11, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.08)", color: "white", cursor: disabled?"not-allowed":"pointer", opacity: disabled?0.5:1, fontWeight: 700 }}>
          🐜 Auto-fill Squad
        </button>
        <button disabled={disabled} onClick={() => onChange([])}
          style={{ fontSize: 11, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.08)", color: "white", cursor: disabled?"not-allowed":"pointer", opacity: disabled?0.5:1, fontWeight: 700 }}>
          ✕ Clear
        </button>
        {lastSquad && lastSquad.length === SQUAD_SIZE && (
          <button disabled={disabled} onClick={() => onChange([...lastSquad])}
            style={{ fontSize:11, padding:"6px 12px", borderRadius:8, border:"1px solid rgba(251,191,36,.4)", background:"rgba(251,191,36,.1)", color:"#fbbf24", cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.5:1, fontWeight:700 }}
            title="Reuse your last squad — survival odds are slightly lower for repeat squads">
            🔁 Last Squad <span style={{fontSize:9,opacity:0.65}}>(−10% survival)</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Battle Scene ──────────────────────────────────────────────────────────────

function BattleScene({ slots, revealedCount, phase, ultraCarriers, ultraRatio }: {
  slots: AntSlot[]; revealedCount: number; phase: Phase;
  ultraCarriers: number; ultraRatio: number;
}) {
  const survivors = slots.slice(0, revealedCount).filter(s => s.survived).length;
  const carriers  = slots.slice(0, revealedCount).filter(s => s.role === "carrier" && s.survived).length;

  return (
    <div style={{
      marginTop: 16, borderRadius: 16,
      border: "1px solid rgba(255,255,255,.1)",
      background: "rgba(0,0,0,.55)",
      padding: 16, overflow: "hidden", position: "relative",
    }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 0%, rgba(96,165,250,.05) 0%, transparent 70%)" }} />

      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12, position: "relative", flexWrap: "wrap" }}>
        <span style={{ color: "#60a5fa", fontWeight: 800 }}>🐜 {revealedCount}/{slots.length} revealed</span>
        <span style={{ color: "#34d399", fontWeight: 800 }}>✅ {survivors} survived</span>
        <span style={{ color: "#fbbf24", fontWeight: 800 }}>🎒 {carriers} carrier{carriers !== 1 ? "s" : ""} home</span>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", position: "relative" }}>
        {slots.map((slot, i) => {
          const m = ROLE_META[slot.role];
          const isRevealed = i < revealedCount;
          const isActive   = i === revealedCount;
          const survived   = slot.survived;

          return (
            <div key={i} style={{
              width: 44, height: 52, borderRadius: 10,
              border: `1px solid ${!isRevealed ? "rgba(255,255,255,.07)" : survived ? `${m.color}66` : "rgba(239,68,68,.35)"}`,
              background: !isRevealed ? "rgba(255,255,255,.03)" : survived ? m.bgColor : "rgba(239,68,68,.08)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              fontSize: 18, position: "relative",
              transition: "all 0.4s cubic-bezier(.34,1.56,.64,1)",
              opacity: !isRevealed ? 0.2 : 1,
              transform: isActive ? "scale(1.2)" : "scale(1)",
              boxShadow: isActive ? `0 0 24px ${m.color}aa` : survived && isRevealed ? `0 0 8px ${m.color}33` : "none",
            }}>
              <span style={{
                filter: !isRevealed ? "grayscale(1)" : !survived ? "grayscale(.9) brightness(.5)" : "none",
                fontSize: isActive ? 22 : 18, transition: "font-size .2s ease",
              }}>{m.emoji}</span>
              {isRevealed && <span style={{ fontSize: 9, marginTop: 1, fontWeight: 900 }}>{survived ? "✅" : "💀"}</span>}
              {slot.boosted && isRevealed && survived && (
                <div style={{ position: "absolute", top: -6, right: -4, fontSize: 8, background: "#f472b6", borderRadius: 4, padding: "1px 3px", color: "white", fontWeight: 900 }}>💥</div>
              )}
              <span style={{ position: "absolute", bottom: 1, left: 0, right: 0, textAlign: "center", fontSize: 7, opacity: 0.35, fontWeight: 700 }}>{i+1}</span>
            </div>
          );
        })}
      </div>

      {phase === "battling" && revealedCount > 0 && (
        <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 10, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.07)", fontSize: 11, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#fbbf24", fontWeight: 800 }}>
            🎒 Ultra needs {ultraCarriers} carriers {carriers >= ultraCarriers ? "✅" : `(${carriers}/${ultraCarriers})`}
          </span>
          <span style={{ color: "#60a5fa", fontWeight: 800 }}>
            👥 Ultra needs {Math.ceil(ultraRatio * SQUAD_SIZE)} survivors {survivors >= Math.ceil(ultraRatio * SQUAD_SIZE) ? "✅" : `(${survivors}/${Math.ceil(ultraRatio * SQUAD_SIZE)})`}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Launch Animation ──────────────────────────────────────────────────────────

function LaunchAnimation() {
  return (
    <div style={{
      marginTop: 16, padding: 28, borderRadius: 16,
      background: "rgba(0,0,0,.55)",
      border: "1px solid rgba(96,165,250,.2)",
      textAlign: "center",
      boxShadow: "0 0 40px rgba(96,165,250,.06)",
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#60a5fa", marginBottom: 14, letterSpacing: "0.1em" }}>
        ⚔️ SQUAD MARCHING INTO ENEMY TERRITORY
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 3, flexWrap: "wrap" }}>
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} style={{ fontSize: 18, display: "inline-block", animation: `march 0.55s ease-in-out ${i * 0.06}s infinite alternate` }}>🐜</span>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, opacity: 0.5, letterSpacing: "0.08em" }}>
        No retreat. No surrender. 🐜
      </div>
      <style>{`@keyframes march { from{transform:translateY(0px)} to{transform:translateY(-8px)} }`}</style>
    </div>
  );
}

// ── Result Modal ──────────────────────────────────────────────────────────────

function RaidResultModal({ slots, rarity, prize, onClose, ultraCarriers, ultraRatio, rareCarriers, rareRatio, commonSurvivors }: {
  slots: AntSlot[]; rarity: Rarity; prize: Prize | null; onClose: () => void;
  ultraCarriers: number; ultraRatio: number;
  rareCarriers: number; rareRatio: number;
  commonSurvivors: number;
}) {
  const survivors = slots.filter(s => s.survived).length;
  const carriers  = slots.filter(s => s.role === "carrier" && s.survived).length;
  const isWin     = rarity !== "none";

  const title =
    rarity === "ultra"  ? "🏆 ULTRA HAUL — LEGENDARY RAID!" :
    rarity === "rare"   ? "⚔️ RARE LOOT — IMPRESSIVE COMMANDER!" :
    rarity === "common" ? "✅ CRATE SECURED — WELL FOUGHT!" :
    "💀 RAID FAILED — YOUR COLONY MOURNS";

  const titleColor =
    rarity === "ultra"  ? "#fbbf24" :
    rarity === "rare"   ? "#60a5fa" :
    rarity === "common" ? "#34d399" : "#f87171";

  const sparks = isWin ? Array.from({ length: 28 }, (_, i) => ({
    left: `${5 + (i * 3.3) % 90}%`, top: `${5 + (i * 7.1) % 80}%`,
    size: 8 + ((i * 3) % 14), delay: (i * 0.15) % 3.5,
    color: rarity === "ultra" ? "rgba(251,191,36,1)" : rarity === "rare" ? "rgba(96,165,250,.95)" : "rgba(52,211,153,.85)",
  })) : [];

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.82)", zIndex: 2147483647, backdropFilter: "blur(6px)" }}
      role="dialog" aria-modal="true">
      <div style={{
        position: "relative", width: "min(520px, 94vw)",
        padding: 28, borderRadius: 20,
        background: "linear-gradient(180deg, rgba(10,18,40,.99) 0%, rgba(5,10,25,.99) 100%)",
        border: `1px solid ${titleColor}44`,
        boxShadow: `0 0 60px ${titleColor}22, 0 28px 60px rgba(0,0,0,.7)`,
        overflow: "visible", maxHeight: "90vh", overflowY: "auto",
      }}>
        {sparks.map((s, i) => (
          <span key={i} style={{
            position: "absolute", left: s.left, top: s.top,
            width: s.size, height: s.size, borderRadius: "50%",
            background: `radial-gradient(circle, ${s.color} 0%, transparent 65%)`,
            filter: `blur(0.5px) drop-shadow(0 0 8px ${s.color})`,
            opacity: 0, pointerEvents: "none",
            animation: `pmSpark 2.8s ease-in-out ${s.delay}s infinite`,
          }} />
        ))}

        <div style={{ fontSize: 18, fontWeight: 900, color: titleColor, textAlign: "center", marginBottom: 16, textShadow: `0 0 20px ${titleColor}88`, letterSpacing: "0.04em" }}>
          {title}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16, textAlign: "center" }}>
          {[
            { label: "SURVIVED",       value: `${survivors}/${slots.length}`, color: "#34d399", emoji: "🐜" },
            { label: "CARRIERS HOME",  value: String(carriers),               color: "#fbbf24", emoji: "🎒" },
            { label: "FELL IN BATTLE", value: String(slots.length-survivors), color: "#f87171", emoji: "💀" },
          ].map(stat => (
            <div key={stat.label} style={{ padding: "10px 6px", borderRadius: 12, background: "rgba(0,0,0,.3)", border: `1px solid ${stat.color}22` }}>
              <div style={{ fontSize: 18 }}>{stat.emoji}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: 9, opacity: 0.55, fontWeight: 700, letterSpacing: "0.06em" }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center", marginBottom: 16 }}>
          {slots.map((slot, i) => {
            const m = ROLE_META[slot.role];
            return (
              <div key={i} title={`${m.label} — ${slot.survived ? "survived" : "fell"}`}
                style={{
                  width: 30, height: 36, borderRadius: 7,
                  border: `1px solid ${slot.survived ? `${m.color}55` : "rgba(239,68,68,.22)"}`,
                  background: slot.survived ? m.bgColor : "rgba(239,68,68,.06)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 12,
                }}>
                <span style={{ filter: slot.survived ? "none" : "grayscale(.9) brightness(.45)" }}>{m.emoji}</span>
                <span style={{ fontSize: 7 }}>{slot.survived ? "✅" : "💀"}</span>
              </div>
            );
          })}
        </div>

        {isWin && (
          <>
            <img src={`/crates/${rarity}.png`} alt={`${rarity} crate`}
              style={{ display: "block", width: 130, height: "auto", margin: "0 auto 12px" }} />
            <div style={{ textAlign: "center", fontSize: 15, fontWeight: 900, color: titleColor, marginBottom: 16 }}>
              {prize?.type === "points" ? (prize as any).label : prize?.label}
            </div>
          </>
        )}

        {!isWin && (
          <div style={{ textAlign: "center", fontSize: 13, opacity: 0.65, marginBottom: 16 }}>
            🐜 Regroup. Rebuild. Strike again.
          </div>
        )}

        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 12, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.07)", fontSize: 11, opacity: 0.8 }}>
          <div style={{ fontWeight: 800, marginBottom: 4, opacity: 0.9 }}>🎯 How to win crates</div>
          <div>🏆 Ultra: {ultraCarriers}+ carriers home AND {Math.round(ultraRatio*100)}%+ of squad survives</div>
          <div>⚔️ Rare: {rareCarriers}+ carrier home AND {Math.round(rareRatio*100)}%+ of squad survives</div>
          <div>✅ Common: {commonSurvivors}+ ants survive (any role)</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>💡 Guards placed next to Carriers give +25% survival to that Carrier</div>
        </div>

        <button className="btn" onClick={onClose}
          style={{ width: "100%", padding: 14, fontSize: 14, fontWeight: 900, background: `linear-gradient(135deg, ${titleColor}22, rgba(15,23,42,.8))`, border: `1px solid ${titleColor}55`, color: titleColor }}>
          {isWin ? "🐜 Claim Loot & Return to Base" : "🐜 Return to Base"}
        </button>
      </div>
      <style>{`@keyframes pmSpark{0%{transform:scale(0.3);opacity:0}20%{opacity:1}55%{transform:scale(1.15);opacity:.9}85%{transform:scale(0.6);opacity:.6}100%{transform:scale(0.2);opacity:0}}`}</style>
    </div>
  );
}

// ── Leaderboards (4 panels always visible) ────────────────────────────────────

function RaidLeaderboardPanel({ lb }: { lb: RaidLeaderboards }) {
  function shortId(id: string, name?: string) {
    if (name && name !== "guest") return name;
    if (id.startsWith("discord:")) return id.slice(8,18) + "…";
    if (id.startsWith("wallet:"))  return id.slice(7,13) + "…";
    return id.slice(0,12) + "…";
  }

  function timeAgo(ts: number) {
    const s = Math.floor((Date.now()-ts)/1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  const rarityColor: Record<Rarity, string> = { ultra:"#fbbf24", rare:"#60a5fa", common:"#34d399", none:"#f87171" };
  const medals = ["🥇","🥈","🥉","4.","5."];

  const panelStyle: React.CSSProperties = {
    flex: "1 1 220px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.1)",
    background: "rgba(0,0,0,.35)",
    overflow: "hidden",
    minWidth: 0,
  };

  const headerStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid rgba(255,255,255,.08)",
    fontSize: 11, fontWeight: 900,
    letterSpacing: "0.06em",
    background: "rgba(0,0,0,.2)",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,.04)",
    fontSize: 12,
  };

  const emptyStyle: React.CSSProperties = {
    padding: "20px 12px", fontSize: 12, opacity: 0.35, textAlign: "center",
  };

  const scrollStyle: React.CSSProperties = {
    maxHeight: 180, overflowY: "auto",
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.7, marginBottom: 10, letterSpacing: "0.06em" }}>
        ⚔️ RAID LEADERBOARDS
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>

        {/* Top Commanders */}
        <div style={panelStyle}>
          <div style={{ ...headerStyle, color: "#fbbf24" }}>🏆 Top Commanders</div>
          <div style={{ ...scrollStyle }}>
            {lb.topCommanders.length === 0
              ? <div style={emptyStyle}>No raids yet. Be first. 🐜</div>
              : lb.topCommanders.slice(0,5).map((e,i) => (
                <div key={i} style={rowStyle}>
                  <span style={{ opacity: 0.55, width: 22 }}>{medals[i]}</span>
                  <span style={{ flex: 1, marginLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortId(e.playerId, e.playerName)}</span>
                  <span style={{ color: "#fbbf24", fontWeight: 900, marginLeft: 8, whiteSpace: "nowrap" }}>{e.score} REBEL</span>
                </div>
              ))
            }
          </div>
          <div style={{ padding: "4px 12px 8px", fontSize: 9, opacity: 0.35 }}>Total REBEL earned across all games</div>
        </div>

        {/* Most Brutal */}
        <div style={panelStyle}>
          <div style={{ ...headerStyle, color: "#34d399" }}>💀 Most Brutal</div>
          <div style={scrollStyle}>
            {lb.brutalRaids.length === 0
              ? <div style={emptyStyle}>No raids yet. 🐜</div>
              : lb.brutalRaids.slice(0,5).map((e,i) => (
                <div key={i} style={rowStyle}>
                  <span style={{ opacity: 0.55, width: 22 }}>{medals[i]}</span>
                  <span style={{ flex: 1, marginLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortId(e.playerId, e.playerName)}</span>
                  <span style={{ color: "#34d399", fontWeight: 900, marginLeft: 8, whiteSpace: "nowrap" }}>{e.score} wins 🐜</span>
                </div>
              ))
            }
          </div>
          <div style={{ padding: "4px 12px 8px", fontSize: 9, opacity: 0.35 }}>Most total wins across all games</div>
        </div>

        {/* Ultra Hall */}
        <div style={panelStyle}>
          <div style={{ ...headerStyle, color: "#fbbf24" }}>✨ Ultra Hall of Fame</div>
          <div style={scrollStyle}>
            {lb.ultraHaul.length === 0
              ? <div style={emptyStyle}>No Ultra hauls yet. Can you be first? 🏆</div>
              : lb.ultraHaul.slice(0,5).map((e,i) => (
                <div key={i} style={rowStyle}>
                  <span style={{ fontSize: 14 }}>✨</span>
                  <span style={{ flex: 1, marginLeft: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortId(e.playerId, e.playerName)}</span>
                  <span style={{ color: "#fbbf24", fontWeight: 900, fontSize: 10, marginLeft: 8, whiteSpace: "nowrap" }}>{timeAgo(e.ts)}</span>
                </div>
              ))
            }
          </div>
          <div style={{ padding: "4px 12px 8px", fontSize: 9, opacity: 0.35 }}>Players who landed an Ultra crate on this game</div>
        </div>

        {/* Recent Raids */}
        <div style={panelStyle}>
          <div style={{ ...headerStyle, color: "#60a5fa" }}>🐜 Recent Raids</div>
          <div style={scrollStyle}>
            {lb.recentRaids.length === 0
              ? <div style={emptyStyle}>Quiet at the front. For now. 🐜</div>
              : lb.recentRaids.slice(0,5).map((e,i) => (
                <div key={i} style={rowStyle}>
                  <span style={{ color: rarityColor[e.rarity], fontSize: 13, width: 18 }}>
                    {e.rarity==="ultra"?"🏆":e.rarity==="rare"?"⚔️":e.rarity==="common"?"✅":"💀"}
                  </span>
                  <span style={{ flex: 1, marginLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{shortId(e.playerId, e.playerName)}</span>
                  <span style={{ color: "#34d399", fontSize: 10, marginLeft: 4, whiteSpace: "nowrap" }}>{e.pointsAwarded > 0 ? `+${e.pointsAwarded} REBEL` : '💀 No loot'}/{SQUAD_SIZE}🐜</span>
                  <span style={{ opacity: 0.35, fontSize: 9, marginLeft: 6, whiteSpace: "nowrap" }}>{timeAgo(e.ts)}</span>
                </div>
              ))
            }
          </div>
          <div style={{ padding: "4px 12px 8px", fontSize: 9, opacity: 0.35 }}>Latest raids on this game only</div>
        </div>

      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Raid() {
  const [{ name: initialName, id: initialId, effectiveId: initialEffectiveId }] = useState(() => {
    const p = loadProfile();
    const name = (p?.name||"guest").trim()||"guest";
    let id = (p?.id||"").trim();
    if (!id) { id=`guest-${Math.random().toString(36).slice(2,7)}`; saveProfile({name,id}); }
    return { name, id, effectiveId: getEffectivePlayerId({...p,id,name} as any) };
  });

  const [playerName, setPlayerName]              = useState(initialName);
  const [playerId]                               = useState(initialId);
  const [effectivePlayerId, setEffectivePlayerId]= useState(initialEffectiveId);

  useEffect(() => {
    const u = () => setEffectivePlayerId(getEffectivePlayerId(loadProfile()));
    u(); window.addEventListener("ra:identity-changed", u);
    return () => window.removeEventListener("ra:identity-changed", u);
  }, []);

  const [pointsConfig, setPointsConfig] = useState(defaultPointsConfig);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/config",{cache:"no-store"});
        const j = await r.json().catch(()=>null);
        if (!cancelled && r.ok && j?.pointsConfig) setPointsConfig(p=>({...p,...j.pointsConfig}));
      } catch {}
    })();
    return () => { cancelled=true; };
  }, []);

  const { balance, spend, earn, devGrant, refresh } = usePoints(effectivePlayerId);

  const [profile, setProfile] = useState<any>(()=>{ try{return loadProfile();}catch{return {};} });
  useEffect(() => {
    const s = ()=>{ try{setProfile(loadProfile());}catch{setProfile({});} };
    s(); window.addEventListener("ra:identity-changed",s);
    return ()=>window.removeEventListener("ra:identity-changed",s);
  }, []);
  useEffect(() => {
    if (typeof window==="undefined") return;
    if (new URLSearchParams(window.location.search).get("discord")==="1")
      window.dispatchEvent(new Event("ra:identity-changed"));
  }, []);

  const isDiscordConnected = !!profile?.discordUserId && !(profile as any)?.discordSkipLink;

  const lastPidRef = useRef<string>("");
  useEffect(() => {
    if (!effectivePlayerId||lastPidRef.current===effectivePlayerId) return;
    lastPidRef.current=effectivePlayerId; refresh().catch(()=>{});
  }, [effectivePlayerId, refresh]);

  // Discord auto-link (mirrors Shuffle)
  const didDiscordLinkRef = useRef(false);
  useEffect(() => {
    if (didDiscordLinkRef.current) return;
    didDiscordLinkRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const gate = loadProfile();
        if ((gate as any)?.discordSkipLink) return;
        const sr = await fetch("/api/auth/discord/session",{cache:"no-store"});
        const sj = await sr.json().catch(()=>null);
        if (!sr.ok||!sj?.ok||!sj?.discordUserId) return;
        const prof = loadProfile();
        const fromId = getEffectivePlayerId(prof);
        const toId = `discord:${sj.discordUserId}`;
        if (String(prof.primaryId||"")===toId) return;
        const lr = await fetch("/api/identity/link-discord",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fromId})});
        const lj = await lr.json().catch(()=>null);
        if (!lr.ok||!lj?.ok) return;
        saveProfile({discordUserId:sj.discordUserId,discordName:sj.discordName,primaryId:toId,name:sj.discordName||prof.name,discordSkipLink:false});
        if (typeof window!=="undefined") window.dispatchEvent(new Event("ra:identity-changed"));
        if (!cancelled) await refresh();
      } catch {}
    })();
    return ()=>{ cancelled=true; };
  }, []);

  // Daily claim
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [nextClaimTs, setNextClaimTs]   = useState<number | null>(null);
  const [countdownStr, setCountdownStr] = useState<string>('');

  // Format ms remaining into HH:MM:SS
  function formatCountdown(ms: number): string {
    if (ms <= 0) return '00:00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
  }
  const [claimStatus, setClaimStatus]   = useState("");
  const [claimBusy, setClaimBusy]       = useState(false);

  useEffect(() => {
    if (!effectivePlayerId) return;
    fetch(`/api/points/claim?playerId=${encodeURIComponent(effectivePlayerId)}`,{cache:"no-store"})
      .then(r=>r.json()).then(j=>{ if(j?.ok) setDailyClaimed(!!j.claimed); }).catch(()=>{});
  }, [effectivePlayerId]);

  async function claimDailyNow() {
    if (!effectivePlayerId||claimBusy) return;
    setClaimBusy(true); setClaimStatus("");
    try {
      const r = await fetch("/api/points/claim",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({playerId:effectivePlayerId,amount:(pointsConfig as any).dailyClaim})});
      const j = await r.json().catch(()=>null);
      if (!r.ok||!j?.ok){setClaimStatus(j?.error||"Claim failed.");return;}
      setClaimStatus(j?.alreadyClaimed?"Already claimed ✅":`+${j?.added||(pointsConfig as any).dailyClaim} ${(pointsConfig as any).currency} ✅`);
      setDailyClaimed(true); await refresh();
    } catch(e:any){setClaimStatus(e?.message||"Error");}
    finally{setClaimBusy(false);}
  }

  // ── Daily claim countdown ─────────────────────────────────────────────────
  // Load nextClaimTs when player identity or claim status changes
  React.useEffect(() => {
    if (!effectivePlayerId) return;
    (async () => {
      try {
        const r = await fetch(`/api/points/claim?playerId=${encodeURIComponent(effectivePlayerId)}`, { cache: 'no-store' });
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok && j?.msUntilNextClaim) {
          setNextClaimTs(Date.now() + Number(j.msUntilNextClaim));
        }
      } catch {}
    })();
  }, [effectivePlayerId, dailyClaimed]);

  // Live countdown ticker - updates every second
  React.useEffect(() => {
    if (!nextClaimTs) return;
    const tick = () => {
      const remaining = nextClaimTs - Date.now();
      if (remaining <= 0) {
        setCountdownStr('');
        setDailyClaimed(false);
        setNextClaimTs(null);
      } else {
        setCountdownStr(formatCountdown(remaining));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextClaimTs]);


  // DRIP migrate (mirrors Shuffle)
  const [showDripMigrate, setShowDripMigrate] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [dripBalance, setDripBalance]         = useState<number|null>(null);
  const [dripAmount, setDripAmount]           = useState<number>(0);
  const [dripBusy, setDripBusy]               = useState(false);
  const [dripStatus, setDripStatus]           = useState("");

  async function openDripModal() {
    setDripStatus(""); setDripBusy(true); setDripBalance(null);
    try {
      const r = await fetch("/api/drip/balance",{cache:"no-store"});
      const j = await r.json().catch(()=>null);
      if (!r.ok||!j?.ok){setDripStatus(j?.error||"Could not load DRIP balance.");setShowDripMigrate(true);return;}
      setDripBalance(Number(j.balance||0)); setDripAmount(0); setShowDripMigrate(true);
    } catch(e:any){setDripStatus(e?.message||"DRIP error");setShowDripMigrate(true);}
    finally{setDripBusy(false);}
  }

  async function migrateDripNow() {
    const amt = Math.floor(Number(dripAmount||0));
    if (!amt||amt<=0){setDripStatus("Enter an amount greater than 0.");return;}
    setDripBusy(true); setDripStatus("Migrating…");
    try {
      const idem = `${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
      const r = await fetch("/api/drip/migrate",{method:"POST",headers:{"Content-Type":"application/json","x-idempotency-key":idem},body:JSON.stringify({amount:amt,playerId:effectivePlayerId,idempotencyKey:idem})});
      const j = await r.json().catch(()=>null);
      if (!r.ok||!j?.ok){setDripStatus(j?.error||"Migrate failed.");if(typeof j?.dripBalance==="number")setDripBalance(j.dripBalance);return;}
      setDripStatus(`✅ Migrated ${amt} points into the game.`);
      await refresh();
      const br = await fetch("/api/drip/balance",{cache:"no-store"});
      const bj = await br.json().catch(()=>null);
      if(br.ok&&bj?.ok)setDripBalance(Number(bj.balance||0));
    } catch(e:any){setDripStatus(e?.message||"Migrate error");}
    finally{setDripBusy(false);}
  }

  // Game state
  const [squad, setSquad]                 = useState<AntRole[]>([...DEFAULT_SQUAD]);
  const [phase, setPhase]                 = useState<Phase>("idle");
  const { muted: raidMuted, toggleMute: toggleRaidMute, startMarch, stopMarch, sfx: raidSfx } = useRaidAudio();
  const [busy, setBusy]                   = useState(false);
  const [slots, setSlots]                 = useState<AntSlot[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [rarity, setRarity]               = useState<Rarity>("none");
  const [prize, setPrize]                 = useState<Prize|null>(null);
  const [showResult, setShowResult]       = useState(false);
  const [showBuyPoints, setShowBuyPoints] = useState(false);

  const cfg        = pointsConfig as any;
  const cost       = Number(cfg?.raidCost ?? 600);
  const squadCost  = calcSquadCost(squad);
  const totalCost  = cost + squadCost;
  const needMore   = Math.max(0, totalCost - balance);
  const ultraCarriersThreshold = Number(cfg?.raidUltraCarriers ?? DEFAULT_ULTRA_CARRIERS);
  const ultraRatioThreshold    = Number(cfg?.raidUltraRatio    ?? DEFAULT_ULTRA_RATIO);
  const rareCarriersThreshold  = Number(cfg?.raidRareCarriers  ?? DEFAULT_RARE_CARRIERS);
  const rareRatioThreshold     = Number(cfg?.raidRareRatio     ?? DEFAULT_RARE_RATIO);
  const commonSurvivorsThreshold = Number(cfg?.raidCommonSurvivors ?? DEFAULT_COMMON_SURVIVORS);

  // Leaderboards
  const [lb, setLb] = useState<RaidLeaderboards>({ topCommanders:[], brutalRaids:[], ultraHaul:[], recentRaids:[] });

  const loadLb = useCallback(async () => {
    try {
      const r = await fetch("/api/leaderboard/summary",{cache:"no-store"});
      const j = await r.json().catch(()=>null);
      if (!r.ok||!j?.ok) return;

      // Filter recentWins to expedition only
      const allRecent = Array.isArray(j.recentWins) ? j.recentWins : [];
      const raidRecent = allRecent.filter((w:any) => w?.game === "expedition");

      // Ultra haul: expedition wins with ultra rarity
      const ultraWins = raidRecent
        .filter((w:any) => w?.rarity === "ultra")
        .map((w:any) => ({ playerId: w.playerId, playerName: w.playerName, ts: w.ts }));

      setLb({
        topCommanders: Array.isArray(j.earned) ? j.earned : [],
        brutalRaids:   Array.isArray(j.wins)   ? j.wins   : [],
        ultraHaul:     ultraWins,
        recentRaids:   raidRecent.map((w:any) => ({
          playerId: w.playerId, playerName: w.playerName,
          rarity: w.rarity, survivors: w.survivors||0,
          ts: w.ts, pointsAwarded: w.pointsAwarded||0,
        })),
      });
    } catch {}
  }, []);

  useEffect(() => { loadLb(); }, [loadLb]);
  useEffect(() => {
    const h = () => loadLb();
    window.addEventListener("ra:leaderboards-refresh",h);
    return ()=>window.removeEventListener("ra:leaderboards-refresh",h);
  }, [loadLb]);

  async function launchRaid() {
    if (busy||squad.length<SQUAD_SIZE||balance<cost) return;
    setBusy(true); setPhase("launching"); startMarch();
    setSlots([]); setRevealedCount(0); setShowResult(false);

  try { localStorage.setItem("ra:raid:lastSquad", JSON.stringify(squad)); setLastSquad([...squad]); } catch {}
  const isRepeatSquad = lastSquad !== null && JSON.stringify(squad) === JSON.stringify(lastSquad);
    await spend(totalCost,"expedition");
    await new Promise(r=>setTimeout(r,900));

    const battleSlots = simulateBattle(squad, cfg, isRepeatSquad ? 0.9 : 1.0);
    setSlots(battleSlots); setPhase("battling");

    for (let i=1; i<=SQUAD_SIZE; i++) {
      await new Promise(r=>setTimeout(r,REVEAL_MS));
      setRevealedCount(i);
      if (battleSlots[i-1]?.survived) raidSfx.survive(); else raidSfx.die();
    }
    await new Promise(r=>setTimeout(r,800));

    const prof  = loadProfile();
    const pid   = String(effectivePlayerId||getEffectivePlayerId(prof)||prof?.id||"guest").trim().slice(0,64)||"guest";
    const pname = (prof?.discordName||playerName||prof?.name||"guest").trim()||"guest";
    const { rarity: r, prize: pz } = calcPrize(battleSlots, cfg);

    if (pz.type==="points"&&(pz as any).points>0) { await earn((pz as any).points); await refresh(); }

    const survivors     = battleSlots.filter(s=>s.survived).length;
    const pointsAwarded = pz.type==="points" ? (pz as any).points : 0;

    addWin({ id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`, ts:Date.now(), game:"expedition", playerId:pid, playerName:pname, rarity:r, pointsAwarded });

    await fetch("/api/wins/add",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`, ts:Date.now(), game:"expedition", playerId:effectivePlayerId||pid, playerName:prof?.discordName||prof?.name||pname, rarity:r, pointsAwarded, survivors, prize:pz.type!=="points"?pz:null }),
    }).catch(()=>{});

    window.dispatchEvent(new Event("ra:leaderboards-refresh"));
    if (r === "ultra" || r === "rare") raidSfx.ultra(); else raidSfx.fail();
    setRarity(r); setPrize(pz); setPhase("revealed"); setShowResult(true); setBusy(false);
  }

  function resetRaid() {
    stopMarch();
    setShowResult(false); setPhase("idle");
    setSlots([]); setRevealedCount(0);
    setRarity("none"); setPrize(null);
    setSquad([...DEFAULT_SQUAD]);
    try { const v = localStorage.getItem("ra:raid:lastSquad"); setLastSquad(v ? JSON.parse(v) : null); } catch {}
  }

  function disconnectDiscord() {
    try {
      const p:any = loadProfile()||{};
      const fallback = (p.walletAddress?`wallet:${p.walletAddress}`:(p.id||"guest")).trim();
      saveProfile({discordUserId:undefined,discordName:undefined,primaryId:fallback,discordSkipLink:true as any} as any);
      window.dispatchEvent(new Event("ra:identity-changed"));
    } catch {}
    window.location.href="/api/auth/discord/logout";
  }

  const isBattling = phase==="launching"||phase==="battling";

  return (
    <>
      {/* Epic background */}
      <div className="ant-colony-bg" aria-hidden="true" />

      <header className="page-head" role="banner">
        <div className="site-title" style={{ display:"flex", alignItems:"center", gap:10 }}>
          <Link href="/">Rebel Ants Playground</Link>
          <button onClick={toggleRaidMute} title={raidMuted ? "Unmute" : "Mute"} style={{ background:"rgba(0,0,0,0.4)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontSize:16, color:"rgba(255,255,255,0.8)", lineHeight:1 }}>
            {raidMuted ? "🔇" : "🔊"}
          </button>
        </div>
        <nav className="tabs" aria-label="Main">
          <Link href="/tunnel"     className="tab">🐜 Ant Tunnel</Link>
          <Link href="/hatch"      className="tab">⚔️ Faction Wars</Link>
          <Link href="/expedition" className="tab tab-active">⚔️ The Raid</Link>
          <Link href="/shuffle"    className="tab">🃏 Shuffle</Link>
        </nav>
      </header>

      <div className="ant-card">
        {/* Hero */}
        <div style={{ textAlign:"center", marginBottom:4 }}>
          <div style={{ fontSize:28, fontWeight:900, letterSpacing:"0.06em", background:"linear-gradient(135deg,#f87171,#fbbf24,#60a5fa)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:4 }}>
            ⚔️ THE RAID
          </div>
          <div style={{ fontSize:13, opacity:0.65, letterSpacing:"0.04em" }}>
            🐜 Assemble {SQUAD_SIZE} ants. March into enemy territory. Win loot or die trying.
          </div>
        </div>

        {/* Difficulty warning */}
        <div style={{ marginTop:10, padding:"8px 14px", borderRadius:10, background:"rgba(248,113,113,.07)", border:"1px solid rgba(248,113,113,.2)", fontSize:11, color:"#f87171", fontWeight:700, textAlign:"center", letterSpacing:"0.04em" }}>
          ⚠️ BRUTAL DIFFICULTY — Carriers only have {Math.round(Number(cfg?.raidCarrierSurvival ?? 20) * (Number(cfg?.raidCarrierSurvival ?? 20) <= 1 ? 100 : 1))}% survival. Place 🛡️ Guards next to them to boost their odds.
        </div>

        <RolePicker squad={squad} onChange={setSquad} disabled={isBattling} carrierPct={Math.round(Number(cfg?.raidCarrierSurvival ?? 0.20) * (Number(cfg?.raidCarrierSurvival ?? 0.20) <= 1 ? 100 : 1))} />

        {phase==="launching" && <LaunchAnimation />}
        {(phase==="battling"||phase==="revealed") && slots.length>0 && (
          <BattleScene
            slots={slots} revealedCount={revealedCount} phase={phase}
            ultraCarriers={ultraCarriersThreshold} ultraRatio={ultraRatioThreshold}
          />
        )}
        {phase==="battling" && (
          <div style={{ marginTop:8, fontSize:12, opacity:0.65, textAlign:"center", fontWeight:700, letterSpacing:"0.06em" }}>
            🐜 Ant {Math.min(revealedCount+1,SQUAD_SIZE)} of {SQUAD_SIZE} reporting in…
          </div>
        )}

        {/* CTA */}
        <div style={{ marginTop:16, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <button className="btn" onClick={launchRaid}
            disabled={busy||squad.length<SQUAD_SIZE||needMore>0}
            title={squad.length<SQUAD_SIZE?`Need ${SQUAD_SIZE} ants`:needMore>0?"Not enough points":""}
            style={{ minWidth:240, height:48, fontSize:14, fontWeight:900, display:"inline-flex", alignItems:"center", justifyContent:"center", position:"relative", background:busy?"rgba(15,23,42,.7)":"linear-gradient(135deg,rgba(248,113,113,.18),rgba(96,165,250,.18))", border:"1px solid rgba(248,113,113,.35)", color:"#f87171" }}>
            <span style={{ visibility:"hidden" }}>Launch Raid (-{cost} {cfg?.currency})</span>
            <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {phase==="launching"?"🐜 Marching…":phase==="battling"?"⚔️ Battle in progress…":squad.length<SQUAD_SIZE?`🐜 Need ${SQUAD_SIZE-squad.length} more ants`:`⚔️ Launch Raid (-${totalCost} ${cfg?.currency})`}
            </span>
          </button>

          <button className="btn" type="button" onClick={()=>setShowBuyPoints(true)} style={{ padding:"10px 14px", fontSize:12 }}>💳 Buy Points</button>

          {isDiscordConnected
            ? <button className="btn" type="button" onClick={disconnectDiscord} style={{ padding:"10px 14px", fontSize:12 }}>Disconnect Discord</button>
            : <button className="btn" type="button"
                onClick={()=>{ try{saveProfile({discordSkipLink:false});window.dispatchEvent(new Event("ra:identity-changed"));}catch{} window.location.href="/api/auth/discord/login"; }}
                style={{ padding:"10px 14px", fontSize:12 }}>Connect Discord</button>
          }

          <button
            className="btn"
            type="button"
            onClick={async()=>{ if(!isDiscordConnected)return; await openDripModal(); }}
            disabled={dripBusy||!isDiscordConnected}
            style={{ padding:"10px 14px", fontSize:12 }}
            title={isDiscordConnected?"Move points from Discord (DRIP) into the game.":"Connect Discord to migrate DRIP points."}
          >
            {dripBusy?"Loading DRIP…":isDiscordConnected?"Migrate DRIP Points":"Connect Discord for DRIP"}
          </button>

          <div style={{ fontSize:11, opacity:0.65 }}>Discord: <b>{isDiscordConnected?"✅":"❌"}</b></div>
        </div>

        <div style={{ marginTop:10, fontSize:12, opacity:0.8, display:"flex", gap:14, flexWrap:"wrap" }}>
          <span>🐜 Balance: <b>{balance}</b> {cfg?.currency}</span>
          <span>⚔️ Launch: <b>{cost}</b> + Squad: <b>{squadCost}</b> = <b>{totalCost}</b> {cfg?.currency}</span>
          {needMore>0 && <span style={{ color:"#f87171" }}>Need {needMore} more {cfg?.currency}</span>}
        </div>
        <div style={{ marginTop:6, fontSize:11, opacity:0.55, display:"flex", gap:10, flexWrap:"wrap" }}>
          <span>🏆 Ultra: +{cfg?.rewards?.ultra}</span>
          <span>⚔️ Rare: +{cfg?.rewards?.rare}</span>
          <span>✅ Common: +{cfg?.rewards?.common}</span>
          <span>📅 Daily cap: {cfg?.dailyEarnCap}</span>
        </div>

        {/* Name + claim */}
        <div style={{ marginTop:12, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <label style={{ fontSize:12, opacity:0.85 }}>
            🐜 Commander:&nbsp;
            <input value={playerName}
              onChange={e=>{ const v=(e.target.value.slice(0,18)||"guest").trim()||"guest"; setPlayerName(v); const p=loadProfile(); saveProfile({name:v,id:(p?.id||playerId||"guest").trim()||"guest"}); }}
              style={{ padding:"6px 10px", borderRadius:10, border:"1px solid rgba(255,255,255,.18)", background:"rgba(15,23,42,.55)", color:"inherit" }}
            />
            <div style={{ fontSize:10, opacity:0.55, marginTop:3 }}>ID: {profile?.discordName || playerName}</div>
          </label>

          <button className="btn" type="button" onClick={claimDailyNow} disabled={claimBusy||dailyClaimed} style={{ padding:"8px 12px", fontSize:12 }}>
            {dailyClaimed
              ? countdownStr
                ? `⏱ Next claim in ${countdownStr}`
                : "🐜 Claimed Today ✅"
              : `🐜 Daily +${cfg?.dailyClaim} ${cfg?.currency}`}
          </button>

          {process.env.NODE_ENV!=="production" && (
            <button className="btn" type="button" onClick={async()=>{ await devGrant(5000); await refresh(); alert("Dev grant ✅"); }} style={{ padding:"8px 12px", fontSize:12 }}>Dev +5000</button>
          )}
          {claimStatus && <div style={{ fontSize:11, opacity:0.85 }}>{claimStatus}</div>}
        </div>

        <div style={{ marginTop:10 }}>
          <button onClick={()=>setShowRules(true)} style={{ fontSize:12, textDecoration:"underline", opacity:0.65, background:"none", border:"none", color:"inherit", cursor:"pointer", padding:0 }}>Official Rules</button>
        </div>

        <RaidLeaderboardPanel lb={lb} />

        {showResult && slots.length>0 && (
          <RaidResultModal
            slots={slots} rarity={rarity} prize={prize} onClose={resetRaid}
            ultraCarriers={ultraCarriersThreshold} ultraRatio={ultraRatioThreshold}
            rareCarriers={rareCarriersThreshold} rareRatio={rareRatioThreshold}
            commonSurvivors={commonSurvivorsThreshold}
          />
        )}

        <BuyPointsModal open={showBuyPoints} onClose={()=>setShowBuyPoints(false)} playerId={effectivePlayerId} onClaimed={async()=>{ await refresh(); }} />

        {/* DRIP Modal */}
        {showDripMigrate && (
          <div style={{ position:"fixed", inset:0, zIndex:2500, background:"rgba(0,0,0,.6)", display:"grid", placeItems:"center", padding:16 }} role="dialog" aria-modal="true">
            <div style={{ width:"min(520px, 95vw)", borderRadius:16, border:"1px solid rgba(255,255,255,.18)", background:"rgba(15,23,42,.96)", boxShadow:"0 28px 60px rgba(0,0,0,.55)", padding:16, color:"white" }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center" }}>
                <div style={{ fontWeight:900, fontSize:16 }}>Migrate DRIP Points → Game</div>
                <button className="btn" onClick={()=>setShowDripMigrate(false)} style={{ padding:"8px 12px" }}>Close</button>
              </div>
              <div style={{ marginTop:10, fontSize:13, opacity:0.9, lineHeight:1.4 }}>
                This will <b>deduct</b> points from DRIP (Discord) and <b>credit</b> the same amount into the game. No double-dipping.
              </div>
              <div style={{ marginTop:12, fontSize:13, opacity:0.95 }}>DRIP Balance: <b>{typeof dripBalance==="number"?dripBalance:"—"}</b></div>
              <div style={{ marginTop:12, display:"grid", gap:8 }}>
                <label style={{ fontSize:12, opacity:0.9 }}>Amount to migrate</label>
                <input value={dripAmount===0?"":String(dripAmount)} onChange={e=>{ const raw=String(e.target.value||"").replace(/^0+/,""); setDripAmount(Number(raw||0)); }} type="number" min={0} step={1}
                  style={{ padding:"10px 12px", borderRadius:12, border:"1px solid rgba(255,255,255,.18)", background:"rgba(15,23,42,.7)", color:"white", outline:"none", fontWeight:800 }} />
                <button className="btn" type="button" onClick={migrateDripNow} disabled={dripBusy} style={{ padding:"12px 12px" }}>
                  <div style={{ fontWeight:900 }}>{dripBusy?"Working…":"Migrate Now"}</div>
                  <div style={{ fontSize:12, opacity:0.9 }}>Deduct from DRIP → Credit to <b>{effectivePlayerId}</b></div>
                </button>
              </div>
              {dripStatus && <div style={{ marginTop:12, fontSize:12, opacity:0.9, whiteSpace:"pre-wrap" }}>{dripStatus}</div>}
            </div>
          </div>
        )}
      </div>

      {showRules && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:3000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowRules(false)}>
          <div style={{ background:"#0f172a", border:"1px solid rgba(255,255,255,0.15)", borderRadius:16, padding:28, maxWidth:560, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative" }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ fontWeight:900, fontSize:18 }}>📋 Official Rules</div>
              <button onClick={()=>setShowRules(false)} style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, padding:"6px 14px", color:"white", cursor:"pointer", fontSize:13 }}>✕ Close</button>
            </div>
            <div style={{ fontSize:13, lineHeight:1.7, display:"flex", flexDirection:"column", gap:12, opacity:0.9 }}>
              <p><b>Free-to-play.</b> No purchase necessary to play. Void where prohibited.</p>
              <p><b>Game currency:</b> REBEL Points are an in-app, promotional points system. They have no guaranteed cash value and are not redeemable for cash.</p>
              <p><b>Optional purchase (APE):</b> You may optionally buy REBEL Points using APE to support the project. <b>All purchases are final</b> (no refunds). Network fees (gas) may apply.</p>
              <p><b>Prizes:</b> Crates may award REBEL Points and/or digital collectibles and/or merch (when available). Prize availability may vary by location.</p>
              <p><b>Daily limits:</b> Daily claim limits and daily play limits apply to support fair access and prevent abuse. Daily plays reset every 24 hours. Purchased bonus plays do not expire.</p>
              <p><b>Fair play:</b> Multi-accounting, automation/bots, exploits, or abuse may result in disqualification, prize forfeiture, or account blocking.</p>
              <p><b>Odds:</b> Prize odds and point values may change over time based on live configuration and promotions.</p>
              <p><b>Taxes:</b> You are responsible for any taxes associated with prizes, if applicable.</p>
              <p style={{ opacity:0.7 }}>By playing, you agree to these rules and acknowledge this is an entertainment experience with promotional rewards.</p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .ant-colony-bg {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background-image: url('/ui/raid-bg.jpg');
          background-size: cover; background-position: center;
        }
        .ant-colony-bg::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(140deg, rgba(4,9,22,0.78), rgba(7,13,30,0.85));
        }
        .page-head {
          position: relative; z-index: 10;
          max-width: 980px; margin: 24px auto 14px; padding: 4px 2px;
        }
        .site-title { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
        .site-title a { color: inherit; text-decoration: none; }
        .tabs { display: flex; gap: 8px; flex-wrap: wrap; }
        .tab {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 10px; border-radius: 999px; font-size: 13px;
          background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.15);
          backdrop-filter: blur(4px); transition: transform .06s ease, background .2s ease;
          color: inherit; text-decoration: none;
        }
        .tab:hover { transform: translateY(-1px); background: rgba(255,255,255,.11); }
        .tab-active { background: rgba(248,113,113,.14); border-color: rgba(248,113,113,.32); color: #f87171; }
        .ant-card {
          position: relative; z-index: 5;
          max-width: 980px; margin: 0 auto 40px;
          padding: 20px; border-radius: 20px;
          background: rgba(8,14,32,.88);
          border: 1px solid rgba(255,255,255,.1);
          backdrop-filter: blur(14px);
          box-shadow: 0 24px 60px rgba(0,0,0,.5);
        }
        .btn {
          border-radius: 12px; border: 1px solid rgba(255,255,255,.18);
          background: rgba(15,23,42,.7); color: white;
          font-weight: 800; cursor: pointer; padding: 10px 16px;
          transition: background .15s, transform .08s;
        }
        .btn:hover:not(:disabled) { background: rgba(15,23,42,.95); transform: translateY(-1px); }
        .btn:disabled { opacity: .42; cursor: not-allowed; transform: none; }
      `}</style>
    </>
  );
}
