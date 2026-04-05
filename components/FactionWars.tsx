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

function FactionCard({ faction, selected, onSelect, disabled }: { faction: Faction; selected: boolean; onSelect: () => void; disabled: boolean; }) {
  return (
    <button onClick={onSelect} disabled={disabled} style={{ background: selected ? faction.bgColor : "rgba(255,255,255,0.03)", border: `2px solid ${selected ? faction.borderColor : "rgba(255,255,255,0.08)"}`, borderRadius: 12, padding: "10px 8px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 80, boxShadow: selected ? `0 0 16px ${faction.color}44` : "none", transform: selected ? "scale(1.04)" : "scale(1)" }}>
      <div style={{ fontSize: 28 }}>{faction.emoji}</div>
      <div style={{ fontSize: 10, fontWeight: 900, color: faction.color, letterSpacing: "0.05em" }}>{faction.name.toUpperCase()}</div>
      <div style={{ fontSize: 8, opacity: 0.6, textAlign: "center" }}>{faction.weapon}</div>
    </button>
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
  const [tab, setTab] = React.useState<"warlords"|"factions"|"streaks"|"rich"|"perfect">("warlords");
  const tabs = [{id:"warlords",label:"🏆 Warlords"},{id:"factions",label:"⚔️ Factions"},{id:"streaks",label:"🔥 Streaks"},{id:"rich",label:"💰 Richest"},{id:"perfect",label:"👑 Perfect"}] as const;
  const shorten = (id: string) => id.startsWith("discord:") ? id.slice(8,16)+"…" : id.slice(0,10)+"…";
  return (
    <div style={{ marginTop: 24, borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.4)", overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
        {tabs.map(t => (<button key={t.id} onClick={() => setTab(t.id as any)} style={{ padding: "10px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", background: tab===t.id ? "rgba(255,255,255,0.08)" : "transparent", border: "none", color: tab===t.id ? "white" : "rgba(255,255,255,0.5)", borderBottom: tab===t.id ? "2px solid #fbbf24" : "2px solid transparent", whiteSpace: "nowrap" }}>{t.label}</button>))}
      </div>
      <div style={{ padding: 16 }}>
        {tab === "factions" ? (
          <div>
            <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 10 }}>Community faction wins this season</div>
            {lb.factions.length === 0 ? <div style={{ opacity: 0.4, fontSize: 12 }}>No data yet</div> :
              lb.factions.slice(0,8).map((f,i) => { const fd = FACTIONS[f.faction as FactionId]; if (!fd) return null;
                return (<div key={f.faction} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}><span style={{ opacity:0.5, fontSize:11, width:18 }}>#{i+1}</span><span style={{ fontSize:16 }}>{fd.emoji}</span><span style={{ fontWeight:700, fontSize:13, color:fd.color, flex:1 }}>{fd.name}</span><span style={{ opacity:0.7, fontSize:12 }}>{f.wins} wins</span></div>); })}
          </div>
        ) : (
          <div>
            {(lb[tab as keyof Omit<FWLeaderboards,"factions">] as any[]).length === 0
              ? <div style={{ opacity:0.4, fontSize:12 }}>No data yet — be first!</div>
              : (lb[tab as keyof Omit<FWLeaderboards,"factions">] as any[]).slice(0,5).map((e:any,i:number) => (
                <div key={e.playerId+i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <span style={{ opacity:0.5, fontSize:11, width:18 }}>#{i+1}</span>
                  <span style={{ flex:1, fontSize:12, fontWeight:600 }}>{e.playerName || shorten(e.playerId)}</span>
                  <span style={{ fontSize:13, fontWeight:800, color:"#fbbf24" }}>{e.score.toLocaleString()}</span>
                </div>))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FactionWars() {
  const initialProfile = typeof window !== "undefined" ? loadProfile() : null;
  const initialEffectiveId = initialProfile ? getEffectivePlayerId(initialProfile) : "guest";
  const [effectivePlayerId, setEffectivePlayerId] = useState(initialEffectiveId);
  const [playerName, setPlayerName] = useState(initialProfile?.discordName || initialProfile?.name || "");
  const lastPidRef = useRef("");
  useEffect(() => {
    const u = () => { const p = loadProfile(); const id = getEffectivePlayerId(p)||"guest"; setEffectivePlayerId(id); setPlayerName(p?.discordName||p?.name||""); };
    u(); window.addEventListener("ra:identity-changed", u); return () => window.removeEventListener("ra:identity-changed", u);
  }, []);
  const { balance, spend, earn, refresh, totalEarnRoom } = usePoints(effectivePlayerId);
  useEffect(() => { if (!effectivePlayerId||lastPidRef.current===effectivePlayerId) return; lastPidRef.current=effectivePlayerId; refresh().catch(()=>{}); }, [effectivePlayerId, refresh]);
  const [profile, setProfile] = useState(initialProfile);
  useEffect(() => { const s=()=>setProfile(loadProfile()); s(); window.addEventListener("ra:identity-changed",s); return ()=>window.removeEventListener("ra:identity-changed",s); }, []);
  useEffect(() => { if (typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("discord")==="1") window.dispatchEvent(new Event("ra:identity-changed")); }, []);

  const [cfg, setCfg] = useState<any>(defaultPointsConfig);
  useEffect(() => { fetch("/api/config",{cache:"no-store"}).then(r=>r.json()).then(j=>{if(j?.pointsConfig)setCfg((c:any)=>({...c,...j.pointsConfig}));}).catch(()=>{}); }, []);
  const fwCost       = Number((cfg as any)?.factionWarsCost        ?? 150);
  const difficulty   = Number((cfg as any)?.factionWarsAIDifficulty ?? 0.65);
  const currency     = String(cfg?.currency || "REBEL");
  const rewardCommon = Number(cfg?.rewards?.common ?? 50);
  const rewardRare   = Number(cfg?.rewards?.rare   ?? 100);
  const rewardUltra  = Number(cfg?.rewards?.ultra  ?? 300);

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
    const newResults = [...results, result];
    setResults(newResults); setSelectedMove(null); setPhase("territory_result"); setBusy(false);
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
    let pts = rarity==="ultra" ? rewardUltra : rarity==="rare" ? rewardRare : rarity==="common" ? rewardCommon : 0;
    if (team.includes("shogun") && rarity==="ultra") pts = Math.floor(pts*1.15);
    if (team.includes("buke") && rarity==="none") { const dc=allResults.filter(r=>r.playerMove.type==="defend").length; if(dc>=3){rarity="common";pts=rewardCommon;} }
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

  const isDiscordConnected = !!profile?.discordUserId && !(profile as any)?.discordSkipLink;
  const currentPlayerFaction = phase==="battle" ? (team[currentFactionIdx]||team[0]) : null;
  const currentPlayerFD = currentPlayerFaction ? FACTIONS[currentPlayerFaction] : null;
  const currentDefenderFD = defenders[currentTerritory] ? FACTIONS[defenders[currentTerritory]] : null;
  const territoriesWon = results.filter(r=>r.won).length;
  const rc = { ultra:"#fbbf24", rare:"#60a5fa", common:"#34d399", none:"#f87171" };
  const rl = { ultra:"🏆 ULTRA — LEGENDARY VICTORY!", rare:"⚔️ RARE — STRONG CAMPAIGN!", common:"✅ COMMON — SOLDIERS HOLD!", none:"💀 DEFEAT — YOUR FORCES FELL" };

  return (
    <div style={{ minHeight:"100vh", background:"#080b14", color:"white", fontFamily:"'Segoe UI',sans-serif" }}>
      {showBuyPoints && <BuyPointsModal onClose={()=>setShowBuyPoints(false)} playerId={effectivePlayerId} onSuccess={()=>{setShowBuyPoints(false);void refresh();}} />}
      <div style={{ backgroundImage:"url('/bg/faction-wars-bg.png')", backgroundSize:"cover", backgroundPosition:"center top", backgroundRepeat:"no-repeat", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom, rgba(8,11,20,0.35) 0%, rgba(8,11,20,0.85) 100%)", zIndex:0, pointerEvents:"none" }} />
        <div style={{ maxWidth:900, margin:"0 auto", padding:"24px 20px", position:"relative", zIndex:1 }}>
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

      <div style={{ maxWidth:900, margin:"0 auto", padding:"20px 16px" }}>
        <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"14px 18px", marginBottom:18, display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
          <div style={{ flex:1, display:"flex", gap:20, flexWrap:"wrap", alignItems:"center" }}>
            <div><span style={{ opacity:0.6, fontSize:12 }}>Balance </span><span style={{ fontWeight:900, fontSize:16, color:"#fbbf24" }}>{balance.toLocaleString()} {currency}</span></div>
            <div><span style={{ opacity:0.6, fontSize:12 }}>Cost </span><span style={{ fontWeight:700, fontSize:14, color:"#f87171" }}>{fwCost} {currency}</span></div>
            {!isDiscordConnected && <button onClick={()=>{window.location.href="/api/auth/discord/login";}} style={{ background:"rgba(88,101,242,0.2)", border:"1px solid rgba(88,101,242,0.4)", borderRadius:20, padding:"5px 14px", cursor:"pointer", fontSize:12, fontWeight:700, color:"#818cf8" }}>🔗 Connect Discord</button>}
          </div>
          <button onClick={()=>setShowBuyPoints(true)} style={{ background:"rgba(251,191,36,0.15)", border:"1px solid rgba(251,191,36,0.3)", borderRadius:20, padding:"6px 16px", cursor:"pointer", fontSize:12, fontWeight:700, color:"#fbbf24" }}>+ Buy Points</button>
        </div>

        {phase === "idle" && (
          <div>
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"24px 20px", marginBottom:18 }}>
              <div style={{ fontSize:28, fontWeight:900, marginBottom:6 }}>⚔️ Faction Wars</div>
              <p style={{ opacity:0.7, fontSize:13, marginBottom:18 }}>Assemble 5 faction warriors. Battle through 5 enemy territories. Each faction brings unique weapons, magic, and passives. The AI fights back hard — know your factions or fall.</p>
              <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
                {Array.from({length:TEAM_SIZE},(_,i)=>{const fid=team[i];const f=fid?FACTIONS[fid]:null;return(
                  <div key={i} style={{ width:60, height:70, borderRadius:10, background:f?f.bgColor:"rgba(255,255,255,0.03)", border:`2px solid ${f?f.borderColor:"rgba(255,255,255,0.1)"}`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontSize:f?28:22, opacity:f?1:0.3, cursor:f?"pointer":"default", transition:"all 0.2s" }} onClick={()=>f&&setTeam(prev=>prev.filter((_,j)=>j!==i))}>
                    {f?f.emoji:"＋"}{f&&<div style={{fontSize:8,color:f.color,fontWeight:700,marginTop:2}}>{f.name}</div>}
                  </div>
                );})}
                <div style={{ fontSize:11, opacity:0.5 }}>
                  {team.length}/{TEAM_SIZE}
                  {team.length>0&&<span style={{marginLeft:8,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTeam([])}>clear</span>}
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(88px,1fr))", gap:8, marginBottom:20 }}>
                {FACTION_IDS.map(fid=>(<FactionCard key={fid} faction={FACTIONS[fid]} selected={team.includes(fid)} onSelect={()=>toggleFaction(fid)} disabled={false} />))}
              </div>
              {team.length>0&&(
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
                  {team.map((fid,i)=>{const f=FACTIONS[fid];return(
                    <div key={i} style={{ background:f.bgColor, border:`1px solid ${f.borderColor}`, borderRadius:10, padding:"8px 12px", fontSize:11, minWidth:130 }}>
                      <div style={{ fontWeight:800, color:f.color, marginBottom:3 }}>{f.emoji} {f.name}</div>
                      <div style={{ opacity:0.7, marginBottom:2 }}>⚡ {f.passive}</div>
                      <div style={{ opacity:0.55, fontSize:10 }}>{f.passiveDesc}</div>
                    </div>
                  );})}
                </div>
              )}
              {runMessage&&<div style={{ color:"#f87171", fontSize:13, marginBottom:12 }}>{runMessage}</div>}
              <button onClick={startCampaign} disabled={team.length<TEAM_SIZE||busy||balance<fwCost} style={{ padding:"13px 28px", borderRadius:12, border:"none", cursor:team.length<TEAM_SIZE||busy||balance<fwCost?"not-allowed":"pointer", background:team.length<TEAM_SIZE?"rgba(255,255,255,0.08)":"linear-gradient(135deg,#dc2626,#9f1239)", color:"white", fontWeight:900, fontSize:16, opacity:team.length<TEAM_SIZE||balance<fwCost?0.5:1, boxShadow:team.length===TEAM_SIZE?"0 0 24px rgba(220,38,38,0.4)":"none", transition:"all 0.2s" }}>
                {team.length<TEAM_SIZE?`⚔️ Select ${TEAM_SIZE-team.length} more warriors`:busy?"Assembling...":`⚔️ Launch Campaign (-${fwCost} ${currency})`}
              </button>
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
                  <div style={{ fontSize:60, lineHeight:1, filter:battleAnim==="win"?"drop-shadow(0 0 20px #34d399)":battleAnim==="lose"?"grayscale(0.8)":"none", transform:battleAnim==="clash"?"scale(1.2) translateX(10px)":"scale(1)", transition:"all 0.3s" }}>{currentPlayerFD.emoji}</div>
                  <div style={{ fontWeight:900, fontSize:14, color:currentPlayerFD.color, marginTop:6 }}>{currentPlayerFD.name}</div>
                  <div style={{ fontSize:10, opacity:0.5 }}>Warrior {currentFactionIdx+1}</div>
                </div>
                <div style={{ fontSize:32, opacity:0.8, fontWeight:900 }}>{battleAnim==="clash"?"💥":battleAnim==="win"?"✅":battleAnim==="lose"?"💀":"VS"}</div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:60, lineHeight:1, filter:battleAnim==="win"?"grayscale(0.8)":battleAnim==="lose"?"drop-shadow(0 0 20px #f87171)":"none", transform:battleAnim==="clash"?"scale(1.2) translateX(-10px)":"scale(1)", transition:"all 0.3s" }}>{currentDefenderFD.emoji}</div>
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
              <button onClick={fightTerritory} disabled={!selectedMove||busy} style={{ marginTop:16, padding:"12px 24px", borderRadius:12, border:"none", cursor:!selectedMove||busy?"not-allowed":"pointer", background:selectedMove?"linear-gradient(135deg,#dc2626,#9f1239)":"rgba(255,255,255,0.06)", color:"white", fontWeight:900, fontSize:15, opacity:!selectedMove?0.5:1, boxShadow:selectedMove?"0 0 20px rgba(220,38,38,0.35)":"none", width:"100%", transition:"all 0.2s" }}>
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
                <div style={{ fontSize:24, alignSelf:"center", opacity:0.6 }}>VS</div>
                <div><div style={{fontSize:11,opacity:0.5,marginBottom:4}}>{df.name}'s counter</div><div style={{fontSize:14,fontWeight:800}}>{last.enemyMove.emoji} {last.enemyMove.label}</div><div style={{fontSize:12,color:"#f87171"}}>Power: {last.enemyPower.toFixed(1)}</div></div>
              </div>
              <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:20 }}>
                {defenders.map((def,i)=>(<TerritoryBadge key={i} index={i} result={results[i]} isCurrent={false} defender={def} />))}
              </div>
              <button onClick={nextTerritory} style={{ padding:"12px 28px", borderRadius:12, border:"none", cursor:"pointer", background:currentTerritory+1<TERRITORY_COUNT?"linear-gradient(135deg,#dc2626,#9f1239)":"linear-gradient(135deg,#fbbf24,#f59e0b)", color:currentTerritory+1<TERRITORY_COUNT?"white":"#000", fontWeight:900, fontSize:15 }}>
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
                {team.map((fid,i)=>(<div key={i} style={{ fontSize:28, opacity:results[i]?.won===false?0.35:1 }} title={FACTIONS[fid].name}>{FACTIONS[fid].emoji}</div>))}
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
              <button onClick={resetGame} style={{ padding:"12px 28px", borderRadius:12, border:"none", cursor:"pointer", background:"linear-gradient(135deg,#dc2626,#9f1239)", color:"white", fontWeight:900, fontSize:15, boxShadow:"0 0 20px rgba(220,38,38,0.3)" }}>⚔️ New Campaign</button>
            </div>
            <FWLeaderboardPanel lb={lb} />
          </div>
        )}
      </div>
    </div>
  );
}
