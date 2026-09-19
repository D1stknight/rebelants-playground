// components/Siege/shared.ts — types + tables shared by the side-view engine (Pixi) and the POV engine (three)
export type Hud = { gate: number; gateMax: number; wave: number; waves: number; horde: number; score: number; kills: number; reload: number; state: "ready" | "play" | "won" | "lost"; msg: string | null; charge?: number };
export type Callbacks = { onHud: (h: Hud) => void; onSfx?: (n: "launch" | "impact" | "crash" | "squish" | "gate" | "horn" | "lose" | "win") => void; onEnd?: (r: { won: boolean; score: number; kills: number; waves: number }) => void };
export const FACTIONS = ["ronin", "samurai", "ashigaru", "yamabushi"] as const;
/** factions that fight from the battlements in first person (over the shoulder) instead of the catapult side view */
export const POV_FACTIONS = ["ashigaru", "yamabushi"] as const;
export const KIT: Record<string, { name: string; ammo: string; clip: "attack" | "magic" | "special"; tint: number }> = {
  boulder: { name: "Catapult crew", ammo: "Boulder", clip: "attack", tint: 0xffffff },
  ronin: { name: "Ronin", ammo: "The Ronin leaps herself — carves a line through the ranks and dashes back", clip: "special", tint: 0xff4d5e },
  samurai: { name: "Samurai", ammo: "Blade boulder — cuts everything around the impact", clip: "attack", tint: 0xff7a7a },
  ashigaru: { name: "Ashigaru", ammo: "Spears from the battlements — hold to charge a volley of five", clip: "attack", tint: 0x8fe08f },
  yamabushi: { name: "Yamabushi", ammo: "Storm orb — lightning chains through the horde; hold to charge a bigger storm", clip: "magic", tint: 0x9ec7ff },
};
export const WAVES: { crawlers: number; big: number; tower?: number; ram?: number; gap: number }[] = [
  { crawlers: 8, big: 0, gap: 0.9 }, { crawlers: 12, big: 2, gap: 0.7 }, { crawlers: 10, big: 2, tower: 1, gap: 0.7 },
  { crawlers: 16, big: 4, gap: 0.55 }, { crawlers: 14, big: 3, tower: 1, ram: 1, gap: 0.55 }, { crawlers: 22, big: 6, tower: 2, ram: 1, gap: 0.45 },
];
export const FX = ["spark", "spark2", "ring", "glow", "flare", "smoke", "smoke2", "fire", "flame", "dirt", "bolt", "bolt2", "star", "slash", "magic", "scorch", "twirl", "muzzle"];
