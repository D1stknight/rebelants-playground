// components/FactionWars.tsx — FACTION WARS
import React, { useState, useEffect, useRef, useCallback } from "react";
import { fightAudio } from "./fight/audio";
import Link from "next/link";
import { pointsConfig as defaultPointsConfig } from "../lib/pointsConfig";
import { usePoints } from "../lib/usePoints";
import { loadProfile, saveProfile, getEffectivePlayerId } from "../lib/profile";
import { addWin } from "../lib/winsStore";
import BuyPointsModal from "./BuyPointsModal";
import FactionWarsArena from "./FactionWarsArena";
import { FACTIONS, FACTION_IDS, TEAM_SIZE, TERRITORY_COUNT, MAX_HP, calcDamage, calcBlock,
  pickEnemyMove, calcPassiveBonus, calcRarity, type Phase, type Rarity, type FactionId,
  type Move, type Faction, type RoundResult, type TerritoryResult } from "../lib/factionWarsSoloRules";
import { useSoloCampaign, type SoloView } from "../lib/raap-solo-campaign";

function useFWAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:fw:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted);
  mutedRef.current = muted;
  React.useEffect(() => { fightAudio.setMuted(muted); }, [muted]);
  const musicRef = React.useRef<HTMLAudioElement | null>(null);
  const lowHpFiredRef = React.useRef(false);
  const play = React.useCallback((file: string, vol = 1) => {
    if (typeof window === "undefined" || mutedRef.current) return;
    try { const a = new Audio("/audio/" + file + ".mp3"); a.volume = vol; void a.play().catch(() => {}); } catch {}
  }, []);
  const switchMusic = React.useCallback((file: string, vol = 0.35) => {
    if (typeof window === "undefined") return;
    if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
    if (mutedRef.current) return;
    try {
      const a = new Audio("/audio/" + file + ".mp3");
      a.loop = true; a.volume = vol;
      void a.play().catch(() => {}); musicRef.current = a;
    } catch {}
  }, []);
  const startTheme = React.useCallback(() => switchMusic("fw-theme-intro", 0.4), [switchMusic]);
  const startMusic = React.useCallback(() => switchMusic("fw-battle", 0.35), [switchMusic]);
  const startEpic  = React.useCallback(() => switchMusic("fw-battle-epic", 0.5), [switchMusic]);
  const stopMusic  = React.useCallback(() => {
    if (musicRef.current) { musicRef.current.pause(); musicRef.current.currentTime = 0; musicRef.current = null; }
  }, []);
  const resetLowHp = React.useCallback(() => { lowHpFiredRef.current = false; }, []);
  const toggleMute = React.useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { localStorage.setItem("ra:fw:muted", next ? "1" : "0"); } catch {}
      if (musicRef.current) { if (next) { musicRef.current.volume = 0; musicRef.current.pause(); } else { musicRef.current.volume = 0.35; musicRef.current.play().catch(()=>{}); } }
      return next;
    });
  }, []);
  const sfx = React.useMemo(() => ({
    startTheme:    () => startTheme(),
    startBattle:   () => startMusic(),
    startEpic:     () => startEpic(),
    stopMusic:     () => stopMusic(),
    clash:         () => play("fw-clash", 0.6),
    roundStart:    () => play("fw-round-start", 0.6),
    attackHit:     () => play("fw-attack-hit", 0.7),
    defendBlock:   () => play("fw-defend-block", 0.7),
    magicCast:     () => play("fw-magic-cast", 0.6),
    trickDodge:    () => play("fw-trick-dodge", 0.7),
    hitLight:      () => play("fw-hit-light", 0.5),
    hitHeavy:      () => play("fw-hit-heavy", 0.8),
    lowHp:         () => { if (!lowHpFiredRef.current) { lowHpFiredRef.current = true; play("fw-low-hp", 0.5); } },
    berserker:     () => play("fw-berserker", 0.9),
    sacrifice:     () => play("fw-sacrifice", 0.9),
    imperial:      () => play("fw-imperial", 0.85),
    heal:          () => play("fw-heal", 0.8),
    plunder:       () => play("fw-plunder", 0.85),
    bloodPrice:    () => play("fw-blood-price", 0.9),
    counter:       () => play("fw-counter", 0.85),
    rally:         () => play("fw-rally", 0.85),
    ambush:        () => play("fw-ambush", 0.85),
    cardFlip:      () => play("fw-card-flip", 0.4),
    cardSelect:    () => play("fw-card-select", 0.5),
    cardDeselect:  () => play("fw-card-deselect", 0.4),
    territoryWin:  () => play("fw-territory-win", 0.8),
    territoryLose: () => play("fw-territory-lose", 0.7),
    win:           () => { stopMusic(); play("fw-win", 0.8); },
    ultra:         () => { stopMusic(); play("fw-ultra", 0.9); },
    lose:          () => { stopMusic(); play("fw-lose", 0.7); },
    crateOpen:     () => play("fw-crate-open", 0.8),
    crateReward:   () => play("fw-crate-reward", 0.7),
  }), [play, startTheme, startMusic, startEpic, stopMusic]);
  return { muted, toggleMute, startTheme, startMusic, startEpic, stopMusic, resetLowHp, sfx };
}


type SamuraiAnimState = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";


/** Wait for the arena's knock-out + finishing move (if one is playing), at least `minMs` in total. */
async function waitArenaFinish(minMs: number) {
  const t0 = Date.now();
  const w = typeof window !== "undefined" ? window.__fwArenaFinish : undefined;
  if (w) await Promise.race([w(), new Promise((r) => setTimeout(r, 25000))]);
  const spent = Date.now() - t0;
  if (spent < 1200 && spent < minMs) await new Promise((r) => setTimeout(r, minMs - spent));
}

function getSamuraiAnimForMove(move: Move | null): SamuraiAnimState {
  if (!move) return "idle";
  if (move.type === "attack") return "attack";
  if (move.type === "magic") return "magic";
  if (move.type === "trick") return "trick";
  if (move.type === "defend") return "defend";
  return "idle";
}

function hasFaction3DCharacter(factionId: string): boolean {
  return [
    "ashigaru",
    "buke",
    "bushi",
    "kenshi",
    "ronin",
    "samurai",
    "shogun",
    "sohei",
    "warrior",
    "wokou",
    "yamabushi",
  ].includes(factionId);
}
type FWLeaderboards = { warlords: {playerId:string;playerName?:string;score:number}[]; factions:{faction:FactionId;wins:number;topPlayers?:{playerId:string;playerName?:string;wins:number}[]}[]; streaks:{playerId:string;playerName?:string;score:number}[]; rich:{playerId:string;playerName?:string;score:number}[]; perfect:{playerId:string;playerName?:string;score:number}[]; pvpWins?:{playerId:string;playerName?:string;score:number}[]; pvpStreaks?:{playerId:string;playerName?:string;score:number}[]; pvpRich?:{playerId:string;playerName?:string;score:number}[]; };


function factionImgPath(fid: string, type: "symbol"|"char"): string {
  const jpgFactions: Record<string,boolean> = { "bushi-symbol": true, "bushi-char": true };
  const jpgCharFactions: Record<string,boolean> = { "shogun-char": true };
  const key = `${fid}-${type}`;
  const ext = jpgFactions[key] ? "jpg" : jpgCharFactions[key] ? "JPG" : "PNG";
  return `/factions/${fid}-${type}.${ext}`;
}

