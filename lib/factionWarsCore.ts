// Faction Wars — shared game-logic core (DUPLICATE for PvP)
//
// This file is a deliberate near-verbatim copy of the type defs, FACTIONS table,
// damage formula, block formula, passive bonus, and rarity helpers from
// components/FactionWars.tsx (the AI-mode component).
//
// WHY DUPLICATE: PvP is being added as a fully separate mode. We want zero risk
// of breaking the existing AI mode while we iterate on PvP. The cost is that any
// change to the AI-mode formula must be mirrored here. Once PvP is stable we
// will deduplicate by having FactionWars.tsx import from this module.
//
// Anything PvP-specific (e.g. PvP move resolution, territory transitions,
// turn-flipping) lives in lib/server/fwpvp.ts, NOT here. This file is the pure
// game-logic surface only.
//
// Note: pickEnemyMove (the AI move selector) is intentionally NOT included here
// because PvP has no AI — both sides are humans. If the AI mode formula changes
// it does NOT need to be re-mirrored here.
//

export type Rarity = "none" | "common" | "rare" | "ultra";
export type FactionId = "samurai"|"ronin"|"warrior"|"ashigaru"|"shogun"|"buke"|"kenshi"|"wokou"|"sohei"|"yamabushi"|"bushi";

type SamuraiAnimState = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";

export interface Move { id: string; label: string; emoji: string; desc: string; power: number; type: "attack"|"defend"|"magic"|"trick"; oneTime?: boolean; }

export function getSamuraiAnimForMove(move: Move | null): SamuraiAnimState {
  if (!move) return "idle";
  if (move.type === "attack") return "attack";
  if (move.type === "magic") return "magic";
  if (move.type === "trick") return "trick";
  if (move.type === "defend") return "defend";
  return "idle";
}

export function hasFaction3DCharacter(factionId: string): boolean {
  return factionId === "samurai" || factionId === "bushi";
}
export interface Faction { id: FactionId; name: string; emoji: string; color: string; bgColor: string; borderColor: string; role: string; passive: string; passiveDesc: string; weapon: string; moves: Move[]; weakTo: FactionId[]; strongVs: FactionId[]; }
export interface RoundResult { round:number; playerMove:Move; enemyMove:Move; playerDmg:number; enemyDmg:number; playerHpAfter:number; enemyHpAfter:number; }
export interface TerritoryResult { territory:number; defender:FactionId; playerFaction:FactionId; rounds:RoundResult[]; playerHpFinal:number; enemyHpFinal:number; won:boolean; }
type FWLeaderboards = { warlords: {playerId:string;playerName?:string;score:number}[]; factions:{faction:FactionId;wins:number;topPlayers?:{playerId:string;playerName?:string;wins:number}[]}[]; streaks:{playerId:string;playerName?:string;score:number}[]; rich:{playerId:string;playerName?:string;score:number}[]; perfect:{playerId:string;playerName?:string;score:number}[]; };

