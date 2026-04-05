// components/FactionWars.tsx — FACTION WARS
import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { pointsConfig as defaultPointsConfig } from "../lib/pointsConfig";
import { usePoints } from "../lib/usePoints";
import { loadProfile, saveProfile, getEffectivePlayerId } from "../lib/profile";
import { addWin } from "../lib/winsStore";
import BuyPointsModal from "./BuyPointsModal";

function useFWAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:fw:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted);
  mutedRef.current = muted;
  const musicRef = React.useRef<HTMLAudioElement | null>(null);
  const play = React.useCallback((src: string, vol = 1) => {
    if (typeof window === "undefined") return;
    try { const a = new Audio(src); a.volume = vol; void a.play().catch(() => {}); } catch {}
  }, []);
  const startMusic = React.useCallback(() => {
    if (typeof window === "undefined") return;
    if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
    try {
      const a = new Audio("/audio/fw-battle.mp3");
      a.loop = true; a.volume = mutedRef.current ? 0 : 0.35;
      void a.play().catch(() => {}); musicRef.current = a;
    } catch {}
  }, []);
  const stopMusic = React.useCallback(() => {
    if (musicRef.current) { musicRef.current.pause(); musicRef.current.currentTime = 0; musicRef.current = null; }
  }, []);
  const toggleMute = React.useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { localStorage.setItem("ra:fw:muted", next ? "1" : "0"); } catch {}
      if (musicRef.current) musicRef.current.volume = next ? 0 : 0.35;
      return next;
    });
  }, []);
  const sfx = React.useMemo(() => ({
    win:   () => { if (!mutedRef.current) { stopMusic(); play("/audio/fw-win.mp3",   0.9); } },
    lose:  () => { if (!mutedRef.current) { stopMusic(); play("/audio/fw-lose.mp3",  0.7); } },
    clash: () => { if (!mutedRef.current) play("/audio/fw-clash.mp3", 0.6); },
    ultra: () => { if (!mutedRef.current) { stopMusic(); play("/audio/fw-ultra.mp3", 1.0); } },
  }), [play, stopMusic]);
  return { muted, toggleMute, startMusic, stopMusic, sfx };
}

type Phase = "idle" | "battle" | "territory_result" | "final_result";
type Rarity = "none" | "common" | "rare" | "ultra";
type FactionId = "samurai"|"ronin"|"warrior"|"ashigaru"|"shogun"|"buke"|"kenshi"|"wokou"|"sohei"|"yamabushi"|"bushi";

interface Move { id: string; label: string; emoji: string; desc: string; power: number; type: "attack"|"defend"|"magic"|"trick"; }
interface Faction { id: FactionId; name: string; emoji: string; color: string; bgColor: string; borderColor: string; role: string; passive: string; passiveDesc: string; weapon: string; moves: Move[]; weakTo: FactionId[]; strongVs: FactionId[]; }
interface TerritoryResult { territory: number; defender: FactionId; playerFaction: FactionId; playerMove: Move; enemyMove: Move; playerPower: number; enemyPower: number; won: boolean; }
type FWLeaderboards = { warlords: {playerId:string;playerName?:string;score:number}[]; factions:{faction:FactionId;wins:number}[]; streaks:{playerId:string;playerName?:string;score:number}[]; rich:{playerId:string;playerName?:string;score:number}[]; perfect:{playerId:string;playerName?:string;score:number}[]; };

