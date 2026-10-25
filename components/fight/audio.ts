// components/fight/audio.ts — fight sounds played on the exact frame the engine reports them (swings, hits, blocks,
// projectiles, finisher effects). WebAudio buffers from /audio/fight/<name>_<n>.mp3; a name picks one of its variants.
// One shared player for the whole page: the game's mute switch and the engine's slow-mo both reach it here.

/** sound name → number of variants on disk (public/audio/fight/<name>_<1..n>.mp3) */
export const FIGHT_SOUNDS: Record<string, number> = {
  swing_punch: 3, swing_kick: 3, swing_blade: 3, swing_heavy: 2,
  punch_light: 2, punch_med: 2, punch_heavy: 1, kick_hit: 2, block: 2, slash_hit: 2, staff_hit: 2,
  star_throw: 1, star_hit: 2, bow_draw: 1, bow_release: 1, arrow_whiz: 1, arrow_hit: 1, gunshot: 1,
  explosion: 1, explosion_small: 1, thunder: 1, zap: 1, magic_charge: 1, magic_launch: 1, magic_hit: 1, seal: 1,
  smoke: 1, vanish: 1, wind: 1, wind_short: 1, rocks: 1, spikes: 1, shatter: 1, petals: 1, ash: 1, fire: 1, stone: 1,
  gold: 1, sky: 1, sink: 1, dissolve: 1, bell: 1, bell_fall: 1, conch: 1, fan: 1, splash: 1, tentacle: 1, body_fall: 1,
  finish_them: 1, title: 1, draw: 1, fuse: 1, wave: 1, dragon: 1, dizzy: 1,
};
export type FightSound = keyof typeof FIGHT_SOUNDS;

/** how loud each sound sits in the mix (0..1) */
const LEVEL: Record<string, number> = {
  swing_punch: 0.35, swing_kick: 0.4, swing_blade: 0.45, swing_heavy: 0.45,
  punch_light: 0.75, punch_med: 0.85, punch_heavy: 1, kick_hit: 0.9, block: 0.7, slash_hit: 0.85, staff_hit: 0.8,
  star_throw: 0.45, star_hit: 0.55, bow_draw: 0.5, bow_release: 0.75, arrow_whiz: 0.5, arrow_hit: 0.7, gunshot: 0.9,
  explosion: 1, explosion_small: 0.8, thunder: 0.85, zap: 0.6, magic_charge: 0.55, magic_launch: 0.6, magic_hit: 0.75, seal: 0.55,
  smoke: 0.5, vanish: 0.65, wind: 0.55, wind_short: 0.5, rocks: 0.75, spikes: 0.85, shatter: 0.8, petals: 0.6, ash: 0.7, fire: 0.7, stone: 0.75,
  gold: 0.65, sky: 0.7, sink: 0.75, dissolve: 0.65, bell: 0.95, bell_fall: 0.6, conch: 0.75, fan: 0.55, splash: 0.75, tentacle: 0.7, body_fall: 0.75,
  finish_them: 0.95, title: 0.85, draw: 0.6, fuse: 0.35, wave: 0.7, dragon: 0.7, dizzy: 0.3,
};
/** the shortest gap between two plays of one name (a rain of arrows must not stack 30 hits on one frame) */
const MIN_GAP: Record<string, number> = { arrow_whiz: 0.14, arrow_hit: 0.08, star_hit: 0.04, punch_light: 0.03, swing_punch: 0.05, swing_kick: 0.06, swing_blade: 0.06, swing_heavy: 0.08, body_fall: 0.25, smoke: 0.12, dizzy: 0.5 };

class FightAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer | null>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private last = new Map<string, number>();
  private live = new Map<string, number>();
  muted = false;
  volume = 0.9;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return null;
      try { this.ctx = new AC(); this.master = this.ctx!.createGain(); this.master.gain.value = this.muted ? 0 : this.volume; this.master.connect(this.ctx!.destination); } catch { return null; }
    }
    if (this.ctx!.state === "suspended") void this.ctx!.resume().catch(() => {});
    return this.ctx;
  }
  setMuted(m: boolean) { this.muted = m; if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02); }
  private file(name: string, i: number) { return `/audio/fight/${name}_${i}.mp3`; }
  private load(key: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(key)) return Promise.resolve(this.buffers.get(key)!);
    if (this.loading.has(key)) return this.loading.get(key)!;
    const ctx = this.ensure(); if (!ctx) return Promise.resolve(null);
    const p = fetch(key).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).then((ab) => new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((b) => { this.buffers.set(key, b); return b; }).catch(() => { this.buffers.set(key, null); return null; });
    this.loading.set(key, p); return p;
  }
  /** fetch every sound now (call when a fight screen opens, so the first punch isn't silent) */
  preload() { if (!this.ensure()) return; for (const [n, c] of Object.entries(FIGHT_SOUNDS)) for (let i = 1; i <= c; i++) void this.load(this.file(n, i)); }
  /** play now; vol multiplies the mix level, rate < 1 for slow motion, pan -1..1 */
  play(name: string, opts: { vol?: number; rate?: number; pan?: number } = {}) {
    const n = FIGHT_SOUNDS[name]; if (!n) return; const ctx = this.ensure(); if (!ctx || !this.master) return;
    const now = performance.now() / 1000; const gap = MIN_GAP[name] ?? 0.02;
    if (now - (this.last.get(name) ?? -1) < gap) return;
    if ((this.live.get(name) ?? 0) >= 6) return;
    this.last.set(name, now);
    const key = this.file(name, 1 + Math.floor(Math.random() * n)); const buf = this.buffers.get(key);
    // test hook: a capture script sets window.__fightAudioLog = [] to rebuild the soundtrack of a recorded fight
    const log = typeof window !== "undefined" ? (window as any).__fightAudioLog : null;
    if (Array.isArray(log)) log.push({ t: performance.now(), file: key, vol: Math.min(1.2, (LEVEL[name] ?? 0.7) * (opts.vol ?? 1)) * (this.muted ? 0 : this.volume), rate: opts.rate ?? 1 });
    const start = (b: AudioBuffer) => {
      const src = ctx.createBufferSource(); src.buffer = b;
      const rate = Math.max(0.5, Math.min(1.5, (opts.rate ?? 1) * (1 + (Math.random() - 0.5) * 0.08))); src.playbackRate.value = rate;
      const g = ctx.createGain(); g.gain.value = Math.min(1.2, (LEVEL[name] ?? 0.7) * (opts.vol ?? 1));
      let node: AudioNode = g; src.connect(g);
      if (opts.pan && (ctx as any).createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan)); g.connect(p); node = p; }
      node.connect(this.master!); this.live.set(name, (this.live.get(name) ?? 0) + 1);
      src.onended = () => { this.live.set(name, Math.max(0, (this.live.get(name) ?? 1) - 1)); try { node.disconnect(); } catch {} };
      src.start();
    };
    if (buf) start(buf);
    else if (buf === undefined) { const t0 = ctx.currentTime; void this.load(key).then((b) => { if (b && ctx.currentTime - t0 < 0.15) start(b); }); }   // first use: only if it arrives in time
  }
}

export const fightAudio = new FightAudio();