export const FACTIONS: Record<FactionId, Faction> = {
  samurai: { id:"samurai", name:"Samurai", emoji:"🔴", color:"#dc2626", bgColor:"rgba(220,38,38,0.12)", borderColor:"rgba(220,38,38,0.4)", role:"Core soldiers", passive:"First Strike", passiveDesc:"1st territory: +2 bonus damage dealt per round", weapon:"Katana",
    moves:[{id:"katana_strike",label:"Katana Strike",emoji:"⚔️",desc:"Full power slash — no reductions, straight damage",power:8,type:"attack"},{id:"honor_guard",label:"Honor Guard",emoji:"🛡️",desc:"Block stance — reduces incoming damage by 40%",power:6,type:"defend"},{id:"battle_cry",label:"Battle Cry",emoji:"📯",desc:"War cry — grants +4 damage for next 5 rounds",power:5,type:"magic"},{id:"counter_strike",label:"Counter Strike",emoji:"🔄",desc:"Counter — deal extra damage equal to enemy power",power:7,type:"trick"},{id:"iron_code",label:"Iron Code",emoji:"📜",desc:"+3 bonus damage for next 8 rounds (persists)",power:4,type:"magic"}],
    weakTo:["ronin","yamabushi"], strongVs:["ashigaru","buke"] },
  ronin: { id:"ronin", name:"Ronin", emoji:"⚫", color:"#9f1239", bgColor:"rgba(159,18,57,0.12)", borderColor:"rgba(159,18,57,0.45)", role:"Elite assassins", passive:"Comeback", passiveDesc:"After losing a territory: next warrior deals +15 bonus damage per round", weapon:"Twin Daggers",
    moves:[{id:"twin_daggers",label:"Twin Daggers",emoji:"🗡️",desc:"Double hit — two strikes at lower power each",power:7,type:"attack"},{id:"shadow_step",label:"Shadow Step",emoji:"👤",desc:"Dodge — enemy misses",power:6,type:"trick"},{id:"last_stand",oneTime:true,label:"Last Stand",emoji:"💀",desc:"Massive +15 bonus damage when your HP is below 40",power:9,type:"magic"},{id:"phantom_blade",oneTime:true,label:"Phantom Blade",emoji:"🌑",desc:"Strike through defenses — enemy block reduced 70%",power:8,type:"trick"},{id:"death_mark",label:"Death Mark",emoji:"☠️",desc:"+2 bonus damage for next 4 rounds",power:5,type:"magic"}],
    weakTo:["shogun","bushi"], strongVs:["samurai","warrior"] },
  warrior: { id:"warrior", name:"Warrior", emoji:"🟤", color:"#b45309", bgColor:"rgba(180,83,9,0.12)", borderColor:"rgba(180,83,9,0.4)", role:"Battle veterans", passive:"Relentless", passiveDesc:"Cracked Circle & Berserker Rage deal +20 extra damage per use", weapon:"Greatsword",
    moves:[{id:"greatsword",label:"Greatsword Slam",emoji:"🔨",desc:"Massive slam — highest base power of any attack",power:10,type:"attack"},{id:"iron_will",label:"Iron Will",emoji:"⛰️",desc:"Absorb enemy hit completely",power:7,type:"defend"},{id:"cracked_circle",label:"Cracked Circle",emoji:"💢",desc:"Sacrifice defense for +4 power",power:8,type:"magic"},{id:"berserker_rage",oneTime:true,label:"Berserker Rage",emoji:"🔥",desc:"Go berserk — max damage but all defend moves locked this territory",power:11,type:"attack"},{id:"blood_price",oneTime:true,label:"Blood Price",emoji:"🩸",desc:"Sacrifice 20 HP to deal double power damage this round",power:10,type:"attack"},
      {id:"war_stomp",label:"War Stomp",emoji:"👊",desc:"Stagger hit — reduces enemy damage by 3 this round",power:6,type:"trick"}],
    weakTo:["kenshi","sohei"], strongVs:["ronin","ashigaru"] },
  ashigaru: { id:"ashigaru", name:"Ashigaru", emoji:"🟢", color:"#166534", bgColor:"rgba(22,101,52,0.12)", borderColor:"rgba(22,101,52,0.4)", role:"Infantry force", passive:"Humble Roots", passiveDesc:"Campaign costs 25 REBEL less (125 total instead of 150)", weapon:"Spear",
    moves:[{id:"spear_thrust",label:"Spear Thrust",emoji:"🌿",desc:"Steady thrust — consistent reliable damage every round",power:6,type:"attack"},{id:"shield_wall",label:"Shield Wall",emoji:"🛡️",desc:"Blocks 60% of damage",power:7,type:"defend"},{id:"rally",label:"Rally",emoji:"📣",desc:"Rally — reduces incoming damage to 0 this round and fully blocks",power:5,type:"magic"},{id:"phalanx",label:"Phalanx",emoji:"🔰",desc:"Shield lock — 40% block with no damage penalty",power:8,type:"defend"},{id:"endure",label:"Endure",emoji:"💪",desc:"Endure — take 0 damage this round (can never finish a territory alone)",power:5,type:"defend"}],
    weakTo:["warrior","ronin"], strongVs:["wokou","sohei"] },
  shogun: { id:"shogun", name:"Shogun", emoji:"🟡", color:"#854d0e", bgColor:"rgba(133,77,14,0.12)", borderColor:"rgba(133,77,14,0.45)", role:"Commander", passive:"Divine Authority", passiveDesc:"Ultra victory: REBEL reward boosted by 15%", weapon:"War Staff",
    moves:[{id:"command_strike",label:"Command Strike",emoji:"👑",desc:"Command — next round gains permanent +8 flat damage bonus",power:9,type:"magic"},{id:"strategic_ret",label:"Strategic Retreat",emoji:"🏳️",desc:"Retreat — your team gets Common reward even if campaign fails",power:5,type:"defend"},{id:"divine_auth",label:"Divine Authority",emoji:"⚡",desc:"Authority — guarantees minimum Common reward this campaign",power:7,type:"magic"},{id:"imperial_decree",oneTime:true,label:"Imperial Decree",emoji:"📋",desc:"Decree — forces enemy to use their weakest move this round",power:8,type:"trick"},{id:"final_command",oneTime:true,label:"Final Command",emoji:"📣",desc:"Epic decree — forces enemy to 1 power AND you get +6 damage",power:9,type:"magic"},
      {id:"warlords_fury",label:"Warlord's Fury",emoji:"⚡",desc:"Fury — base power +4 per territory already won",power:7,type:"attack"}],
    weakTo:["yamabushi","wokou"], strongVs:["ronin","bushi"] },
  buke: { id:"buke", name:"Buke", emoji:"🪖", color:"#4d7c0f", bgColor:"rgba(77,124,15,0.12)", borderColor:"rgba(77,124,15,0.4)", role:"Noble defenders", passive:"Noble Guard", passiveDesc:"Mostly used defend moves? A campaign loss flips to Common win", weapon:"Trident",
    moves:[{id:"trident_stab",label:"Trident Stab",emoji:"🔱",desc:"Triple strike — three fast hits, reliable damage",power:7,type:"attack"},{id:"noble_defense",label:"Noble Defense",emoji:"🏰",desc:"Noble stance — 40% block with honorable defense",power:8,type:"defend"},{id:"honor_bond",label:"Honor Bond",emoji:"🤝",desc:"+3 permanent damage bonus for rest of campaign",power:6,type:"magic"},{id:"bastion",label:"Bastion",emoji:"🏯",desc:"Fortress — 40% block + +5 bonus damage dealt",power:9,type:"defend"},{id:"noble_sacrifice",oneTime:true,label:"Noble Sacrifice",emoji:"💎",desc:"SACRIFICE: warrior dies instantly. Next warrior gets +12 permanent damage boost",power:4,type:"magic"}],
    weakTo:["samurai","kenshi"], strongVs:["yamabushi","wokou"] },
  kenshi: { id:"kenshi", name:"Kenshi", emoji:"🩵", color:"#0f766e", bgColor:"rgba(15,118,110,0.12)", borderColor:"rgba(15,118,110,0.4)", role:"Sword masters", passive:"Blade Harmony", passiveDesc:"Win 3 territories in a row: all moves deal +12 extra damage", weapon:"Katana",
    moves:[{id:"precision_slash",label:"Precision Slash",emoji:"🌊",desc:"Precision cut — reduces enemy block effectiveness by 70%",power:8,type:"attack"},{id:"blade_harmony",label:"Blade Harmony",emoji:"🌀",desc:"+3 permanent damage bonus for rest of campaign",power:7,type:"magic"},{id:"meditation",label:"Meditative Focus",emoji:"🧘",desc:"Focus — stacks +2 damage per territory you use this move",power:5,type:"defend"},{id:"blade_storm",oneTime:true,label:"Blade Storm",emoji:"💨",desc:"Blade storm — rapid strikes with +7 bonus damage",power:9,type:"attack"},{id:"mirror_slash",label:"Mirror Slash",emoji:"🪞",desc:"Reflect — deals damage equal to what you just took last round",power:7,type:"trick"},
      {id:"perfect_form",label:"Perfect Form",emoji:"✨",desc:"+3 bonus if you took 0 damage last round",power:7,type:"defend"}],
    weakTo:["wokou","warrior"], strongVs:["buke","samurai"] },
  wokou: { id:"wokou", name:"Wokou", emoji:"🌊", color:"#475569", bgColor:"rgba(71,85,105,0.12)", borderColor:"rgba(71,85,105,0.4)", role:"Sea raiders", passive:"Sea Raider", passiveDesc:"Win a territory: random chance to earn extra bonus REBEL", weapon:"Cutlass",
    moves:[{id:"cutlass_raid",label:"Cutlass Raid",emoji:"🏴‍☠️",desc:"40% chance to earn +10 bonus REBEL when you win this territory",power:7,type:"trick"},{id:"sea_storm",label:"Sea Storm",emoji:"🌊",desc:"Chaos strike — random power 4-10 this round",power:7,type:"magic"},{id:"ghost_tide",label:"Ghost Tide",emoji:"👻",desc:"Disappear — enemy nullified",power:6,type:"trick"},{id:"ambush",oneTime:true,label:"Ambush",emoji:"🗺️",desc:"Ambush — deals +4 bonus damage if enemy also attacked",power:8,type:"trick"},{id:"plunder",label:"Plunder",emoji:"💰",desc:"Loot bonus — win this territory to earn extra REBEL (see reward)",power:6,type:"magic"}],
    weakTo:["ashigaru","buke"], strongVs:["kenshi","shogun"] },
  sohei: { id:"sohei", name:"Sohei", emoji:"🟠", color:"#c2410c", bgColor:"rgba(194,65,12,0.12)", borderColor:"rgba(194,65,12,0.4)", role:"Monk warriors", passive:"Monk Ward", passiveDesc:"Lose a territory with HP above 0: counts as a narrow escape", weapon:"War Staff",
    moves:[{id:"staff_sweep",label:"Staff Sweep",emoji:"🌅",desc:"Wide sweep — strong consistent attack damage",power:7,type:"attack"},{id:"monks_ward",label:"Monk's Ward",emoji:"☯️",desc:"Ward — blocks 55% of enemy damage this round",power:8,type:"defend"},{id:"enlightened",label:"Enlightened Strike",emoji:"🔥",desc:"Spiritual damage bypasses armor",power:9,type:"magic"},{id:"sacred_flame",oneTime:true,label:"Sacred Flame",emoji:"🕯️",desc:"Sacred fire — +7 spiritual damage bonus",power:8,type:"magic"},{id:"iron_meditation",label:"Iron Meditation",emoji:"🧘",desc:"Meditate — heals +15 HP and gives +3 damage bonus for 4 rounds",power:6,type:"defend"}],
    weakTo:["ashigaru","kenshi"], strongVs:["warrior","yamabushi"] },
  yamabushi: { id:"yamabushi", name:"Yamabushi", emoji:"🔵", color:"#164e63", bgColor:"rgba(22,78,99,0.12)", borderColor:"rgba(22,78,99,0.4)", role:"Mountain mystics", passive:"Spirit Vision", passiveDesc:"One random territory this campaign: hidden +5 damage bonus", weapon:"Mystic Staff",
    moves:[{id:"mystic_flame",label:"Mystic Flame",emoji:"🔮",desc:"Random elemental power 4-10 via chaos magic",power:7,type:"magic"},{id:"spirit_vision",label:"Spirit Vision",emoji:"👁️",desc:"Vision — +3 damage bonus activates each round you use this",power:6,type:"trick"},{id:"mountain_seal",oneTime:true,label:"Mountain Seal",emoji:"🗻",desc:"Seal — +3 damage bonus after using (mountain power)",power:8,type:"magic"},{id:"void_seal",oneTime:true,label:"Void Seal",emoji:"🌀",desc:"Erase enemy move — they get power 1",power:9,type:"magic"},{id:"mountain_echo",label:"Mountain Echo",emoji:"📣",desc:"Echo — replays 70% of last round's damage as extra bonus",power:6,type:"trick"}],
    weakTo:["sohei","samurai"], strongVs:["shogun","buke"] },
  bushi: { id:"bushi", name:"Bushi", emoji:"🔷", color:"#1e3a5f", bgColor:"rgba(30,58,95,0.12)", borderColor:"rgba(30,58,95,0.45)", role:"Tactical officers", passive:"Tactical Mind", passiveDesc:"Each round: see enemy faction weaknesses before choosing", weapon:"Tactical Blade",
    moves:[{id:"tactical_blade",label:"Tactical Blade",emoji:"🗡️",desc:"Blade strike — +2 bonus damage for attack moves",power:7,type:"attack"},{id:"officers_order",label:"Officer's Order",emoji:"📋",desc:"+3 bonus damage for all attack moves this territory",power:6,type:"magic"},{id:"strategic_mind",oneTime:true,label:"Strategic Mind",emoji:"🧠",desc:"Tactical read — +2 damage per territory already won",power:8,type:"trick"},{id:"field_intel",label:"Field Intel",emoji:"🔭",desc:"Intel — +3 bonus if your move counters the enemy type",power:7,type:"trick"},{id:"tactical_strike",label:"Tactical Strike",emoji:"🎯",desc:"Calculated blow — power equals territories won",power:7,type:"attack"}],
    weakTo:["samurai","sohei"], strongVs:["ronin","wokou"] },
};