const FACTIONS: Record<FactionId, Faction> = {
  samurai: { id:"samurai", name:"Samurai", emoji:"🔴", color:"#dc2626", bgColor:"rgba(220,38,38,0.12)", borderColor:"rgba(220,38,38,0.4)", role:"Core soldiers", passive:"First Strike", passiveDesc:"+20% power on Territory 1", weapon:"Katana",
    moves:[{id:"katana_strike",label:"Katana Strike",emoji:"⚔️",desc:"Precise high-damage slash",power:8,type:"attack"},{id:"honor_guard",label:"Honor Guard",emoji:"🛡️",desc:"Nullifies enemy tricks",power:6,type:"defend"},{id:"battle_cry",label:"Battle Cry",emoji:"📯",desc:"Boosts team power this territory",power:5,type:"magic"}],
    weakTo:["ronin","yamabushi"], strongVs:["ashigaru","buke"] },
  ronin: { id:"ronin", name:"Ronin", emoji:"⚫", color:"#9f1239", bgColor:"rgba(159,18,57,0.12)", borderColor:"rgba(159,18,57,0.45)", role:"Elite assassins", passive:"Comeback", passiveDesc:"+25% power after losing a territory", weapon:"Twin Daggers",
    moves:[{id:"twin_daggers",label:"Twin Daggers",emoji:"🗡️",desc:"Double hit lower power",power:7,type:"attack"},{id:"shadow_step",label:"Shadow Step",emoji:"👤",desc:"Dodge — enemy misses",power:6,type:"trick"},{id:"last_stand",label:"Last Stand",emoji:"💀",desc:"Massive spike if losing",power:9,type:"magic"}],
    weakTo:["shogun","bushi"], strongVs:["samurai","warrior"] },
  warrior: { id:"warrior", name:"Warrior", emoji:"🟤", color:"#b45309", bgColor:"rgba(180,83,9,0.12)", borderColor:"rgba(180,83,9,0.4)", role:"Battle veterans", passive:"Relentless", passiveDesc:"Strike mode deals +30% damage", weapon:"Greatsword",
    moves:[{id:"greatsword",label:"Greatsword Slam",emoji:"🔨",desc:"Highest raw damage",power:10,type:"attack"},{id:"iron_will",label:"Iron Will",emoji:"⛰️",desc:"Absorb enemy hit completely",power:7,type:"defend"},{id:"cracked_circle",label:"Cracked Circle",emoji:"💢",desc:"Sacrifice defense for +4 power",power:8,type:"magic"}],
    weakTo:["kenshi","sohei"], strongVs:["ronin","ashigaru"] },
  ashigaru: { id:"ashigaru", name:"Ashigaru", emoji:"🟢", color:"#166534", bgColor:"rgba(22,101,52,0.12)", borderColor:"rgba(22,101,52,0.4)", role:"Infantry force", passive:"Humble Roots", passiveDesc:"Cost reduced by 25 REBEL", weapon:"Spear",
    moves:[{id:"spear_thrust",label:"Spear Thrust",emoji:"🌿",desc:"Reliable steady damage",power:6,type:"attack"},{id:"shield_wall",label:"Shield Wall",emoji:"🛡️",desc:"Blocks 60% of damage",power:7,type:"defend"},{id:"rally",label:"Rally",emoji:"📣",desc:"Recover lost territory slot",power:5,type:"magic"}],
    weakTo:["warrior","ronin"], strongVs:["wokou","sohei"] },
  shogun: { id:"shogun", name:"Shogun", emoji:"🟡", color:"#854d0e", bgColor:"rgba(133,77,14,0.12)", borderColor:"rgba(133,77,14,0.45)", role:"Commander", passive:"Divine Authority", passiveDesc:"+15% reward on Ultra", weapon:"War Staff",
    moves:[{id:"command_strike",label:"Command Strike",emoji:"👑",desc:"Multiplies next warrior damage",power:9,type:"magic"},{id:"strategic_ret",label:"Strategic Retreat",emoji:"🏳️",desc:"Preserve and guarantee min reward",power:5,type:"defend"},{id:"divine_auth",label:"Divine Authority",emoji:"⚡",desc:"Force minimum Common reward",power:7,type:"magic"}],
    weakTo:["yamabushi","wokou"], strongVs:["ronin","bushi"] },
  buke: { id:"buke", name:"Buke", emoji:"🪖", color:"#4d7c0f", bgColor:"rgba(77,124,15,0.12)", borderColor:"rgba(77,124,15,0.4)", role:"Noble defenders", passive:"Noble Guard", passiveDesc:"Defense mode never gives Nothing", weapon:"Trident",
    moves:[{id:"trident_stab",label:"Trident Stab",emoji:"🔱",desc:"Multi-hit 3 small strikes",power:7,type:"attack"},{id:"noble_defense",label:"Noble Defense",emoji:"🏰",desc:"Guarantee no wipe",power:8,type:"defend"},{id:"honor_bond",label:"Honor Bond",emoji:"🤝",desc:"Link warriors +3 combo power",power:6,type:"magic"}],
    weakTo:["samurai","kenshi"], strongVs:["yamabushi","wokou"] },
  kenshi: { id:"kenshi", name:"Kenshi", emoji:"🩵", color:"#0f766e", bgColor:"rgba(15,118,110,0.12)", borderColor:"rgba(15,118,110,0.4)", role:"Sword masters", passive:"Blade Harmony", passiveDesc:"3 wins in a row: +15% power", weapon:"Katana",
    moves:[{id:"precision_slash",label:"Precision Slash",emoji:"🌊",desc:"Bypass enemy defense",power:8,type:"attack"},{id:"blade_harmony",label:"Blade Harmony",emoji:"🌀",desc:"Chain to next warrior +3",power:7,type:"magic"},{id:"meditation",label:"Meditative Focus",emoji:"🧘",desc:"Build +2 power per territory",power:5,type:"defend"}],
    weakTo:["wokou","warrior"], strongVs:["buke","samurai"] },
  wokou: { id:"wokou", name:"Wokou", emoji:"🌊", color:"#475569", bgColor:"rgba(71,85,105,0.12)", borderColor:"rgba(71,85,105,0.4)", role:"Sea raiders", passive:"Sea Raider", passiveDesc:"Random chance to steal bonus reward", weapon:"Cutlass",
    moves:[{id:"cutlass_raid",label:"Cutlass Raid",emoji:"🏴‍☠️",desc:"Steal enemy bonus on win",power:7,type:"trick"},{id:"sea_storm",label:"Sea Storm",emoji:"🌊",desc:"Chaotic random power 4-10",power:7,type:"magic"},{id:"ghost_tide",label:"Ghost Tide",emoji:"👻",desc:"Disappear — enemy nullified",power:6,type:"trick"}],
    weakTo:["ashigaru","buke"], strongVs:["kenshi","shogun"] },
  sohei: { id:"sohei", name:"Sohei", emoji:"🟠", color:"#c2410c", bgColor:"rgba(194,65,12,0.12)", borderColor:"rgba(194,65,12,0.4)", role:"Monk warriors", passive:"Monk Ward", passiveDesc:"Recover from one lost territory", weapon:"War Staff",
    moves:[{id:"staff_sweep",label:"Staff Sweep",emoji:"🌅",desc:"Area attack all positions",power:7,type:"attack"},{id:"monks_ward",label:"Monk's Ward",emoji:"☯️",desc:"Nullify one enemy hit",power:8,type:"defend"},{id:"enlightened",label:"Enlightened Strike",emoji:"🔥",desc:"Spiritual damage bypasses armor",power:9,type:"magic"}],
    weakTo:["ashigaru","kenshi"], strongVs:["warrior","yamabushi"] },
  yamabushi: { id:"yamabushi", name:"Yamabushi", emoji:"🔵", color:"#164e63", bgColor:"rgba(22,78,99,0.12)", borderColor:"rgba(22,78,99,0.4)", role:"Mountain mystics", passive:"Spirit Vision", passiveDesc:"Wildcard: one territory gets secret power-up", weapon:"Mystic Staff",
    moves:[{id:"mystic_flame",label:"Mystic Flame",emoji:"🔮",desc:"Random elemental power 5-9",power:7,type:"magic"},{id:"spirit_vision",label:"Spirit Vision",emoji:"👁️",desc:"Reveal weakness +3 next",power:6,type:"trick"},{id:"mountain_seal",label:"Mountain Seal",emoji:"🗻",desc:"Seal enemy strongest counter",power:8,type:"magic"}],
    weakTo:["sohei","samurai"], strongVs:["shogun","buke"] },
  bushi: { id:"bushi", name:"Bushi", emoji:"🔷", color:"#1e3a5f", bgColor:"rgba(30,58,95,0.12)", borderColor:"rgba(30,58,95,0.45)", role:"Tactical officers", passive:"Tactical Mind", passiveDesc:"See defender faction before choosing move", weapon:"Tactical Blade",
    moves:[{id:"tactical_blade",label:"Tactical Blade",emoji:"🗡️",desc:"See result before confirming",power:7,type:"attack"},{id:"officers_order",label:"Officer's Order",emoji:"📋",desc:"Reorder attack +2 highest",power:6,type:"magic"},{id:"strategic_mind",label:"Strategic Mind",emoji:"🧠",desc:"Pick enemy territory order",power:8,type:"trick"}],
    weakTo:["samurai","sohei"], strongVs:["ronin","wokou"] },
};

