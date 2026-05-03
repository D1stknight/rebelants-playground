// components/FactionWarsBattleScene.tsx
//
// Visual battle scene + result modals — extracted from components/FactionWars.tsx.
//
// IMPORTANT: This is a PRESENTATION component. It owns no game logic. It receives
// game state as props and emits actions via callbacks. The parent (whether AI mode
// or PvP) is responsible for damage calculation, audio, and state transitions.
//
// AI mode (components/FactionWars.tsx) has an inline copy of this JSX and is
// NOT yet using this component. This file exists so the PvP match page can render
// the same look and feel. Once PvP is stable we can switch AI mode to use this
// component too — at that point the inline copy in FactionWars.tsx can be deleted.
//
// If you tweak the visual design, change BOTH places (here and the inline version
// in FactionWars.tsx) — or migrate AI mode to use this component.

import React from "react";
import FactionWars3DCharacter from "./FactionWars3DCharacter";
import {
  FACTIONS,
  MAX_HP,
  TEAM_SIZE,
  TERRITORY_COUNT,
  hasFaction3DCharacter,
  type FactionId,
  type Move,
  type Faction,
  type RoundResult,
  type TerritoryResult,
  type Rarity,
} from "../lib/factionWarsCore";

// Inline helpers (originally in FactionWars.tsx) — kept here to keep this
// component self-contained.
function factionImgPath(fid: string, type: "symbol" | "char"): string {
  const jpgFactions: Record<string, boolean> = { "bushi-symbol": true, "bushi-char": true };
  const jpgCharFactions: Record<string, boolean> = { "shogun-char": true };
  const key = `${fid}-${type}`;
  const ext = jpgFactions[key] ? "jpg" : jpgCharFactions[key] ? "JPG" : "PNG";
  return `/factions/${fid}-${type}.${ext}`;
}

const RARITY_COLORS: Record<Rarity, string> = {
  ultra: "#fbbf24",
  rare: "#60a5fa",
  common: "#34d399",
  none: "#f87171",
};

// ── Inline TerritoryBadge (extracted from FactionWars.tsx) ──────────────────
function TerritoryBadge({ index, result, isCurrent, defender }: { index: number; result?: TerritoryResult; isCurrent: boolean; defender?: FactionId; }) {
  const df = defender ? FACTIONS[defender] : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, opacity: result || isCurrent ? 1 : 0.35 }}>
      <div style={{ width: 48, height: 48, borderRadius: 10, position:"relative", border: `2px solid ${result ? (result.won ? "#34d399" : "#f87171") : isCurrent ? "#fbbf24" : "rgba(255,255,255,0.15)"}`, boxShadow: isCurrent ? "0 0 16px rgba(251,191,36,0.4)" : result?.won ? "0 0 10px rgba(52,211,153,0.3)" : "none", transition: "all 0.3s", overflow:"hidden", background:"rgba(0,0,0,0.5)", flexShrink:0 }}>
        {df && <img src={factionImgPath(df.id,"symbol")} alt={df.name} style={{ width:"100%", height:"100%", objectFit:"contain", padding:4, filter: result && !result.won ? "grayscale(0.7) opacity(0.6)" : "none" }} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />}
        {!df && <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🏰</div>}
        {result && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background: result.won ? "rgba(52,211,153,0.35)" : "rgba(239,68,68,0.35)", fontSize:18 }}>
            {result.won ? "✅" : "💀"}
          </div>
        )}
        {isCurrent && !result && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(251,191,36,0.3)", fontSize:16 }}>⚔️</div>
        )}
      </div>
      <div style={{ fontSize: 9, opacity: 0.6 }}>T{index + 1}</div>
      {df && <div style={{ fontSize: 8, color: df.color, fontWeight: 700 }}>{df.name}</div>}
    </div>
  );
}

// ── Prop types ───────────────────────────────────────────────────────────────

type Phase = "battle" | "territory_result" | "final_result";

export interface BattleSceneState {
  phase: Phase;

  // Team info
  team: FactionId[];
  defenders: FactionId[];
  currentTerritory: number;
  currentFactionIdx: number;

  // Active fighters
  currentPlayerFD: Faction | null;
  currentDefenderFD: Faction | null;

  // HPs
  playerHp: number;
  enemyHp: number;

  // Round state within the current territory
  currentRound: number;
  roundLog: Array<{ playerMove: string; enemyMove: string; playerDmg: number; enemyDmg: number; effect?: string }>;
  currentTerritoryRounds: RoundResult[];

  // Visual effect state
  dmgFloats: Array<{ id: number; side: "player" | "enemy" | "plunder"; dmg: number }>;
  battleAnim: "idle" | "clash" | "win" | "lose";
  enemy3DAnim: "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";
  player3DAnim: "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";

  // Move selection state
  selectedMove: Move | null;
  usedMoves: Record<string, number>;

  // Buffs / bonuses (for badge display)
  sacrificeBonus: number;
  powerBuffRounds: number;
  powerBuffAmt: number;
  comboBonus: number;
  commandActive: boolean;
  berserkerActive: boolean;
  meditationStacks: number;
  oneTimeUsed: string[];

  // Match outcome state
  results: TerritoryResult[];
  finalRarity: Rarity;
  territoriesWon: number;

  // UI flags
  showHowToPlay: boolean;
  busy: boolean;

  // Healing potion state (only used if enableHealing=true)
  healBusy: boolean;
  healUsed: number;