function FactionCard({ faction, selected, onSelect, disabled }: { faction: Faction; selected: boolean; onSelect: () => void; disabled: boolean; }) {
  return (
    <div
      onClick={disabled ? undefined : onSelect}
      style={{
        width: 96, height: 132, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, perspective: "600px", flexShrink: 0,
      }}
    >
      <div style={{
        width: "100%", height: "100%", position: "relative",
        transformStyle: "preserve-3d",
        transform: selected ? "rotateY(180deg)" : "rotateY(0deg)",
        transition: "transform 0.5s cubic-bezier(0.4,0,0.2,1)",
      }}>
        {/* Front: symbol */}
        <div style={{
          position: "absolute", inset: 0, backfaceVisibility: "hidden",
          borderRadius: 12, overflow: "hidden",
          border: `2px solid ${selected ? faction.borderColor : "rgba(255,255,255,0.1)"}`,
          background: "rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column", alignItems: "center",
          boxShadow: selected ? `0 0 20px ${faction.color}55` : "none",
        }}>
          <img src={factionImgPath(faction.id,"symbol")} alt={faction.name}
            style={{ width: "100%", height: 90, objectFit: "contain", padding: "6px 4px 2px", background: "rgba(0,0,0,0.45)", borderRadius: "10px 10px 0 0", boxSizing: "border-box" }}
            onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }}
          />
          <div style={{ padding: "4px 4px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 900, color: faction.color, letterSpacing: "0.06em" }}>{faction.name.toUpperCase()}</div>
            {(() => { const best = faction.moves.reduce((a,b)=>a.power>b.power?a:b); return <div style={{ fontSize:9, fontWeight:900, color:faction.color, marginTop:1 }}>{best.emoji} PWR {best.power}</div>; })()}
          </div>
        </div>
        {/* Back: character */}
        <div style={{
          position: "absolute", inset: 0, backfaceVisibility: "hidden",
          transform: "rotateY(180deg)", borderRadius: 12, overflow: "hidden",
          border: `2px solid ${faction.borderColor}`,
          background: faction.bgColor,
          display: "flex", flexDirection: "column", alignItems: "center",
          boxShadow: `0 0 24px ${faction.color}66`,
        }}>
          <img src={factionImgPath(faction.id,"char")} alt={faction.name + " warrior"}
            style={{ width: "100%", height: 98, objectFit: "cover", objectPosition: "top", borderRadius: "10px 10px 0 0" }}
            onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }}
          />
          <div style={{ padding: "4px 4px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 900, color: faction.color, letterSpacing: "0.06em" }}>{faction.name.toUpperCase()}</div>
            <div style={{ fontSize: 7, opacity: 0.7, marginTop: 1 }}>✓ Selected</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MoveButton({ move, selected, onSelect, disabled, faction }: { move: Move; selected: boolean; onSelect: () => void; disabled: boolean; faction: Faction; }) {
  const tc: Record<string,string> = { attack:"#f87171", defend:"#34d399", magic:"#c084fc", trick:"#fbbf24" };
  return (
    <button onClick={onSelect} disabled={disabled} style={{ background: selected ? faction.bgColor : "rgba(255,255,255,0.03)", border: `2px solid ${selected ? faction.borderColor : "rgba(255,255,255,0.1)"}`, borderRadius: 10, padding: "10px 12px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "all 0.18s", textAlign: "left", flex: 1, boxShadow: selected ? `0 0 12px ${faction.color}44` : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>{move.emoji}</span>
        <span style={{ fontWeight: 800, fontSize: 13 }}>{move.label}</span>
        <span style={{ marginLeft: "auto", fontSize: 9, background: tc[move.type], color: "#000", borderRadius: 4, padding: "1px 5px", fontWeight: 900 }}>{move.type.toUpperCase()}</span>
      </div>
      <div style={{ fontSize: 11, opacity: 0.65 }}>{move.desc}</div>
      <div style={{ fontSize: 10, opacity: 0.5, marginTop: 3 }}>Power: {move.power}/10</div>
    </button>
  );
}

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

function FWLeaderboardPanel({ lb }: { lb: FWLeaderboards }) {
  const [isSmallScreen, setIsSmallScreen] = React.useState(false);
  React.useEffect(() => {
    const check = () => setIsSmallScreen(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const shorten = (id: string) => id.startsWith("discord:") ? id.slice(8,16)+"…" : id.slice(0,10)+"…";
  const MAX = 50;

  const cardStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 14, padding: 16, display: "flex", flexDirection: "column",
  };
  const titleStyle: React.CSSProperties = {
    fontWeight: 900, fontSize: 13, marginBottom: 4, letterSpacing: "0.04em",
  };
  const subtextStyle: React.CSSProperties = {
    fontSize: 10, opacity: 0.45, marginBottom: 12, lineHeight: 1.4,
  };
  const scrollStyle: React.CSSProperties = {
    overflowY: "auto", maxHeight: 260, flex: 1,
    scrollbarWidth: "thin", scrollbarColor: "rgba(251,191,36,0.3) transparent",
  };
  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10,
    padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.06)",
  };
  const rankStyle = (i: number): React.CSSProperties => ({
    fontSize: 11, fontWeight: 800, minWidth: 22, color:
      i === 0 ? "#fbbf24" : i === 1 ? "#94a3b8" : i === 2 ? "#b45309" : "rgba(255,255,255,0.35)",
  });
  const emptyStyle: React.CSSProperties = {
    opacity: 0.35, fontSize: 12, padding: "16px 0", textAlign: "center",
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 14, color: "#fbbf24", letterSpacing: "0.04em" }}>
        ⚔️ FACTION WARS LEADERBOARDS
      </div>

      {/* Top 4 in a 2x2 grid */}
      <div style={{ display: "grid", gridTemplateColumns: isSmallScreen ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>

        {/* 🏆 Warlords */}
        <div style={cardStyle}>
          <div style={{ ...titleStyle, color: "#fbbf24" }}>🏆 Warlords</div>
          <div style={subtextStyle}>Most territories conquered all time across all campaigns</div>
          <div style={scrollStyle}>
            {lb.warlords.length === 0
              ? <div style={emptyStyle}>No data yet — be the first!</div>
              : lb.warlords.slice(0, MAX).map((e, i) => (
                <div key={e.playerId+i} style={rowStyle}>
                  <span style={rankStyle(i)}>#{i+1}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || shorten(e.playerId)}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>{e.score.toLocaleString()}</span>
                  <span style={{ fontSize: 9, opacity: 0.45, marginLeft: 2 }}>🏰</span>
                </div>
              ))}
          </div>
        </div>

        {/* 🔥 Streaks */}
        <div style={cardStyle}>
          <div style={{ ...titleStyle, color: "#f87171" }}>🔥 Streaks</div>
          <div style={subtextStyle}>Longest win streaks without a full campaign defeat</div>
          <div style={scrollStyle}>
            {lb.streaks.length === 0
              ? <div style={emptyStyle}>No data yet — be the first!</div>
              : lb.streaks.slice(0, MAX).map((e, i) => (
                <div key={e.playerId+i} style={rowStyle}>
                  <span style={rankStyle(i)}>#{i+1}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || shorten(e.playerId)}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#f87171" }}>{e.score.toLocaleString()}</span>
                  <span style={{ fontSize: 9, opacity: 0.45, marginLeft: 2 }}>🔥</span>
                </div>
              ))}
          </div>
        </div>

        {/* 💰 Richest Commanders */}
        <div style={cardStyle}>
          <div style={{ ...titleStyle, color: "#34d399" }}>💰 Richest Commanders</div>
          <div style={subtextStyle}>Most REBEL earned through Faction Wars victories</div>
          <div style={scrollStyle}>
            {lb.rich.length === 0
              ? <div style={emptyStyle}>No data yet — be the first!</div>
              : lb.rich.slice(0, MAX).map((e, i) => (
                <div key={e.playerId+i} style={rowStyle}>
                  <span style={rankStyle(i)}>#{i+1}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || shorten(e.playerId)}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#34d399" }}>{e.score.toLocaleString()}</span>
                  <span style={{ fontSize: 9, opacity: 0.45, marginLeft: 2 }}>REBEL</span>
                </div>
              ))}
          </div>
        </div>

        {/* 👑 Perfect Campaigns */}
        <div style={cardStyle}>
          <div style={{ ...titleStyle, color: "#c084fc" }}>👑 Perfect Campaigns</div>
          <div style={subtextStyle}>Most flawless 5/5 territory wins in a single campaign</div>
          <div style={scrollStyle}>
            {lb.perfect.length === 0
              ? <div style={emptyStyle}>No data yet — be the first!</div>
              : lb.perfect.slice(0, MAX).map((e, i) => (
                <div key={e.playerId+i} style={rowStyle}>
                  <span style={rankStyle(i)}>#{i+1}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || shorten(e.playerId)}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#c084fc" }}>{e.score.toLocaleString()}</span>
                  <span style={{ fontSize: 9, opacity: 0.45, marginLeft: 2 }}>5/5</span>
                </div>
              ))}
          </div>
        </div>

      </div>

      {/* ⚔️ Faction Standings — full width */}
      <div style={{ ...cardStyle, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(251,191,36,0.2)" }}>
        <div style={{ ...titleStyle, color: "#fbbf24" }}>⚔️ Faction Standings</div>
        <div style={subtextStyle}>Community-wide wins per faction this season — rally your faction on Discord to climb the ranks</div>
        {lb.factions.length === 0
            ? <div style={{ ...emptyStyle }}>No faction data yet — start a campaign!</div>
            : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:10 }}>
                {lb.factions.slice(0,11).map((f,i)=>{
                  const fd = FACTIONS[f.faction as FactionId];
                  if (!fd) return null;
                  const maxWins = lb.factions[0]?.wins||1;
                  const pct = Math.round((f.wins/maxWins)*100);
                  const topPl = f.topPlayers||[];
                  const shorten = (id:string) => id.startsWith("discord:")? id.slice(8,14)+"…":id.slice(0,8)+"…";
                  return (
                    <div key={f.faction} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, border:`1px solid ${fd.borderColor}`, overflow:"hidden" }}>
                      {/* Faction header */}
                      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:fd.bgColor }}>
                        <img src={factionImgPath(fd.id,"symbol")} alt={fd.name} style={{ width:26,height:26,objectFit:"contain",background:"rgba(0,0,0,0.4)",borderRadius:5,padding:2 }} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:11, fontWeight:900, color:fd.color }}>{fd.name}</div>
                          <div style={{ height:3, borderRadius:2, background:"rgba(255,255,255,0.1)", marginTop:3, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:pct+"%", background:fd.color, borderRadius:2, transition:"width 0.6s" }} />
                          </div>
                        </div>
                        <div style={{ fontSize:14, fontWeight:900, color:fd.color }}>{f.wins}</div>
                      </div>
                      {/* Top players list — scrollable top 10 */}
                      <div style={{ maxHeight:130, overflowY:"auto", padding:"4px 0", scrollbarWidth:"thin", scrollbarColor:"rgba(255,255,255,0.1) transparent" }}>
                        {topPl.length === 0
                          ? <div style={{ fontSize:10, opacity:0.35, padding:"8px 10px" }}>No leaders yet</div>
                          : topPl.slice(0,10).map((p,pi)=>(
                            <div key={p.playerId+pi} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 10px", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                              <span style={{ fontSize:9, opacity:pi<3?0.9:0.4, fontWeight:800, minWidth:16, color:pi===0?"#fbbf24":pi===1?"#94a3b8":pi===2?"#b45309":"inherit" }}>#{pi+1}</span>
                              <span style={{ flex:1, fontSize:10, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color: pi===0?fd.color:"inherit" }}>{p.playerName||shorten(p.playerId)}</span>
                              <span style={{ fontSize:10, fontWeight:800, color:fd.color }}>{p.wins}</span>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
          }
      </div>

      {/* ⚔️ PvP Champions — full width (Commit J) */}
      <div style={{ marginTop: 12, padding: 16, borderRadius: 14, background: "rgba(192,132,252,0.04)", border: "1px solid rgba(192,132,252,0.25)" }}>
        <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 4, letterSpacing: "0.04em", color: "#c084fc" }}>
          ⚔️ PvP Champions
        </div>
        <div style={subtextStyle}>Head-to-head Faction Wars matches — wins, streaks, and REBEL plundered from opponents</div>
        <div style={{ display: "grid", gridTemplateColumns: isSmallScreen ? "1fr" : "1fr 1fr 1fr", gap: 12, marginTop: 10 }}>

          {/* 🏆 PvP Wins */}
          <div style={cardStyle}>
            <div style={{ ...titleStyle, color: "#c084fc" }}>🏆 Top Champions</div>
            <div style={subtextStyle}>Most PvP victories all time</div>
            <div style={scrollStyle}>
              {(!lb.pvpWins || lb.pvpWins.length === 0)
                ? <div style={emptyStyle}>No PvP matches yet — challenge a friend!</div>
                : lb.pvpWins.slice(0, MAX).map((e, i) => (
                  <div key={e.playerId+i} style={rowStyle}>
                    <span style={rankStyle(i)}>#{i+1}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || shorten(e.playerId)}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#c084fc" }}>{e.score.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* 🔥 PvP Streaks */}
          <div style={cardStyle}>
            <div style={{ ...titleStyle, color: "#f87171" }}>🔥 Hot Streaks</div>
            <div style={subtextStyle}>Longest PvP win streak ever</div>
            <div style={scrollStyle}>
              {(!lb.pvpStreaks || lb.pvpStreaks.length === 0)
                ? <div style={emptyStyle}>No streaks yet — go on a run!</div>
                : lb.pvpStreaks.slice(0, MAX).map((e, i) => (
                  <div key={e.playerId+i} style={rowStyle}>
                    <span style={rankStyle(i)}>#{i+1}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || shorten(e.playerId)}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#f87171" }}>{e.score.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* 💰 PvP Plunder */}
          <div style={cardStyle}>
            <div style={{ ...titleStyle, color: "#fbbf24" }}>💰 Plunder Lords</div>
            <div style={subtextStyle}>Most REBEL won from PvP pots + crates</div>
            <div style={scrollStyle}>
              {(!lb.pvpRich || lb.pvpRich.length === 0)
                ? <div style={emptyStyle}>No plunder yet — be the first to win a pot!</div>
                : lb.pvpRich.slice(0, MAX).map((e, i) => (
                  <div key={e.playerId+i} style={rowStyle}>
                    <span style={rankStyle(i)}>#{i+1}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || shorten(e.playerId)}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#fbbf24" }}>{e.score.toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}


export default function FactionWars() {
  // ── Identity ──────────────────────────────────────────────────────────
  const initialProfile = typeof window !== "undefined" ? loadProfile() : null;
  const initialEffectiveId = initialProfile ? getEffectivePlayerId(initialProfile) : "guest";
  const [effectivePlayerId, setEffectivePlayerId] = useState(initialEffectiveId);
  const [playerName, setPlayerName] = useState(initialProfile?.discordName || initialProfile?.name || "");
  const playerId = effectivePlayerId;
  const solo = useSoloCampaign(effectivePlayerId);

  useEffect(() => {
    const u = () => { const p = loadProfile(); const id = getEffectivePlayerId(p)||"guest"; setEffectivePlayerId(id); setPlayerName(p?.discordName||p?.name||""); };
    u(); window.addEventListener("ra:identity-changed", u); return () => window.removeEventListener("ra:identity-changed", u);
  }, []);

  // Inject a CSS @media rule so the AI move-grid reliably collapses to a single
  // column on mobile (≤600px). Inline minmax(300px,1fr) auto-fit should already
  // do this, but this is belt-and-suspenders for any browser/cache that ignores
  // the inline style. !important wins specificity. Idempotent (id check).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "fw-move-grid-mobile-css";
    if (document.getElementById(id)) return;
    const styleEl = document.createElement("style");
    styleEl.id = id;
    styleEl.textContent = "@media (max-width: 600px) { .fw-move-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }";
    document.head.appendChild(styleEl);
  }, []);

  const { balance, spend, earn, refresh, totalEarnRoom, devGrant, runOf } = usePoints(effectivePlayerId);
  const [checkingSavedCampaign, setCheckingSavedCampaign] = useState(false);
  const [campaignBalanceMessage, setCampaignBalanceMessage] = useState("");
  const checkingCampaignRef = useRef(false);
  const checkSavedCampaign = async () => {
    if (checkingCampaignRef.current || solo.busy || busy) return;
    checkingCampaignRef.current = true; setCheckingSavedCampaign(true); setBusy(true); setCampaignBalanceMessage("");
    try {
      const saved = await solo.status();
      if (saved) await refresh();
    } catch { setCampaignBalanceMessage("The point balance could not be refreshed. Check saved campaign again; no action is repeated."); }
    finally { checkingCampaignRef.current = false; setCheckingSavedCampaign(false); setBusy(false); }
  };
  const lastPidRef = useRef<string>("");
  useEffect(() => { if (!effectivePlayerId||lastPidRef.current===effectivePlayerId) return; lastPidRef.current=effectivePlayerId; refresh().catch(()=>{}); }, [effectivePlayerId, refresh]);

  const [profile, setProfile] = useState(initialProfile);
  useEffect(() => { const s=()=>setProfile(loadProfile()); s(); window.addEventListener("ra:identity-changed",s); return ()=>window.removeEventListener("ra:identity-changed",s); }, []);

  const isDiscordConnected = !!profile?.discordUserId && !(profile as any)?.discordSkipLink;

  // Discord auto-link
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

  useEffect(() => { if (typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("discord")==="1") window.dispatchEvent(new Event("ra:identity-changed")); }, []);

  function disconnectDiscord() {
    try { saveProfile({ discordUserId: undefined, discordName: undefined, primaryId: undefined, discordSkipLink: true }); window.dispatchEvent(new Event("ra:identity-changed")); window.location.href = "/api/auth/discord/logout"; } catch {}
  }

  // Daily claim
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [nextClaimTs, setNextClaimTs]   = useState<number|null>(null);
  const [countdownStr, setCountdownStr] = useState<string>('');
  const [claimStatus, setClaimStatus]   = useState("");
  const [claimBusy, setClaimBusy]       = useState(false);

  function formatCountdown(ms: number): string {
    if (ms<=0) return '00:00:00';
    const totalSec=Math.floor(ms/1000); const h=Math.floor(totalSec/3600); const m=Math.floor((totalSec%3600)/60); const s=totalSec%60;
    return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
  }

  useEffect(() => { if (!effectivePlayerId) return; fetch(`/api/points/claim?playerId=${encodeURIComponent(effectivePlayerId)}`,{cache:"no-store"}).then(r=>r.json()).then(j=>{ if(j?.ok){ setDailyClaimed(!!j.claimed); if(j.claimed && j.msUntilNextClaim>0) setNextClaimTs(Date.now()+Number(j.msUntilNextClaim)); } }).catch(()=>{}); }, [effectivePlayerId]);

  async function claimDailyNow() {
    if (claimBusy||dailyClaimed||!effectivePlayerId) return;
    setClaimBusy(true); setClaimStatus("Claiming…");
    try {
      const r=await fetch("/api/points/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:effectivePlayerId,amount:cfg?.dailyClaim})});
      const j=await r.json().catch(()=>null);
      if (!r.ok||!j?.ok){setClaimStatus(j?.error||"Claim failed.");return;}
      setDailyClaimed(true); setClaimStatus(`✅ +${j.added||cfg?.dailyClaim} ${cfg?.currency} claimed!`); if(j.msUntilNextClaim>0) setNextClaimTs(Date.now()+Number(j.msUntilNextClaim)); else setNextClaimTs(Date.now()+86400000);
      await refresh();
    } catch(e:any){setClaimStatus(e?.message||"Claim error");}
    finally{setClaimBusy(false);}
  }

  useEffect(() => {
    if (!nextClaimTs) return;
    const id=setInterval(()=>{ const ms=nextClaimTs-Date.now(); if(ms<=0){setCountdownStr(''); clearInterval(id); setDailyClaimed(false); return;} setCountdownStr(formatCountdown(ms)); },1000);
    return ()=>clearInterval(id);
  }, [nextClaimTs]);

  const [showRules, setShowRules] = useState(false);

  // ── Config ──────────────────────────────────────────────────────────
  const [cfgState, setCfgState] = useState<any>(defaultPointsConfig);
  useEffect(() => { fetch("/api/config",{cache:"no-store"}).then(r=>r.json()).then(j=>{if(j?.pointsConfig)setCfgState((c:any)=>({...c,...j.pointsConfig}));}).catch(()=>{}); }, []);
  const cfg        = cfgState as any;
  const fwCost        = Number(cfg?.factionWarsCost           ?? 150);
  const fwPlunderBonus = Number(cfg?.factionWarsPlunderBonus  ?? 50);
  const difficulty = Number(cfg?.factionWarsAIDifficulty ?? 0.75);
  const currency   = String(cfg?.currency || "REBEL");

  // ── Game State ───────────────────────────────────────────────────────
  const [phase, setPhase]               = useState<Phase>("idle");
  const [team, setTeam]                 = useState<FactionId[]>([]);
  const [defenders, setDefenders]       = useState<FactionId[]>([]);
  const [currentTerritory, setCurrentT] = useState(0);
  const [currentFactionIdx, setCurrentFI] = useState(0);
 const [selectedMove, setSelectedMove] = useState<Move|null>(null);
  const [enemy3DAnim, setEnemy3DAnim] = useState<SamuraiAnimState>("idle");
const [player3DAnim, setPlayer3DAnim] = useState<SamuraiAnimState>("idle");
  const [results, setResults]           = useState<TerritoryResult[]>([]);
  const [finalRarity, setFinalRarity]   = useState<Rarity>("none");
  const [runMessage, setRunMessage]     = useState("");
  const [busy, setBusy]                 = useState(false);
  const [showBuyPoints, setShowBuyPoints] = useState(false);
  const [showPrizeModal, setShowPrizeModal] = useState(false);
  const [prizeLabel, setPrizeLabel] = useState("");
  const [prizeSub, setPrizeSub] = useState("");
  const [prizeClaimId, setPrizeClaimId] = useState<string|undefined>(undefined);
  const [prizeMerchShipping, setPrizeMerchShipping] = useState(false);
  const [prizeObj, setPrizeObj] = useState<any>(null);
  const [prizeNeedShipping, setPrizeNeedShipping] = useState(false);
  const [prizeShipMsg, setPrizeShipMsg] = useState("");
  const [prizeShipBusy, setPrizeShipBusy] = useState(false);
  const [prizeShipForm, setPrizeShipForm] = useState({ name:"", email:"", phone:"", address1:"", address2:"", city:"", state:"", zip:"", country:"" });
  const [lb, setLb]                     = useState<FWLeaderboards>({ warlords:[], factions:[], streaks:[], rich:[], perfect:[], pvpWins:[], pvpStreaks:[], pvpRich:[] });
  const [battleAnim, setBattleAnim]     = useState<"idle"|"clash"|"win"|"lose">("idle");
  const [playerHp, setPlayerHp]         = useState(MAX_HP);
  const [enemyHp, setEnemyHp]           = useState(MAX_HP);
  const [currentRound, setCurrentRound] = useState(0);
  const [roundLog, setRoundLog]         = useState<{playerMove:string;enemyMove:string;playerDmg:number;enemyDmg:number;effect?:string}[]>([]);
  const [dmgFloats, setDmgFloats]       = useState<{id:number;side:"player"|"enemy"|"plunder";dmg:number}[]>([]);
  const [currentTerritoryRounds, setCurrentTerritoryRounds] = useState<RoundResult[]>([]);
 const dmgFloatId = useRef(0);
const plunderPendingRef = useRef(false);
const fightSeqRef = useRef(0);
const fightInFlightRef = useRef(false);
// the arena + moves block: kept on screen while a round plays (no scrolling between picking a move and watching it)
const stageRef = useRef<HTMLDivElement>(null);
const showStage = useCallback(() => {
  const el = stageRef.current; if (!el || typeof window === "undefined") return;
  const r = el.getBoundingClientRect(); if (r.top >= -4 && r.top <= Math.max(80, window.innerHeight * 0.2)) return;
  window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 8), behavior: "smooth" });
}, []);
  const [usedMoves, setUsedMoves] = useState<Record<string,number>>({});
  const [sacrificeBonus, setSacrificeBonus] = useState(0);
  const [berserkerActive, setBerserkerActive] = useState(false);
  // Campaign-level buffs (persist across territories)
  const [powerBuffRounds, setPowerBuffRounds] = useState(0);   // rounds remaining for iron_code/death_mark style buffs
  const [powerBuffAmt, setPowerBuffAmt]       = useState(0);   // extra damage while buff active
  const [comboBonus, setComboBonus]           = useState(0);   // honor_bond/blade_harmony bonus
  const [meditationStacks, setMeditationStacks] = useState(0); // meditative_focus stacks
  const [lastStandUsed, setLastStandUsed]     = useState(false);
  const [commandActive, setCommandActive]     = useState(false); // command_strike: next warrior +50% damage
  const [strategicRetUsed, setStrategicRetUsed] = useState(false);
  const [healBusy, setHealBusy]   = useState(false);
  const [healUsed, setHealUsed]     = useState(0);
  const [oneTimeUsed, setOneTimeUsed] = useState<string[]>([]);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const { muted, toggleMute, startTheme, startMusic, startEpic, stopMusic, resetLowHp, sfx } = useFWAudio();

  const loadLB = useCallback(async () => {
    try { const r=await fetch("/api/faction-wars/leaderboard",{cache:"no-store"}); const j=await r.json(); if(j?.ok)setLb(j.lb); } catch {}
  }, []);
  useEffect(() => { void loadLB(); }, [loadLB]);
  useEffect(() => {
    const h=()=>loadLB(); window.addEventListener("ra:leaderboards-refresh",h); return ()=>window.removeEventListener("ra:leaderboards-refresh",h);
  }, [loadLB]);
  useEffect(() => {
    let started = false;
    const tryStart = () => {
      if (started) return;
      started = true;
      sfx.startTheme();
      document.removeEventListener('click', tryStart);
      document.removeEventListener('keydown', tryStart);
      document.removeEventListener('touchstart', tryStart);
    };
    // startTheme returns void but internally calls play() — attempt it and
    // check if audio context is already unlocked via a short silent test
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ac.state === 'running') {
      // Audio already unlocked (e.g. navigated from another game) — play immediately
      ac.close();
      tryStart();
    } else {
      // Audio locked (direct URL load) — wait for first interaction
      ac.close();
      document.addEventListener('click', tryStart);
      document.addEventListener('keydown', tryStart);
      document.addEventListener('touchstart', tryStart);
    }
    return () => {
      stopMusic();
      document.removeEventListener('click', tryStart);
      document.removeEventListener('keydown', tryStart);
      document.removeEventListener('touchstart', tryStart);
    };
  }, []);

  const toggleFaction = (fid: FactionId) => {
    if (phase !== "idle") return;
    sfx.cardFlip();
    if (team.includes(fid)) sfx.cardDeselect(); else sfx.cardSelect();
    setTeam(prev => { const idx=prev.indexOf(fid); if(idx>=0)return prev.filter((_,i)=>i!==idx); if(prev.length>=TEAM_SIZE)return prev; return [...prev,fid]; });
  };

  const applySolo = useCallback((session: SoloView) => {
    if (session.held || session.abandoned) return;
    const g = session.state;
    setTeam(g.team); setDefenders(g.defenders); setResults(g.results); setCurrentT(g.territory);
    setCurrentFI(g.territory); setPlayerHp(g.playerHp); setEnemyHp(g.enemyHp);
    setCurrentRound(g.rounds.length); setCurrentTerritoryRounds(g.rounds); setUsedMoves(g.usedMoves);
    setOneTimeUsed(g.oneTimeUsed); setHealUsed(g.healUsed); setBerserkerActive(g.berserkerActive);
    setSacrificeBonus(g.sacrificeBonus); setPowerBuffAmt(g.powerBuffAmount); setPowerBuffRounds(g.powerBuffRounds);
    setComboBonus(g.comboBonus); setCommandActive(g.commandActive); setMeditationStacks(g.meditationStacks);
    setStrategicRetUsed(g.strategicRetreatUsed); plunderPendingRef.current = g.plunderPending;
    setSelectedMove(null); setFinalRarity(g.rarity); setPhase(g.phase);
    setRoundLog([...g.rounds].reverse().slice(0, 6).map(r => ({ playerMove: r.playerMove.label,
      enemyMove: r.enemyMove.label, playerDmg: r.playerDmg, enemyDmg: r.enemyDmg, effect: "" })));
    setCfgState((c: any) => ({ ...c, factionWarsCost: session.config.cost,
      factionWarsHealCost: session.config.healCost, factionWarsHealAmt: session.config.healAmount,
      factionWarsHealMax: session.config.healMaximum, factionWarsPlunderBonus: session.config.plunder,
      factionWarsAIDifficulty: session.config.difficulty, rewards: { ...c.rewards, ...session.config.rewards } }));
  }, []);
  const holdSoloApply = useRef(false); // the arena is still playing the knock-out / finishing move
  useEffect(() => { if (solo.session && !holdSoloApply.current) applySolo(solo.session); }, [solo.session, applySolo]);
  const displayedSoloOwner = useRef<string | null>(null);
  useEffect(() => {
    if (displayedSoloOwner.current && displayedSoloOwner.current !== effectivePlayerId) {
      setPhase("idle"); setTeam([]); setDefenders([]); setResults([]); setSelectedMove(null);
      fightSeqRef.current++; fightInFlightRef.current = false;
    }
    if (solo.session) displayedSoloOwner.current = solo.session.playerId;
  }, [effectivePlayerId, solo.session]);

  const startCampaign = async () => {
    if (team.length < TEAM_SIZE || busy) return;
    if (solo.requiresSavedCheck) { setRunMessage("Check the saved campaign before starting another one."); return; }
    if (Number(totalEarnRoom||0) < fwCost) { setRunMessage("No plays left today."); return; }
    const actualCostCheck = team.includes("ashigaru") ? Math.max(0, fwCost - 25) : fwCost;
    if (balance < actualCostCheck) { setRunMessage(`Not enough ${currency} to start Faction Wars.`); return; }
    setBusy(true); setRunMessage("Assembling your forces...");
    if (solo.enabled && solo.sharing) {
      try {
        const saved = await solo.start(team, actualCostCheck); applySolo(saved); startMusic();
        setRunMessage(""); await refresh();
      } catch (error) { setRunMessage((error as Error).message); }
      finally { setBusy(false); }
      return;
    }
    try {
      const actualCost = team.includes("ashigaru") ? Math.max(0, fwCost - 25) : fwCost;
    const spendRes: any = await spend(actualCost, "faction-wars");
      if (!spendRes?.ok) { setRunMessage(spendRes?.error||"Could not start campaign."); setBusy(false); return; }
    } catch (e: any) { setRunMessage(e?.message||"Could not start."); setBusy(false); return; }
    const defs: FactionId[] = [];
    const available = [...FACTION_IDS];
    for (let i = 0; i < TERRITORY_COUNT; i++) {
      const idx = Math.floor(Math.random() * available.length);
      defs.push(available[idx]); available.splice(idx, 1);
      if (available.length === 0) available.push(...FACTION_IDS.filter(f => !defs.slice(-3).includes(f)));
    }
fightSeqRef.current += 1;
fightInFlightRef.current = false;
setDefenders(defs); setResults([]); setCurrentT(0); setCurrentFI(0); setSelectedMove(null); setFinalRarity("none"); setRunMessage("");
setPlayer3DAnim("idle"); setEnemy3DAnim("idle");
if (typeof window !== "undefined") {
  (window as any).__fw3dPlayPlayer?.("idle");
  (window as any).__fw3dPlayEnemy?.("idle");
}
setPlayerHp(MAX_HP); setEnemyHp(MAX_HP); setCurrentRound(0); setRoundLog([]); setDmgFloats([]); setCurrentTerritoryRounds([]);
setPhase("battle"); startMusic(); setBusy(false);
  };

 const startTerritory = () => {
  fightSeqRef.current += 1;
  fightInFlightRef.current = false;
  sfx.roundStart();
  setSelectedMove(null);
  setBattleAnim("idle");
  setPlayer3DAnim("idle");
  setEnemy3DAnim("idle");
  if (typeof window !== "undefined") {
    (window as any).__fw3dPlayPlayer?.("idle");
    (window as any).__fw3dPlayEnemy?.("idle");
  }
  setPlayerHp(MAX_HP); setEnemyHp(MAX_HP);
  setCurrentRound(0); setRoundLog([]); setDmgFloats([]); setCurrentTerritoryRounds([]);
  setUsedMoves({}); setBerserkerActive(false);
    // Apply meditation stacks to starting power buff
    if (meditationStacks > 0) { setPowerBuffAmt(meditationStacks * 2); setPowerBuffRounds(99); }
  };

 const fightTerritory = async () => {
  if (!selectedMove || busy || fightInFlightRef.current) return;
  showStage();
  if (solo.session && !solo.session.abandoned) {
    fightInFlightRef.current = true; setBusy(true); setBattleAnim("clash");
    const chosen = selectedMove;
    setPlayer3DAnim(getSamuraiAnimForMove(chosen));
    try {
      holdSoloApply.current = true;
      const saved = await solo.act({ kind: "MOVE", moveId: chosen.id });
      const round = saved.state.rounds[saved.state.rounds.length - 1];
      if (round) { setEnemy3DAnim(getSamuraiAnimForMove(round.enemyMove));
        const fid = ++dmgFloatId.current;
        setDmgFloats([{ id: fid, side: "player", dmg: round.enemyDmg }, { id: fid + 1, side: "enemy", dmg: round.playerDmg }]);
        setTimeout(() => setDmgFloats(prev => prev.filter(x => x.id !== fid && x.id !== fid + 1)), 1500);
      }
      // the territory ended: show the final blow and the finishing move before the result screen
      if (round && saved.state.phase !== "battle") {
        setPlayerHp(round.playerHpAfter); setEnemyHp(round.enemyHpAfter);
        setBattleAnim(round.enemyHpAfter <= 0 ? "win" : round.playerHpAfter <= 0 ? "lose" : "idle");
        await waitArenaFinish(1500);
      }
      holdSoloApply.current = false;
      applySolo(saved); await refresh(); setRunMessage("");
      setBattleAnim(saved.state.enemyHp <= 0 ? "win" : saved.state.playerHp <= 0 ? "lose" : "idle");
    } catch (error) { setRunMessage((error as Error).message); setBattleAnim("idle"); }
    finally { holdSoloApply.current = false; setBusy(false); fightInFlightRef.current = false; }
    return;
  }

  fightInFlightRef.current = true;
  const fightSeq = fightSeqRef.current;

  const nextPlayerAnim = getSamuraiAnimForMove(selectedMove);

setPlayer3DAnim(nextPlayerAnim);

if (typeof window !== "undefined") {
  (window as any).__fw3dPlayPlayer?.(nextPlayerAnim);
}
    setShowHowToPlay(false); // auto-collapse once battle begins
    const playerFaction = team[currentFactionIdx] || team[0];
    const defender = defenders[currentTerritory];
    const tWon = results.filter(r=>r.won).length;
    const tLost = results.filter(r=>!r.won).length;
    const bonus = calcPassiveBonus(playerFaction, tWon, currentTerritory === 0) + sacrificeBonus
      + (powerBuffRounds > 0 ? powerBuffAmt : 0)
      + comboBonus
      + (commandActive ? 8 : 0); // command_strike: +8 flat bonus
    if (sacrificeBonus > 0) setSacrificeBonus(0);
    if (powerBuffRounds > 0) setPowerBuffRounds(n => n - 1);
    if (commandActive) setCommandActive(false); // consumed after one use
    setBusy(true); setBattleAnim("clash");   // the arena plays the swing / hit / block sounds on the frames they happen
   await new Promise(r=>setTimeout(r,450));
if (fightSeq !== fightSeqRef.current) return;

    const imperialDecreeFlag = selectedMove.id === "imperial_decree" || selectedMove.id === "final_command";
   const enemyMove = imperialDecreeFlag
  ? FACTIONS[defender].moves.reduce((a,b)=>a.power<b.power?a:b)
  : pickEnemyMove(defender, selectedMove, difficulty, enemyHp, playerHp, currentTerritory);

const nextEnemyAnim = getSamuraiAnimForMove(enemyMove);
setEnemy3DAnim(nextEnemyAnim);

if (typeof window !== "undefined") {
  (window as any).__fw3dPlayEnemy?.(nextEnemyAnim);
}
    const timesUsed = usedMoves[selectedMove.id] || 0;
    const degradedMove: Move = { ...selectedMove, power: Math.max(1, selectedMove.power - timesUsed) };
    setUsedMoves(prev => ({ ...prev, [selectedMove.id]: (prev[selectedMove.id]||0)+1 }));
    if (selectedMove.oneTime) setOneTimeUsed(prev => [...prev, selectedMove.id]);
    // ── Special move effects ──────────────────────────────────────
    if (selectedMove.id === "berserker_rage") { setBerserkerActive(true); fightAudio.play("finish_them", { vol: 0.7 }); }
    if (selectedMove.id === "imperial_decree" || selectedMove.id === "final_command") sfx.imperial();
    if (selectedMove.id === "iron_meditation") sfx.heal();
    if (selectedMove.id === "plunder") sfx.plunder();
    if (selectedMove.id === "blood_price") sfx.bloodPrice();
    if (selectedMove.id === "counter_strike") sfx.counter();
    if (selectedMove.id === "rally") sfx.rally();
    if (selectedMove.id === "ambush") sfx.ambush();
    if (selectedMove.id === "iron_code")        { setPowerBuffAmt(3); setPowerBuffRounds(8); } // +3 dmg for 8 rounds (~2 territories)
    if (selectedMove.id === "death_mark")       { setPowerBuffAmt(2); setPowerBuffRounds(4); } // +2 dmg next 4 rounds
    if (selectedMove.id === "blade_harmony")    setComboBonus(prev => prev + 3); // permanent campaign +3
    if (selectedMove.id === "honor_bond")       setComboBonus(prev => prev + 3); // permanent campaign +3
    if (selectedMove.id === "command_strike")   setCommandActive(true); // next round gets +8 bonus
    if (selectedMove.id === "meditation")       setMeditationStacks(prev => prev + 1); // stacks per territory
    if (selectedMove.id === "iron_meditation")  { setPlayerHp(hp => Math.min(MAX_HP, hp + 15)); setPowerBuffAmt(3); setPowerBuffRounds(4); } // real +15 HP heal + buff
    if (selectedMove.id === "battle_cry")       { setPowerBuffAmt(4); setPowerBuffRounds(5); } // +4 dmg next 5 rounds
    if (selectedMove.id === "spirit_vision")    setPowerBuffAmt(prev => Math.max(prev, 3)); // reveal = +3 power buff rounds
    if (selectedMove.id === "divine_auth")   plunderPendingRef.current = true;
    if (selectedMove.id === "strategic_ret")  setStrategicRetUsed(true);
    // strategic_ret handled below
    if (selectedMove.id === "cutlass_raid")     { if (Math.random() < 0.4) { const bonus2 = 10; earn(bonus2, "faction-wars").catch(()=>{}); } }
    if (selectedMove.id === "mountain_seal")    setPowerBuffAmt(prev => prev + 3); // seal = your next moves hit harder
    if (selectedMove.id === "bushido_stand")     { /* handled via block + bonus in calcDamage */ }
    if (selectedMove.id === "blood_price")       { setPlayerHp(hp => Math.max(1, hp - 20)); } // costs 20 HP

    // Track plunder use for this territory
    if (selectedMove.id === "plunder") { plunderPendingRef.current = true; }
    if (selectedMove.id === "noble_sacrifice") {
      setSacrificeBonus(12); sfx.sacrifice();
      setPlayerHp(0);
      const sacRnd: RoundResult = {round:currentRound+1,playerMove:selectedMove,enemyMove:selectedMove,playerDmg:0,enemyDmg:100,playerHpAfter:0,enemyHpAfter:enemyHp};
      const sacRes: TerritoryResult = {territory:currentTerritory,defender,playerFaction,rounds:[...currentTerritoryRounds,sacRnd],playerHpFinal:0,enemyHpFinal:enemyHp,won:false};
      setBattleAnim("lose"); await new Promise(r=>setTimeout(r,700)); setBattleAnim("idle");
      setResults(prev=>[...prev,sacRes]); setSelectedMove(null); setBusy(false); fightInFlightRef.current = false; setPhase("territory_result");
      return;
    }
    // ── Conditional round effects ────────────────────────────────
    // war_stomp: reduce enemy damage this round by 3
    const warStompPenalty = selectedMove.id === "war_stomp" ? 3 : 0;
    // ambush: +4 bonus if enemy chose attack
    const ambushBonus = (selectedMove.id === "ambush" && enemyMove.type === "attack") ? 4 : 0;
    // counter_strike: deal back enemy's power as extra damage
    const counterBonus = selectedMove.id === "counter_strike" ? Math.round(enemyMove.power * 1.2) : 0;
    // precision_slash: ignore 50% of enemy block
    const precisionFlag = selectedMove.id === "precision_slash";
    // perfect_form: +3 bonus if enemy dealt 0 damage last round
    const lastRound = currentTerritoryRounds[currentTerritoryRounds.length - 1];
    const perfectBonus = (selectedMove.id === "perfect_form" && lastRound && lastRound.enemyDmg === 0) ? 3 : 0;
    // sea_storm: random power 4-10
    const seaStormFlag = selectedMove.id === "sea_storm";
    // last_stand: huge spike only when player HP < 40
    const lastStandActive = selectedMove.id === "last_stand" && playerHp < 40;
    // endure: can't lose this territory (forced win if this move is chosen)
    const endureFlag = selectedMove.id === "endure";
    // mountain_echo: replay last round's player damage
    const echoBonus = (selectedMove.id === "mountain_echo" && lastRound) ? Math.round(lastRound.playerDmg * 0.7) : 0;
    const mirrorBonus = (selectedMove.id === "mirror_slash" && lastRound) ? lastRound.enemyDmg : 0;
    const finalCmdBonus = selectedMove.id === "final_command" ? 6 : 0;
    // officers_order: +3 to all attack moves this territory
    const officersBonus = selectedMove.id === "officers_order" ? 3 : 0;
    // tactical_blade: +2 power for attack moves
    const tacticalBonus = selectedMove.id === "tactical_blade" && degradedMove.type === "attack" ? 2 : 0;
    // field_intel: +3 if you counter the enemy's type
    const cm2: Record<string,string[]> = { attack:["defend","trick"], defend:["magic","attack"], magic:["trick","defend"], trick:["attack","magic"] };
    const fieldBonus = (selectedMove.id === "field_intel" && (cm2[enemyMove.type]||[]).includes(selectedMove.type)) ? 3 : 0;
    // strategic_mind: +2 per territory already won
    const stratBonus = selectedMove.id === "strategic_mind" ? tWon * 2 : 0;

    const totalBonus = bonus + ambushBonus + counterBonus + perfectBonus + echoBonus + mirrorBonus + finalCmdBonus + officersBonus + tacticalBonus + fieldBonus + stratBonus + (lastStandActive ? 15 : 0);

    let seaStormPower = seaStormFlag ? (Math.floor(Math.random()*7)+4) : degradedMove.power;
    const moveForDmg: Move = seaStormFlag ? {...degradedMove, power: seaStormPower} : degradedMove;

    const playerDmg = calcDamage(moveForDmg, playerFaction, defender, totalBonus, tWon, tLost, difficulty, true);
    const rawEnemyDmg = calcDamage(enemyMove, defender, playerFaction, 0, 0, 0, difficulty, false);
    const rawEnemyReduced = Math.max(0, rawEnemyDmg - warStompPenalty);
    const block = precisionFlag ? calcBlock(selectedMove) * 0.3 : calcBlock(selectedMove);
    const enemyDmg = endureFlag ? 0 : Math.round(rawEnemyReduced * (1 - block));

    const newPlayerHp = Math.max(0, playerHp - enemyDmg);
    const newEnemyHp  = Math.max(0, enemyHp  - playerDmg);
    setPlayerHp(newPlayerHp);
    setEnemyHp(newEnemyHp);

    if (newPlayerHp < 25 && playerHp >= 25) sfx.lowHp();

    // Floating dmg numbers
    const fid = ++dmgFloatId.current;
    setDmgFloats(prev => [...prev,
      {id:fid,   side:"player" as const, dmg:enemyDmg},
      {id:fid+1, side:"enemy"  as const, dmg:playerDmg}
    ]);
    setTimeout(() => setDmgFloats(prev => prev.filter(f => f.id!==fid && f.id!==fid+1)), 1500);

    const roundResult: RoundResult = {
      round: currentRound+1, playerMove: selectedMove, enemyMove,
      playerDmg, enemyDmg, playerHpAfter: newPlayerHp, enemyHpAfter: newEnemyHp,
    };
    const newRounds = [...currentTerritoryRounds, roundResult];
    setCurrentTerritoryRounds(newRounds);
    setCurrentRound(n => n+1);
    // Build effect tag for round log
    const effectTag = (() => {
      if (selectedMove.id==="iron_code"||selectedMove.id==="death_mark"||selectedMove.id==="battle_cry") return "⚡ Buff active";
      if (selectedMove.id==="ambush" && ambushBonus>0) return "🎯 Ambush!";
      if (selectedMove.id==="counter_strike") return "🔄 Counter!";
      if (selectedMove.id==="endure") return "💪 Endured!";
      if (selectedMove.id==="iron_meditation") return "💚 Healed!";
      if (selectedMove.id==="war_stomp") return "👊 Stomped!";
      if (selectedMove.id==="rally") return "🛡️ Rallied!";
      if (selectedMove.id==="strategic_ret") return "🏳️ Retreat!";
      if (selectedMove.id==="imperial_decree"||selectedMove.id==="final_command") return "📋 Decreed!";
      if (selectedMove.id==="mirror_slash" && mirrorBonus>0) return "🪞 Reflected!";
      if (selectedMove.id==="blood_price") return "🩸 Blood Price!";
      if (selectedMove.id==="blade_harmony"||selectedMove.id==="honor_bond") return "🔗 Bonded!";
      if (selectedMove.id==="command_strike") return "👑 Command!";
      if (selectedMove.id==="plunder") return "💰 Plundered!";
      if (selectedMove.id==="spirit_vision"||selectedMove.id==="mountain_seal") return "🔮 Sealed!";
      return "";
    })();
    setRoundLog(prev => [{playerMove:selectedMove.label, enemyMove:enemyMove.label, playerDmg, enemyDmg, effect:effectTag}, ...prev.slice(0,5)]);

    // endure: can't lose this territory — but also can't win by using it alone
const over = endureFlag ? false : (newPlayerHp <= 0 || newEnemyHp <= 0);

if (typeof window !== "undefined") {
  window.setTimeout(() => {
    if (over && newEnemyHp <= 0) {
      setPlayer3DAnim("win");
      setEnemy3DAnim("lose");
      (window as any).__fw3dPlayPlayer?.("win");
      (window as any).__fw3dPlayEnemy?.("lose");
      return;
    }

    if (over && newPlayerHp <= 0) {
      setPlayer3DAnim("lose");
      setEnemy3DAnim("win");
      (window as any).__fw3dPlayPlayer?.("lose");
      (window as any).__fw3dPlayEnemy?.("win");
      return;
    }

    setPlayer3DAnim("idle");
    setEnemy3DAnim("idle");
    (window as any).__fw3dPlayPlayer?.("idle");
    (window as any).__fw3dPlayEnemy?.("idle");
  }, 950);
}

setBattleAnim(newEnemyHp <= 0 ? "win" : newPlayerHp <= 0 ? "lose" : "idle");
   await new Promise(r=>setTimeout(r, over ? 700 : 250));
    if (fightSeq !== fightSeqRef.current) return;
    if (!over) { setBattleAnim("idle"); }

    setSelectedMove(null);
    setBusy(false);
    if (fightSeq === fightSeqRef.current) fightInFlightRef.current = false;

if (over) {
  await waitArenaFinish(3500);
  if (fightSeq !== fightSeqRef.current) return;
  setBattleAnim("idle");
  const playerWon = newEnemyHp <= 0;
      // Plunder bonus on win
      if (playerWon && plunderPendingRef.current) {
        const plunderAmt = Number(cfg?.factionWarsPlunderBonus ?? 50);
        try { await earn(plunderAmt, "faction-wars"); await refresh(); } catch {}
        plunderPendingRef.current = false;
        // Big REBEL float on screen
        const pid2 = ++dmgFloatId.current;
        setDmgFloats(prev => [...prev, {id:pid2, side:"plunder" as const, dmg:plunderAmt}]);
        setTimeout(()=>setDmgFloats(prev=>prev.filter(f=>f.id!==pid2)), 2000);
      }
      const result: TerritoryResult = {
        territory: currentTerritory, defender, playerFaction,
        rounds: newRounds, playerHpFinal: newPlayerHp, enemyHpFinal: newEnemyHp, won: playerWon,
      };
      setResults(prev => [...prev, result]);
      setSelectedMove(null);
      setPhase("territory_result");
    }
  };

  const nextTerritory = async () => {
    if (solo.session && !solo.session.abandoned) {
      if (busy) return; setBusy(true);
      try {
        const saved = await solo.act({ kind: "NEXT" }); applySolo(saved); await refresh();
        if (saved.state.phase === "final_result") await finishCampaign(saved.state.results, saved, true);
        else { sfx.roundStart(); resetLowHp(); }
      } catch (error) { setRunMessage((error as Error).message); }
      finally { setBusy(false); }
      return;
    }
    const next = currentTerritory + 1;
    const lastResult = results[results.length - 1];
    if (lastResult?.won) sfx.territoryWin(); else sfx.territoryLose();
    resetLowHp();
    if (next >= TERRITORY_COUNT) { void finishCampaign([...results]); }
    else { setCurrentT(next); setCurrentFI(prev => (prev+1) % TEAM_SIZE); startTerritory(); setPhase("battle"); if (next >= 3) sfx.startEpic(); }
  };

  const finishCampaign = async (allResults: TerritoryResult[], verified?: SoloView, share = false) => {
    setBusy(true);
    const territoriesWon = allResults.filter(r=>r.won).length;
    let rarity = calcRarity(territoriesWon);
    let pts = rarity==="ultra" ? Number(cfg?.rewards?.ultra??300) : rarity==="rare" ? Number(cfg?.rewards?.rare??100) : rarity==="common" ? Number(cfg?.rewards?.common??50) : 0;
    if (team.includes("shogun") && rarity==="ultra") pts = Math.floor(pts*1.15);
    // Strategic Retreat: guarantee at least Common reward if used
    if (strategicRetUsed && rarity==="none") { rarity="common"; pts=Number(cfg?.rewards?.common??50); }
    if (team.includes("buke") && rarity==="none") { const dc=allResults.reduce((sum,r)=>sum+(r.rounds?.filter(rnd=>rnd.playerMove.type==="defend").length||0),0); if(dc>=3){rarity="common";pts=Number(cfg?.rewards?.common??50);} }
    if (verified) { rarity = verified.state.rarity; pts = verified.state.reward; }
    setFinalRarity(rarity);
    if (!verified && pts>0) { const er:any=await earn(pts, "faction-wars").catch(()=>null); if(er?.ok)await refresh().catch(()=>{}); }

          // ── Roll crate prize (exact Shuffle pattern) ──────────────────────
          if (rarity !== "none") {
            try {
              const rollR = verified ? null : await fetch(`/api/prizes/roll?force=${rarity}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerId: String(effectivePlayerId||"guest"), rarity, game: "faction-wars", runId: runOf("faction-wars") })
              });
              const rollJ = verified ? await solo.reward() : await rollR!.json().catch(() => null);
              if ((verified || rollR!.ok) && rollJ?.ok && rollJ?.prize) {
                const p = rollJ.prize;
                setPrizeObj(p);
                setPrizeLabel(p.label || (rarity === "ultra" ? "🏆 ULTRA CRATE" : rarity === "rare" ? "⚔️ RARE CRATE" : "✅ COMMON CRATE"));
                setPrizeSub(p.type === "nft" ? "You won an NFT!" : p.type === "merch" ? "You won merch!" : `+${p.points || pts} REBEL`);
                setPrizeNeedShipping(false);
                setPrizeShipMsg("");

                // ── Merch: create claim immediately, capture shipping in modal (Shuffle pattern) ──
                if (String(p?.type||"").toLowerCase() === "merch") {
                  const prof2 = loadProfile();
                  const pid2 = String(effectivePlayerId||getEffectivePlayerId(prof2)||"guest").trim().slice(0,64)||"guest";
                  const claimId2 = verified ? `fwsolo-${verified.id}` : `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
                  const cr = verified ? null : await fetch("/api/prizes/claim", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ claimId: claimId2, playerId: pid2, prize: p, wallet: null, shipping: null, game: "faction-wars", rarity }),
                  });
                  const cj = verified ? await solo.claimPrize(null) : await cr!.json().catch(() => null);
                  if ((verified || cr!.ok) && cj?.ok) {
                    setPrizeClaimId(claimId2);
                    setPrizeNeedShipping(!!cj.needShipping);
                  } else {
                    setPrizeShipMsg(cj?.error || "Merch claim failed");
                  }
                }

                setPrizeMerchShipping(p.type === "merch");
                setShowPrizeModal(true);
                sfx.crateOpen();
                setTimeout(() => sfx.crateReward(), 1000);
              }
            } catch (error) { if (verified) setRunMessage((error as Error).message); }
          }
    const prof=loadProfile(); const pid=String(effectivePlayerId||getEffectivePlayerId(prof)||"guest").trim().slice(0,64)||"guest"; const pname=(prof?.discordName||playerName||prof?.name||"guest").trim()||"guest";
    if (verified) {
      try {
        const marker = `raap:solo-win:${verified.id}`;
        if (!localStorage.getItem(marker)) {
          // Mark before the local display update; reopening a saved prize must
          // not inflate the browser's wins total. The server result is separate.
          localStorage.setItem(marker, "recorded");
          addWin({ id: `fwsolo-${verified.id}`, ts: Date.now(), game: "faction-wars", playerId: pid,
            playerName: pname, rarity, pointsAwarded: pts });
        }
      } catch { /* Browser storage may be unavailable; the canonical game remains saved. */ }
      try { await solo.recordScore(pname); } catch (error) { setRunMessage((error as Error).message); }
    } else {
    addWin({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,ts:Date.now(),game:"faction-wars",playerId:pid,playerName:pname,rarity,pointsAwarded:pts});
    await fetch("/api/faction-wars/record",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:pid,playerName:pname,rarity,pointsAwarded:pts,territoriesWon,team,perfect:territoriesWon===5,runId:runOf("faction-wars")})}).catch(()=>{});
    }
    window.dispatchEvent(new Event("ra:leaderboards-refresh")); void loadLB();
    if (rarity==="ultra") sfx.ultra(); else if (rarity!=="none") sfx.win(); else sfx.lose();
    setPhase("final_result"); setBusy(false);
    if (verified && share) void solo.shareCompletion();
  };

 const resetGame = async () => {
   if (solo.session) {
     try { await solo.abandon(); } catch (error) { setRunMessage((error as Error).message); return; }
   }
   fightSeqRef.current += 1;
   fightInFlightRef.current = false;
   stopMusic(); sfx.startTheme(); setPhase("idle"); setTeam([]); setDefenders([]); setResults([]); setCurrentT(0); setCurrentFI(0); setSelectedMove(null); setFinalRarity("none"); setRunMessage(""); setBusy(false); setBattleAnim("idle"); setPlayer3DAnim("idle"); setEnemy3DAnim("idle");
if (typeof window !== "undefined") {
  (window as any).__fw3dPlayPlayer?.("idle");
  (window as any).__fw3dPlayEnemy?.("idle");
}
setPlayerHp(MAX_HP); setEnemyHp(MAX_HP); setCurrentRound(0); setRoundLog([]); setDmgFloats([]); setCurrentTerritoryRounds([]);
  };

  const currentPlayerFaction = phase==="battle" ? (team[currentFactionIdx]||team[0]) : null;
  const currentPlayerFD = currentPlayerFaction ? FACTIONS[currentPlayerFaction] : null;
  const currentDefenderFD = defenders[currentTerritory] ? FACTIONS[defenders[currentTerritory]] : null;
  const territoriesWon = results.filter(r=>r.won).length;
  const rc = { ultra:"#fbbf24", rare:"#60a5fa", common:"#34d399", none:"#f87171" };
  const rl = { ultra:"🏆 ULTRA — LEGENDARY VICTORY!", rare:"⚔️ RARE — STRONG CAMPAIGN!", common:"✅ COMMON — SOLDIERS HOLD!", none:"💀 DEFEAT — YOUR FORCES FELL" };

  return (
    <div style={{ minHeight:"100vh", color:"white", fontFamily:"'Segoe UI',sans-serif", backgroundImage:"url('/bg/faction-wars-bg.png')", backgroundSize:"cover", backgroundPosition:"center top", backgroundAttachment:"fixed", backgroundRepeat:"no-repeat", position:"relative" }}>
      <div style={{ position:"fixed", inset:0, background:"rgba(8,11,20,0.82)", zIndex:0, pointerEvents:"none" }} />
      <BuyPointsModal open={showBuyPoints} onClose={()=>setShowBuyPoints(false)} playerId={effectivePlayerId} onClaimed={()=>{setShowBuyPoints(false);void refresh();}} />
      {/* Crate Reveal Modal — exact Shuffle style */}
          {/* ── Crate Prize Modal — matches Shuffle exactly ─────────────────── */}
          {showPrizeModal && (() => {
            const rar = finalRarity as string;
            const crateTitle = rar==="ultra" ? "🏆 ULTRA CRATE!" : rar==="rare" ? "⚔️ Rare Crate!" : "✅ Crate Unlocked";
            const subLine = rar==="ultra" ? "5/5 territories — Legendary!" : rar==="rare" ? "3–4 territories — Strong campaign!" : "1–2 territories — Soldiers hold!";
            const sps = Array.from({length:24},(_,i)=>({ left:String(8+(i*4.1)%84)+'%', top:String(10+(i*7.3)%62)+'%', size:10+((i*3)%14), delay:(i*0.18)%3.2 }));
            const titleColor = rar==="ultra" ? "#fbbf24" : rar==="rare" ? "#60a5fa" : "#34d399";
            return (
              <>
                <style>{`.fw-prize-modal{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,0.6);z-index:2147483647;padding:16px}.fw-prize-card{position:relative;min-width:300px;max-width:420px;width:90vw;padding:20px 20px;border-radius:16px;text-align:center;background:rgba(10,18,40,0.97);border:2px solid rgba(148,163,184,0.2);box-shadow:0 24px 40px rgba(0,0,0,0.65);overflow:visible}.fw-sparkle-layer{position:absolute;inset:-8% -10%;pointer-events:none;z-index:0}.fw-pm-sparkle{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,0.95) 0%,rgba(255,255,255,0) 65%);filter:blur(0.3px) drop-shadow(0 0 12px rgba(255,255,255,0.65));opacity:0;animation:fwPmSpark 2.6s ease-in-out infinite}.fw-prize-art{display:block;width:130px;max-width:55vw;height:auto;margin:0 auto 12px;position:relative;z-index:1}.fw-prize-aura{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:220px;height:220px;border-radius:50%;pointer-events:none;z-index:0;filter:blur(45px)}.fw-prize-aura[data-rarity='ultra']{background:radial-gradient(circle,rgba(251,191,36,0.5),transparent 70%)}.fw-prize-aura[data-rarity='rare']{background:radial-gradient(circle,rgba(96,165,250,0.45),transparent 70%)}.fw-prize-aura[data-rarity='common']{background:radial-gradient(circle,rgba(52,211,153,0.4),transparent 70%)}@keyframes fwPmSpark{0%{transform:scale(0.4);opacity:0}20%{opacity:1}55%{transform:scale(1.1);opacity:0.9}85%{transform:scale(0.7);opacity:0.7}100%{transform:scale(0.3);opacity:0}}`}</style>
                <div className="fw-prize-modal">
                  <div className="fw-prize-card">
                    <div className="fw-sparkle-layer">{sps.map((sp,i)=>(<span key={i} className={"fw-pm-sparkle "+rar} style={{left:sp.left,top:sp.top,width:sp.size+"px",height:sp.size+"px",animationDelay:sp.delay+"s"}} />))}</div>
                    <div className="fw-prize-aura" data-rarity={rar} />
                    <div style={{position:"relative",fontSize:20,fontWeight:900,color:titleColor,margin:"0 0 4px",zIndex:1}}>{crateTitle}</div>
                    <div style={{position:"relative",fontSize:12,opacity:0.55,marginBottom:12,zIndex:1}}>{subLine}</div>
                    <img className="fw-prize-art" src={"/crates/"+rar+".png"} alt={rar+" crate"} />
                    <div style={{position:"relative",zIndex:1,fontSize:15,fontWeight:700,marginBottom:4}}>
                      You won: <b style={{color:titleColor}}>{prizeSub}</b>
                    </div>

                    {/* ── NFT: wallet input (exact Shuffle pattern) ── */}
                    {rar === "ultra" && prizeObj?.type === "nft" && !loadProfile()?.walletAddress ? (
                      <div style={{marginTop:10,textAlign:"left",position:"relative",zIndex:1}}>
                        <div style={{fontSize:12,opacity:0.75,marginBottom:10}}>✅ Enter the wallet you want this NFT sent to (we'll remember it for next time).</div>
                        <input
                          defaultValue={loadProfile()?.walletAddress || ""}
                          onChange={(e) => { const next=String(e.target.value||"").trim(); const p=loadProfile(); saveProfile({...p,walletAddress:next}); }}
                          placeholder="0x… wallet address"
                          style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1px solid rgba(255,255,255,.18)",background:"rgba(0,0,0,.25)",color:"white"}}
                        />
                        <div style={{fontSize:11,opacity:0.5,marginTop:8}}>After you continue, your claim will show up in Admin → Claims.</div>
                      </div>
                    ) : rar === "ultra" && prizeObj?.type === "nft" && loadProfile()?.walletAddress ? (
                      <div style={{marginTop:10,fontSize:12,opacity:0.7,position:"relative",zIndex:1}}>
                        ✅ NFT will be sent to: <b style={{color:titleColor}}>{loadProfile()?.walletAddress}</b>
                        <div style={{fontSize:11,opacity:0.5,marginTop:4}}>After you continue, your claim will show up in Admin → Claims.</div>
                      </div>
                    ) : null}

                    {/* ── Merch: shipping form (exact Shuffle pattern) ── */}
                    {prizeNeedShipping && prizeClaimId && (
                      <div style={{marginTop:10,textAlign:"left",position:"relative",zIndex:1}}>
                        <div style={{fontSize:12,opacity:0.75,marginBottom:10}}>✅ This merch prize needs shipping info to fulfill.</div>
                        <div style={{display:"grid",gap:8}}>
                          {["name","email","phone","address1","address2","city","state","zip","country"].map(field => (
                            <input key={field} value={(prizeShipForm as any)[field]||""} onChange={e=>setPrizeShipForm(f=>({...f,[field]:e.target.value}))} placeholder={field==="address1"?"Address Line 1":field==="address2"?"Address Line 2 (optional)":field.charAt(0).toUpperCase()+field.slice(1)} style={{padding:"10px 12px",borderRadius:10,border:"1px solid rgba(255,255,255,.18)",background:"rgba(0,0,0,.25)",color:"white"}} />
                          ))}
                        </div>
                        {prizeShipMsg && <div style={{marginTop:8,fontSize:12,color:prizeShipMsg.includes("✅")?"#22c55e":"#f87171"}}>{prizeShipMsg}</div>}
                      </div>
                    )}
                    {prizeMerchShipping && !prizeNeedShipping && prizeClaimId && (
                      <div style={{position:"relative",zIndex:1,marginTop:10,fontSize:12,opacity:0.75,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:"10px 12px"}}>
                        🎁 Merch won! Claim ID: <b style={{fontFamily:"monospace"}}>{prizeClaimId}</b>. Your shipping info will be requested by support.
                      </div>
                    )}

                    {prizeShipMsg && !prizeNeedShipping && <div style={{position:"relative",zIndex:1,marginTop:8,fontSize:12,color:"#f87171"}}>{prizeShipMsg}</div>}

                    <button
                      disabled={prizeShipBusy}
                      onClick={async () => {
                        const prof3 = loadProfile();
                        const pid3 = String(effectivePlayerId||getEffectivePlayerId(prof3)||"guest").trim().slice(0,64)||"guest";
                        // ── NFT: create claim with wallet ──
                        if (prizeObj?.type === "nft") {
                          const wallet3 = prof3?.walletAddress || "";
                          if (!wallet3) { alert("Please enter a wallet address first."); return; }
                          try {
                            const connectedPrize = solo.session?.state.phase === "final_result";
                            const cr = connectedPrize ? null : await fetch("/api/claims/create", {
                              method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ playerId: pid3, wallet: wallet3, prize: prizeObj, game: "faction-wars", rarity: finalRarity }),
                            });
                            const cj = connectedPrize ? await solo.claimPrize(wallet3) : await cr!.json().catch(() => null);
                            if ((!connectedPrize && !cr!.ok) || !cj?.ok) { alert("Claim failed. Please try again."); return; }
                          } catch { alert("Claim failed. Please try again."); return; }
                        }
                        // ── Merch: submit shipping if needed ──
                        if (prizeNeedShipping && prizeClaimId) {
                          setPrizeShipBusy(true);
                          try {
                            const sr = await fetch("/api/prizes/shipping", {
                              method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ claimId: prizeClaimId, playerId: pid3, shipping: prizeShipForm }),
                            });
                            const sj = await sr.json().catch(() => null);
                            if (!sr.ok || !sj?.ok) { setPrizeShipMsg(sj?.error || "Shipping save failed"); setPrizeShipBusy(false); return; }
                            setPrizeShipMsg("✅ Shipping saved!");
                          } catch { setPrizeShipMsg("Shipping save failed"); setPrizeShipBusy(false); return; }
                          setPrizeShipBusy(false);
                        }
                        // Reset and close
                        setShowPrizeModal(false);
                        setPrizeObj(null); setPrizeNeedShipping(false); setPrizeShipMsg(""); setPrizeClaimId(undefined); setPrizeMerchShipping(false);
                        setPrizeShipForm({ name:"",email:"",phone:"",address1:"",address2:"",city:"",state:"",zip:"",country:"" });
                      }}
                      style={{position:"relative",zIndex:1,marginTop:16,padding:"12px 40px",borderRadius:12,border:"none",cursor:prizeShipBusy?"default":"pointer",background:rar==="ultra"?"linear-gradient(135deg,#fbbf24,#f59e0b)":rar==="rare"?"linear-gradient(135deg,#60a5fa,#3b82f6)":"linear-gradient(135deg,#34d399,#059669)",color:"#000",fontWeight:900,fontSize:15,opacity:prizeShipBusy?0.6:1}}>
                      {prizeShipBusy ? "Saving…" : rar==="ultra" ? "⚔️ Legendary!" : "Continue"}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}

      {solo.enabled && solo.session && <div style={{ position: "relative", zIndex: 2, maxWidth: 900, margin: "0 auto", padding: 16,
        background: "rgba(0,0,0,0.65)", borderBottom: "1px solid rgba(52,211,153,0.3)" }}>
        <p role="status">{campaignBalanceMessage || solo.message}</p>
        <p>Solo campaign reference: <strong>{solo.session.id}</strong></p>
        {!!solo.session.raapActionCount && <p>This campaign includes approved Rebel actions. Share its completed result with your Rebel’s history. Your game prize stays unchanged; sharing adds no RAAP XP or badge.</p>}
        <button type="button" style={{ padding: "8px 12px", border: "1px solid #64748b", borderRadius: 8, margin: "8px 8px 0 0" }} disabled={solo.busy || busy || checkingSavedCampaign} onClick={() => void checkSavedCampaign()}>{checkingSavedCampaign ? "Checking saved campaign…" : "Check saved campaign"}</button>
        {solo.session.state.phase === "final_result" && !solo.session.held && <>
          <button type="button" style={{ padding: "8px 12px", border: "1px solid #64748b", borderRadius: 8, margin: "8px 8px 0 0" }} disabled={solo.busy || busy} onClick={() => void finishCampaign(solo.session!.state.results, solo.session!)}>Open saved reward</button>
          <button type="button" style={{ padding: "8px 12px", border: "1px solid #34d399", borderRadius: 8, marginTop: 8 }} disabled={solo.busy || busy} onClick={() => void solo.shareCompletion()}>Share saved completion</button>
        </>}
      </div>}

      {/* Official Rules Modal */}
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

      {/* ── HEADER (cleaned up Shuffle-style) ── */}
      <header style={{ position:'relative', zIndex:20, maxWidth:980, margin:'0 auto', padding:'16px 20px 0', display:'flex', alignItems:'center', justifyContent:'space-between', fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif" }}>
        <Link href="/" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none', color:'white' }}>
          <span style={{ fontSize:20, filter:'drop-shadow(0 0 8px rgba(251,191,36,0.6))' }}>←</span>
          <span style={{ fontSize:11, fontWeight:900, letterSpacing:'0.2em', textTransform:'uppercase', color:'rgba(255,255,255,0.5)' }}>REBEL ANTS</span>
        </Link>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:13, fontWeight:900, letterSpacing:'0.1em', color:'#fbbf24', filter:'drop-shadow(0 0 8px rgba(251,191,36,0.5))' }}>
            ⚡ {balance} <span style={{ fontSize:10, color:'rgba(251,191,36,0.6)' }}>{currency}</span>
          </div>
          <button onPointerDown={e=>{e.preventDefault();toggleMute();}} title={muted?"Unmute":"Mute"}
            style={{ background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:20, padding:'6px 12px', cursor:'pointer', fontSize:15, color:'rgba(255,255,255,0.8)', minWidth:40 }}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"16px 12px", overflowX:"hidden", width:"100%", position:"relative", zIndex:1 }}>
        {phase === "idle" && (
          <div>
              {/* Title (Shuffle-style centered gradient) */}
              <div style={{ textAlign:'center', marginBottom:18, marginTop:14 }}>
                <div style={{ fontSize:'clamp(22px,4vw,38px)', fontWeight:900, letterSpacing:'0.15em', textTransform:'uppercase',
                  background:'linear-gradient(135deg,#fbbf24,#f87171,#c084fc)',
                  WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
                  filter:'drop-shadow(0 0 20px rgba(251,191,36,0.4))',
                }}>⚔️ FACTION WARS</div>
                <div style={{ fontSize:12, letterSpacing:'0.25em', color:'rgba(255,255,255,0.35)', textTransform:'uppercase', marginTop:4 }}>
                  ASSEMBLE 5 · CONQUER 5 · KNOW YOUR FACTIONS
                </div>
              </div>

              {/* Primary action row */}
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', justifyContent:'center', marginBottom:14 }}>
                {solo.enabled && <div style={{ flexBasis: "100%", maxWidth: 600, padding: 16, border: "1px solid rgba(52,211,153,0.35)", background: "rgba(0,0,0,0.5)", borderRadius: 12, marginBottom: 4, textAlign: "left" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 700 }}>
                    <input type="checkbox" checked={solo.sharing} disabled={!solo.connected || !!solo.session || solo.busy}
                      onChange={event => solo.setSharing(event.target.checked)} />
                    Share this solo campaign with my connected Rebel
                  </label>
                  <p role="status" style={{ fontSize: 12, color: "#cbd5e1", margin: "8px 0", lineHeight: 1.5 }}>{campaignBalanceMessage || solo.message}</p>
                  <button type="button" style={{ padding: "7px 12px", border: "1px solid #64748b", borderRadius: 8, fontSize: 12 }} disabled={solo.busy || busy || checkingSavedCampaign} onClick={() => void checkSavedCampaign()}>{checkingSavedCampaign ? "Checking saved campaign…" : "Check saved campaign"}</button>
                </div>}
                <button onClick={startCampaign} disabled={team.length<TEAM_SIZE||busy||balance<fwCost||solo.requiresSavedCheck||solo.sharing&&(solo.busy||solo.uncertain)}
                  style={{ minWidth:280, height:48, padding:'0 28px', fontSize:13, fontWeight:900, letterSpacing:'0.1em', textTransform:'uppercase',
                    display:'inline-flex', alignItems:'center', justifyContent:'center', borderRadius:24, border:'1px solid rgba(251,191,36,0.4)',
                    background:team.length<TEAM_SIZE||busy||balance<fwCost?'rgba(255,255,255,0.05)':'linear-gradient(135deg,rgba(251,191,36,0.25),rgba(248,113,113,0.25))',
                    color:team.length<TEAM_SIZE||busy||balance<fwCost?'rgba(255,255,255,0.4)':'#fbbf24',
                    cursor:team.length<TEAM_SIZE||busy||balance<fwCost?'not-allowed':'pointer',
                    filter:team.length<TEAM_SIZE||busy||balance<fwCost?'none':'drop-shadow(0 0 12px rgba(251,191,36,0.3))' }}>
                  {team.length<TEAM_SIZE?`Select ${TEAM_SIZE-team.length} more`:busy?"Assembling…":`⚔️ Launch Campaign (${team.includes("ashigaru") ? Math.max(0, fwCost-25) : fwCost} ${currency})`}
                </button>
                <button onClick={()=>setShowBuyPoints(true)}
                  style={{ padding:'10px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.1em', textTransform:'uppercase', borderRadius:20, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(0,0,0,0.4)', color:'rgba(255,255,255,0.8)', cursor:'pointer' }}>
                  💎 Buy Points
                </button>
                {isDiscordConnected ? (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderRadius:20, border:'1px solid rgba(88,101,242,0.3)', background:'rgba(88,101,242,0.08)', fontSize:11, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase' }}>
                    <span style={{ color:'#a5b4fc' }}>✓ Discord</span>
                    <button onClick={disconnectDiscord} style={{ background:'none', border:'none', fontSize:10, color:'rgba(255,255,255,0.4)', cursor:'pointer', padding:0, textDecoration:'underline' }}>disconnect</button>
                  </div>
                ) : (
                  <button onClick={()=>{ try{saveProfile({discordSkipLink:false});window.dispatchEvent(new Event("ra:identity-changed"));}catch{} window.location.href="/api/auth/discord/login"; }}
                    style={{ padding:'10px 16px', fontSize:11, fontWeight:900, letterSpacing:'0.1em', textTransform:'uppercase', borderRadius:20, border:'1px solid rgba(88,101,242,0.4)', background:'rgba(88,101,242,0.12)', color:'#a5b4fc', cursor:'pointer' }}>
                    Connect Discord
                  </button>
                )}
                <Link href="/faction-wars/pvp" style={{ padding: '10px 16px', fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 20, border: '1px solid rgba(192,132,252,0.4)', background: 'rgba(192,132,252,0.08)', color: '#c084fc', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  ⚔️ Challenge a Friend
                </Link>
              </div>

              {/* Stats row (Shuffle-style) */}
              <div style={{ display:'flex', gap:14, flexWrap:'wrap', justifyContent:'center', alignItems:'center', padding:'10px 14px', borderRadius:14, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.02)', fontSize:11, fontFamily:"'Noto Serif JP', 'Hiragino Mincho ProN', serif", letterSpacing:'0.05em', marginBottom:12 }}>
                <span style={{ color:'rgba(255,255,255,0.5)', textTransform:'uppercase' }}>Cost: <b style={{color:'#fbbf24'}}>{fwCost}</b> {currency}</span>
                <span style={{ color:'rgba(255,255,255,0.4)', textTransform:'uppercase' }}>Common <b style={{color:'#86efac'}}>+{cfg?.rewards?.common}</b></span>
                <span style={{ color:'rgba(255,255,255,0.4)', textTransform:'uppercase' }}>Rare <b style={{color:'#93c5fd'}}>+{cfg?.rewards?.rare}</b></span>
                <span style={{ color:'rgba(255,255,255,0.4)', textTransform:'uppercase' }}>Ultra <b style={{color:'#fbbf24'}}>+{cfg?.rewards?.ultra}</b></span>
                <span style={{ color:'rgba(255,255,255,0.3)', textTransform:'uppercase', borderLeft:'1px solid rgba(255,255,255,0.1)', paddingLeft:14 }}>Daily Cap <b style={{color:'rgba(255,255,255,0.6)'}}>{cfg?.dailyEarnCap}</b></span>
                <button onClick={claimDailyNow} disabled={claimBusy||dailyClaimed}
                  style={{ padding:'5px 12px', fontSize:10, fontWeight:900, letterSpacing:'0.1em', textTransform:'uppercase', borderRadius:14, border:'1px solid rgba(251,191,36,0.3)', background:dailyClaimed?'rgba(255,255,255,0.04)':'rgba(251,191,36,0.12)', color:dailyClaimed?'rgba(255,255,255,0.4)':'#fbbf24', cursor:claimBusy||dailyClaimed?'not-allowed':'pointer' }}>
                  {dailyClaimed ? (countdownStr ? `⏱ ${countdownStr}` : "✓ Claimed") : `Claim +${cfg?.dailyClaim}`}
                </button>
                {process.env.NODE_ENV!=="production" && (
                  <button onClick={async()=>{ await devGrant(5000); await refresh(); alert("Dev grant ✅"); }}
                    style={{ padding:'5px 10px', fontSize:10, borderRadius:14, border:'1px dashed rgba(255,255,255,0.2)', background:'transparent', color:'rgba(255,255,255,0.5)', cursor:'pointer' }}>
                    +5k (dev)
                  </button>
                )}
                {claimStatus && <span style={{ fontSize:10, opacity:0.7 }}>{claimStatus}</span>}
              </div>

              {/* Commander name (compact, optional reveal) */}
              <details style={{ marginBottom:14 }}>
                <summary style={{ fontSize:10, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(255,255,255,0.35)', cursor:'pointer', padding:'4px 0' }}>
                  Commander: <b style={{color:'rgba(255,255,255,0.7)'}}>{profile?.discordName || playerName}</b>
                </summary>
                <div style={{ marginTop:8, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', padding:'10px 14px', borderRadius:10, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
                  <label style={{ fontSize:11, opacity:0.85 }}>
                    Name:&nbsp;
                    <input value={playerName}
                      onChange={e=>{ const v=(e.target.value.slice(0,18)||"guest").trim()||"guest"; setPlayerName(v); const p=loadProfile(); saveProfile({name:v,id:(p?.id||playerId||`p_${Date.now().toString(36)}`)}); window.dispatchEvent(new Event("ra:identity-changed")); }}
                      style={{ padding:'5px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,.18)', background:'rgba(15,23,42,.55)', color:'inherit', fontSize:11 }}
                    />
                  </label>
                  <span style={{ fontSize:10, opacity:0.5 }}>ID: {profile?.discordName || playerName}</span>
                </div>
              </details>

              {runMessage && <div style={{ color:"#f87171", fontSize:13, marginTop:10 }}>{runMessage}</div>}

              {/* Team builder */}
              <div style={{ marginTop:20, paddingTop:16, borderTop:"1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize:14, fontWeight:800, marginBottom:12, color:"#fbbf24" }}>⚔️ Assemble Your Team ({team.length}/{TEAM_SIZE})</div>
                <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
                  {Array.from({length:TEAM_SIZE},(_,i)=>{const fid=team[i];const f=fid?FACTIONS[fid]:null;return(
                    <div key={i} title={f?"Click to remove "+f.name:undefined} onClick={()=>f&&setTeam(prev=>prev.filter((_,j)=>j!==i))} style={{ width:62, height:78, borderRadius:10, background:f?f.bgColor:"rgba(255,255,255,0.03)", border:`2px solid ${f?f.borderColor:"rgba(255,255,255,0.1)"}`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", opacity:f?1:0.3, cursor:f?"pointer":"default", transition:"all 0.2s", overflow:"hidden", position:"relative", boxShadow:f?`0 0 14px ${f.color}44`:undefined }}>
                      {f ? (
                        <>
                          <img src={factionImgPath(f.id,"char")} alt={f.name} style={{ width:"100%", height:55, objectFit:"cover", objectPosition:"top" }} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
                          <div style={{fontSize:7,color:f.color,fontWeight:900,padding:"2px 0",letterSpacing:"0.05em"}}>{f.name.toUpperCase()}</div>
                        </>
                      ) : <div style={{fontSize:20,opacity:0.4}}>＋</div>}
                    </div>
                  );})}
                  {team.length>0&&<span style={{fontSize:11,opacity:0.5,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTeam([])}>clear</span>}
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))", gap:8, marginBottom:16 }}>
                  {FACTION_IDS.map(fid=>(<FactionCard key={fid} faction={FACTIONS[fid]} selected={team.includes(fid)} onSelect={()=>toggleFaction(fid)} disabled={false} />))}
                </div>
                {team.length>0&&(
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    {team.map((fid,i)=>{const f=FACTIONS[fid];return(
                      <div key={i} style={{ background:f.bgColor, border:`1px solid ${f.borderColor}`, borderRadius:10, padding:"10px 12px", fontSize:11, minWidth:150, display:"flex", gap:10, alignItems:"flex-start" }}>
                        <img src={factionImgPath(f.id,"symbol")} alt={f.name} style={{ width:36, height:36, objectFit:"contain", borderRadius:6, background:"rgba(0,0,0,0.4)", padding:3, flexShrink:0 }} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontWeight:900, color:f.color, marginBottom:3, fontSize:12 }}>{f.name}</div>
                          <div style={{ opacity:0.75, marginBottom:2 }}>⚡ {f.passive}</div>
                          <div style={{ opacity:0.55, fontSize:10 }}>{f.id === "ashigaru" ? `Campaign costs 25 ${currency} less (${Math.max(0, fwCost - 25)} instead of ${fwCost}).` : f.passiveDesc}</div>
                        </div>
                      </div>
                    );})}
                  </div>
                )}
              </div>
        <div style={{ marginBottom:8 }}>
          <button onClick={()=>setShowRules(true)} style={{ fontSize:12, textDecoration:"underline", opacity:0.55, background:"none", border:"none", color:"inherit", cursor:"pointer", padding:0 }}>Official Rules</button>
        </div>
            <FWLeaderboardPanel lb={lb} />
          </div>
        )}

        {phase === "battle" && currentPlayerFD && currentDefenderFD && (
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
            <div ref={stageRef} style={{ position:"relative", borderRadius:18, overflow:"hidden", marginBottom:16, border:"1px solid rgba(255,255,255,0.1)", scrollMarginTop:8 }}>

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

              <div style={{ position:"relative", zIndex:1, padding:"12px 12px 14px" }}>

                {/* Characters — shared 3D arena (presentation only; see components/FactionWarsArena.tsx) */}
                <FactionWarsArena
                  player={{ id: currentPlayerFD.id, name: currentPlayerFD.name, color: currentPlayerFD.color, borderColor: currentPlayerFD.borderColor, anim: player3DAnim, hp: playerHp, label: `Warrior ${currentFactionIdx+1}/${TEAM_SIZE}`, symbolSrc: factionImgPath(currentPlayerFD.id,"symbol") }}
                  enemy={{ id: currentDefenderFD.id, name: currentDefenderFD.name, color: currentDefenderFD.color, borderColor: currentDefenderFD.borderColor, anim: enemy3DAnim, hp: enemyHp, label: "Territory Defender", symbolSrc: factionImgPath(currentDefenderFD.id,"symbol") }}
                  battleAnim={battleAnim}
                  preload={[...team, ...defenders]}
                  title={`TERRITORY ${currentTerritory+1} · ${currentDefenderFD.name.toUpperCase()}\u2019S HOLD`}
                  finisherChoice
                  sfx={sfx}
                  height="clamp(220px, min(44vw, calc(100vh - 360px)), 420px)"
                />

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

                {/* Move selector */}
                <div style={{ borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:10, marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:800, marginBottom:7, opacity:0.7, letterSpacing:"0.04em" }}>
                    ⚔️ CHOOSE {currentPlayerFD.name.toUpperCase()}'S MOVE
                  </div>
                  <div className="fw-move-grid" style={{ display:"grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap:6 }}>
                  {currentPlayerFD.moves.map(m=>{
                    const tc: Record<string,string> = { attack:"#f87171", defend:"#34d399", magic:"#c084fc", trick:"#fbbf24" };
                    const isSel = selectedMove?.id===m.id;
                    const timesUsedM = usedMoves[m.id] || 0;
                    const degradedPow = Math.max(1, m.power - timesUsedM);
                    const isExhausted = (m.oneTime && oneTimeUsed.includes(m.id)) || (berserkerActive && m.type === "defend");
                    return (
                      <button key={m.id} title={m.id === "plunder" ? `+${fwPlunderBonus} REBEL if win` : m.desc} onClick={()=>!busy&&!isExhausted&&setSelectedMove(m)} disabled={busy||isExhausted}
                        style={{ display:"flex", flexDirection:"column", gap:3, padding:"8px 9px", borderRadius:10, textAlign:"left",
                          border:`2px solid ${isExhausted?"rgba(255,255,255,0.04)":isSel ? currentPlayerFD.borderColor : "rgba(255,255,255,0.08)"}`,
                          background: isExhausted ? "rgba(0,0,0,0.2)" : isSel ? currentPlayerFD.bgColor : "rgba(255,255,255,0.03)",
                          cursor: busy||isExhausted?"not-allowed":"pointer", opacity: isExhausted ? 0.4 : 1,
                          boxShadow: isSel ? `0 0 16px ${currentPlayerFD.color}44` : "none",
                          transform: isSel ? "scale(1.01)" : "scale(1)", transition:"all 0.18s" }}>
                        {/* Row 1: emoji + name · Row 2: type + power */}
                        <div style={{ display:"flex", alignItems:"center", gap:5, minWidth:0 }}>
                          <span style={{ fontSize:15, flexShrink:0 }}>{m.emoji}</span>
                          <span style={{ fontWeight:900, fontSize:11, lineHeight:1.15, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", flex:1, minWidth:0 }}>{m.label}</span>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:5, minWidth:0 }}>
                          <span style={{ fontSize:8, background:tc[m.type], color:"#000", borderRadius:3, padding:"1px 4px", fontWeight:900, flexShrink:0 }}>{m.type.toUpperCase()}</span>
                          <span style={{ flex:1 }} />
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
                      </button>
                    );
                  })}
                  </div>

                  <div style={{ fontSize:10, opacity:0.6, margin:"7px 2px 0", minHeight:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {selectedMove ? <><b style={{ opacity:0.9 }}>{selectedMove.label}:</b> {selectedMove.id === "plunder" ? `+${fwPlunderBonus} REBEL if win` : selectedMove.desc}</> : "Pick a move, then strike. The fight plays out above."}
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:8, alignItems:"stretch", flexWrap:"wrap" }}>
                  <button onClick={fightTerritory} disabled={!selectedMove||busy||!!solo.session&&(solo.busy||solo.uncertain)}
                    style={{ flex:"1 1 220px", minWidth:0, padding:"12px 18px", borderRadius:12, border:"none",
                      cursor:!selectedMove||busy?"not-allowed":"pointer",
                      background:selectedMove?"linear-gradient(135deg,#fbbf24,#f59e0b)":"rgba(255,255,255,0.06)",
                      color:selectedMove?"#000":"white", fontWeight:900, fontSize:15,
                      opacity:!selectedMove?0.45:1, transition:"all 0.2s",
                      boxShadow:selectedMove?"0 4px 24px rgba(251,191,36,0.4)":"none",
                      transform:selectedMove?"translateY(-1px)":"none" }}>
                    {busy?"⚔️ Fighting...":selectedMove?`⚔️ Strike with ${selectedMove.label}!`:"← Select a move above"}
                  </button>
                {/* Healing Potion button */}
                {(() => {
                  const healCost = Number(cfg?.factionWarsHealCost ?? 25);
                  const healAmt  = Number(cfg?.factionWarsHealAmt  ?? 30);
                  return (
                    <div style={{ display:"flex", flex:"0 1 auto", marginLeft:"auto" }}>
                      <button
                        onClick={async()=>{
                          const maxHeals = Number(cfg?.factionWarsHealMax??2);
                          if (healBusy||busy||playerHp>=MAX_HP||healUsed>=maxHeals) return;
                          if (balance < healCost) return;
                          setHealBusy(true);
                          try {
                            if (solo.session && !solo.session.abandoned) applySolo(await solo.act({ kind: "HEAL" }, healCost));
                            else { await spend(healCost,"faction-wars-heal"); const newHp=Math.min(MAX_HP,playerHp+healAmt); setPlayerHp(newHp); setHealUsed(n=>n+1); }
                            await refresh();
                          } catch (error) { setRunMessage((error as Error).message); }
                          setHealBusy(false);
                        }}
                        disabled={healBusy||busy||!!solo.session&&(solo.busy||solo.uncertain)||playerHp>=MAX_HP||balance<Number(cfg?.factionWarsHealCost??25)||healUsed>=Number(cfg?.factionWarsHealMax??2)}
                        title={`Spend ${healCost} REBEL to restore ${healAmt} HP`}
                        style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 12px", height:"100%", borderRadius:12, border:"1px solid rgba(52,211,153,0.3)", background:"rgba(52,211,153,0.1)", color:"#34d399", fontSize:11, fontWeight:800, cursor:healBusy||busy||playerHp>=MAX_HP||balance<Number(cfg?.factionWarsHealCost??25)?"not-allowed":"pointer", opacity:healBusy||busy||playerHp>=MAX_HP||balance<Number(cfg?.factionWarsHealCost??25)?0.4:1 }}>
                        🧪 Heal +{healAmt} HP
                        <span style={{opacity:0.6,fontSize:10}}>(-{healCost} {currency})</span>
                        <span style={{opacity:0.5,fontSize:9,marginLeft:4}}>({Math.max(0,Number(cfg?.factionWarsHealMax??2)-healUsed)} left)</span>
                      </button>
                    </div>
                  );
                })()}

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

              </div>
            </div>
          </div>
        )}

        {phase === "territory_result" && results.length > 0 && (() => {
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
              <button onClick={nextTerritory} disabled={busy || !!solo.session && (solo.busy || solo.uncertain)}
                style={{ padding:"12px 28px", borderRadius:12, border:"none", cursor:"pointer", background:currentTerritory+1<TERRITORY_COUNT?"linear-gradient(135deg,#fbbf24,#f59e0b)":"linear-gradient(135deg,#34d399,#059669)", color:"#000", fontWeight:900, fontSize:15 }}>
                {currentTerritory+1<TERRITORY_COUNT?`⚔️ Next Territory (${currentTerritory+2}/${TERRITORY_COUNT})`:"🏁 See Final Results"}
              </button>
            </div>
          );
        })()}

        {phase === "final_result" && (
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
            <FWLeaderboardPanel lb={lb} />
          </div>
        )}
      {/* Copyright */}
      <div style={{ textAlign:"center", padding:"10px 0 6px", fontSize:10, opacity:0.28, color:"white", letterSpacing:"0.05em", userSelect:"none", pointerEvents:"none" }}>
        © 2026 Rebel Ants LLC · Developed by Miguel Concepcion
      </div>
      </div>
    </div>
  );
}
