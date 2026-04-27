// lib/factionConfig.ts — All 11 Rebel Ants factions
export type FactionId =
  | 'ashigaru' | 'ronin' | 'samurai' | 'bushi' | 'warrior'
  | 'shogun' | 'buke' | 'kenshi' | 'wokou' | 'sohei' | 'yamabushi';

export type RoleId = 'scout' | 'soldier' | 'carrier' | 'guard' | 'bomber';

export interface FactionDef {
  id: FactionId;
  name: string;
  available: boolean;
  colors: {
    primary: string;   // main accent color
    secondary: string; // supporting color
    bg: string;        // card background
    glow: string;      // box-shadow glow
    text: string;      // label text color
    gradient: string;  // CSS gradient string
  };
  roles: Record<RoleId, { img: string; label: string }>;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  ashigaru: {
    id: 'ashigaru', name: 'Ashigaru', available: true,
    colors: {
      primary: '#4ade80', secondary: '#16a34a',
      bg: 'rgba(22,163,74,0.12)', glow: 'rgba(74,222,128,0.5)',
      text: '#4ade80', gradient: 'linear-gradient(135deg,#14532d,#166534,#15803d)',
    },
    roles: {
      scout:   { img: '/factions/ashigaru/ashigaru_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/ashigaru/ashigaru_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/ashigaru/ashigaru_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/ashigaru/ashigaru_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/ashigaru/ashigaru_bomber.PNG',  label: 'Bomber'  },
    },
  },
  ronin: {
    id: 'ronin', name: 'Ronin', available: false,
    colors: {
      primary: '#ef4444', secondary: '#1c1917',
      bg: 'rgba(239,68,68,0.1)', glow: 'rgba(239,68,68,0.45)',
      text: '#f87171', gradient: 'linear-gradient(135deg,#1c1917,#292524,#ef4444)',
    },
    roles: {
      scout:   { img: '/factions/ronin/ronin_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/ronin/ronin_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/ronin/ronin_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/ronin/ronin_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/ronin/ronin_bomber.PNG',  label: 'Bomber'  },
    },
  },
  samurai: {
    id: 'samurai', name: 'Samurai', available: false,
    colors: {
      primary: '#dc2626', secondary: '#7f1d1d',
      bg: 'rgba(220,38,38,0.1)', glow: 'rgba(220,38,38,0.45)',
      text: '#fca5a5', gradient: 'linear-gradient(135deg,#450a0a,#7f1d1d,#dc2626)',
    },
    roles: {
      scout:   { img: '/factions/samurai/samurai_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/samurai/samurai_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/samurai/samurai_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/samurai/samurai_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/samurai/samurai_bomber.PNG',  label: 'Bomber'  },
    },
  },
  bushi: {
    id: 'bushi', name: 'Bushi', available: false,
    colors: {
      primary: '#eab308', secondary: '#1e3a5f',
      bg: 'rgba(30,58,95,0.2)', glow: 'rgba(234,179,8,0.45)',
      text: '#fbbf24', gradient: 'linear-gradient(135deg,#0c1a2e,#1e3a5f,#b45309)',
    },
    roles: {
      scout:   { img: '/factions/bushi/bushi_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/bushi/bushi_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/bushi/bushi_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/bushi/bushi_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/bushi/bushi_bomber.PNG',  label: 'Bomber'  },
    },
  },
  warrior: {
    id: 'warrior', name: 'Warriors', available: false,
    colors: {
      primary: '#b45309', secondary: '#78350f',
      bg: 'rgba(180,83,9,0.1)', glow: 'rgba(180,83,9,0.45)',
      text: '#fb923c', gradient: 'linear-gradient(135deg,#431407,#78350f,#b45309)',
    },
    roles: {
      scout:   { img: '/factions/warrior/warrior_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/warrior/warrior_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/warrior/warrior_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/warrior/warrior_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/warrior/warrior_bomber.PNG',  label: 'Bomber'  },
    },
  },
  shogun: {
    id: 'shogun', name: 'Shogun', available: false,
    colors: {
      primary: '#a855f7', secondary: '#1e1b4b',
      bg: 'rgba(168,85,247,0.1)', glow: 'rgba(168,85,247,0.5)',
      text: '#c084fc', gradient: 'linear-gradient(135deg,#0f0720,#1e1b4b,#6b21a8)',
    },
    roles: {
      scout:   { img: '/factions/shogun/shogun_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/shogun/shogun_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/shogun/shogun_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/shogun/shogun_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/shogun/shogun_bomber.PNG',  label: 'Bomber'  },
    },
  },
  buke: {
    id: 'buke', name: 'Buke', available: false,
    colors: {
      primary: '#84cc16', secondary: '#3f6212',
      bg: 'rgba(132,204,22,0.08)', glow: 'rgba(132,204,22,0.4)',
      text: '#a3e635', gradient: 'linear-gradient(135deg,#1a2e05,#3f6212,#65a30d)',
    },
    roles: {
      scout:   { img: '/factions/buke/buke_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/buke/buke_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/buke/buke_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/buke/buke_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/buke/buke_bomber.PNG',  label: 'Bomber'  },
    },
  },
  kenshi: {
    id: 'kenshi', name: 'Kenshi', available: false,
    colors: {
      primary: '#06b6d4', secondary: '#164e63',
      bg: 'rgba(6,182,212,0.1)', glow: 'rgba(6,182,212,0.45)',
      text: '#67e8f9', gradient: 'linear-gradient(135deg,#083344,#164e63,#0e7490)',
    },
    roles: {
      scout:   { img: '/factions/kenshi/kenshi_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/kenshi/kenshi_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/kenshi/kenshi_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/kenshi/kenshi_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/kenshi/kenshi_bomber.PNG',  label: 'Bomber'  },
    },
  },
  wokou: {
    id: 'wokou', name: 'Wokou', available: false,
    colors: {
      primary: '#a16207', secondary: '#78350f',
      bg: 'rgba(161,98,7,0.1)', glow: 'rgba(161,98,7,0.4)',
      text: '#ca8a04', gradient: 'linear-gradient(135deg,#1c0a00,#431407,#92400e)',
    },
    roles: {
      scout:   { img: '/factions/wokou/wokou_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/wokou/wokou_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/wokou/wokou_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/wokou/wokou_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/wokou/wokou_bomber.PNG',  label: 'Bomber'  },
    },
  },
  sohei: {
    id: 'sohei', name: 'Sohei', available: false,
    colors: {
      primary: '#f97316', secondary: '#7c2d12',
      bg: 'rgba(249,115,22,0.1)', glow: 'rgba(249,115,22,0.45)',
      text: '#fdba74', gradient: 'linear-gradient(135deg,#2c0a00,#7c2d12,#c2410c)',
    },
    roles: {
      scout:   { img: '/factions/sohei/sohei_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/sohei/sohei_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/sohei/sohei_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/sohei/sohei_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/sohei/sohei_bomber.PNG',  label: 'Bomber'  },
    },
  },
  yamabushi: {
    id: 'yamabushi', name: 'Yamabushi', available: false,
    colors: {
      primary: '#14b8a6', secondary: '#134e4a',
      bg: 'rgba(20,184,166,0.1)', glow: 'rgba(20,184,166,0.45)',
      text: '#5eead4', gradient: 'linear-gradient(135deg,#042f2e,#134e4a,#0f766e)',
    },
    roles: {
      scout:   { img: '/factions/yamabushi/yamabushi_scout.PNG',   label: 'Scout'   },
      soldier: { img: '/factions/yamabushi/yamabushi_soldier.PNG', label: 'Soldier' },
      carrier: { img: '/factions/yamabushi/yamabushi_carrier.PNG', label: 'Carrier' },
      guard:   { img: '/factions/yamabushi/yamabushi_guard.PNG',   label: 'Guard'   },
      bomber:  { img: '/factions/yamabushi/yamabushi_bomber.PNG',  label: 'Bomber'  },
    },
  },
};

export const FACTION_LIST = Object.values(FACTIONS);