  // Economy display
  cfg: any;
  currency: string;
  balance: number;
}

export interface BattleSceneActions {
  // State setters use React.Dispatch<SetStateAction<T>> so callers can pass
  // either a value OR an updater function (h => !h, n => n + 1, etc).
  setSelectedMove: React.Dispatch<React.SetStateAction<Move | null>>;
  setShowHowToPlay: React.Dispatch<React.SetStateAction<boolean>>;
  fightTerritory: () => void;
  nextTerritory: () => void;
  resetGame: () => void;

  // Healing potion callbacks (no-ops if enableHealing=false)
  setHealBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setHealUsed: React.Dispatch<React.SetStateAction<number>>;
  setPlayerHp: React.Dispatch<React.SetStateAction<number>>;
  spend: (amount: number, reason: string) => Promise<any>;
  refresh: () => Promise<any> | void;
}

export interface BattleSceneProps {
  state: BattleSceneState;
  actions: BattleSceneActions;
  // PvP passes false; AI mode passes true (or omits to default true).
  enableHealing?: boolean;
  // PvP passes false (it has its own move picker); AI mode passes true (default).
  // When false, the "Choose move" 4-button grid + "Strike" button are hidden.
  // The HP bars, fighter cards, round history, and buff badges still render.
  showMovePicker?: boolean;
  // Optional slot for leaderboard rendered inside final_result.
  // PvP passes null; AI mode passes its <FWLeaderboardPanel /> here.
  leaderboardSlot?: React.ReactNode;
}