export const TEAM_SIZE = 5;
export const TERRITORY_COUNT = 5;

// ── HP COMBAT ENGINE ──────────────────────────────────────────────────────────
export const MAX_HP = 100;

export function calcDamage(move: Move, atk: FactionId, def: FactionId, bonus: number, tWon: number, tLost: number, diff: number, isPlayer: boolean): number {
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
  // AI gets slightly higher cap so fights feel dangerous
  return Math.max(2, Math.min(Math.round(dmg), isPlayer ? 24 : 28));
}

export function calcBlock(move: Move): number {
  if (move.id === "rally") return 1.0; // Rally = full block this round
  if (["shadow_step","ghost_tide","vanishing_cut"].includes(move.id)) return 0.40;
  if (["monks_ward"].includes(move.id)) return 0.55;
  if (["noble_defense","honor_guard","phalanx","bastion"].includes(move.id)) return 0.40;
  if (["shield_wall","iron_will","endure"].includes(move.id)) return 0.35;
  if (move.id === "bushido_stand") return 0.30;
  if (move.type === "defend") return 0.25;
  return 0;
}


export function calcPassiveBonus(faction: FactionId, territoriesWon: number, isT1: boolean): number {
  if (faction === "samurai" && isT1) return 2;
  if (faction === "shogun" || faction === "bushi") return 1;
  return 0;
}

export function calcRarity(won: number): Rarity {
  if (won === 5) return "ultra";
  if (won >= 3) return "rare";
  if (won >= 1) return "common";
  return "none";
}




export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];