const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
const TEAM_SIZE = 5;
const TERRITORY_COUNT = 5;

function simulateBattle(playerFaction: FactionId, playerMove: Move, defenderFaction: FactionId, difficulty: number, bonusFromPassive: number, territoriesWon: number, territoriesLost: number): { won: boolean; playerPower: number; enemyPower: number; enemyMove: Move } {
  const pf = FACTIONS[playerFaction];
  const df = FACTIONS[defenderFaction];
  let pp = playerMove.power + bonusFromPassive;
  if (pf.strongVs.includes(defenderFaction)) pp += 2;
  if (pf.weakTo.includes(defenderFaction))   pp -= 2;
  if (playerFaction === "ronin" && territoriesLost > 0) pp += 2;
  if (playerFaction === "warrior" && playerMove.id === "cracked_circle") pp += 3;
  if (playerFaction === "kenshi" && territoriesWon >= 3) pp += 2;
  if (playerMove.id === "mystic_flame") pp = Math.floor(Math.random() * 5) + 5 + bonusFromPassive;
  let enemyMove: Move;
  if (Math.random() < difficulty) {
    const cm: Record<string,string[]> = { attack:["defend","trick"], defend:["magic","attack"], magic:["trick","defend"], trick:["attack","magic"] };
    const pref = cm[playerMove.type] || [];
    const smart = df.moves.filter(m => pref.includes(m.type));
    enemyMove = smart.length ? smart[Math.floor(Math.random() * smart.length)] : df.moves[Math.floor(Math.random() * df.moves.length)];
  } else {
    enemyMove = df.moves[Math.floor(Math.random() * df.moves.length)];
  }
  let ep = enemyMove.power;
  if (df.strongVs.includes(playerFaction)) ep += 2;
  if (df.weakTo.includes(playerFaction))   ep -= 2;
  ep += Math.floor(difficulty * 3);
  pp += (Math.random() * 2 - 1);
  ep += (Math.random() * 2 - 1);
  if (playerMove.id === "shadow_step" || playerMove.id === "ghost_tide") ep *= 0.5;
  if (playerMove.id === "noble_defense" || playerMove.id === "honor_guard") pp += 2;
  if (playerMove.id === "monks_ward") ep = Math.min(ep, pp);
  if (playerMove.id === "enlightened") pp += 2;
  pp = Math.max(1, pp); ep = Math.max(1, ep);
  return { won: pp > ep, playerPower: pp, enemyPower: ep, enemyMove };
}

function calcPassiveBonus(faction: FactionId, territoriesWon: number, isT1: boolean): number {
  if (faction === "samurai" && isT1) return 2;
  if (faction === "shogun" || faction === "bushi") return 1;
  return 0;
}

function calcRarity(won: number): Rarity {
  if (won === 5) return "ultra";
  if (won >= 3) return "rare";
  if (won >= 1) return "common";
  return "none";
}

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
            <div style={{ fontSize: 8, opacity: 0.5, marginTop: 1 }}>{faction.weapon}</div>
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
      <div style={{ width: 44, height: 44, borderRadius: 10, background: result ? (result.won ? "rgba(52,211,153,0.15)" : "rgba(239,68,68,0.12)") : isCurrent ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.04)", border: `2px solid ${result ? (result.won ? "#34d399" : "#f87171") : isCurrent ? "#fbbf24" : "rgba(255,255,255,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: isCurrent ? "0 0 16px rgba(251,191,36,0.4)" : "none", transition: "all 0.3s" }}>
        {result ? (result.won ? "✅" : "💀") : isCurrent ? "⚔️" : df ? df.emoji : "🏰"}
      </div>
      <div style={{ fontSize: 9, opacity: 0.6 }}>T{index + 1}</div>
      {df && <div style={{ fontSize: 8, color: df.color, fontWeight: 700 }}>{df.name}</div>}
    </div>
  );
}

