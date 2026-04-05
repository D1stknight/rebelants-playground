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

interface Move { id: string; label: string; emoji: string; desc: string; power: number; type: "attack"|"defend"|"magic"|"trick"; oneTime?: boolean; }
interface Faction { id: FactionId; name: string; emoji: string; color: string; bgColor: string; borderColor: string; role: string; passive: string; passiveDesc: string; weapon: string; moves: Move[]; weakTo: FactionId[]; strongVs: FactionId[]; }
interface RoundResult { round:number; playerMove:Move; enemyMove:Move; playerDmg:number; enemyDmg:number; playerHpAfter:number; enemyHpAfter:number; }
interface TerritoryResult { territory:number; defender:FactionId; playerFaction:FactionId; rounds:RoundResult[]; playerHpFinal:number; enemyHpFinal:number; won:boolean; }
type FWLeaderboards = { warlords: {playerId:string;playerName?:string;score:number}[]; factions:{faction:FactionId;wins:number;topPlayers?:{playerId:string;playerName?:string;wins:number}[]}[]; streaks:{playerId:string;playerName?:string;score:number}[]; rich:{playerId:string;playerName?:string;score:number}[]; perfect:{playerId:string;playerName?:string;score:number}[]; };

const FACTIONS: Record<FactionId, Faction> = {
  samurai: { id:"samurai", name:"Samurai", emoji:"🔴", color:"#dc2626", bgColor:"rgba(220,38,38,0.12)", borderColor:"rgba(220,38,38,0.4)", role:"Core soldiers", passive:"First Strike", passiveDesc:"1st territory: +2 bonus damage dealt per round", weapon:"Katana",
    moves:[{id:"katana_strike",label:"Katana Strike",emoji:"⚔️",desc:"Strong reliable slash — full power damage",power:8,type:"attack"},{id:"honor_guard",label:"Honor Guard",emoji:"🛡️",desc:"Block stance — reduces incoming damage by 40%",power:6,type:"defend"},{id:"battle_cry",label:"Battle Cry",emoji:"📯",desc:"War cry — grants +4 damage for next 5 rounds",power:5,type:"magic"},{id:"counter_strike",label:"Counter Strike",emoji:"🔄",desc:"Counter — deal extra damage equal to enemy power",power:7,type:"trick"},{id:"iron_code",label:"Iron Code",emoji:"📜",desc:"+3 bonus damage for next 8 rounds (persists)",power:4,type:"magic"}],
    weakTo:["ronin","yamabushi"], strongVs:["ashigaru","buke"] },
  ronin: { id:"ronin", name:"Ronin", emoji:"⚫", color:"#9f1239", bgColor:"rgba(159,18,57,0.12)", borderColor:"rgba(159,18,57,0.45)", role:"Elite assassins", passive:"Comeback", passiveDesc:"After losing a territory: next warrior deals +15 bonus damage per round", weapon:"Twin Daggers",
    moves:[{id:"twin_daggers",label:"Twin Daggers",emoji:"🗡️",desc:"Double hit lower power",power:7,type:"attack"},{id:"shadow_step",label:"Shadow Step",emoji:"👤",desc:"Dodge — enemy misses",power:6,type:"trick"},{id:"last_stand",oneTime:true,label:"Last Stand",emoji:"💀",desc:"Massive +15 bonus damage when your HP is below 40",power:9,type:"magic"},{id:"phantom_blade",oneTime:true,label:"Phantom Blade",emoji:"🌑",desc:"Strike through defenses — enemy block reduced 70%",power:8,type:"trick"},{id:"death_mark",label:"Death Mark",emoji:"☠️",desc:"+2 bonus damage for next 4 rounds",power:5,type:"magic"}],
    weakTo:["shogun","bushi"], strongVs:["samurai","warrior"] },
  warrior: { id:"warrior", name:"Warrior", emoji:"🟤", color:"#b45309", bgColor:"rgba(180,83,9,0.12)", borderColor:"rgba(180,83,9,0.4)", role:"Battle veterans", passive:"Relentless", passiveDesc:"Cracked Circle & Berserker Rage deal +20 extra damage per use", weapon:"Greatsword",
    moves:[{id:"greatsword",label:"Greatsword Slam",emoji:"🔨",desc:"Highest raw damage",power:10,type:"attack"},{id:"iron_will",label:"Iron Will",emoji:"⛰️",desc:"Absorb enemy hit completely",power:7,type:"defend"},{id:"cracked_circle",label:"Cracked Circle",emoji:"💢",desc:"Sacrifice defense for +4 power",power:8,type:"magic"},{id:"berserker_rage",oneTime:true,label:"Berserker Rage",emoji:"🔥",desc:"Go berserk — max damage but all defend moves locked this territory",power:11,type:"attack"},{id:"blood_price",oneTime:true,label:"Blood Price",emoji:"🩸",desc:"Sacrifice 20 HP to deal double power damage this round",power:10,type:"attack"},
      {id:"war_stomp",label:"War Stomp",emoji:"👊",desc:"Stagger hit — reduces enemy damage by 3 this round",power:6,type:"trick"}],
    weakTo:["kenshi","sohei"], strongVs:["ronin","ashigaru"] },
  ashigaru: { id:"ashigaru", name:"Ashigaru", emoji:"🟢", color:"#166534", bgColor:"rgba(22,101,52,0.12)", borderColor:"rgba(22,101,52,0.4)", role:"Infantry force", passive:"Humble Roots", passiveDesc:"Campaign costs 25 REBEL less (125 total instead of 150)", weapon:"Spear",
    moves:[{id:"spear_thrust",label:"Spear Thrust",emoji:"🌿",desc:"Reliable steady damage",power:6,type:"attack"},{id:"shield_wall",label:"Shield Wall",emoji:"🛡️",desc:"Blocks 60% of damage",power:7,type:"defend"},{id:"rally",label:"Rally",emoji:"📣",desc:"Rally — reduces incoming damage to 0 this round and fully blocks",power:5,type:"magic"},{id:"phalanx",label:"Phalanx",emoji:"🔰",desc:"Shield lock — 40% block with no damage penalty",power:8,type:"defend"},{id:"endure",label:"Endure",emoji:"💪",desc:"Endure — take 0 damage this round (can never finish a territory alone)",power:5,type:"defend"}],
    weakTo:["warrior","ronin"], strongVs:["wokou","sohei"] },
  shogun: { id:"shogun", name:"Shogun", emoji:"🟡", color:"#854d0e", bgColor:"rgba(133,77,14,0.12)", borderColor:"rgba(133,77,14,0.45)", role:"Commander", passive:"Divine Authority", passiveDesc:"Ultra victory: REBEL reward boosted by 15%", weapon:"War Staff",
    moves:[{id:"command_strike",label:"Command Strike",emoji:"👑",desc:"Command — next round gains permanent +8 flat damage bonus",power:9,type:"magic"},{id:"strategic_ret",label:"Strategic Retreat",emoji:"🏳️",desc:"Retreat — your team gets Common reward even if campaign fails",power:5,type:"defend"},{id:"divine_auth",label:"Divine Authority",emoji:"⚡",desc:"Authority — guarantees minimum Common reward this campaign",power:7,type:"magic"},{id:"imperial_decree",oneTime:true,label:"Imperial Decree",emoji:"📋",desc:"Decree — forces enemy to use their weakest move this round",power:8,type:"trick"},{id:"final_command",oneTime:true,label:"Final Command",emoji:"📣",desc:"Epic decree — forces enemy to 1 power AND you get +6 damage",power:9,type:"magic"},
      {id:"warlords_fury",label:"Warlord's Fury",emoji:"⚡",desc:"Fury — base power +4 per territory already won",power:7,type:"attack"}],
    weakTo:["yamabushi","wokou"], strongVs:["ronin","bushi"] },
  buke: { id:"buke", name:"Buke", emoji:"🪖", color:"#4d7c0f", bgColor:"rgba(77,124,15,0.12)", borderColor:"rgba(77,124,15,0.4)", role:"Noble defenders", passive:"Noble Guard", passiveDesc:"Mostly used defend moves? A campaign loss flips to Common win", weapon:"Trident",
    moves:[{id:"trident_stab",label:"Trident Stab",emoji:"🔱",desc:"Triple strike — reliable attack damage",power:7,type:"attack"},{id:"noble_defense",label:"Noble Defense",emoji:"🏰",desc:"Noble stance — 40% block with honorable defense",power:8,type:"defend"},{id:"honor_bond",label:"Honor Bond",emoji:"🤝",desc:"+3 permanent damage bonus for rest of campaign",power:6,type:"magic"},{id:"bastion",label:"Bastion",emoji:"🏯",desc:"Fortress — 40% block + +5 bonus damage dealt",power:9,type:"defend"},{id:"noble_sacrifice",oneTime:true,label:"Noble Sacrifice",emoji:"💎",desc:"SACRIFICE: warrior dies instantly. Next warrior gets +12 permanent damage boost",power:4,type:"magic"}],
    weakTo:["samurai","kenshi"], strongVs:["yamabushi","wokou"] },
  kenshi: { id:"kenshi", name:"Kenshi", emoji:"🩵", color:"#0f766e", bgColor:"rgba(15,118,110,0.12)", borderColor:"rgba(15,118,110,0.4)", role:"Sword masters", passive:"Blade Harmony", passiveDesc:"Win 3 territories in a row: all moves deal +12 extra damage", weapon:"Katana",
    moves:[{id:"precision_slash",label:"Precision Slash",emoji:"🌊",desc:"Precision cut — reduces enemy block effectiveness by 70%",power:8,type:"attack"},{id:"blade_harmony",label:"Blade Harmony",emoji:"🌀",desc:"+3 permanent damage bonus for rest of campaign",power:7,type:"magic"},{id:"meditation",label:"Meditative Focus",emoji:"🧘",desc:"Focus — stacks +2 damage per territory you use this move",power:5,type:"defend"},{id:"blade_storm",oneTime:true,label:"Blade Storm",emoji:"💨",desc:"Blade storm — rapid strikes with +7 bonus damage",power:9,type:"attack"},{id:"mirror_slash",label:"Mirror Slash",emoji:"🪞",desc:"Reflect — deals damage equal to what you just took last round",power:7,type:"trick"},
      {id:"perfect_form",label:"Perfect Form",emoji:"✨",desc:"+3 bonus if you took 0 damage last round",power:7,type:"defend"}],
    weakTo:["wokou","warrior"], strongVs:["buke","samurai"] },
  wokou: { id:"wokou", name:"Wokou", emoji:"🌊", color:"#475569", bgColor:"rgba(71,85,105,0.12)", borderColor:"rgba(71,85,105,0.4)", role:"Sea raiders", passive:"Sea Raider", passiveDesc:"Win a territory: random chance to earn extra bonus REBEL", weapon:"Cutlass",
    moves:[{id:"cutlass_raid",label:"Cutlass Raid",emoji:"🏴‍☠️",desc:"40% chance to earn +10 bonus REBEL when you win this territory",power:7,type:"trick"},{id:"sea_storm",label:"Sea Storm",emoji:"🌊",desc:"Chaos strike — random power 4-10 this round",power:7,type:"magic"},{id:"ghost_tide",label:"Ghost Tide",emoji:"👻",desc:"Disappear — enemy nullified",power:6,type:"trick"},{id:"ambush",oneTime:true,label:"Ambush",emoji:"🗺️",desc:"Ambush — deals +4 bonus damage if enemy also attacked",power:8,type:"trick"},{id:"plunder",label:"Plunder",emoji:"💰",desc:"Loot bonus — win this territory to earn extra REBEL (see reward)",power:6,type:"magic"}],
    weakTo:["ashigaru","buke"], strongVs:["kenshi","shogun"] },
  sohei: { id:"sohei", name:"Sohei", emoji:"🟠", color:"#c2410c", bgColor:"rgba(194,65,12,0.12)", borderColor:"rgba(194,65,12,0.4)", role:"Monk warriors", passive:"Monk Ward", passiveDesc:"Lose a territory with HP above 0: counts as a narrow escape", weapon:"War Staff",
    moves:[{id:"staff_sweep",label:"Staff Sweep",emoji:"🌅",desc:"Sweep — strong reliable attack damage",power:7,type:"attack"},{id:"monks_ward",label:"Monk's Ward",emoji:"☯️",desc:"Ward — blocks 55% of enemy damage this round",power:8,type:"defend"},{id:"enlightened",label:"Enlightened Strike",emoji:"🔥",desc:"Spiritual damage bypasses armor",power:9,type:"magic"},{id:"sacred_flame",oneTime:true,label:"Sacred Flame",emoji:"🕯️",desc:"Sacred fire — +7 spiritual damage bonus",power:8,type:"magic"},{id:"iron_meditation",label:"Iron Meditation",emoji:"🧘",desc:"Meditate — heals +15 HP and gives +3 damage bonus for 4 rounds",power:6,type:"defend"}],
    weakTo:["ashigaru","kenshi"], strongVs:["warrior","yamabushi"] },
  yamabushi: { id:"yamabushi", name:"Yamabushi", emoji:"🔵", color:"#164e63", bgColor:"rgba(22,78,99,0.12)", borderColor:"rgba(22,78,99,0.4)", role:"Mountain mystics", passive:"Spirit Vision", passiveDesc:"One random territory this campaign: hidden +5 damage bonus", weapon:"Mystic Staff",
    moves:[{id:"mystic_flame",label:"Mystic Flame",emoji:"🔮",desc:"Random elemental power 4-10 via chaos magic",power:7,type:"magic"},{id:"spirit_vision",label:"Spirit Vision",emoji:"👁️",desc:"Vision — +3 damage bonus activates each round you use this",power:6,type:"trick"},{id:"mountain_seal",oneTime:true,label:"Mountain Seal",emoji:"🗻",desc:"Seal — +3 damage bonus after using (mountain power)",power:8,type:"magic"},{id:"void_seal",oneTime:true,label:"Void Seal",emoji:"🌀",desc:"Erase enemy move — they get power 1",power:9,type:"magic"},{id:"mountain_echo",label:"Mountain Echo",emoji:"📣",desc:"Echo — replays 70% of last round's damage as extra bonus",power:6,type:"trick"}],
    weakTo:["sohei","samurai"], strongVs:["shogun","buke"] },
  bushi: { id:"bushi", name:"Bushi", emoji:"🔷", color:"#1e3a5f", bgColor:"rgba(30,58,95,0.12)", borderColor:"rgba(30,58,95,0.45)", role:"Tactical officers", passive:"Tactical Mind", passiveDesc:"Each round: see enemy faction weaknesses before choosing", weapon:"Tactical Blade",
    moves:[{id:"tactical_blade",label:"Tactical Blade",emoji:"🗡️",desc:"Blade strike — +2 bonus damage for attack moves",power:7,type:"attack"},{id:"officers_order",label:"Officer's Order",emoji:"📋",desc:"+3 bonus damage for all attack moves this territory",power:6,type:"magic"},{id:"strategic_mind",oneTime:true,label:"Strategic Mind",emoji:"🧠",desc:"Tactical read — +2 damage per territory already won",power:8,type:"trick"},{id:"field_intel",label:"Field Intel",emoji:"🔭",desc:"Intel — +3 bonus if your move counters the enemy type",power:7,type:"trick"},{id:"tactical_strike",label:"Tactical Strike",emoji:"🎯",desc:"Calculated blow — power equals territories won",power:7,type:"attack"}],
    weakTo:["samurai","sohei"], strongVs:["ronin","wokou"] },
};

