// components/Siege/shared.ts — types + tables shared by the siege engine and the React shell
export type Hud = { gate: number; gateMax: number; wave: number; waves: number; horde: number; score: number; kills: number; reload: number; state: "ready" | "play" | "won" | "lost"; msg: string | null; charge?: number; intro?: boolean; menu?: boolean; banner?: boolean; paused?: boolean; boss?: { name: string; hp: number; max: number } | null; treb?: boolean; wallView?: boolean; threat?: number };
export type Callbacks = { audio?: import("./audio").SiegeAudio; onHud: (h: Hud) => void; onSfx?: (n: "launch" | "impact" | "crash" | "squish" | "gate" | "horn" | "lose" | "win") => void; onLost?: () => void; onEnd?: (r: { won: boolean; score: number; kills: number; waves: number }) => void };
export type View = "side" | "pov";
/** every faction, in picker order: catapult crews first, then the ones who fight from the battlements in first person */
export const FACTIONS = ["ronin", "samurai", "warrior", "buke", "shogun", "ashigaru", "yamabushi", "kenshi", "sohei", "bushi", "wokou"] as const;
export const POV_FACTIONS = ["ashigaru", "yamabushi", "kenshi", "sohei", "bushi", "wokou"] as const;
export const viewOf = (f: string): View => ((POV_FACTIONS as readonly string[]).includes(f) ? "pov" : "side");
export const KIT: Record<string, { name: string; ammo: string; clip: "attack" | "magic" | "special"; tint: number; reload: number }> = {
  boulder: { name: "Catapult crew", ammo: "Plain boulder — hold to charge a heavier throw", clip: "attack", tint: 0xffffff, reload: 1.3 },
  ronin: { name: "Ronin", ammo: "Shadow Step — she leaps to the mark herself, carves everything around her and blinks back", clip: "special", tint: 0xff4d5e, reload: 1.5 },
  samurai: { name: "Samurai", ammo: "Blade boulder — a ring of blades cuts everything around the impact", clip: "attack", tint: 0xff7a7a, reload: 1.4 },
  warrior: { name: "Warrior", ammo: "Greatstone — a huge slow boulder that flattens a wide circle", clip: "attack", tint: 0xffa04a, reload: 2.1 },
  buke: { name: "Buke", ammo: "Shield boulder — hits the horde and mends the gate where it lands", clip: "attack", tint: 0x8fb8ff, reload: 1.5 },
  shogun: { name: "Shogun", ammo: "War standard — plants a banner; the garrison rallies and rains arrows around it", clip: "special", tint: 0xffd27a, reload: 2.4 },
  ashigaru: { name: "Ashigaru", ammo: "Spears from the battlements — hold to charge a volley of five", clip: "attack", tint: 0x8fe08f, reload: 1.0 },
  yamabushi: { name: "Yamabushi", ammo: "Storm orb — lightning chains through the horde; hold for a bigger storm", clip: "magic", tint: 0x9ec7ff, reload: 1.4 },
  kenshi: { name: "Kenshi", ammo: "Blade fan — three fast blades that pierce the ranks; hold for seven", clip: "attack", tint: 0xe0e6ff, reload: 0.9 },
  sohei: { name: "Sohei", ammo: "Ward stone — a holy circle that burns the horde and mends the gate", clip: "magic", tint: 0xffe08a, reload: 1.8 },
  bushi: { name: "Bushi", ammo: "Trap stake — pins the first crawler that steps on it; hold to plant three", clip: "special", tint: 0xb8ffb0, reload: 1.1 },
  wokou: { name: "Wokou", ammo: "Grapple hook — yanks a crawler off its feet and slams it down on the rest", clip: "attack", tint: 0x7ad7ff, reload: 1.3 },
};
export type Wave = { crawlers: number; big: number; tower?: number; ram?: number; slingers?: number; wasps?: number; brutes?: number; brood?: boolean; gap: number; name?: string };
export const WAVES: Wave[] = [
  { crawlers: 10, big: 0, gap: 0.8, name: "WAVE 1 — scouts" },
  { crawlers: 16, big: 2, gap: 0.6, name: "WAVE 2 — the crawl" },
  { crawlers: 14, big: 2, slingers: 3, tower: 1, gap: 0.6, name: "WAVE 3 — web-slingers" },
  { crawlers: 14, big: 3, wasps: 8, gap: 0.55, name: "WAVE 4 — wasps on the wind" },
  { crawlers: 18, big: 3, slingers: 3, tower: 1, ram: 1, gap: 0.5, name: "WAVE 5 — the ram" },
  { crawlers: 18, big: 4, brutes: 3, wasps: 6, gap: 0.45, name: "WAVE 6 — beetle brutes" },
  { crawlers: 40, big: 0, wasps: 4, gap: 0.22, name: "WAVE 7 — the swarm" },
  { crawlers: 22, big: 5, slingers: 4, wasps: 5, tower: 2, ram: 1, gap: 0.4, name: "WAVE 8 — twin towers" },
  { crawlers: 22, big: 6, brutes: 5, wasps: 6, ram: 2, gap: 0.4, name: "WAVE 9 — the iron shell" },
  { crawlers: 16, big: 2, slingers: 4, wasps: 22, gap: 0.45, name: "WAVE 10 — the sky hive" },
  { crawlers: 38, big: 8, slingers: 5, wasps: 10, brutes: 4, tower: 3, ram: 2, gap: 0.3, name: "WAVE 11 — the great push" },
  { crawlers: 24, big: 6, brutes: 3, wasps: 8, slingers: 2, brood: true, gap: 0.45, name: "FINAL WAVE — THE BROOD MOTHER" },
];