function FWLeaderboardPanel({ lb }: { lb: FWLeaderboards }) {
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
          {lb.factions.length === 0
            ? <div style={{ ...emptyStyle, gridColumn: "1/-1" }}>No faction data yet — start a campaign!</div>
            : lb.factions.slice(0, MAX).map((f, i) => {
                const fd = FACTIONS[f.faction as FactionId];
                if (!fd) return null;
                const maxWins = lb.factions[0]?.wins || 1;
                const pct = Math.round((f.wins / maxWins) * 100);
                return (
                  <div key={f.faction} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: `1px solid ${fd.borderColor}` }}>
                    <img src={factionImgPath(fd.id,"symbol")} alt={fd.name} style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 6, background: "rgba(0,0,0,0.4)", padding: 2 }} onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: fd.color }}>{fd.name}</div>
                      <div style={{ marginTop: 3, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: pct+"%", background: fd.color, borderRadius: 2, transition: "width 0.6s ease" }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: fd.color, minWidth: 28, textAlign: "right" }}>{f.wins}</div>
                  </div>
                );
              })}
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

  useEffect(() => {
    const u = () => { const p = loadProfile(); const id = getEffectivePlayerId(p)||"guest"; setEffectivePlayerId(id); setPlayerName(p?.discordName||p?.name||""); };
    u(); window.addEventListener("ra:identity-changed", u); return () => window.removeEventListener("ra:identity-changed", u);
  }, []);

  const { balance, spend, earn, refresh, totalEarnRoom, devGrant } = usePoints(effectivePlayerId);
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

  // DRIP migrate
  const [showDripMigrate, setShowDripMigrate] = useState(false);
  const [dripBalance, setDripBalance]         = useState<number|null>(null);
  const [dripAmount, setDripAmount]           = useState<number>(0);
  const [dripBusy, setDripBusy]               = useState(false);
  const [dripStatus, setDripStatus]           = useState("");

  async function openDripModal() {
    setDripStatus(""); setDripBusy(true); setDripBalance(null);
    try {
      const r=await fetch("/api/drip/balance",{cache:"no-store"}); const j=await r.json().catch(()=>null);
      if (!r.ok||!j?.ok){setDripStatus(j?.error||"Could not load DRIP balance.");setShowDripMigrate(true);return;}
      setDripBalance(Number(j.balance||0)); setDripAmount(0); setShowDripMigrate(true);
    } catch(e:any){setDripStatus(e?.message||"DRIP error");setShowDripMigrate(true);}
    finally{setDripBusy(false);}
  }

  async function migrateDripNow() {
    const amt=Math.floor(Number(dripAmount||0)); if(!amt||amt<=0){setDripStatus("Enter an amount > 0.");return;}
    setDripBusy(true); setDripStatus("Migrating…");
    try {
      const idem=`${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
      const r=await fetch("/api/drip/migrate",{method:"POST",headers:{"Content-Type":"application/json","x-idempotency-key":idem},body:JSON.stringify({amount:amt,playerId:effectivePlayerId,idempotencyKey:idem})});
      const j=await r.json().catch(()=>null);
      if (!r.ok||!j?.ok){setDripStatus(j?.error||"Migrate failed.");if(typeof j?.dripBalance==="number")setDripBalance(j.dripBalance);return;}
      setDripStatus(`✅ Migrated ${amt} points into the game.`); await refresh();
      const br=await fetch("/api/drip/balance",{cache:"no-store"}); const bj=await br.json().catch(()=>null);
      if(br.ok&&bj?.ok)setDripBalance(Number(bj.balance||0));
    } catch(e:any){setDripStatus(e?.message||"Migrate error");}
    finally{setDripBusy(false);}
  }

  // ── Config ──────────────────────────────────────────────────────────
  const [cfgState, setCfgState] = useState<any>(defaultPointsConfig);
  useEffect(() => { fetch("/api/config",{cache:"no-store"}).then(r=>r.json()).then(j=>{if(j?.pointsConfig)setCfgState((c:any)=>({...c,...j.pointsConfig}));}).catch(()=>{}); }, []);
  const cfg        = cfgState as any;
  const fwCost     = Number(cfg?.factionWarsCost        ?? 150);
  const difficulty = Number(cfg?.factionWarsAIDifficulty ?? 0.65);
  const currency   = String(cfg?.currency || "REBEL");

  // ── Game State ───────────────────────────────────────────────────────
  const [phase, setPhase]               = useState<Phase>("idle");
  const [team, setTeam]                 = useState<FactionId[]>([]);
  const [defenders, setDefenders]       = useState<FactionId[]>([]);
  const [currentTerritory, setCurrentT] = useState(0);
  const [currentFactionIdx, setCurrentFI] = useState(0);
  const [selectedMove, setSelectedMove] = useState<Move|null>(null);
  const [results, setResults]           = useState<TerritoryResult[]>([]);
  const [finalRarity, setFinalRarity]   = useState<Rarity>("none");
  const [runMessage, setRunMessage]     = useState("");
  const [busy, setBusy]                 = useState(false);
  const [showBuyPoints, setShowBuyPoints] = useState(false);
  const [lb, setLb]                     = useState<FWLeaderboards>({ warlords:[], factions:[], streaks:[], rich:[], perfect:[] });
  const [battleAnim, setBattleAnim]     = useState<"idle"|"clash"|"win"|"lose">("idle");
  const { muted, toggleMute, startMusic, stopMusic, sfx } = useFWAudio();

  const loadLB = useCallback(async () => {
    try { const r=await fetch("/api/faction-wars/leaderboard",{cache:"no-store"}); const j=await r.json(); if(j?.ok)setLb(j.lb); } catch {}
  }, []);
  useEffect(() => { void loadLB(); }, [loadLB]);
  useEffect(() => {
    const h=()=>loadLB(); window.addEventListener("ra:leaderboards-refresh",h); return ()=>window.removeEventListener("ra:leaderboards-refresh",h);
  }, [loadLB]);

  const toggleFaction = (fid: FactionId) => {
    if (phase !== "idle") return;
    setTeam(prev => { const idx=prev.indexOf(fid); if(idx>=0)return prev.filter((_,i)=>i!==idx); if(prev.length>=TEAM_SIZE)return prev; return [...prev,fid]; });
  };

  const startCampaign = async () => {
    if (team.length < TEAM_SIZE || busy) return;
    if (Number(totalEarnRoom||0) < fwCost) { setRunMessage("No plays left today."); return; }
    if (balance < fwCost) { setRunMessage(`Not enough ${currency} to start Faction Wars.`); return; }
    setBusy(true); setRunMessage("Assembling your forces...");
    try {
      const spendRes: any = await spend(fwCost, "faction-wars");
      if (!spendRes?.ok) { setRunMessage(spendRes?.error||"Could not start campaign."); setBusy(false); return; }
    } catch (e: any) { setRunMessage(e?.message||"Could not start."); setBusy(false); return; }
    const defs: FactionId[] = [];
    const available = [...FACTION_IDS];
    for (let i = 0; i < TERRITORY_COUNT; i++) {
      const idx = Math.floor(Math.random() * available.length);
      defs.push(available[idx]); available.splice(idx, 1);
      if (available.length === 0) available.push(...FACTION_IDS.filter(f => !defs.slice(-3).includes(f)));
    }
    setDefenders(defs); setResults([]); setCurrentT(0); setCurrentFI(0); setSelectedMove(null); setFinalRarity("none"); setRunMessage(""); setPhase("battle"); startMusic(); setBusy(false);
  };

  const fightTerritory = async () => {
    if (!selectedMove || busy) return;
    const playerFaction = team[currentFactionIdx] || team[0];
    const defender = defenders[currentTerritory];
    const won = results.filter(r=>r.won).length;
    const lost = results.filter(r=>!r.won).length;
    const bonus = calcPassiveBonus(playerFaction, won, currentTerritory === 0);
    setBusy(true); setBattleAnim("clash"); sfx.clash();
    await new Promise(r=>setTimeout(r,800));
    const res = simulateBattle(playerFaction, selectedMove, defender, difficulty, bonus, won, lost);
    setBattleAnim(res.won ? "win" : "lose");
    await new Promise(r=>setTimeout(r,600));
    setBattleAnim("idle");
    const result: TerritoryResult = { territory: currentTerritory, defender, playerFaction, playerMove: selectedMove, enemyMove: res.enemyMove, playerPower: res.playerPower, enemyPower: res.enemyPower, won: res.won };
    setResults(prev => [...prev, result]); setSelectedMove(null); setPhase("territory_result"); setBusy(false);
  };

  const nextTerritory = () => {
    const next = currentTerritory + 1;
    if (next >= TERRITORY_COUNT) { void finishCampaign([...results]); }
    else { setCurrentT(next); setCurrentFI(prev => (prev+1) % TEAM_SIZE); setPhase("battle"); }
  };

  const finishCampaign = async (allResults: TerritoryResult[]) => {
    setBusy(true);
    const territoriesWon = allResults.filter(r=>r.won).length;
    let rarity = calcRarity(territoriesWon);
    let pts = rarity==="ultra" ? Number(cfg?.rewards?.ultra??300) : rarity==="rare" ? Number(cfg?.rewards?.rare??100) : rarity==="common" ? Number(cfg?.rewards?.common??50) : 0;
    if (team.includes("shogun") && rarity==="ultra") pts = Math.floor(pts*1.15);
    if (team.includes("buke") && rarity==="none") { const dc=allResults.filter(r=>r.playerMove.type==="defend").length; if(dc>=3){rarity="common";pts=Number(cfg?.rewards?.common??50);} }
    setFinalRarity(rarity);
    if (pts>0) { const er:any=await earn(pts).catch(()=>null); if(er?.ok)await refresh().catch(()=>{}); }
    const prof=loadProfile(); const pid=String(effectivePlayerId||getEffectivePlayerId(prof)||"guest").trim().slice(0,64)||"guest"; const pname=(prof?.discordName||playerName||prof?.name||"guest").trim()||"guest";
    addWin({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,ts:Date.now(),game:"faction-wars",playerId:pid,playerName:pname,rarity,pointsAwarded:pts});
    await fetch("/api/faction-wars/record",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:pid,playerName:pname,rarity,pointsAwarded:pts,territoriesWon,team,perfect:territoriesWon===5})}).catch(()=>{});
    window.dispatchEvent(new Event("ra:leaderboards-refresh")); void loadLB();
    if (rarity==="ultra") sfx.ultra(); else if (rarity!=="none") sfx.win(); else sfx.lose();
    setPhase("final_result"); setBusy(false);
  };

  const resetGame = () => {
    stopMusic(); setPhase("idle"); setTeam([]); setDefenders([]); setResults([]); setCurrentT(0); setCurrentFI(0); setSelectedMove(null); setFinalRarity("none"); setRunMessage(""); setBusy(false); setBattleAnim("idle");
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

      {/* DRIP Modal */}
      {showDripMigrate && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>setShowDripMigrate(false)}>
          <div style={{ background:"#0f172a", border:"1px solid rgba(255,255,255,0.15)", borderRadius:16, padding:24, maxWidth:380, width:"90%", position:"relative" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontWeight:900, fontSize:16, marginBottom:12 }}>⚔️ Migrate DRIP Points</div>
            {dripBalance !== null && <div style={{ fontSize:13, opacity:0.8, marginBottom:10 }}>DRIP Balance: <b>{dripBalance}</b></div>}
            <input type="number" value={dripAmount} onChange={e=>setDripAmount(Number(e.target.value))} min={0} max={dripBalance||0} placeholder="Amount to migrate" style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid rgba(255,255,255,0.2)", background:"rgba(0,0,0,0.3)", color:"white", marginBottom:10, fontSize:14 }} />
            {dripStatus && <div style={{ fontSize:12, color:dripStatus.startsWith("✅")?"#34d399":"#f87171", marginBottom:10 }}>{dripStatus}</div>}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={migrateDripNow} disabled={dripBusy} style={{ flex:1, padding:"10px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#fbbf24,#f59e0b)", color:"#000", fontWeight:900, cursor:"pointer" }}>Migrate</button>
              <button onClick={()=>setShowDripMigrate(false)} style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(255,255,255,0.2)", background:"transparent", color:"white", cursor:"pointer" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ position:"relative", zIndex:1 }}>
        <div style={{ maxWidth:900, margin:"0 auto", padding:"24px 20px" }}>
          <div style={{ fontSize:26, fontWeight:900, marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
            <Link href="/" style={{ textDecoration:"none", color:"inherit" }}>Rebel Ants Playground</Link>
            <button onClick={toggleMute} title={muted?"Unmute":"Mute"} style={{ background:"rgba(0,0,0,0.4)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontSize:16, color:"rgba(255,255,255,0.8)", lineHeight:1 }}>{muted?"🔇":"🔊"}</button>
          </div>
          <nav style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {([["tunnel","🐜 Ant Tunnel"],["hatch","⚔️ Faction Wars"],["expedition","⚔️ The Raid"],["shuffle","🃏 Shuffle"]] as [string,string][]).map(([href,label])=>(
              <Link key={href} href={`/${href}`} style={{ padding:"8px 14px", borderRadius:20, textDecoration:"none", fontSize:13, fontWeight:700, background:href==="hatch"?"rgba(251,191,36,0.15)":"rgba(255,255,255,0.07)", border:`1px solid ${href==="hatch"?"rgba(251,191,36,0.4)":"rgba(255,255,255,0.12)"}`, color:href==="hatch"?"#fbbf24":"rgba(255,255,255,0.8)" }}>{label}</Link>
            ))}
          </nav>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"20px 16px", position:"relative", zIndex:1 }}>
        {phase === "idle" && (
          <div>
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"24px 20px", marginBottom:18 }}>
              {/* Title */}
              <div style={{ textAlign:"center", marginBottom:14 }}>
                <div style={{ fontSize:28, fontWeight:900, letterSpacing:"0.06em", background:"linear-gradient(135deg,#fbbf24,#f87171,#c084fc)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:4 }}>⚔️ FACTION WARS</div>
                <div style={{ fontSize:13, opacity:0.65, letterSpacing:"0.04em" }}>🏰 Assemble 5 faction warriors. Battle 5 territories. Know your factions or fall.</div>
              </div>

              {/* Launch button */}
              <div style={{ marginTop:16, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                <button onClick={startCampaign} disabled={team.length<TEAM_SIZE||busy||balance<fwCost}
                  style={{ minWidth:240, height:48, fontSize:14, fontWeight:900, display:"inline-flex", alignItems:"center", justifyContent:"center", borderRadius:12, border:"1px solid rgba(251,191,36,0.35)", cursor:team.length<TEAM_SIZE||busy||balance<fwCost?"not-allowed":"pointer", background:team.length<TEAM_SIZE?"rgba(15,23,42,.7)":"linear-gradient(135deg,rgba(251,191,36,.18),rgba(192,132,252,.18))", color:"#fbbf24" }}>
                  {team.length<TEAM_SIZE?`⚔️ Select ${TEAM_SIZE-team.length} more warriors`:busy?"Assembling...":`⚔️ Launch Campaign (-${fwCost} ${currency})`}
                </button>
                <button onClick={()=>setShowBuyPoints(true)} style={{ padding:"10px 14px", fontSize:12, borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.07)", color:"white", cursor:"pointer", fontWeight:700 }}>💳 Buy Points</button>
                {isDiscordConnected
                  ? <button onClick={disconnectDiscord} style={{ padding:"10px 14px", fontSize:12, borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.07)", color:"white", cursor:"pointer", fontWeight:700 }}>Disconnect Discord</button>
                  : <button onClick={()=>{ try{saveProfile({discordSkipLink:false});window.dispatchEvent(new Event("ra:identity-changed"));}catch{} window.location.href="/api/auth/discord/login"; }} style={{ padding:"10px 14px", fontSize:12, borderRadius:10, border:"1px solid rgba(88,101,242,0.4)", background:"rgba(88,101,242,0.15)", color:"#818cf8", cursor:"pointer", fontWeight:700 }}>🔗 Connect Discord</button>
                }
                <button onClick={async()=>{ if(!isDiscordConnected)return; await openDripModal(); }} disabled={dripBusy||!isDiscordConnected}
                  style={{ padding:"10px 14px", fontSize:12, borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.07)", color:"white", cursor:"pointer", fontWeight:700, opacity:isDiscordConnected?1:0.5 }}
                  title={isDiscordConnected?"Move points from Discord (DRIP) into the game":"Connect Discord to migrate DRIP points"}>
                  {dripBusy?"Loading DRIP…":isDiscordConnected?"Migrate DRIP Points":"Connect Discord for DRIP"}
                </button>
                <div style={{ fontSize:11, opacity:0.65 }}>Discord: <b>{isDiscordConnected?"✅":"❌"}</b></div>
              </div>

              {/* Balance info */}
              <div style={{ marginTop:10, fontSize:12, opacity:0.8, display:"flex", gap:14, flexWrap:"wrap" }}>
                <span>⚔️ Balance: <b>{balance}</b> {currency}</span>
                <span>🏰 Cost: <b>{fwCost}</b> {currency}</span>
                {balance < fwCost && <span style={{ color:"#f87171" }}>Need {fwCost - balance} more {currency}</span>}
              </div>
              <div style={{ marginTop:6, fontSize:11, opacity:0.55, display:"flex", gap:10, flexWrap:"wrap" }}>
                <span>🏆 Ultra: +{cfg?.rewards?.ultra}</span>
                <span>⚔️ Rare: +{cfg?.rewards?.rare}</span>
                <span>✅ Common: +{cfg?.rewards?.common}</span>
                <span>📅 Daily cap: {cfg?.dailyEarnCap}</span>
              </div>

              {/* Name + daily claim */}
              <div style={{ marginTop:12, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                <label style={{ fontSize:12, opacity:0.85 }}>
                  ⚔️ Commander:&nbsp;
                  <input value={playerName}
                    onChange={e=>{ const v=(e.target.value.slice(0,18)||"guest").trim()||"guest"; setPlayerName(v); const p=loadProfile(); saveProfile({name:v,id:(p?.id||playerId||"guest").trim()||"guest"}); }}
                    style={{ padding:"6px 10px", borderRadius:10, border:"1px solid rgba(255,255,255,.18)", background:"rgba(15,23,42,.55)", color:"inherit" }}
                  />
                  <div style={{ fontSize:10, opacity:0.55, marginTop:3 }}>ID: {profile?.discordName || playerName}</div>
                </label>
                <button onClick={claimDailyNow} disabled={claimBusy||dailyClaimed}
                  style={{ padding:"8px 12px", fontSize:12, borderRadius:10, border:"1px solid rgba(251,191,36,0.3)", background:"rgba(251,191,36,0.12)", color:"#fbbf24", cursor:claimBusy||dailyClaimed?"not-allowed":"pointer", fontWeight:700, opacity:claimBusy||dailyClaimed?0.6:1 }}>
                  {dailyClaimed ? (countdownStr ? `⏱ Next claim in ${countdownStr}` : "✅ Claimed Today") : `⚔️ Daily +${cfg?.dailyClaim} ${currency}`}
                </button>
                {process.env.NODE_ENV!=="production" && (
                  <button onClick={async()=>{ await devGrant(5000); await refresh(); alert("Dev grant ✅"); }} style={{ padding:"8px 12px", fontSize:12, borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.07)", color:"white", cursor:"pointer" }}>Dev +5000</button>
                )}
                {claimStatus && <div style={{ fontSize:11, opacity:0.85 }}>{claimStatus}</div>}
              </div>

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
                          <div style={{ opacity:0.55, fontSize:10 }}>{f.passiveDesc}</div>
                        </div>
                      </div>
                    );})}
                  </div>
                )}
              </div>
            </div>
            <FWLeaderboardPanel lb={lb} />
          </div>
        )}

        {phase === "battle" && currentPlayerFD && currentDefenderFD && (
          <div>
            <div style={{ background:"rgba(0,0,0,0.4)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:16, marginBottom:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
                <div style={{ fontSize:13, fontWeight:800, opacity:0.8 }}>Territory {currentTerritory+1} of {TERRITORY_COUNT}</div>
                <div style={{ fontSize:12, opacity:0.5 }}>{territoriesWon} won · {results.length-territoriesWon} lost</div>
              </div>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                {defenders.map((def,i)=>(<TerritoryBadge key={i} index={i} result={results[i]} isCurrent={i===currentTerritory} defender={def} />))}
              </div>
            </div>
            <div style={{ background:"rgba(0,0,0,0.5)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:20, marginBottom:18 }}>
              <div style={{ display:"flex", justifyContent:"space-around", alignItems:"center", marginBottom:20 }}>
                <div style={{ textAlign:"center" }}>
                  <div style={{ width:88, height:88, borderRadius:14, overflow:"hidden", filter:battleAnim==="win"?"drop-shadow(0 0 20px #34d399)":battleAnim==="lose"?"grayscale(0.8)":"none", transform:battleAnim==="clash"?"scale(1.2) translateX(10px)":"scale(1)", transition:"all 0.3s", border:`2px solid ${currentPlayerFD.borderColor}`, boxShadow:`0 0 20px ${currentPlayerFD.color}44` }}>
                    <img src={factionImgPath(currentPlayerFD.id,"char")} alt={currentPlayerFD.name} style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top" }} onError={(e)=>{ (e.target as HTMLImageElement).style.fontSize="48px"; }} />
                  </div>
                  <div style={{ fontWeight:900, fontSize:14, color:currentPlayerFD.color, marginTop:6 }}>{currentPlayerFD.name}</div>
                  <div style={{ fontSize:10, opacity:0.5 }}>Warrior {currentFactionIdx+1}</div>
                </div>
                <div style={{ fontSize:36, opacity:0.8, fontWeight:900 }}>{battleAnim==="clash"?"💥":battleAnim==="win"?"✅":battleAnim==="lose"?"💀":"VS"}</div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ width:88, height:88, borderRadius:14, overflow:"hidden", filter:battleAnim==="win"?"grayscale(0.8) opacity(0.5)":battleAnim==="lose"?"drop-shadow(0 0 20px #f87171)":"none", transform:battleAnim==="clash"?"scale(1.2) translateX(-10px)":"scale(1)", transition:"all 0.3s", border:`2px solid ${currentDefenderFD.borderColor}`, boxShadow:`0 0 20px ${currentDefenderFD.color}33` }}>
                    <img src={factionImgPath(currentDefenderFD.id,"char")} alt={currentDefenderFD.name} style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top" }} onError={(e)=>{ (e.target as HTMLImageElement).style.fontSize="48px"; }} />
                  </div>
                  <div style={{ fontWeight:900, fontSize:14, color:currentDefenderFD.color, marginTop:6 }}>{currentDefenderFD.name}</div>
                  <div style={{ fontSize:10, opacity:0.5 }}>Defender</div>
                </div>
              </div>
              {team[currentFactionIdx]==="bushi"&&(
                <div style={{ background:"rgba(30,58,95,0.3)", border:"1px solid rgba(30,58,95,0.5)", borderRadius:10, padding:"8px 12px", marginBottom:14, fontSize:11 }}>
                  🧠 <strong>Bushi Intel:</strong> {currentDefenderFD.name} is weak to <span style={{color:"#34d399"}}>{currentDefenderFD.weakTo.map(f=>FACTIONS[f]?.name).join(", ")}</span>
                </div>
              )}
              <div style={{ fontSize:13, fontWeight:800, marginBottom:10, opacity:0.8 }}>Choose {currentPlayerFD.name}'s move:</div>
              <div style={{ display:"flex", gap:10, flexDirection:"column" }}>
                {currentPlayerFD.moves.map(m=>(<MoveButton key={m.id} move={m} selected={selectedMove?.id===m.id} onSelect={()=>setSelectedMove(m)} disabled={busy} faction={currentPlayerFD} />))}
              </div>
              <button onClick={fightTerritory} disabled={!selectedMove||busy}
                style={{ marginTop:16, padding:"12px 24px", borderRadius:12, border:"none", cursor:!selectedMove||busy?"not-allowed":"pointer", background:selectedMove?"linear-gradient(135deg,#fbbf24,#f59e0b)":"rgba(255,255,255,0.06)", color:selectedMove?"#000":"white", fontWeight:900, fontSize:15, opacity:!selectedMove?0.5:1, width:"100%", transition:"all 0.2s" }}>
                {busy?"⚔️ Fighting...":selectedMove?`⚔️ Strike with ${selectedMove.label}!`:"Select a move to attack"}
              </button>
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
              <div style={{ display:"flex", justifyContent:"center", gap:24, marginBottom:16 }}>
                <div><div style={{fontSize:11,opacity:0.5,marginBottom:4}}>Your move</div><div style={{fontSize:14,fontWeight:800}}>{last.playerMove.emoji} {last.playerMove.label}</div><div style={{fontSize:12,color:"#60a5fa"}}>Power: {last.playerPower.toFixed(1)}</div></div>
                <div style={{fontSize:24,alignSelf:"center",opacity:0.6}}>VS</div>
                <div><div style={{fontSize:11,opacity:0.5,marginBottom:4}}>{df.name}'s counter</div><div style={{fontSize:14,fontWeight:800}}>{last.enemyMove.emoji} {last.enemyMove.label}</div><div style={{fontSize:12,color:"#f87171"}}>Power: {last.enemyPower.toFixed(1)}</div></div>
              </div>
              <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:20 }}>
                {defenders.map((def,i)=>(<TerritoryBadge key={i} index={i} result={results[i]} isCurrent={false} defender={def} />))}
              </div>
              <button onClick={nextTerritory}
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
                    <span style={{color:FACTIONS[r.defender].color}}>{FACTIONS[r.defender].emoji} {FACTIONS[r.defender].name}</span>
                    <span style={{marginLeft:"auto"}}>{r.playerMove.emoji} {r.playerMove.label} <span style={{opacity:0.5}}>vs</span> {r.enemyMove.emoji} {r.enemyMove.label}</span>
                  </div>
                ))}
              </div>
              <button onClick={resetGame} style={{ padding:"12px 28px", borderRadius:12, border:"none", cursor:"pointer", background:"linear-gradient(135deg,#fbbf24,#f59e0b)", color:"#000", fontWeight:900, fontSize:15 }}>⚔️ New Campaign</button>
            </div>
            <FWLeaderboardPanel lb={lb} />
          </div>
        )}
      </div>
    </div>
  );
}