const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
const TEAM_SIZE = 5;
const TERRITORY_COUNT = 5;

// ── HP COMBAT ENGINE ──────────────────────────────────────────────────────────
const MAX_HP = 100;

function calcDamage(move: Move, atk: FactionId, def: FactionId, bonus: number, tWon: number, tLost: number, diff: number, isPlayer: boolean): number {
  const af = FACTIONS[atk];
  let dmg = move.power * 2.0 + bonus * 1.2;
  if (af.strongVs.includes(def)) dmg += 6;
  if (af.weakTo.includes(def))   dmg -= 5;
  if (move.type === "defend") dmg *= 0.55;
  if (move.type === "trick")  dmg *= 0.80;
  if (move.type === "magic")  dmg *= 1.10;
  if (isPlayer) {
    if (atk === "ronin" && tLost > 0) dmg += 8;
    if (atk === "kenshi" && tWon >= 3) dmg += 6;
    if (atk === "warrior" && (move.id === "cracked_circle" || move.id === "berserker_rage")) dmg += 10;
    if (move.id === "mystic_flame") dmg = (Math.floor(Math.random()*5)+5)*6.5;
    if (move.id === "last_stand") dmg += 12;
    if (move.id === "phantom_blade") dmg += 6;
    if (move.id === "void_seal") dmg += 9;
    if (move.id === "blade_storm") dmg += 7;
    if (move.id === "enlightened" || move.id === "sacred_flame") dmg += 7;
    if (move.id === "bastion") dmg += 5;
    if (move.id === "warlords_fury") dmg += tWon * 4;
    if (move.id === "tactical_strike") dmg += tWon * 3;
  } else {
    dmg += Math.floor(diff * 4);
  }
  dmg *= (0.82 + Math.random() * 0.36);
  return Math.max(2, Math.min(Math.round(dmg), 24));
}