export function FactionWarsBattleScene({ state, actions, enableHealing = true, showMovePicker = true, leaderboardSlot = null }: BattleSceneProps) {
  // Destructure state into local names so the original JSX doesn't need rewriting
  const {
    phase,
    team, defenders, currentTerritory, currentFactionIdx,
    currentPlayerFD, currentDefenderFD,
    playerHp, enemyHp,
    currentRound, roundLog, currentTerritoryRounds,
    dmgFloats, battleAnim, enemy3DAnim, player3DAnim,
    selectedMove, usedMoves,
    sacrificeBonus, powerBuffRounds, powerBuffAmt, comboBonus,
    commandActive, berserkerActive, meditationStacks, oneTimeUsed,
    results, finalRarity, territoriesWon,
    showHowToPlay, busy,
    healBusy, healUsed,
    cfg, currency, balance,
  } = state;

  const {
    setSelectedMove, setShowHowToPlay,
    fightTerritory, nextTerritory, resetGame,
    setHealBusy, setHealUsed, setPlayerHp,
    spend, refresh,
  } = actions;

  // Local helpers used by the JSX (original locals from FactionWars.tsx)
  const rc = RARITY_COLORS;
  const rl: Record<Rarity, string> = {
    ultra: "🏆 ULTRA — LEGENDARY VICTORY!",
    rare: "⚔️ RARE — STRONG CAMPAIGN!",
    common: "✅ COMMON — SOLDIERS HOLD!",
    none: "💀 DEFEAT — YOUR FORCES FELL",
  };

  // Derived from cfg — mirrors FactionWars.tsx line 646
  const fwPlunderBonus = Number(cfg?.factionWarsPlunderBonus ?? 50);

  // ── PHASE: battle ──────────────────────────────────────────────────────────
  if (phase === "battle") {
    if (!currentPlayerFD || !currentDefenderFD) return null;
    return (
      <div>
        {/* Territory progress bar */}
        <div style={{ background:"rgba(0,0,0,0.5)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, padding:"12px 16px", marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:900, color:"#fbbf24", letterSpacing:"0.05em" }}>⚔️ TERRITORY {currentTerritory+1} / {TERRITORY_COUNT}</div>
            <div style={{ display:"flex", gap:12, fontSize:11, alignItems:"center" }}>
              <span style={{ color:"#34d399", fontWeight:700 }}>✅ {territoriesWon} won</span>
              <span style={{ color:"#f87171", fontWeight:700 }}>💀 {results.length-territoriesWon} lost</span>
              <span style={{ color:"#fbbf24", fontWeight:800, background:"rgba(251,191,36,0.12)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:8, padding:"2px 8px" }}>💰 {balance} {currency}</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
            {defenders.map((def,i)=>(<TerritoryBadge key={i} index={i} result={results[i]} isCurrent={i===currentTerritory} defender={def} />))}
          </div>
        </div>

        {/* HOW TO PLAY — collapsible */}
        <div style={{ marginBottom:12 }}>
          <button onClick={()=>setShowHowToPlay(h=>!h)} style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:10, padding:"8px 14px", cursor:"pointer", width:"100%", color:"white" }}>
            <span style={{ fontSize:14 }}>📖</span>
            <span style={{ fontWeight:800, fontSize:12, color:"#fbbf24", flex:1, textAlign:"left" }}>How to Play</span>
            <span style={{ fontSize:11, opacity:0.5 }}>{showHowToPlay ? "▲ hide" : "▼ show"}</span>
          </button>
          {showHowToPlay && (
            <div style={{ background:"rgba(0,0,0,0.5)", border:"1px solid rgba(251,191,36,0.15)", borderRadius:"0 0 10px 10px", padding:"12px 16px", fontSize:12 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontWeight:900, color:"#fbbf24", marginBottom:4 }}>⚔️ Goal</div>
                  <div style={{ opacity:0.75, lineHeight:1.5 }}>Win as many of the 5 territories as possible. Each territory is one fight between your warrior and the defender. Win 3+ to earn rewards. Win all 5 for the Ultra crate.</div>
                </div>
                <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontWeight:900, color:"#60a5fa", marginBottom:4 }}>🎯 Moves</div>
                  <div style={{ opacity:0.75, lineHeight:1.5 }}>Pick one of your warrior's 5 moves. Each move has a <b>Power value</b> (1–11). Higher power = better chance to win that territory. The enemy AI picks its best counter automatically.</div>
                </div>
                <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontWeight:900, color:"#34d399", marginBottom:4 }}>📊 Power Bars</div>
                  <div style={{ opacity:0.75, lineHeight:1.5 }}>Each territory is a <b>HP fight</b> — both you and the defender start at 100 HP. Pick a move each round, both sides deal damage simultaneously. First to <b>0 HP loses the territory</b>. Win 3+ territories to earn rewards.</div>
                </div>
                <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ fontWeight:900, color:"#c084fc", marginBottom:4 }}>⚡ Passives</div>
                  <div style={{ opacity:0.75, lineHeight:1.5 }}>Each faction has a passive bonus — like Ronin getting stronger after a loss, or Samurai hitting harder on Territory 1. Combine factions to stack advantages.</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <div style={{ fontSize:11, background:"rgba(248,113,113,0.12)", border:"1px solid rgba(248,113,113,0.2)", borderRadius:6, padding:"3px 8px", color:"#f87171" }}>🔴 ATTACK — raw damage</div>
                <div style={{ fontSize:11, background:"rgba(52,211,153,0.12)", border:"1px solid rgba(52,211,153,0.2)", borderRadius:6, padding:"3px 8px", color:"#34d399" }}>🟢 DEFEND — blocks counters</div>
                <div style={{ fontSize:11, background:"rgba(192,132,252,0.12)", border:"1px solid rgba(192,132,252,0.2)", borderRadius:6, padding:"3px 8px", color:"#c084fc" }}>🟣 MAGIC — special effects</div>
                <div style={{ fontSize:11, background:"rgba(251,191,36,0.12)", border:"1px solid rgba(251,191,36,0.2)", borderRadius:6, padding:"3px 8px", color:"#fbbf24" }}>🟡 TRICK — dodge or steal</div>
              </div>
            </div>
          )}
        </div>

        {/* MAIN BATTLE ARENA */}
        <div style={{ position:"relative", borderRadius:18, overflow:"hidden", marginBottom:16, border:"1px solid rgba(255,255,255,0.1)" }}>

          {/* Plunder REBEL float — centered over arena */}
          {dmgFloats.filter(f=>f.side==="plunder").map(f=>(
            <div key={f.id} style={{ position:"absolute", top:"20%", left:0, right:0, textAlign:"center", zIndex:99, pointerEvents:"none",
              fontSize:28, fontWeight:900, color:"#fbbf24", textShadow:"0 0 24px rgba(251,191,36,0.9)" }}>
              💰 +{f.dmg} {currency} PLUNDER!
            </div>
          ))}
          {/* Animated arena background */}
          <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse at 25% 50%, ${currentPlayerFD.color}22 0%, transparent 60%), radial-gradient(ellipse at 75% 50%, ${currentDefenderFD.color}22 0%, transparent 60%), linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.9) 100%)`, transition:"background 0.5s ease" }} />
          {/* Flash overlay on clash */}
          {battleAnim==="clash" && <div style={{ position:"absolute", inset:0, background:"rgba(255,200,50,0.12)", zIndex:2, pointerEvents:"none", animation:"none" }} />}
          {battleAnim==="win" && <div style={{ position:"absolute", inset:0, background:"rgba(52,211,153,0.08)", zIndex:2, pointerEvents:"none" }} />}
          {battleAnim==="lose" && <div style={{ position:"absolute", inset:0, background:"rgba(239,68,68,0.08)", zIndex:2, pointerEvents:"none" }} />}

          <div style={{ position:"relative", zIndex:1, padding:"24px 20px 20px" }}>

            {/* Characters — big portraits */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:12, alignItems:"center", marginBottom:14 }}>
              {/* Player */}
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                <div style={{ position:"relative", width:120, height:140, borderRadius:14, overflow:"hidden",
                  border:`3px solid ${currentPlayerFD.borderColor}`,
                  boxShadow: battleAnim==="win" ? `0 0 40px ${currentPlayerFD.color}99` : `0 0 14px ${currentPlayerFD.color}44`,
                  transform: battleAnim==="clash"?"scale(1.1) translateX(14px) rotate(-3deg)":battleAnim==="win"?"scale(1.06)":battleAnim==="lose"?"scale(0.9) rotate(4deg)":"scale(1)",
                  filter: battleAnim==="lose"?"grayscale(0.7) brightness(0.55)":playerHp<25?"brightness(0.8)":"none",
                  transition:"all 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}>
               {hasFaction3DCharacter(currentPlayerFD.id) ? (
        <FactionWars3DCharacter
          factionId={currentPlayerFD.id}
          side="player"
          animState={player3DAnim}
        />
      ) : (
        <img src={factionImgPath(currentPlayerFD.id,"char")} alt={currentPlayerFD.name}
          style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top" }}
          onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
      )}
                  <div style={{ position:"absolute", bottom:4, right:4, width:26, height:26, borderRadius:5, overflow:"hidden", background:"rgba(0,0,0,0.75)", border:`1px solid ${currentPlayerFD.borderColor}` }}>
                    <img src={factionImgPath(currentPlayerFD.id,"symbol")} alt="" style={{ width:"100%", height:"100%", objectFit:"contain", padding:2 }} />
                  </div>
                  {playerHp < 25 && <div style={{ position:"absolute", inset:0, border:"3px solid #f87171", borderRadius:12, pointerEvents:"none", boxShadow:"inset 0 0 20px rgba(248,113,113,0.4)" }} />}
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontWeight:900, fontSize:12, color:currentPlayerFD.color }}>{currentPlayerFD.name.toUpperCase()}</div>
                  <div style={{ fontSize:9, opacity:0.45 }}>Warrior {currentFactionIdx+1}/{TEAM_SIZE}</div>
                </div>
              </div>

              {/* Center VS */}
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, minWidth:52 }}>
                <div style={{ fontSize:battleAnim==="clash"?44:26, fontWeight:900, transition:"all 0.2s",
                  textShadow:battleAnim==="clash"?"0 0 30px #fbbf24":battleAnim==="win"?"0 0 20px #34d399":battleAnim==="lose"?"0 0 20px #f87171":"none",
                  transform:battleAnim==="clash"?"scale(1.3)":"scale(1)" }}>
                  {battleAnim==="clash"?"💥":battleAnim==="win"?"✅":battleAnim==="lose"?"💀":"⚔️"}
                </div>
                <div style={{ fontSize:9, fontWeight:900, opacity:0.35, letterSpacing:"0.12em" }}>VS</div>
              </div>

              {/* Defender */}
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                <div style={{ position:"relative", width:120, height:140, borderRadius:14, overflow:"hidden",
                  border:`3px solid ${currentDefenderFD.borderColor}`,
                  boxShadow: battleAnim==="lose" ? `0 0 40px ${currentDefenderFD.color}99` : `0 0 14px ${currentDefenderFD.color}33`,
                  transform: battleAnim==="clash"?"scale(1.1) translateX(-14px) rotate(3deg)":battleAnim==="lose"?"scale(1.06)":battleAnim==="win"?"scale(0.9) rotate(-4deg)":"scale(1)",
                  filter: battleAnim==="win"?"grayscale(0.7) brightness(0.55)":enemyHp<25?"brightness(0.8)":"none",
                  transition:"all 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}>
               {hasFaction3DCharacter(currentDefenderFD.id) ? (
        <FactionWars3DCharacter
          factionId={currentDefenderFD.id}
          side="enemy"
          animState={enemy3DAnim}
        />
      ) : (
        <img src={factionImgPath(currentDefenderFD.id,"char")} alt={currentDefenderFD.name}
          style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top" }}
          onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
      )}
                  <div style={{ position:"absolute", bottom:4, left:4, width:26, height:26, borderRadius:5, overflow:"hidden", background:"rgba(0,0,0,0.75)", border:`1px solid ${currentDefenderFD.borderColor}` }}>
                    <img src={factionImgPath(currentDefenderFD.id,"symbol")} alt="" style={{ width:"100%", height:"100%", objectFit:"contain", padding:2 }} />
                  </div>
                  {enemyHp < 25 && <div style={{ position:"absolute", inset:0, border:"3px solid #f87171", borderRadius:12, pointerEvents:"none", boxShadow:"inset 0 0 20px rgba(248,113,113,0.4)" }} />}
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontWeight:900, fontSize:12, color:currentDefenderFD.color }}>{currentDefenderFD.name.toUpperCase()}</div>
                  <div style={{ fontSize:9, opacity:0.45 }}>Territory Defender</div>
                </div>
              </div>
            </div>

            {/* ── HP BARS ── MK Style ───────────────────────── */}
            <div style={{ marginBottom:14 }}>
              {/* Player HP bar */}
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:7 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, width:110, flexShrink:0 }}>
                  <img src={factionImgPath(currentPlayerFD.id,"symbol")} alt="" style={{ width:22, height:22, objectFit:"contain", background:"rgba(0,0,0,0.4)", borderRadius:4, padding:2, flexShrink:0 }} />
        <span style={{ fontWeight:900, fontSize:11, color:currentPlayerFD.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentPlayerFD.name.toUpperCase()}</span>
                  <span style={{ fontSize:9, fontWeight:900, background:"rgba(52,211,153,0.2)", color:"#34d399", borderRadius:4, padding:"1px 5px", flexShrink:0 }}>YOU</span>
                </div>
                <div style={{ flex:1, height:20, borderRadius:5, background:"rgba(0,0,0,0.6)", border:"1px solid rgba(255,255,255,0.1)", overflow:"hidden", position:"relative" }}>
                  <div style={{ height:"100%", borderRadius:4,
                    background: playerHp>50 ? "linear-gradient(90deg,#34d399,#10b981)" : playerHp>25 ? "linear-gradient(90deg,#fbbf24,#f59e0b)" : "linear-gradient(90deg,#f87171,#dc2626)",
                    width:`${playerHp}%`, transition:"width 0.45s ease",
                    boxShadow: playerHp>50 ? "0 0 10px rgba(52,211,153,0.6)" : playerHp>25 ? "0 0 10px rgba(251,191,36,0.5)" : "0 0 10px rgba(248,113,113,0.6)"
                  }} />
                  {dmgFloats.filter(f=>f.side==="player").map(f=>(
                    <div key={f.id} style={{ position:"absolute", right:6, top:1, fontSize:13, fontWeight:900, color:"#f87171", pointerEvents:"none" }}>-{f.dmg}</div>
                  ))}
                </div>
                <div style={{ minWidth:40, textAlign:"right", fontWeight:900, fontSize:14,
                  color:playerHp>50?"#34d399":playerHp>25?"#fbbf24":"#f87171" }}>{playerHp}<span style={{fontSize:9,opacity:0.5}}>/100</span></div>
              </div>
              {/* Enemy HP bar */}
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, width:110, flexShrink:0 }}>
                  <img src={factionImgPath(currentDefenderFD.id,"symbol")} alt="" style={{ width:22, height:22, objectFit:"contain", background:"rgba(0,0,0,0.4)", borderRadius:4, padding:2, flexShrink:0 }} />
        <span style={{ fontWeight:900, fontSize:11, color:currentDefenderFD.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentDefenderFD.name.toUpperCase()}</span>
                  <span style={{ fontSize:9, fontWeight:900, background:"rgba(248,113,113,0.2)", color:"#f87171", borderRadius:4, padding:"1px 5px", flexShrink:0 }}>ENEMY</span>
                </div>
                <div style={{ flex:1, height:20, borderRadius:5, background:"rgba(0,0,0,0.6)", border:"1px solid rgba(255,255,255,0.1)", overflow:"hidden", position:"relative" }}>
                  <div style={{ height:"100%", borderRadius:4,
                    background: enemyHp>50 ? `linear-gradient(90deg,${currentDefenderFD.color},${currentDefenderFD.color}bb)` : enemyHp>25 ? "linear-gradient(90deg,#fbbf24,#f59e0b)" : "linear-gradient(90deg,#f87171,#dc2626)",
                    width:`${enemyHp}%`, transition:"width 0.45s ease",
                    boxShadow:`0 0 10px ${currentDefenderFD.color}66`
                  }} />
                  {dmgFloats.filter(f=>f.side==="enemy").map(f=>(
                    <div key={f.id} style={{ position:"absolute", right:6, top:1, fontSize:13, fontWeight:900, color:"#34d399", pointerEvents:"none" }}>-{f.dmg}</div>
                  ))}
                </div>
                <div style={{ minWidth:40, textAlign:"right", fontWeight:900, fontSize:14,
                  color:enemyHp>50?"#34d399":enemyHp>25?"#fbbf24":"#f87171" }}>{enemyHp}<span style={{fontSize:9,opacity:0.5}}>/100</span></div>
              </div>
            </div>

            {/* Active buff indicators */}
            {(powerBuffRounds > 0 || comboBonus > 0 || commandActive || meditationStacks > 0) && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8, justifyContent:"center" }}>
                {powerBuffRounds > 0 && <div style={{ fontSize:10, fontWeight:800, background:"rgba(52,211,153,0.15)", border:"1px solid rgba(52,211,153,0.3)", color:"#34d399", borderRadius:20, padding:"2px 8px" }}>⚡ +{powerBuffAmt} dmg ({powerBuffRounds})</div>}
                {comboBonus > 0 && <div style={{ fontSize:10, fontWeight:800, background:"rgba(192,132,252,0.15)", border:"1px solid rgba(192,132,252,0.3)", color:"#c084fc", borderRadius:20, padding:"2px 8px" }}>🔗 Combo +{comboBonus}</div>}
                {commandActive && <div style={{ fontSize:10, fontWeight:800, background:"rgba(251,191,36,0.15)", border:"1px solid rgba(251,191,36,0.3)", color:"#fbbf24", borderRadius:20, padding:"2px 8px" }}>👑 Command +8 READY</div>}
                {meditationStacks > 0 && <div style={{ fontSize:10, fontWeight:800, background:"rgba(99,102,241,0.15)", border:"1px solid rgba(99,102,241,0.3)", color:"#818cf8", borderRadius:20, padding:"2px 8px" }}>🧘 Focus ×{meditationStacks}</div>}
              </div>
            )}

            {/* Round counter */}
            <div style={{ textAlign:"center", marginBottom:14 }}>
              <span style={{ fontSize:11, fontWeight:900, color:"#fbbf24", letterSpacing:"0.12em", opacity:0.9 }}>
                ⚔️ ROUND {currentRound + 1}
              </span>
              <span style={{ fontSize:10, opacity:0.4, marginLeft:8 }}>— first to 0 HP loses the territory</span>
            </div>

            {/* Round log */}
            {roundLog.length > 0 && (
              <div style={{ background:"rgba(0,0,0,0.45)", borderRadius:10, padding:"8px 12px", marginBottom:12, maxHeight:96, overflowY:"auto" }}>
                <div style={{ fontSize:9, opacity:0.35, marginBottom:5, letterSpacing:"0.06em", fontWeight:700 }}>ROUND HISTORY</div>
                {roundLog.slice(0,2).map((r,i)=>(
                  <div key={i} style={{ display:"flex", gap:10, fontSize:10, marginBottom:4, opacity:i===0?1:0.5, alignItems:"center" }}>
                    <span style={{ color:"#34d399", fontWeight:700, minWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>⚔️ {r.playerMove}</span>
                    <span style={{ color:"#f87171", fontWeight:800 }}>-{r.enemyDmg} to you</span>
                    <span style={{ opacity:0.3 }}>|</span>
                    <span style={{ color:"#f87171", fontWeight:700, minWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>🛡️ {r.enemyMove}</span>
                    <span style={{ color:"#34d399", fontWeight:800 }}>-{r.playerDmg} to enemy</span>
                    {r.effect && <span style={{ marginLeft:4, color:"#fbbf24", fontWeight:900, fontSize:10, background:"rgba(251,191,36,0.18)", border:"1px solid rgba(251,191,36,0.35)", borderRadius:4, padding:"1px 6px", flexShrink:0 }}>{r.effect}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Faction matchup intel strip */}
            <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:16, flexWrap:"wrap" }}>
              {currentPlayerFD.strongVs.includes(currentDefenderFD.id as FactionId) && (
                <div style={{ fontSize:10, fontWeight:700, color:"#34d399", background:"rgba(52,211,153,0.1)", border:"1px solid rgba(52,211,153,0.25)", borderRadius:20, padding:"3px 10px" }}>
                  ✅ {currentPlayerFD.name} has advantage
                </div>
              )}
              {currentPlayerFD.weakTo.includes(currentDefenderFD.id as FactionId) && (
                <div style={{ fontSize:10, fontWeight:700, color:"#f87171", background:"rgba(248,113,113,0.1)", border:"1px solid rgba(248,113,113,0.25)", borderRadius:20, padding:"3px 10px" }}>
                  ⚠️ {currentDefenderFD.name} has advantage
                </div>
              )}
              {team[currentFactionIdx]==="bushi" && (
                <div style={{ fontSize:10, fontWeight:700, color:"#818cf8", background:"rgba(129,140,248,0.1)", border:"1px solid rgba(129,140,248,0.25)", borderRadius:20, padding:"3px 10px" }}>
                  🧠 Bushi Intel: weak to {currentDefenderFD.weakTo.map(f=>FACTIONS[f]?.name).join(", ")}
                </div>
              )}
            </div>

            {/* Healing Potion button */}
            {enableHealing && (() => {
              const healCost = Number(cfg?.factionWarsHealCost ?? 25);
              const healAmt  = Number(cfg?.factionWarsHealAmt  ?? 30);
              return (
                <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
                  <button
                    onClick={async()=>{
                      const maxHeals = Number(cfg?.factionWarsHealMax??2);
                      if (healBusy||busy||playerHp>=MAX_HP||healUsed>=maxHeals) return;
                      if (balance < healCost) return;
                      setHealBusy(true);
                      try { await spend(healCost,"faction-wars"); const newHp=Math.min(MAX_HP,playerHp+healAmt); setPlayerHp(newHp); setHealUsed(n=>n+1); await refresh(); } catch {}
                      setHealBusy(false);
                    }}
                    disabled={healBusy||busy||playerHp>=MAX_HP||balance<Number(cfg?.factionWarsHealCost??25)||healUsed>=Number(cfg?.factionWarsHealMax??2)}
                    title={`Spend ${healCost} REBEL to restore ${healAmt} HP`}
                    style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 14px", borderRadius:20, border:"1px solid rgba(52,211,153,0.3)", background:"rgba(52,211,153,0.1)", color:"#34d399", fontSize:11, fontWeight:800, cursor:healBusy||busy||playerHp>=MAX_HP||balance<Number(cfg?.factionWarsHealCost??25)?"not-allowed":"pointer", opacity:healBusy||busy||playerHp>=MAX_HP||balance<Number(cfg?.factionWarsHealCost??25)?0.4:1 }}>
                    🧪 Heal +{healAmt} HP
                    <span style={{opacity:0.6,fontSize:10}}>(-{healCost} {currency})</span>
                    <span style={{opacity:0.5,fontSize:9,marginLeft:4}}>({Math.max(0,Number(cfg?.factionWarsHealMax??2)-healUsed)} left)</span>
                  </button>
                </div>
              );
            })()}

            {/* Move selector (move grid + Strike button) — hidden in PvP via showMovePicker={false} */}
            {showMovePicker && (
            <div style={{ borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:16 }}>
              <div style={{ fontSize:12, fontWeight:800, marginBottom:10, opacity:0.7, letterSpacing:"0.04em" }}>
                ⚔️ CHOOSE {currentPlayerFD.name.toUpperCase()}'S MOVE
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {currentPlayerFD.moves.map(m=>{
                const tc: Record<string,string> = { attack:"#f87171", defend:"#34d399", magic:"#c084fc", trick:"#fbbf24" };
                const isSel = selectedMove?.id===m.id;
                const timesUsedM = usedMoves[m.id] || 0;
                const degradedPow = Math.max(1, m.power - timesUsedM);
                const isExhausted = (m.oneTime && oneTimeUsed.includes(m.id)) || (berserkerActive && m.type === "defend");
                return (
                  <button key={m.id} onClick={()=>!busy&&!isExhausted&&setSelectedMove(m)} disabled={busy||isExhausted}
                    style={{ display:"flex", flexDirection:"column", gap:4, padding:"10px 10px", borderRadius:10, textAlign:"left",
                      border:`2px solid ${isExhausted?"rgba(255,255,255,0.04)":isSel ? currentPlayerFD.borderColor : "rgba(255,255,255,0.08)"}`,
                      background: isExhausted ? "rgba(0,0,0,0.2)" : isSel ? currentPlayerFD.bgColor : "rgba(255,255,255,0.03)",
                      cursor: busy||isExhausted?"not-allowed":"pointer", opacity: isExhausted ? 0.4 : 1,
                      boxShadow: isSel ? `0 0 16px ${currentPlayerFD.color}44` : "none",
                      transform: isSel ? "scale(1.01)" : "scale(1)", transition:"all 0.18s" }}>
                    {/* Top row: emoji + name + type + power */}
                    <div style={{ display:"flex", alignItems:"center", gap:5, minWidth:0 }}>
                      <span style={{ fontSize:15, flexShrink:0 }}>{m.emoji}</span>
                      <span style={{ fontWeight:900, fontSize:11, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, minWidth:0 }}>{m.label}</span>
                      <span style={{ fontSize:8, background:tc[m.type], color:"#000", borderRadius:3, padding:"1px 4px", fontWeight:900, flexShrink:0 }}>{m.type.toUpperCase()}</span>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2, flexShrink:0 }}>
                        <span style={{ fontSize:11, fontWeight:900, color: isExhausted?"#666": isSel ? currentPlayerFD.color : "rgba(255,255,255,0.7)", lineHeight:1 }}>
                          {isExhausted ? "✗" : <>{degradedPow}<span style={{fontSize:8,opacity:0.45}}>/{m.power}</span>{timesUsedM > 0 && <span style={{fontSize:8,color:"#f87171"}}>↓</span>}</>}
                        </span>
                        <div style={{ width:28, height:3, borderRadius:2, background:"rgba(255,255,255,0.1)", overflow:"hidden" }}>
                          <div style={{ height:"100%", borderRadius:2, background:tc[m.type], width:`${Math.round(degradedPow/m.power*100)}%`, transition:"width 0.3s" }} />
                        </div>
                      </div>
                    </div>
                    {/* Badges */}
                    {(m.oneTime || isExhausted) && (
                      <div style={{ display:"flex", gap:3 }}>
                        {m.oneTime && !isExhausted && <span style={{ fontSize:8, background:"rgba(251,191,36,0.2)", color:"#fbbf24", borderRadius:3, padding:"1px 4px", fontWeight:900, border:"1px solid rgba(251,191,36,0.3)" }}>1× ONLY</span>}
                        {isExhausted && !berserkerActive && <span style={{ fontSize:8, background:"rgba(255,255,255,0.1)", color:"#666", borderRadius:3, padding:"1px 4px", fontWeight:900 }}>USED</span>}
                        {isExhausted && berserkerActive && m.type==="defend" && <span style={{ fontSize:8, background:"rgba(251,100,36,0.25)", color:"#f87171", borderRadius:3, padding:"1px 4px", fontWeight:900 }}>🔥BERSERK</span>}
                      </div>
                    )}
                    {/* Description */}
                    <div style={{ fontSize:10, opacity:0.55, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {m.id === "plunder" ? `+${fwPlunderBonus} REBEL if win` : m.desc}
                    </div>
                  </button>
                );
              })}
              </div>

              <button onClick={fightTerritory} disabled={!selectedMove||busy}
                style={{ marginTop:14, padding:"14px 24px", borderRadius:12, border:"none",
                  cursor:!selectedMove||busy?"not-allowed":"pointer",
                  background:selectedMove?"linear-gradient(135deg,#fbbf24,#f59e0b)":"rgba(255,255,255,0.06)",
                  color:selectedMove?"#000":"white", fontWeight:900, fontSize:15,
                  opacity:!selectedMove?0.45:1, width:"100%", transition:"all 0.2s",
                  boxShadow:selectedMove?"0 4px 24px rgba(251,191,36,0.4)":"none",
                  transform:selectedMove?"translateY(-1px)":"none" }}>
                {busy?"⚔️ Fighting...":selectedMove?`⚔️ Strike with ${selectedMove.label}!`:"← Select a move above"}
              </button>
            </div>
          </div>
            )}
        </div>
      </div>
    );
  }

  // ── PHASE: territory_result ────────────────────────────────────────────────
  if (phase === "territory_result") {
    if (results.length === 0) return null;
    const last = results[results.length-1];
    const df = FACTIONS[last.defender];
    return (
        <div style={{ background:"rgba(0,0,0,0.5)", border:`2px solid ${last.won?"#34d399":"#f87171"}`, borderRadius:16, padding:24, marginBottom:18, textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:10 }}>{last.won?"✅":"💀"}</div>
          <div style={{ fontSize:22, fontWeight:900, color:last.won?"#34d399":"#f87171", marginBottom:8 }}>{last.won?`Territory ${last.territory+1} Captured!`:`Territory ${last.territory+1} Lost`}</div>
          {/* HP final display */}
          <div style={{ display:"flex", justifyContent:"center", gap:24, marginBottom:14 }}>
            <div style={{ textAlign:"center" }}>
              <img src={factionImgPath(FACTIONS[last.playerFaction].id,"symbol")} alt="" style={{ width:32, height:32, objectFit:"contain", background:"rgba(0,0,0,0.4)", borderRadius:6, padding:3, marginBottom:4 }} />
              <div style={{ fontSize:11, opacity:0.5, marginBottom:2 }}>{FACTIONS[last.playerFaction].name}</div>
              <div style={{ fontSize:16, fontWeight:900, color: last.playerHpFinal>0?"#34d399":"#f87171" }}>{last.playerHpFinal} HP</div>
            </div>
            <div style={{ alignSelf:"center", fontSize:20, opacity:0.5 }}>VS</div>
            <div style={{ textAlign:"center" }}>
              <img src={factionImgPath(df.id,"symbol")} alt="" style={{ width:32, height:32, objectFit:"contain", background:"rgba(0,0,0,0.4)", borderRadius:6, padding:3, marginBottom:4 }} />
              <div style={{ fontSize:11, opacity:0.5, marginBottom:2 }}>{df.name}</div>
              <div style={{ fontSize:16, fontWeight:900, color: last.enemyHpFinal>0?"#34d399":"#f87171" }}>{last.enemyHpFinal} HP</div>
            </div>
          </div>
          {/* Round recap - last 3 rounds */}
          {last.rounds && last.rounds.length > 0 && (
            <div style={{ background:"rgba(0,0,0,0.3)", borderRadius:10, padding:"8px 12px", marginBottom:14, maxHeight:90, overflowY:"auto" }}>
              <div style={{ fontSize:9, opacity:0.4, marginBottom:5, letterSpacing:"0.06em" }}>FIGHT RECAP — {last.rounds.length} rounds</div>
              {last.rounds.slice(-3).reverse().map((r,i)=>(
                <div key={i} style={{ display:"flex", gap:8, fontSize:10, marginBottom:3, opacity:i===0?1:0.6 }}>
                  <span style={{ opacity:0.4 }}>R{r.round}</span>
                  <span style={{ color:"#34d399" }}>⚔️ {r.playerMove.label} <b>-{r.playerDmg}</b></span>
                  <span style={{ opacity:0.3 }}>|</span>
                  <span style={{ color:"#f87171" }}>🛡️ {r.enemyMove.label} <b>-{r.enemyDmg}</b></span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:20 }}>
            {defenders.map((def,i)=>(<TerritoryBadge key={i} index={i} result={results[i]} isCurrent={false} defender={def} />))}
          </div>
          <button onClick={nextTerritory}
            style={{ padding:"12px 28px", borderRadius:12, border:"none", cursor:"pointer", background:currentTerritory+1<TERRITORY_COUNT?"linear-gradient(135deg,#fbbf24,#f59e0b)":"linear-gradient(135deg,#34d399,#059669)", color:"#000", fontWeight:900, fontSize:15 }}>
            {currentTerritory+1<TERRITORY_COUNT?`⚔️ Next Territory (${currentTerritory+2}/${TERRITORY_COUNT})`:"🏁 See Final Results"}
          </button>
        </div>
    );
  }

  // ── PHASE: final_result ────────────────────────────────────────────────────
  if (phase === "final_result") {
    return (
      <div>
        <div style={{ background:"rgba(0,0,0,0.6)", border:`2px solid ${rc[finalRarity]}`, borderRadius:16, padding:28, marginBottom:18, textAlign:"center", boxShadow:`0 0 40px ${rc[finalRarity]}33` }}>
          <div style={{ fontSize:52, marginBottom:12 }}>{finalRarity==="ultra"?"🏆":finalRarity==="rare"?"⚔️":finalRarity==="common"?"✅":"💀"}</div>
          <div style={{ fontSize:22, fontWeight:900, color:rc[finalRarity], marginBottom:8 }}>{rl[finalRarity]}</div>
          <div style={{ fontSize:15, opacity:0.8, marginBottom:16 }}>{territoriesWon}/{TERRITORY_COUNT} territories conquered</div>
          <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:16, flexWrap:"wrap" }}>
            {team.map((fid,i)=>{const f=FACTIONS[fid];return(
              <div key={i} style={{ width:46, height:46, borderRadius:8, overflow:"hidden", opacity:results[i]?.won===false?0.25:1, border:`2px solid ${f.borderColor}`, boxShadow:results[i]?.won?`0 0 10px ${f.color}44`:undefined }}>
                <img src={factionImgPath(fid,"char")} alt={f.name} style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top" }} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
              </div>
            );})}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:20 }}>
            {results.map((r,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, background:r.won?"rgba(52,211,153,0.08)":"rgba(239,68,68,0.08)", border:`1px solid ${r.won?"rgba(52,211,153,0.2)":"rgba(239,68,68,0.2)"}`, borderRadius:8, padding:"6px 12px", fontSize:12 }}>
                <span>{r.won?"✅":"💀"}</span>
                <span style={{opacity:0.6}}>T{i+1}</span>
                <span style={{display:"flex",alignItems:"center",gap:5,color:FACTIONS[r.defender].color}}>
                  <img src={factionImgPath(r.defender,"symbol")} alt={FACTIONS[r.defender].name} style={{width:16,height:16,objectFit:"contain",background:"rgba(0,0,0,0.4)",borderRadius:3,padding:1}} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
                  {FACTIONS[r.defender].name}
                </span>
                <span style={{marginLeft:"auto", fontSize:11, opacity:0.7}}>
                  {r.rounds?.length ?? 0} rounds · final HP {r.playerHpFinal} vs {r.enemyHpFinal}
                </span>
              </div>
            ))}
          </div>
          <button onClick={resetGame} style={{ padding:"12px 28px", borderRadius:12, border:"none", cursor:"pointer", background:"linear-gradient(135deg,#fbbf24,#f59e0b)", color:"#000", fontWeight:900, fontSize:15 }}>⚔️ New Campaign</button>
        </div>
        {leaderboardSlot}
      </div>
    );
  }
  // Fallback (shouldn't happen if parent guards correctly)
  return null;
}

export default FactionWarsBattleScene;
