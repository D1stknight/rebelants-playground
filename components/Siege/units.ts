// components/Siege/units.ts — animated faction sprites for The Siege (sheets from tools/siege-sprites: 256 px frames, 10 per row)
import * as PIXI from "pixi.js";

export type SheetMeta = { frame: number; cols: number; clips: Record<string, [number, number, number, boolean]>; feet: number; height: number };
export type Sheet = { tex: PIXI.Texture; meta: SheetMeta; frames: PIXI.Texture[] };
const cache: Record<string, Promise<Sheet>> = {};
export function loadSheet(fid: string): Promise<Sheet> {
  if (!cache[fid]) cache[fid] = (async () => {
    const [tex, meta] = await Promise.all([PIXI.Assets.load<PIXI.Texture>(`/siege/units/${fid}.png`), fetch(`/siege/units/${fid}.json`).then((r) => r.json()) as Promise<SheetMeta>]);
    const n = Math.max(...Object.values(meta.clips).map(([s, c]) => s + c)); const frames: PIXI.Texture[] = [];
    for (let i = 0; i < n; i++) frames.push(new PIXI.Texture({ source: tex.source, frame: new PIXI.Rectangle((i % meta.cols) * meta.frame, Math.floor(i / meta.cols) * meta.frame, meta.frame, meta.frame) }));
    return { tex, meta, frames };
  })();
  return cache[fid];
}

/** one animated ant. `heightPx` = how tall the standing model should draw (css px in world space); anchor at the feet */
export class Unit {
  sp: PIXI.Sprite; sheet: Sheet; clip = "idle"; f = 0; t = 0; loop = true; onDone: (() => void) | null = null; holdFrame: number | null = null; fid: string;
  constructor(sheet: Sheet, fid: string, heightPx: number, flip = false) {
    this.sheet = sheet; this.fid = fid; this.sp = new PIXI.Sprite(sheet.frames[0]); const k = heightPx / sheet.meta.height; this.sp.scale.set(flip ? -k : k, k);
    this.sp.anchor.set(0.5, sheet.meta.feet / sheet.meta.frame);
  }
  play(clip: string, opts: { loop?: boolean; onDone?: () => void; hold?: number | null; speed?: number } = {}) {
    if (!this.sheet.meta.clips[clip]) clip = "idle"; const c = this.sheet.meta.clips[clip];
    this.clip = clip; this.f = 0; this.t = 0; this.loop = opts.loop ?? c[3]; this.onDone = opts.onDone || null; this.holdFrame = opts.hold ?? null; this.speed = opts.speed ?? 1; this.apply();
  }
  speed = 1;
  update(dt: number) {
    const c = this.sheet.meta.clips[this.clip]; if (!c) return; if (this.holdFrame != null) { this.f = Math.min(c[1] - 1, this.holdFrame); this.apply(); return; }
    this.t += dt * c[2] * this.speed;
    while (this.t >= 1) { this.t -= 1; this.f++; if (this.f >= c[1]) { if (this.loop) this.f = 0; else { this.f = c[1] - 1; const d = this.onDone; this.onDone = null; d?.(); } } }
    this.apply();
  }
  apply() { const c = this.sheet.meta.clips[this.clip]; this.sp.texture = this.sheet.frames[c[0] + this.f]; }
}