function calcBlock(move: Move): number {
  if (["shadow_step","ghost_tide","vanishing_cut"].includes(move.id)) return 0.40;
  if (["monks_ward"].includes(move.id)) return 0.55;
  if (["noble_defense","honor_guard","phalanx","bastion"].includes(move.id)) return 0.40;
  if (["shield_wall","iron_will","endure"].includes(move.id)) return 0.35;
  if (move.id === "bushido_stand") return 0.30;
  if (move.type === "defend") return 0.25;
  return 0;
}

function pickEnemyMove(def: FactionId, pm: Move, diff: number, eHp: number, pHp: number): Move {
  const df = FACTIONS[def];
  if (diff > 0.7 && eHp < 30) return df.moves.reduce((a,b)=>a.power>b.power?a:b);
  if (diff > 0.6 && pHp < 30) {
    const press = df.moves.filter(m=>m.type==="attack"||m.type==="magic");
    if (press.length) return press.reduce((a,b)=>a.power>b.power?a:b);
  }
  if (Math.random() < diff) {
    const cm: Record<string,string[]> = { attack:["defend","trick"], defend:["magic","attack"], magic:["trick","defend"], trick:["attack","magic"] };
    const counters = df.moves.filter(m=>(cm[pm.type]||[]).includes(m.type));
    if (counters.length) {
      counters.sort((a,b)=>b.power-a.power);
      return counters[Math.floor(Math.pow(Math.random(),0.5)*counters.length)];
    }
  }
  const sorted = [...df.moves].sort((a,b)=>b.power-a.power);
  return sorted[Math.floor(Math.pow(Math.random(),0.7)*sorted.length)];
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
  const fwCost        = Number(cfg?.factionWarsCost           ?? 150);
  const fwPlunderBonus = Number(cfg?.factionWarsPlunderBonus  ?? 50);
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
  const [showPrizeModal, setShowPrizeModal] = useState(false);
  const [prizeLabel, setPrizeLabel] = useState("");
  const [prizeSub, setPrizeSub] = useState("");
  const [prizeClaimId, setPrizeClaimId] = useState<string|undefined>(undefined);
  const [prizeMerchShipping, setPrizeMerchShipping] = useState(false);
  const [lb, setLb]                     = useState<FWLeaderboards>({ warlords:[], factions:[], streaks:[], rich:[], perfect:[] });
  const [battleAnim, setBattleAnim]     = useState<"idle"|"clash"|"win"|"lose">("idle");
  const [playerHp, setPlayerHp]         = useState(MAX_HP);
  const [enemyHp, setEnemyHp]           = useState(MAX_HP);
  const [currentRound, setCurrentRound] = useState(0);
  const [roundLog, setRoundLog]         = useState<{playerMove:string;enemyMove:string;playerDmg:number;enemyDmg:number;effect?:string}[]>([]);
  const [dmgFloats, setDmgFloats]       = useState<{id:number;side:"player"|"enemy"|"plunder";dmg:number}[]>([]);
  const [currentTerritoryRounds, setCurrentTerritoryRounds] = useState<RoundResult[]>([]);
  const dmgFloatId = useRef(0);
  const plunderPendingRef = useRef(false);
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
  const [healBusy, setHealBusy]   = useState(false);
  const [healUsed, setHealUsed]     = useState(0);
  const [oneTimeUsed, setOneTimeUsed] = useState<string[]>([]);
  const [showHowToPlay, setShowHowToPlay] = useState(true);
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
    const actualCostCheck = team.includes("ashigaru") ? Math.max(0, fwCost - 25) : fwCost;
    if (balance < actualCostCheck) { setRunMessage(`Not enough ${currency} to start Faction Wars.`); return; }
    setBusy(true); setRunMessage("Assembling your forces...");
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
    setDefenders(defs); setResults([]); setCurrentT(0); setCurrentFI(0); setSelectedMove(null); setFinalRarity("none"); setRunMessage("");
    setPlayerHp(MAX_HP); setEnemyHp(MAX_HP); setCurrentRound(0); setRoundLog([]); setDmgFloats([]); setCurrentTerritoryRounds([]);
    setPhase("battle"); startMusic(); setBusy(false);
  };

  const startTerritory = () => {
    setPlayerHp(MAX_HP); setEnemyHp(MAX_HP);
    setCurrentRound(0); setRoundLog([]); setDmgFloats([]); setCurrentTerritoryRounds([]);
    setUsedMoves({}); setBerserkerActive(false);
    // Apply meditation stacks to starting power buff
    if (meditationStacks > 0) { setPowerBuffAmt(meditationStacks * 2); setPowerBuffRounds(99); }
  };

  const fightTerritory = async () => {
    if (!selectedMove || busy) return;
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
    setBusy(true); setBattleAnim("clash"); sfx.clash();
    await new Promise(r=>setTimeout(r,450));

    const imperialDecreeFlag = selectedMove.id === "imperial_decree" || selectedMove.id === "final_command";
    const enemyMove = imperialDecreeFlag
      ? FACTIONS[defender].moves.reduce((a,b)=>a.power<b.power?a:b)
      : pickEnemyMove(defender, selectedMove, difficulty, enemyHp, playerHp);
    const timesUsed = usedMoves[selectedMove.id] || 0;
    const degradedMove: Move = { ...selectedMove, power: Math.max(1, selectedMove.power - timesUsed) };
    setUsedMoves(prev => ({ ...prev, [selectedMove.id]: (prev[selectedMove.id]||0)+1 }));
    if (selectedMove.oneTime) setOneTimeUsed(prev => [...prev, selectedMove.id]);
    // ── Special move effects ──────────────────────────────────────
    if (selectedMove.id === "berserker_rage")  setBerserkerActive(true);
    if (selectedMove.id === "iron_code")        { setPowerBuffAmt(3); setPowerBuffRounds(8); } // +3 dmg for 8 rounds (~2 territories)
    if (selectedMove.id === "death_mark")       { setPowerBuffAmt(2); setPowerBuffRounds(4); } // +2 dmg next 4 rounds
    if (selectedMove.id === "blade_harmony")    setComboBonus(prev => prev + 3); // permanent campaign +3
    if (selectedMove.id === "honor_bond")       setComboBonus(prev => prev + 3); // permanent campaign +3
    if (selectedMove.id === "command_strike")   setCommandActive(true); // next round gets +8 bonus
    if (selectedMove.id === "meditation")       setMeditationStacks(prev => prev + 1); // stacks per territory
    if (selectedMove.id === "iron_meditation")  { setPlayerHp(hp => Math.min(MAX_HP, hp + 15)); setPowerBuffAmt(3); setPowerBuffRounds(4); } // real +15 HP heal + buff
    if (selectedMove.id === "battle_cry")       { setPowerBuffAmt(4); setPowerBuffRounds(5); } // +4 dmg next 5 rounds
    if (selectedMove.id === "spirit_vision")    setPowerBuffAmt(prev => Math.max(prev, 3)); // reveal = +3 power buff rounds
    if (selectedMove.id === "divine_auth")   plunderPendingRef.current = true; // reuse flag to signal min-rarity guarantee
    // strategic_ret handled below
    if (selectedMove.id === "cutlass_raid")     { if (Math.random() < 0.4) { const bonus2 = 10; earn(bonus2).catch(()=>{}); } }
    if (selectedMove.id === "mountain_seal")    setPowerBuffAmt(prev => prev + 3); // seal = your next moves hit harder
    if (selectedMove.id === "bushido_stand")     { /* handled via block + bonus in calcDamage */ }
    if (selectedMove.id === "blood_price")       { setPlayerHp(hp => Math.max(1, hp - 20)); } // costs 20 HP

    // Track plunder use for this territory
    if (selectedMove.id === "plunder") { plunderPendingRef.current = true; }
    if (selectedMove.id === "noble_sacrifice") {
      setSacrificeBonus(12);
      setPlayerHp(0);
      const sacRnd: RoundResult = {round:currentRound+1,playerMove:selectedMove,enemyMove:selectedMove,playerDmg:0,enemyDmg:100,playerHpAfter:0,enemyHpAfter:enemyHp};
      const sacRes: TerritoryResult = {territory:currentTerritory,defender,playerFaction,rounds:[...currentTerritoryRounds,sacRnd],playerHpFinal:0,enemyHpFinal:enemyHp,won:false};
      setBattleAnim("lose"); await new Promise(r=>setTimeout(r,700)); setBattleAnim("idle");
      setResults(prev=>[...prev,sacRes]); setSelectedMove(null); setBusy(false); setPhase("territory_result");
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
    setBattleAnim(newEnemyHp <= 0 ? "win" : newPlayerHp <= 0 ? "lose" : "idle");
    await new Promise(r=>setTimeout(r, over ? 700 : 250));
    if (!over) { setBattleAnim("idle"); }

    setSelectedMove(null);
    setBusy(false);

    if (over) {
      await new Promise(r=>setTimeout(r,500));
      setBattleAnim("idle");
      const playerWon = newEnemyHp <= 0;
      // Plunder bonus on win
      if (playerWon && plunderPendingRef.current) {
        const plunderAmt = Number(cfg?.factionWarsPlunderBonus ?? 50);
        try { await earn(plunderAmt); await refresh(); } catch {}
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

  const nextTerritory = () => {
    const next = currentTerritory + 1;
    if (next >= TERRITORY_COUNT) { void finishCampaign([...results]); }
    else { setCurrentT(next); setCurrentFI(prev => (prev+1) % TEAM_SIZE); startTerritory(); setPhase("battle"); }
  };

  const finishCampaign = async (allResults: TerritoryResult[]) => {
    setBusy(true);
    const territoriesWon = allResults.filter(r=>r.won).length;
    let rarity = calcRarity(territoriesWon);
    let pts = rarity==="ultra" ? Number(cfg?.rewards?.ultra??300) : rarity==="rare" ? Number(cfg?.rewards?.rare??100) : rarity==="common" ? Number(cfg?.rewards?.common??50) : 0;
    if (team.includes("shogun") && rarity==="ultra") pts = Math.floor(pts*1.15);
    if (team.includes("buke") && rarity==="none") { const dc=allResults.reduce((sum,r)=>sum+(r.rounds?.filter(rnd=>rnd.playerMove.type==="defend").length||0),0); if(dc>=3){rarity="common";pts=Number(cfg?.rewards?.common??50);} }
    setFinalRarity(rarity);
    if (pts>0) { const er:any=await earn(pts).catch(()=>null); if(er?.ok)await refresh().catch(()=>{}); }

    // Roll crate prize if won anything
    if (rarity !== "none") {
      try {
        const rollR = await fetch(`/api/prizes/roll?force=${rarity}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: String(effectivePlayerId||"guest"), rarity, game: "faction-wars" })
        });
        const rollJ = await rollR.json().catch(() => null);
        if (rollR.ok && rollJ?.ok && rollJ?.prize) {
          const p = rollJ.prize;
          setPrizeLabel(p.label || (rarity === "ultra" ? "🏆 ULTRA CRATE" : rarity === "rare" ? "⚔️ RARE CRATE" : "✅ COMMON CRATE"));
          setPrizeSub(p.type === "nft" ? "You won an NFT!" : p.type === "merch" ? "You won merch!" : `+${p.points || pts} REBEL`);
          setPrizeClaimId(rollJ.claimId);
          setPrizeMerchShipping(p.type === "merch");
          setShowPrizeModal(true);
        }
      } catch {}
    }
    const prof=loadProfile(); const pid=String(effectivePlayerId||getEffectivePlayerId(prof)||"guest").trim().slice(0,64)||"guest"; const pname=(prof?.discordName||playerName||prof?.name||"guest").trim()||"guest";
    addWin({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,ts:Date.now(),game:"faction-wars",playerId:pid,playerName:pname,rarity,pointsAwarded:pts});
    await fetch("/api/faction-wars/record",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:pid,playerName:pname,rarity,pointsAwarded:pts,territoriesWon,team,perfect:territoriesWon===5})}).catch(()=>{});
    window.dispatchEvent(new Event("ra:leaderboards-refresh")); void loadLB();
    if (rarity==="ultra") sfx.ultra(); else if (rarity!=="none") sfx.win(); else sfx.lose();
    if (rarity !== "none") setShowPrizeModal(true);
    setPhase("final_result"); setBusy(false);
  };

  const resetGame = () => {
    stopMusic(); setPhase("idle"); setTeam([]); setDefenders([]); setResults([]); setCurrentT(0); setCurrentFI(0); setSelectedMove(null); setFinalRarity("none"); setRunMessage(""); setBusy(false); setBattleAnim("idle");
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
      {/* Crate Reveal Modal */}
      {showPrizeModal && (()=>{
        const rar = finalRarity as string;
        const t = rar==="ultra"?"🏆 ULTRA CRATE!":rar==="rare"?"⚔️ Rare Crate!":"✅ Crate Unlocked";
        const bc = rar==="ultra"?"#fbbf24":rar==="rare"?"#60a5fa":"#34d399";
        const ac = rar==="ultra"?"rgba(251,191,36,0.4)":rar==="rare"?"rgba(96,165,250,0.35)":"rgba(52,211,153,0.3)";
        const sub2 = rar==="ultra"?"5/5 conquered":rar==="rare"?"3-4 conquered":"1-2 conquered";
        const sps = Array.from({length:24},(_,i)=>({ left:String(8+(i*4.1)%84)+'%', top:String(10+(i*7.3)%62)+'%', size:10+((i*3)%14), delay:(i*0.18)%3.2 }));
        return (
          <div style={{position:"fixed",inset:0,display:"grid",placeItems:"center",background:"rgba(0,0,0,0.7)",zIndex:1000}}>
            <div style={{position:"relative",minWidth:300,maxWidth:400,padding:"32px 28px",borderRadius:20,background:"rgba(8,14,32,0.98)",border:"2px solid "+bc,boxShadow:"0 0 60px "+ac+", 0 24px 40px rgba(0,0,0,0.7)",textAlign:"center",overflow:"hidden"}}>
              {sps.map((sp: {left:string;top:string;size:number;delay:number},i: number)=>(
                <span key={i} className={"pm-sparkle "+rar} style={{position:"absolute",left:sp.left,top:sp.top,width:sp.size,height:sp.size,animationDelay:sp.delay+"s"}} />
              ))}
              <div style={{position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",width:200,height:200,borderRadius:"50%",background:ac,filter:"blur(40px)",pointerEvents:"none"}} />
              <div style={{position:"relative",fontSize:22,fontWeight:900,color:bc,marginBottom:6,letterSpacing:"0.03em"}}>{t}</div>
              <div style={{position:"relative",fontSize:12,opacity:0.55,marginBottom:16}}>{sub2}</div>
              <div style={{position:"relative",marginBottom:16}}>
                <img src={"/crates/"+rar+".png"} alt={rar+" crate"} style={{width:140,height:140,objectFit:"contain",filter:"drop-shadow(0 0 20px "+bc+")"}} />
              </div>
              <div style={{position:"relative",fontSize:17,fontWeight:900,color:"white",marginBottom:4}}>
                You won: <span style={{color:bc}}>{prizeSub}</span>
              </div>
              {prizeClaimId && <div style={{position:"relative",fontSize:10,opacity:0.35,marginBottom:16,fontFamily:"monospace"}}>Claim: {prizeClaimId}</div>}
              {!prizeClaimId && <div style={{height:20}} />}
              {prizeMerchShipping && prizeClaimId && (
                <div style={{position:"relative",textAlign:"left",marginBottom:12,fontSize:12,opacity:0.75,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:12}}>
                  🎁 Merch won! Contact support with your Claim ID to arrange shipping.
                </div>
              )}
              <button onClick={()=>setShowPrizeModal(false)} style={{position:"relative",padding:"12px 36px",borderRadius:12,border:"none",cursor:"pointer",background:"linear-gradient(135deg,"+bc+","+bc+"99)",color:"#000",fontWeight:900,fontSize:15}}>
                {rar==="ultra"?"⚔️ Legendary!":"Continue"}
              </button>
            </div>
          </div>
        );
      })()}

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
                  {team.length<TEAM_SIZE?`⚔️ Select ${TEAM_SIZE-team.length} more warriors`:busy?"Assembling...":`⚔️ Launch Campaign (-${team.includes("ashigaru") ? Math.max(0, fwCost-25) : fwCost} ${currency})`}
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
                      <img src={factionImgPath(currentPlayerFD.id,"char")} alt={currentPlayerFD.name}
                        style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top" }}
                        onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
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
                      <img src={factionImgPath(currentDefenderFD.id,"char")} alt={currentDefenderFD.name}
                        style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top" }}
                        onError={(e)=>{ (e.target as HTMLImageElement).style.display="none"; }} />
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

                {/* Round log */}
                {roundLog.length > 0 && (
                  <div style={{ background:"rgba(0,0,0,0.45)", borderRadius:10, padding:"8px 12px", marginBottom:12, maxHeight:96, overflowY:"auto" }}>
                    <div style={{ fontSize:9, opacity:0.35, marginBottom:5, letterSpacing:"0.06em", fontWeight:700 }}>ROUND HISTORY</div>
                    {roundLog.slice(0,5).map((r,i)=>(
                      <div key={i} style={{ display:"flex", gap:10, fontSize:10, marginBottom:4, opacity:i===0?1:0.5, alignItems:"center" }}>
                        <span style={{ color:"#34d399", fontWeight:700, minWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>⚔️ {r.playerMove}</span>
                        <span style={{ color:"#f87171", fontWeight:800 }}>-{r.enemyDmg} to you</span>
                        <span style={{ opacity:0.3 }}>|</span>
                        <span style={{ color:"#f87171", fontWeight:700, minWidth:70, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>🛡️ {r.enemyMove}</span>
                        <span style={{ color:"#34d399", fontWeight:800 }}>-{r.playerDmg} to enemy</span>
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
                {(() => {
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

                {/* Move selector */}
                <div style={{ borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:16 }}>
                  <div style={{ fontSize:12, fontWeight:800, marginBottom:10, opacity:0.7, letterSpacing:"0.04em" }}>
                    ⚔️ CHOOSE {currentPlayerFD.name.toUpperCase()}'S MOVE
                  </div>
                  <div style={{ display:"flex", gap:8, flexDirection:"column" }}>
                    {currentPlayerFD.moves.map(m=>{
                      const tc: Record<string,string> = { attack:"#f87171", defend:"#34d399", magic:"#c084fc", trick:"#fbbf24" };
                      const isSel = selectedMove?.id===m.id;
                      const timesUsedM = usedMoves[m.id] || 0;
                      const degradedPow = Math.max(1, m.power - timesUsedM);
                      const isExhausted = (m.oneTime && oneTimeUsed.includes(m.id)) || (berserkerActive && m.type === "defend");
                      return (
                        <button key={m.id} onClick={()=>!busy&&!isExhausted&&setSelectedMove(m)} disabled={busy||isExhausted}
                          style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:12,
                            border:`2px solid ${isExhausted?"rgba(255,255,255,0.04)":isSel ? currentPlayerFD.borderColor : "rgba(255,255,255,0.08)"}`,
                            background: isExhausted ? "rgba(0,0,0,0.2)" : isSel ? currentPlayerFD.bgColor : "rgba(255,255,255,0.03)",
                            cursor: busy||isExhausted?"not-allowed":"pointer", textAlign:"left", opacity: isExhausted ? 0.4 : 1,
                            boxShadow: isSel ? `0 0 16px ${currentPlayerFD.color}44` : "none",
                            transform: isSel ? "scale(1.01)" : "scale(1)", transition:"all 0.18s" }}>
                          {/* Move symbol */}
                          <div style={{ width:40, height:40, borderRadius:10, background: isSel?"rgba(0,0,0,0.4)":"rgba(0,0,0,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0, border:`1px solid ${tc[m.type]}44` }}>
                            {m.emoji}
                          </div>
                          {/* Move info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                              <span style={{ fontWeight:900, fontSize:14 }}>{m.label}</span>
                              <span style={{ fontSize:9, background:tc[m.type], color:"#000", borderRadius:4, padding:"1px 6px", fontWeight:900 }}>{m.type.toUpperCase()}</span>
                              {m.oneTime && !isExhausted && <span style={{ fontSize:9, background:"rgba(251,191,36,0.2)", color:"#fbbf24", borderRadius:4, padding:"1px 6px", fontWeight:900, border:"1px solid rgba(251,191,36,0.3)" }}>1× ONLY</span>}
                              {isExhausted && !berserkerActive && <span style={{ fontSize:9, background:"rgba(255,255,255,0.1)", color:"#666", borderRadius:4, padding:"1px 6px", fontWeight:900 }}>USED</span>}
                              {isExhausted && berserkerActive && m.type==="defend" && <span style={{ fontSize:9, background:"rgba(251,100,36,0.25)", color:"#f87171", borderRadius:4, padding:"1px 6px", fontWeight:900 }}>🔥BERSERK</span>}
                            </div>
                            <div style={{ fontSize:11, opacity:0.6 }}>
                              {m.id === "plunder" ? `Win this territory → earn +${fwPlunderBonus} bonus REBEL` : m.desc}
                            </div>
                          </div>
                          {/* Power meter */}
                          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, flexShrink:0, minWidth:44 }}>
                            <div style={{ fontSize:13, fontWeight:900, color: isExhausted?"#666": isSel ? currentPlayerFD.color : "rgba(255,255,255,0.6)" }}>
                              {isExhausted ? "✗" : degradedPow}
                              {!isExhausted && timesUsedM > 0 && <span style={{fontSize:9,color:"#f87171",marginLeft:2}}>↓{timesUsedM}</span>}
                            </div>
                            <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.1)", overflow:"hidden" }}>
                              <div style={{ height:"100%", borderRadius:2, background:tc[m.type], width:`${m.power*10}%`, transition:"width 0.3s" }} />
                            </div>
                            <div style={{ fontSize:8, opacity:0.4 }}>PWR</div>
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
      </div>
    </div>
  );
}
