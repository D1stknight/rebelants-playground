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
const LAST_SQUAD_KEY="ra:raid:lastSquad";
function saveLastSquad(s:AntRole[]){if(typeof window==="undefined")return;try{localStorage.setItem(LAST_SQUAD_KEY,JSON.stringify(s));}catch{}}
function loadLastSquad():AntRole[]|null{if(typeof window==="undefined")return null;try{const v=localStorage.getItem(LAST_SQUAD_KEY);return v?JSON.parse(v):null;}catch{return null;}}
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

function RolePicker({ squad, onChange, disabled, carrierPct, lastSquad, onLastSquad, faction }: {
  squad: AntRole[]; onChange: (n: AntRole[]) => void; disabled: boolean; carrierPct: number;
  lastSquad?: AntRole[] | null; onLastSquad?: (s: AntRole[]) => void;
  faction: import('../lib/factionConfig').FactionDef;
}) {
  const roles = Object.keys(ROLE_META) as AntRole[];
  const fc = faction.colors;
  const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";

  return (
    <div>
      {/* Role selection cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:14 }}>
        {roles.map(role => {
          const m = ROLE_META[role];
          const count = squad.filter(r => r === role).length;
          const canAdd = squad.length < SQUAD_SIZE && !disabled;
          const imgSrc = faction.roles[role as AntRole]?.img;
          return (
            <button key={role} disabled={!canAdd} title={m.desc}
              onClick={() => canAdd && onChange([...squad, role])}
              style={{
                position:'relative', padding:0, borderRadius:16, overflow:'hidden',
                border: count > 0 ? `2px solid ${fc.primary}` : '2px solid rgba(255,255,255,0.08)',
                background: count > 0 ? fc.bg : 'rgba(255,255,255,0.03)',
                cursor: canAdd ? 'pointer' : 'not-allowed',
                opacity: disabled ? 0.45 : 1,
                boxShadow: count > 0 ? `0 0 20px ${fc.glow}, inset 0 0 20px ${fc.bg}` : 'none',
                transition:'all 0.2s ease',
                transform: count > 0 ? 'scale(1.03)' : 'scale(1)',
                minHeight: 120,
                display:'flex', flexDirection:'column', alignItems:'center',
              }}>
              {/* Character image */}
              <div style={{ width:'100%', aspectRatio:'1', overflow:'hidden', borderRadius:'12px 12px 0 0',
                background: count > 0 ? fc.gradient : 'rgba(0,0,0,0.3)',
                display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
                <img key={imgSrc} src={imgSrc} alt={m.label}
                  style={{ width:'90%', height:'90%', objectFit:'contain',
                    filter: count > 0 ? `drop-shadow(0 0 8px ${fc.glow})` : 'brightness(0.7) saturate(0.6)',
                    transition:'all 0.3s ease' }}
                  onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                {/* Faction glow overlay when selected */}
                {count > 0 && <div style={{ position:'absolute', inset:0,
                  background: `radial-gradient(ellipse at 50% 80%, ${fc.glow} 0%, transparent 65%)`,
                  pointerEvents:'none' }} />}
                {/* Count badge */}
                {count > 0 && (
                  <div style={{ position:'absolute', top:4, right:4,
                    width:20, height:20, borderRadius:'50%',
                    background: fc.primary, color:'#000',
                    fontSize:11, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow: `0 0 8px ${fc.glow}`,
                    fontFamily: FONT,
                  }}>{count}</div>
                )}
              </div>
              {/* Label + stats */}
              <div style={{ padding:'6px 4px 8px', width:'100%', textAlign:'center' }}>
                <div style={{ fontFamily:FONT, fontSize:10, fontWeight:900, letterSpacing:'0.12em',
                  textTransform:'uppercase', color: count > 0 ? fc.text : 'rgba(255,255,255,0.6)',
                  marginBottom:2 }}>{faction.roles[role as AntRole]?.label || m.label}</div>
                <div style={{ fontFamily:FONT, fontSize:8, opacity:0.55, letterSpacing:'0.08em' }}>
                  survive: {role === 'carrier' ? carrierPct : m.survivalDisplay}%
                </div>
                <div style={{ fontFamily:FONT, fontSize:9, fontWeight:900,
                  color: count > 0 ? fc.primary : 'rgba(255,255,255,0.3)', marginTop:1 }}>
                  {ROLE_COST[role as AntRole]} REBEL
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Marching order */}
      <div style={{ fontFamily:FONT, fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase',
        color:'rgba(255,255,255,0.4)', marginBottom:6 }}>
        ⚔️ MARCHING ORDER — {squad.length}/{SQUAD_SIZE} · SQUAD COST: {calcSquadCost(squad)} REBEL
      </div>
      <div style={{ display:'flex', gap:4, flexWrap:'wrap', padding:'10px 12px', borderRadius:14,
        background:'rgba(0,0,0,0.4)', border:`1px solid ${fc.primary}22`, minHeight:60 }}>
        {squad.map((role, i) => {
          const m = ROLE_META[role];
          const imgSrc = faction.roles[role as AntRole]?.img;
          return (
            <button key={i} disabled={disabled}
              title={`#${i+1} ${m.label} — click to remove`}
              onClick={() => { if (!disabled) { const n=[...squad]; n.splice(i,1); onChange(n); }}}
              style={{ width:40, height:52, borderRadius:10, padding:'4px 2px 3px', overflow:'hidden',
                border: `1px solid ${fc.primary}66`,
                background: fc.bg,
                cursor: disabled ? 'default' : 'pointer', position:'relative',
                boxShadow: `0 0 8px ${fc.glow}`,
                transition:'transform 0.15s, box-shadow 0.15s',
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2,
              }}>
              <img key={imgSrc} src={imgSrc} alt={m.label}
                style={{ width:'85%', height:26, objectFit:'contain' }}
                onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
              <div style={{ fontFamily:FONT, fontSize:6, fontWeight:900, letterSpacing:'0.05em',
                color: fc.text, textTransform:'uppercase', lineHeight:1, marginTop:0 }}>
                {(faction.roles[role as AntRole]?.label || m.label).slice(0,4)}
              </div>
              <div style={{ position:'absolute', top:2, right:2, width:12, height:12, borderRadius:'50%',
                background:'rgba(0,0,0,0.7)', color:'rgba(255,255,255,0.5)',
                fontSize:7, display:'flex', alignItems:'center', justifyContent:'center' }}>
                ✕
              </div>
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, SQUAD_SIZE - squad.length) }, (_,i) => (
          <div key={`e${i}`} style={{ width:40, height:48, borderRadius:10,
            border: `1px dashed ${fc.primary}22`, display:'flex', alignItems:'center',
            justifyContent:'center', fontSize:14, opacity:0.15 }}>🐜</div>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
        <button disabled={disabled} onClick={() => onChange([...DEFAULT_SQUAD])}
          style={{ fontFamily:FONT, fontSize:10, padding:'7px 14px', borderRadius:50,
            border: `1px solid ${fc.primary}44`, background: fc.bg,
            color: fc.text, cursor: disabled ? 'not-allowed' : 'pointer',
            letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:900 }}>
          ⚡ AUTO-FILL
        </button>
        <button disabled={disabled} onClick={() => onChange([])}
          style={{ fontFamily:FONT, fontSize:10, padding:'7px 14px', borderRadius:50,
            border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)',
            color:'rgba(255,255,255,0.5)', cursor: disabled ? 'not-allowed' : 'pointer',
            letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:900 }}>
          ✕ CLEAR
        </button>
        {lastSquad && lastSquad.length === SQUAD_SIZE && onLastSquad && (
          <button disabled={disabled} onClick={() => onLastSquad([...lastSquad])}
            style={{ fontFamily:FONT, fontSize:10, padding:'7px 14px', borderRadius:50,
              border:'1px solid rgba(251,191,36,0.3)', background:'rgba(251,191,36,0.08)',
              color:'#fbbf24', cursor: disabled ? 'not-allowed' : 'pointer',
              letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:900 }}
            title="Reuse last squad — −10% survival">
            🔁 LAST SQUAD <span style={{fontSize:8,opacity:0.65}}>(−10%)</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Battle Scene ──────────────────────────────────────────────────────────────

function BattleScene({ slots, revealedCount, phase, ultraCarriers, ultraRatio, faction }: {
  slots: AntSlot[]; revealedCount: number; phase: Phase;
  ultraCarriers: number; ultraRatio: number;
  faction?: any;
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
              width: 48, height: 64, borderRadius: 10, overflow:'hidden', padding: 0,
              border: `1px solid ${!isRevealed ? "rgba(255,255,255,.07)" : survived ? `${m.color}66` : "rgba(239,68,68,.35)"}`,
              background: !isRevealed ? "rgba(255,255,255,.03)" : survived ? m.bgColor : "rgba(239,68,68,.08)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              fontSize: 18, position: "relative",
              transition: "all 0.4s cubic-bezier(.34,1.56,.64,1)",
              opacity: !isRevealed ? 0.2 : 1,
              transform: isActive ? "scale(1.2)" : "scale(1)",
              boxShadow: isActive ? `0 0 24px ${m.color}aa` : survived && isRevealed ? `0 0 8px ${m.color}33` : "none",
            }}>
                {faction?.roles?.[slot.role as AntRole]?.img ? (
                  <img key={faction.roles[slot.role as AntRole].img} src={faction.roles[slot.role as AntRole].img} alt={m.label}
                    style={{
                      width:'100%', height:40, objectFit:'contain',
                      filter: !isRevealed ? 'grayscale(1) brightness(0.3)'
                        : !survived ? 'grayscale(1) brightness(0.4) sepia(1) hue-rotate(280deg)'
                        : 'none',
                      transition:'filter 0.4s ease',
                    }}
                    onError={e=>{(e.target as HTMLImageElement).style.display='none';}}
                  />
                ) : (
                  <span style={{
                    filter: !isRevealed ? "grayscale(1)" : !survived ? "grayscale(.9) brightness(.5)" : "none",
                    fontSize: isActive ? 22 : 18, transition: "font-size .2s ease",
                  }}>{m.emoji}</span>
                )}
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

function RaidResultModal({ slots, rarity, prize, onClose, ultraCarriers, ultraRatio, rareCarriers, rareRatio, commonSurvivors,
  prizeObj, prizeNeedShipping, prizeShipMsg, prizeShipBusy, prizeClaimId, prizeShipForm, setPrizeShipForm, setPrizeShipMsg, setPrizeShipBusy, setPrizeClaimId, setPrizeNeedShipping, effectivePlayerId: eid
}: {
  slots: AntSlot[]; rarity: Rarity; prize: Prize | null; onClose: () => void;
  ultraCarriers: number; ultraRatio: number;
  rareCarriers: number; rareRatio: number;
  commonSurvivors: number;
  prizeObj: any; prizeNeedShipping: boolean; prizeShipMsg: string; prizeShipBusy: boolean;
  prizeClaimId: string|undefined; prizeShipForm: any;
  setPrizeShipForm: (v:any)=>void; setPrizeShipMsg: (v:string)=>void;
  setPrizeShipBusy: (v:boolean)=>void; setPrizeClaimId: (v:string|undefined)=>void;
  setPrizeNeedShipping: (v:boolean)=>void; effectivePlayerId: string;
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

        {/* ── NFT: wallet input (Shuffle pattern) ── */}
          {isWin && prizeObj?.type === "nft" && !loadProfile()?.walletAddress && (
            <div style={{ marginTop: 12, textAlign: "left" }}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>✅ Enter the wallet you want this NFT sent to (we'll remember it for next time).</div>
              <input
                defaultValue={loadProfile()?.walletAddress || ""}
                onChange={(e) => { const next=String(e.target.value||"").trim(); const p=loadProfile(); saveProfile({...p,walletAddress:next}); }}
                placeholder="0x… wallet address"
                style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid rgba(255,255,255,.18)", background:"rgba(0,0,0,.25)", color:"white" }}
              />
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>After you continue, your claim will show up in Admin → Claims.</div>
            </div>
          )}
          {isWin && prizeObj?.type === "nft" && loadProfile()?.walletAddress && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
              ✅ NFT will be sent to: <b style={{ color: titleColor }}>{loadProfile()?.walletAddress}</b>
            </div>
          )}

          {/* ── Merch: shipping form (Shuffle pattern) ── */}
          {prizeNeedShipping && prizeClaimId && (
            <div style={{ marginTop: 12, textAlign: "left" }}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>✅ This merch prize needs shipping info to fulfill.</div>
              <div style={{ display: "grid", gap: 8 }}>
                {["name","email","phone","address1","address2","city","state","zip","country"].map(field => (
                  <input key={field} value={(prizeShipForm as any)[field]||""} onChange={e=>setPrizeShipForm((f:any)=>({...f,[field]:e.target.value}))} placeholder={field==="address1"?"Address Line 1":field==="address2"?"Address Line 2 (optional)":field.charAt(0).toUpperCase()+field.slice(1)} style={{ padding:"10px 12px", borderRadius:10, border:"1px solid rgba(255,255,255,.18)", background:"rgba(0,0,0,.25)", color:"white" }} />
                ))}
              </div>
              {prizeShipMsg && <div style={{ marginTop: 8, fontSize: 12, color: prizeShipMsg.includes("✅")?"#22c55e":"#f87171" }}>{prizeShipMsg}</div>}
            </div>
          )}
          {prizeShipMsg && !prizeNeedShipping && <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{prizeShipMsg}</div>}

          <button className="btn" disabled={prizeShipBusy}
            onClick={async () => {
              const _pid = String(eid||"guest").trim().slice(0,64)||"guest";
              // ── NFT: create claim with wallet ──
              if (prizeObj?.type === "nft") {
                const _w = loadProfile()?.walletAddress || "";
                if (!_w) { alert("Please enter a wallet address first."); return; }
                try {
                  const _cr = await fetch("/api/claims/create", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ playerId: _pid, wallet: _w, prize: prizeObj, game: "expedition", rarity }),
                  });
                  const _cj = await _cr.json().catch(() => null);
                  if (!_cr.ok || !_cj?.ok) { alert("Claim failed. Please try again."); return; }
                } catch { alert("Claim failed. Please try again."); return; }
              }
              // ── Merch: submit shipping if needed ──
              if (prizeNeedShipping && prizeClaimId) {
                setPrizeShipBusy(true);
                try {
                  const _sr = await fetch("/api/prizes/shipping", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ claimId: prizeClaimId, playerId: _pid, shipping: prizeShipForm }),
                  });
                  const _sj = await _sr.json().catch(() => null);
                  if (!_sr.ok || !_sj?.ok) { setPrizeShipMsg(_sj?.error || "Shipping save failed"); setPrizeShipBusy(false); return; }
                  setPrizeShipMsg("✅ Shipping saved!");
                } catch { setPrizeShipMsg("Shipping save failed"); setPrizeShipBusy(false); return; }
                setPrizeShipBusy(false);
              }
              onClose();
            }}
            style={{ width:"100%", padding:14, fontSize:14, fontWeight:900, background:`linear-gradient(135deg, ${titleColor}22, rgba(15,23,42,.8))`, border:`1px solid ${titleColor}55`, color:titleColor, opacity:prizeShipBusy?0.6:1, cursor:prizeShipBusy?"default":"pointer", marginTop:4 }}>
            {prizeShipBusy ? "Saving…" : isWin ? "🐜 Claim Loot & Return to Base" : "🐜 Return to Base"}
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

      {/* Copyright */}
      <div style={{ textAlign:"center", padding:"10px 0 6px", fontSize:10, opacity:0.28, color:"white", letterSpacing:"0.05em", userSelect:"none", pointerEvents:"none" }}>
        © 2026 Rebel Ants LLC · Developed by Miguel Concepcion
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
    // Try immediate autoplay (works if user already interacted)
    void startMarch();
    // Fallback: start on first click/touch/keydown anywhere
    const startOnce = () => { void startMarch(); document.removeEventListener('pointerdown', startOnce); document.removeEventListener('keydown', startOnce); };
    document.addEventListener('pointerdown', startOnce, { once: true });
    document.addEventListener('keydown', startOnce, { once: true });
    return () => { stopMarch(); document.removeEventListener('pointerdown', startOnce); document.removeEventListener('keydown', startOnce); };
  }, []);
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

  const { balance, spend, earn, devGrant, refresh, remainingDaily, capBank, dailyCap, totalEarnRoom } = usePoints(effectivePlayerId);

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
  const [squad, setSquad]                 = useState<AntRole[]>([]);
  const [lastSquad,setLastSquad]=useState<AntRole[]|null>(()=>{if(typeof window==="undefined")return null;try{const v=localStorage.getItem(LAST_SQUAD_KEY);return v?JSON.parse(v):null;}catch{return null;}});
  const [phase, setPhase]                 = useState<Phase>("idle");
  const { muted: raidMuted, toggleMute: toggleRaidMute, startMarch, stopMarch, sfx: raidSfx } = useRaidAudio();
  const [busy, setBusy]                   = useState(false);
  const [slots, setSlots]                 = useState<AntSlot[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [rarity, setRarity]               = useState<Rarity>("none");
  const [prize, setPrize]                 = useState<Prize|null>(null);
  const [showResult, setShowResult]       = useState(false);
  const [showBuyPoints, setShowBuyPoints] = useState(false);
  const [prizeObj, setPrizeObj] = useState<any>(null);
  const [prizeNeedShipping, setPrizeNeedShipping] = useState(false);
  const [prizeShipMsg, setPrizeShipMsg] = useState("");
  const [prizeShipBusy, setPrizeShipBusy] = useState(false);
  const [prizeClaimId, setPrizeClaimId] = useState<string|undefined>(undefined);
  const [prizeShipForm, setPrizeShipForm] = useState({ name:"", email:"", phone:"", address1:"", address2:"", city:"", state:"", zip:"", country:"" });

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

  if (typeof window !== "undefined") { try { localStorage.setItem("ra:raid:lastSquad", JSON.stringify(squad)); setLastSquad([...squad]); } catch {} }
  if(typeof window!=="undefined"){try{localStorage.setItem(LAST_SQUAD_KEY,JSON.stringify(squad));setLastSquad([...squad]);}catch{}}
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
  // ── Determine rarity locally (survivor/carrier counts) ──
  const { rarity: r_temp } = calcPrize(battleSlots, cfg);

  // ── Roll actual prize via server (Shuffle pattern — routes through NFT inventory) ──
  const _rollR = await fetch(`/api/prizes/roll?force=${r_temp}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: pid, rarity: r_temp, game: "expedition" }),
  }).catch(() => null);
  const _rollJ = _rollR ? await _rollR.json().catch(() => null) : null;
  const r = r_temp as Rarity;
  const pz: Prize = (_rollR?.ok && _rollJ?.ok && _rollJ?.prize) ? _rollJ.prize as Prize : calcPrize(battleSlots, cfg).prize;
  const fullPrizeObj = (_rollR?.ok && _rollJ?.ok && _rollJ?.prize) ? _rollJ.prize : null;

  // ── Merch: create claim immediately (Shuffle pattern) ──
  setPrizeNeedShipping(false); setPrizeShipMsg(""); setPrizeClaimId(undefined);
  if (String(pz?.type||"").toLowerCase() === "merch") {
    const _claimId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const _cr = await fetch("/api/prizes/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId: _claimId, playerId: pid, prize: pz, wallet: null, shipping: null, game: "expedition", rarity: r }),
    }).catch(() => null);
    const _cj = _cr ? await _cr.json().catch(() => null) : null;
    if (_cr?.ok && _cj?.ok) { setPrizeClaimId(_claimId); setPrizeNeedShipping(!!_cj.needShipping); }
    else { setPrizeShipMsg(_cj?.error || "Merch claim failed"); }
  }
  setPrizeObj(fullPrizeObj);

  if (pz.type==="points"&&(pz as any).points>0) { await earn((pz as any).points); await refresh(); }

  const survivors = battleSlots.filter(s=>s.survived).length;
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
  setPrizeObj(null); setPrizeNeedShipping(false); setPrizeShipMsg(""); setPrizeShipBusy(false); setPrizeClaimId(undefined);
  setPrizeShipForm({ name:"",email:"",phone:"",address1:"",address2:"",city:"",state:"",zip:"",country:"" });
    setSquad([...DEFAULT_SQUAD]);
    if(typeof window!=="undefined"){try{const v=localStorage.getItem(LAST_SQUAD_KEY);setLastSquad(v?JSON.parse(v):null);}catch{}}
    if (typeof window !== "undefined") { try { const v = localStorage.getItem("ra:raid:lastSquad"); setLastSquad(v ? JSON.parse(v) : null); } catch {} }
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



  const [factionId, setFactionId] = React.useState<import('../lib/factionConfig').FactionId>('ashigaru');
  // Inline faction data — SSR safe, no window access
  const FACTION_DATA: Record<string, any> = {
    ashigaru: { id:'ashigaru', name:'Ashigaru', colors:{ primary:'#4ade80', secondary:'#16a34a', bg:'rgba(22,163,74,0.12)', glow:'rgba(74,222,128,0.5)', text:'#4ade80', gradient:'linear-gradient(135deg,#14532d,#166534,#15803d)' }, roles:{ scout:{img:'/factions/ashigaru/ashigaru_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/ashigaru/ashigaru_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/ashigaru/ashigaru_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/ashigaru/ashigaru_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/ashigaru/ashigaru_bomber.PNG?v=2',label:'Bomber'} } },
    ronin:    { id:'ronin',    name:'Ronin',    colors:{ primary:'#ef4444', secondary:'#1c1917', bg:'rgba(239,68,68,0.1)', glow:'rgba(239,68,68,0.45)', text:'#f87171', gradient:'linear-gradient(135deg,#1c1917,#292524,#ef4444)' }, roles:{ scout:{img:'/factions/ronin/ronin_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/ronin/ronin_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/ronin/ronin_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/ronin/ronin_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/ronin/ronin_bomber.PNG?v=2',label:'Bomber'} } },
    samurai:  { id:'samurai',  name:'Samurai',  colors:{ primary:'#dc2626', secondary:'#7f1d1d', bg:'rgba(220,38,38,0.1)', glow:'rgba(220,38,38,0.45)', text:'#fca5a5', gradient:'linear-gradient(135deg,#450a0a,#7f1d1d,#dc2626)' }, roles:{ scout:{img:'/factions/samurai/samurai_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/samurai/samurai_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/samurai/samurai_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/samurai/samurai_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/samurai/samurai_bomber.PNG?v=2',label:'Bomber'} } },
    bushi:    { id:'bushi',    name:'Bushi',    colors:{ primary:'#eab308', secondary:'#1e3a5f', bg:'rgba(30,58,95,0.2)', glow:'rgba(234,179,8,0.45)', text:'#fbbf24', gradient:'linear-gradient(135deg,#0c1a2e,#1e3a5f,#b45309)' }, roles:{ scout:{img:'/factions/bushi/bushi_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/bushi/bushi_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/bushi/bushi_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/bushi/bushi_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/bushi/bushi_bomber.PNG?v=2',label:'Bomber'} } },
    warrior:  { id:'warrior',  name:'Warriors', colors:{ primary:'#b45309', secondary:'#78350f', bg:'rgba(180,83,9,0.1)', glow:'rgba(180,83,9,0.45)', text:'#fb923c', gradient:'linear-gradient(135deg,#431407,#78350f,#b45309)' }, roles:{ scout:{img:'/factions/warrior/warrior_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/warrior/warrior_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/warrior/warrior_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/warrior/warrior_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/warrior/warrior_bomber.PNG?v=2',label:'Bomber'} } },
    shogun:   { id:'shogun',   name:'Shogun',   colors:{ primary:'#a855f7', secondary:'#1e1b4b', bg:'rgba(168,85,247,0.1)', glow:'rgba(168,85,247,0.5)', text:'#c084fc', gradient:'linear-gradient(135deg,#0f0720,#1e1b4b,#6b21a8)' }, roles:{ scout:{img:'/factions/shogun/shogun_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/shogun/shogun_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/shogun/shogun_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/shogun/shogun_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/shogun/shogun_bomber.PNG?v=2',label:'Bomber'} } },
    buke:     { id:'buke',     name:'Buke',     colors:{ primary:'#84cc16', secondary:'#3f6212', bg:'rgba(132,204,22,0.08)', glow:'rgba(132,204,22,0.4)', text:'#a3e635', gradient:'linear-gradient(135deg,#1a2e05,#3f6212,#65a30d)' }, roles:{ scout:{img:'/factions/buke/buke_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/buke/buke_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/buke/buke_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/buke/buke_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/buke/buke_bomber.PNG?v=2',label:'Bomber'} } },
    kenshi:   { id:'kenshi',   name:'Kenshi',   colors:{ primary:'#06b6d4', secondary:'#164e63', bg:'rgba(6,182,212,0.1)', glow:'rgba(6,182,212,0.45)', text:'#67e8f9', gradient:'linear-gradient(135deg,#083344,#164e63,#0e7490)' }, roles:{ scout:{img:'/factions/kenshi/kenshi_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/kenshi/kenshi_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/kenshi/kenshi_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/kenshi/kenshi_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/kenshi/kenshi_bomber.PNG?v=2',label:'Bomber'} } },
    wokou:    { id:'wokou',    name:'Wokou',    colors:{ primary:'#a16207', secondary:'#78350f', bg:'rgba(161,98,7,0.1)', glow:'rgba(161,98,7,0.4)', text:'#ca8a04', gradient:'linear-gradient(135deg,#1c0a00,#431407,#92400e)' }, roles:{ scout:{img:'/factions/wokou/wokou_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/wokou/wokou_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/wokou/wokou_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/wokou/wokou_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/wokou/wokou_bomber.PNG?v=2',label:'Bomber'} } },
    sohei:    { id:'sohei',    name:'Sohei',    colors:{ primary:'#f97316', secondary:'#7c2d12', bg:'rgba(249,115,22,0.1)', glow:'rgba(249,115,22,0.45)', text:'#fdba74', gradient:'linear-gradient(135deg,#2c0a00,#7c2d12,#c2410c)' }, roles:{ scout:{img:'/factions/sohei/sohei_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/sohei/sohei_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/sohei/sohei_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/sohei/sohei_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/sohei/sohei_bomber.PNG?v=2',label:'Bomber'} } },
    yamabushi:{ id:'yamabushi',name:'Yamabushi',colors:{ primary:'#14b8a6', secondary:'#134e4a', bg:'rgba(20,184,166,0.1)', glow:'rgba(20,184,166,0.45)', text:'#5eead4', gradient:'linear-gradient(135deg,#042f2e,#134e4a,#0f766e)' }, roles:{ scout:{img:'/factions/yamabushi/yamabushi_scout.PNG?v=2',label:'Scout'}, soldier:{img:'/factions/yamabushi/yamabushi_soldier.PNG?v=2',label:'Soldier'}, carrier:{img:'/factions/yamabushi/yamabushi_carrier.PNG?v=2',label:'Carrier'}, guard:{img:'/factions/yamabushi/yamabushi_guard.PNG?v=2',label:'Guard'}, bomber:{img:'/factions/yamabushi/yamabushi_bomber.PNG?v=2',label:'Bomber'} } },
  };
  const faction = FACTION_DATA[factionId] ?? FACTION_DATA['ashigaru'];

  // Expose current faction to BattleScene via window (client-only)
  if (typeof window !== 'undefined') {
    (window as any).__RAID_FACTION__ = faction;
  }

  return (
    <>
      {/* ── PARTICLES ── */}
      <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none', overflow:'hidden' }}>
        {[...Array(25)].map((_,i) => (
          <div key={i} style={{
            position:'absolute', bottom:'-4px',
            left: `${(i*97+13)%100}%`,
            width: 1+(i%2), height: 2+(i%4),
            borderRadius: i%3===0 ? '50%' : '2px',
            background: i%3===0 ? '#22d3ee' : i%3===1 ? '#0ea5e9' : '#67e8f9',
            opacity: 0.1+(i%4)*0.05,
            animation: `raidFloat ${5+(i%5)*1.5}s ${(i*0.6)%7}s infinite linear`,
          }} />
        ))}
      </div>

      {/* ── BG ── */}
      <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none', backgroundImage:"url('/ui/raid-bg.jpg')", backgroundSize:'cover', backgroundPosition:'center', filter:'saturate(0.75) brightness(0.55)' }} />
      <div style={{ position:'fixed', inset:0, zIndex:1, pointerEvents:'none', background:'linear-gradient(160deg, rgba(2,6,23,0.8) 0%, rgba(3,10,28,0.65) 50%, rgba(2,8,20,0.85) 100%)' }} />
      <div style={{ position:'fixed', inset:0, zIndex:1, pointerEvents:'none', background:'radial-gradient(ellipse at 50% 20%, rgba(6,182,212,0.08) 0%, transparent 60%)' }} />

      {/* ── HEADER ── */}
      <header style={{ position:'relative', zIndex:20, maxWidth:980, margin:'0 auto', padding:'16px 20px 0', display:'flex', alignItems:'center', justifyContent:'space-between', fontFamily: "'Noto Serif JP', 'Hiragino Mincho ProN', serif" }}>
        <Link href="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', color:'white' }}>
          <span style={{ fontSize:20, filter:'drop-shadow(0 0 8px rgba(34,211,238,0.6))' }}>←</span>
          <span style={{ fontSize:11, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,0.5)' }}>REBEL ANTS</span>
        </Link>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:13, fontWeight:900, letterSpacing:'0.1em', color:'#fbbf24', filter:'drop-shadow(0 0 8px rgba(251,191,36,0.5))' }}>
            ⚡ {balance} <span style={{ fontSize:10, color:'rgba(251,191,36,0.6)' }}>REBEL</span>
          </div>
          <button onPointerDown={e=>{e.preventDefault();toggleRaidMute();}}
            style={{ background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:20, padding:'6px 12px', cursor:'pointer', fontSize:15, color:'rgba(255,255,255,0.8)', minWidth:40, minHeight:40, touchAction:'manipulation' }}>
            {raidMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      {/* ── MAIN ── */}
      <div style={{ position:'relative', zIndex:10, maxWidth:980, margin:'0 auto', padding:'12px 16px 40px', fontFamily: "'Noto Serif JP', 'Hiragino Mincho ProN', serif" }}>

        {/* Title */}
        <div style={{ textAlign:'center', marginBottom:20 }}>
          <div style={{ fontSize:'clamp(26px,5vw,52px)', fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase',
            background:'linear-gradient(135deg,#e0f2fe,#38bdf8,#0ea5e9,#22d3ee,#67e8f9)',
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
            filter:'drop-shadow(0 0 24px rgba(34,211,238,0.5))' }}>⚔️ THE RAID</div>
          <div style={{ fontSize:12, letterSpacing:'0.25em', color:'rgba(255,255,255,0.35)', textTransform:'uppercase', marginTop:6 }}>
            🐜 ASSEMBLE YOUR SQUAD · MARCH INTO ENEMY TERRITORY · WIN LOOT OR DIE TRYING
          </div>
        </div>

        {/* Mission briefing */}
        <div style={{ marginBottom:16, padding:'12px 18px', borderRadius:14, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.25)', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>⚠️</span>
          <div style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,180,180,0.85)' }}>
            BRUTAL DIFFICULTY — Carriers only have {Math.round(Number(cfg?.raidCarrierSurvival ?? 25) * 100)}% survival chance. Send warriors to protect them.
          </div>
        </div>

        {/* ── SQUAD BUILDER ── */}
        <div style={{ marginBottom:16, borderRadius:20, overflow:'hidden',
          background:'linear-gradient(135deg, rgba(3,10,28,0.9), rgba(5,15,35,0.95))',
          border:`1px solid ${faction.colors.primary}33`,
          boxShadow:`0 0 40px ${faction.colors.glow.replace('0.5','0.06')}, inset 0 1px 0 ${faction.colors.primary}22`,
          transition:'border-color 0.4s, box-shadow 0.4s',
        }}>
          {/* Squad builder header + faction dropdown */}
          <div style={{ padding:'14px 20px 12px', borderBottom:`1px solid ${faction.colors.primary}15`, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
            <div style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:12, fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase', color: faction.colors.text, filter:`drop-shadow(0 0 8px ${faction.colors.glow})` }}>
              ⚔️ ASSEMBLE YOUR SQUAD
            </div>

            {/* Faction Dropdown */}
            <div style={{ position:'relative', display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,0.4)' }}>FACTION</span>
              <select
                value={factionId}
                onChange={e => setFactionId(e.target.value as any)}
                style={{
                  fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif",
                  fontSize:11, fontWeight:900, letterSpacing:'0.12em',
                  background:'rgba(0,0,0,0.6)',
                  border:`1px solid ${faction.colors.primary}55`,
                  borderRadius:10, padding:'7px 32px 7px 12px',
                  color: faction.colors.text,
                  cursor:'pointer', outline:'none', appearance:'none',
                  boxShadow:`0 0 12px ${faction.colors.glow.replace('0.5','0.2')}`,
                  textTransform:'uppercase',
                  minWidth:140,
                }}>
                {[
                  {id:'ashigaru',name:'⛩ ASHIGARU',available:true},
                  {id:'ronin',name:'🗡 RONIN',available:true},
                  {id:'samurai',name:'⚔️ SAMURAI',available:true},
                  {id:'bushi',name:'🏯 BUSHI',available:true},
                  {id:'warrior',name:'🛡 WARRIORS',available:true},
                  {id:'shogun',name:'👑 SHOGUN',available:true},
                  {id:'buke',name:'🌿 BUKE',available:true},
                  {id:'kenshi',name:'💧 KENSHI',available:true},
                  {id:'wokou',name:'🌊 WOKOU',available:true},
                  {id:'sohei',name:'🔥 SOHEI',available:true},
                  {id:'yamabushi',name:'🌌 YAMABUSHI',available:true},
                ].map(f => (
                  <option key={f.id} value={f.id} disabled={!f.available}
                    style={{ background:'#0a0f1e', color: f.available ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                    {f.name}
                  </option>
                ))}
              </select>
              {/* Dropdown arrow */}
              <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', color: faction.colors.text, fontSize:9 }}>▼</div>
            </div>
          </div>

          <div style={{ padding:'16px 20px' }}>
            <RolePicker
              lastSquad={lastSquad} onLastSquad={(s) => setSquad(s)}
              squad={squad} onChange={setSquad}
              disabled={isBattling}
              carrierPct={Math.round(Number(cfg?.raidCarrierSurvival ?? 0.20) * (Number(cfg?.raidCarrierSurvival ?? 0.20) <= 1 ? 100 : 1))}
              faction={faction}
            />
          </div>
        </div>

        {/* ── BATTLE SCENE ── */}
        {(phase==='battling'||phase==='revealed') && slots.length>0 && (
          <div style={{ marginBottom:16, borderRadius:20, overflow:'hidden',
            background:'linear-gradient(135deg, rgba(3,10,28,0.95), rgba(8,20,50,0.98))',
            border:`1px solid ${faction.colors.primary}33`,
            boxShadow:`0 0 60px ${faction.colors.glow.replace('0.5','0.1')}, inset 0 1px 0 ${faction.colors.primary}22`,
            padding:'20px' }}>
            <div style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:11, fontWeight:900, letterSpacing:'0.25em', textTransform:'uppercase', color: faction.colors.text, marginBottom:14, filter:`drop-shadow(0 0 8px ${faction.colors.glow})` }}>
              ⚔️ BATTLE REPORT
            </div>
            <BattleScene slots={slots} revealedCount={revealedCount} phase={phase}
              ultraCarriers={ultraCarriersThreshold} ultraRatio={ultraRatioThreshold} faction={faction} />
          </div>
        )}

        {phase==='launching' && <LaunchAnimation />}

        {phase==='battling' && (
          <div style={{ marginTop:8, fontSize:12, textAlign:'center', fontWeight:900, fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", letterSpacing:'0.2em', textTransform:'uppercase', color:'#22d3ee', animation:'raidPulse 1s ease-in-out infinite', filter:'drop-shadow(0 0 8px rgba(34,211,238,0.6))' }}>
            🐜 ANT {Math.min(revealedCount+1,SQUAD_SIZE)} OF {SQUAD_SIZE} REPORTING IN…
          </div>
        )}

        {/* ── ACTION ROW ── */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginTop:16, marginBottom:12 }}>
          <button onClick={launchRaid}
            disabled={busy||squad.length<SQUAD_SIZE||needMore>0}
            title={squad.length<SQUAD_SIZE ? `Need ${SQUAD_SIZE} ants` : needMore>0 ? 'Not enough points' : ''}
            style={{
              fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", position:'relative', minWidth:240, height:52,
              display:'inline-flex', alignItems:'center', justifyContent:'center',
              fontSize:13, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase',
              background: (busy||squad.length<SQUAD_SIZE||needMore>0) ? 'rgba(6,182,212,0.08)' : 'linear-gradient(135deg,#0369a1,#0ea5e9,#22d3ee)',
              border: (busy||squad.length<SQUAD_SIZE||needMore>0) ? '2px solid rgba(6,182,212,0.2)' : '2px solid rgba(34,211,238,0.6)',
              borderRadius:50, color:'white',
              cursor: (busy||squad.length<SQUAD_SIZE||needMore>0) ? 'not-allowed' : 'pointer',
              opacity: (busy||squad.length<SQUAD_SIZE||needMore>0) ? 0.45 : 1,
              boxShadow: (busy||squad.length<SQUAD_SIZE||needMore>0) ? 'none' : '0 0 20px rgba(6,182,212,0.5), 0 0 40px rgba(6,182,212,0.2)',
              animation: (!busy&&squad.length>=SQUAD_SIZE&&needMore===0) ? 'btnTealGlow 2.5s ease-in-out infinite' : 'none',
              transition:'all 0.2s',
            }}>
            <span style={{ visibility:'hidden', position:'absolute' }}>Launch Raid (-{cost} {cfg?.currency})</span>
            <span style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {phase==='launching' ? '🐜 MARCHING…' : phase==='battling' ? '⚔️ BATTLE IN PROGRESS…' : squad.length<SQUAD_SIZE ? `SQUAD NEEDS ${SQUAD_SIZE-squad.length} MORE` : `⚔️ LAUNCH RAID · COST: ${totalCost} ${cfg?.currency}`}
            </span>
          </button>

          <button type="button" onClick={()=>setShowBuyPoints(true)}
            style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'10px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.3)', borderRadius:50, color:'#fbbf24', cursor:'pointer', whiteSpace:'nowrap' }}>
            💎 BUY POINTS
          </button>

          {isDiscordConnected ? (
            <button type="button" onClick={disconnectDiscord}
              style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'10px 14px', fontSize:11, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase', background:'rgba(88,101,242,0.12)', border:'1px solid rgba(88,101,242,0.3)', borderRadius:50, color:'#a5b4fc', cursor:'pointer', whiteSpace:'nowrap' }}>
              ✓ DISCORD
            </button>
          ) : (
            <button type="button"
              onClick={()=>{ try{saveProfile({discordSkipLink:false});window.dispatchEvent(new Event('ra:identity-changed'));}catch{} window.location.href='/api/auth/discord/login'; }}
              style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'10px 14px', fontSize:11, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase', background:'#5865F2', border:'none', borderRadius:50, color:'white', cursor:'pointer', whiteSpace:'nowrap' }}>
              CONNECT DISCORD
            </button>
          )}

          <div style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:12, letterSpacing:'0.1em', color:'rgba(255,255,255,0.5)', textTransform:'uppercase' }}>
            <span style={{ color:'#fbbf24', fontWeight:900 }}>{balance}</span> {cfg?.currency}
          </div>
          {needMore>0 && <span style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:11, color:'#f87171', letterSpacing:'0.1em', textTransform:'uppercase' }}>NEED {needMore} MORE</span>}
        </div>

        
        {/* ── Plays & Cap Info ── */}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:10, padding:'12px 16px', borderRadius:14, background:'rgba(34,211,238,0.05)', border:'1px solid rgba(34,211,238,0.12)' }}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', flex:1 }}>
            <div style={{ padding:'5px 14px', borderRadius:20, background:'rgba(34,211,238,0.1)', border:'1px solid rgba(34,211,238,0.25)' }}>
              <span style={{ fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.45)', marginRight:5 }}>PLAYS TODAY</span>
              <span style={{ fontSize:14, fontWeight:900, color:'#22d3ee' }}>{remainingDaily}</span>
              <span style={{ fontSize:10, color:'rgba(255,255,255,0.3)' }}> / {Number(dailyCap||0)}</span>
            </div>
            {capBank > 0 && (
              <div style={{ padding:'5px 14px', borderRadius:20, background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.25)' }}>
                <span style={{ fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase', color:'rgba(255,255,255,0.45)', marginRight:5 }}>BONUS PLAYS</span>
                <span style={{ fontSize:14, fontWeight:900, color:'#fbbf24' }}>+{capBank}</span>
                <span style={{ fontSize:9, color:'rgba(255,255,255,0.3)', marginLeft:4 }}>NEVER EXPIRE</span>
              </div>
            )}
          </div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', letterSpacing:'0.06em', textAlign:'right', lineHeight:1.5 }}>
            Resets daily · 💎 Buy REBEL for bonus plays that never expire
          </div>
        </div>
        {/* ── INFO STRIP ── */}
        <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'center', marginBottom:12, padding:'12px 16px', borderRadius:14, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(34,211,238,0.1)' }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {[
              {label:'ULTRA',val:`+${cfg?.rewards?.ultra}`,col:'#fbbf24'},
              {label:'RARE',val:`+${cfg?.rewards?.rare}`,col:'#22d3ee'},
              {label:'COMMON',val:`+${cfg?.rewards?.common}`,col:'#34d399'},
              {label:'LAUNCH',val:String(cost),col:'#f87171'},
              {label:'SQUAD',val:String(squadCost),col:'#f87171'},
            ].map(item => (
              <div key={item.label} style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase' }}>
                <span style={{ color:'rgba(255,255,255,0.35)' }}>{item.label} </span>
                <span style={{ color:item.col, fontWeight:900 }}>{item.val}</span>
              </div>
            ))}
          </div>
          <div style={{ flex:1 }} />
          <button type="button" onClick={claimDailyNow} disabled={claimBusy||dailyClaimed}
            style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'7px 14px', fontSize:10, fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase', background: dailyClaimed ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#ef4444,#f97316)', border: dailyClaimed ? '1px solid rgba(255,255,255,0.1)' : 'none', borderRadius:50, color: dailyClaimed ? 'rgba(255,255,255,0.3)' : 'white', cursor: dailyClaimed ? 'not-allowed' : 'pointer', whiteSpace:'nowrap', boxShadow: dailyClaimed ? 'none' : '0 0 12px rgba(239,68,68,0.3)' }}>
            {dailyClaimed ? (countdownStr ? `⏱ NEXT IN ${countdownStr}` : '✓ CLAIMED TODAY') : `⚡ CLAIM +${cfg?.dailyClaim} REBEL`}
          </button>
          {isDiscordConnected && (
            <button type="button" onClick={async()=>{ if(isDiscordConnected) await openDripModal(); }} disabled={dripBusy}
              style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", padding:'7px 12px', fontSize:10, fontWeight:900, letterSpacing:'0.12em', textTransform:'uppercase', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:50, color:'rgba(255,255,255,0.5)', cursor:'pointer', whiteSpace:'nowrap' }}>
              {dripBusy ? 'LOADING...' : 'MIGRATE DRIP'}
            </button>
          )}
        </div>

        <div style={{ marginBottom:20 }}>
          <button onClick={()=>setShowRules(true)} style={{ fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', background:'transparent', border:'none', color:'rgba(255,255,255,0.3)', cursor:'pointer', textDecoration:'underline' }}>
            OFFICIAL RULES
          </button>
        </div>

        <div style={{ borderRadius:18, border:'1px solid rgba(34,211,238,0.15)', background:'rgba(3,10,28,0.7)', backdropFilter:'blur(12px)', padding:16, boxShadow:'0 0 30px rgba(6,182,212,0.08)' }}>
          <RaidLeaderboardPanel lb={lb} />
        </div>

        <div style={{ textAlign:'center', padding:'16px 0 4px', fontSize:10, opacity:0.25, color:'white', letterSpacing:'0.06em', userSelect:'none', fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", textTransform:'uppercase' }}>
          © 2026 REBEL ANTS LLC · DEVELOPED BY MIGUEL CONCEPCION
        </div>
      </div>

      {/* ── MODALS ── */}
      {showResult && slots.length>0 && (
        <RaidResultModal slots={slots} rarity={rarity} prize={prize} onClose={resetRaid}
          ultraCarriers={ultraCarriersThreshold} ultraRatio={ultraRatioThreshold}
          rareCarriers={rareCarriersThreshold} rareRatio={rareRatioThreshold}
          commonSurvivors={commonSurvivorsThreshold}
          prizeObj={prizeObj} prizeNeedShipping={prizeNeedShipping}
          prizeShipMsg={prizeShipMsg} prizeShipBusy={prizeShipBusy}
          prizeClaimId={prizeClaimId} prizeShipForm={prizeShipForm}
          setPrizeShipForm={setPrizeShipForm} setPrizeShipMsg={setPrizeShipMsg}
          setPrizeShipBusy={setPrizeShipBusy} setPrizeClaimId={setPrizeClaimId}
          setPrizeNeedShipping={setPrizeNeedShipping} effectivePlayerId={effectivePlayerId} />
      )}

      <BuyPointsModal open={showBuyPoints} onClose={()=>setShowBuyPoints(false)} playerId={effectivePlayerId} onClaimed={async()=>{ await refresh(); }} />

      {showRules && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=>setShowRules(false)}>
          <div style={{ background:'#040c1e', border:'1px solid rgba(34,211,238,0.2)', borderRadius:16, padding:28, maxWidth:560, width:'100%', maxHeight:'85vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
              <div style={{ fontWeight:900, fontSize:18, fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", letterSpacing:'0.1em' }}>📋 OFFICIAL RULES</div>
              <button onClick={()=>setShowRules(false)} style={{ background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:8, padding:'6px 14px', color:'white', cursor:'pointer', fontSize:13 }}>✕</button>
            </div>
            <div style={{ fontSize:13, lineHeight:1.7, display:'flex', flexDirection:'column', gap:12, opacity:0.9 }}>
              <p><b>Free-to-play.</b> No purchase necessary. Void where prohibited.</p>
              <p><b>Game currency:</b> REBEL Points are promotional only. No guaranteed cash value.</p>
              <p><b>Prizes:</b> May award REBEL Points and/or collectibles/merch when available.</p>
              <p><b>Fair play:</b> Bots or exploits may result in disqualification.</p>
              <p style={{ opacity:0.7 }}>By playing, you agree to these rules.</p>
            </div>
          </div>
        </div>
      )}

      {showDripMigrate && (
        <div style={{ position:'fixed', inset:0, zIndex:2500, background:'rgba(0,0,0,.6)', display:'grid', placeItems:'center', padding:16 }} role="dialog" aria-modal="true">
          <div style={{ width:'min(520px, 95vw)', borderRadius:16, border:'1px solid rgba(255,255,255,.18)', background:'rgba(4,9,22,.97)', boxShadow:'0 28px 60px rgba(0,0,0,.55)', padding:20, color:'white' }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:12 }}>
              <div style={{ fontWeight:900, fontSize:16 }}>Migrate DRIP Points → Game</div>
              <button className="btn" onClick={()=>setShowDripMigrate(false)} style={{ padding:'8px 12px' }}>Close</button>
            </div>
            <div style={{ fontSize:13, opacity:0.9, lineHeight:1.4, marginBottom:12 }}>
              This will <b>deduct</b> points from DRIP (Discord) and <b>credit</b> the same amount into the game.
            </div>
            <div style={{ fontSize:13, opacity:0.95, marginBottom:12 }}>DRIP Balance: <b>{typeof dripBalance==='number'?dripBalance:'—'}</b></div>
            <div style={{ display:'grid', gap:8, marginBottom:14 }}>
              <label style={{ fontSize:12, opacity:0.9 }}>Amount to migrate</label>
              <input value={dripAmount===0?'':String(dripAmount)}
                onChange={(e)=>{ const raw=String(e.target.value||'').replace(/^0+/,''); const n=parseInt(raw,10); setDripAmount(isNaN(n)?0:Math.max(0,Math.min(n,typeof dripBalance==='number'?dripBalance:0))); }}
                type="number" min={0} max={typeof dripBalance==='number'?dripBalance:0} placeholder="0"
                style={{ padding:10, borderRadius:10, border:'1px solid rgba(255,255,255,.18)', background:'rgba(15,23,42,.55)', color:'inherit', fontSize:15, width:160 }} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn" onClick={migrateDripNow} disabled={dripBusy||dripAmount<=0} style={{ padding:'10px 18px', fontSize:13 }}>
                {dripBusy?'Migrating…':`Migrate ${dripAmount} ${cfg?.currency}`}
              </button>
            </div>
            {dripStatus && <div style={{ marginTop:10, fontSize:13 }}>{dripStatus}</div>}
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;700;900&display=swap');
        * { box-sizing: border-box; }
        body { background: #020617; }
        .ant-colony-bg, .page-head, .site-title, .tabs { display: none; }
        .btn { border-radius:12px; border:1px solid rgba(34,211,238,0.2); background:rgba(6,182,212,0.1); color:white; font-weight:800; cursor:pointer; transition:all 0.2s; }
        .btn:hover:not(:disabled) { background:rgba(6,182,212,0.2); }
        .btn:disabled { opacity:0.4; cursor:not-allowed; }
        .ant-card { background:transparent!important; border:none!important; box-shadow:none!important; padding:0!important; }
        @keyframes raidFloat { 0%{transform:translateY(0) scale(1);opacity:inherit} 80%{opacity:inherit} 100%{transform:translateY(-100vh) scale(0.1);opacity:0} }
        @keyframes btnTealGlow { 0%,100%{box-shadow:0 0 20px rgba(6,182,212,0.5),0 0 40px rgba(6,182,212,0.2)} 50%{box-shadow:0 0 30px rgba(6,182,212,0.8),0 0 60px rgba(6,182,212,0.3)} }
        @keyframes raidPulse { 0%,100%{opacity:0.7;transform:scale(1)} 50%{opacity:1;transform:scale(1.02)} }
      `}</style>
    </>
  );
}