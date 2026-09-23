// components/Siege/audio.ts — The Siege sound: Web Audio SFX (positional: distance fall-off + stereo pan from the camera),
// looping beds (wind, horde skitter, wasp buzz) and an <audio> music track. Files: /audio/siege/*.mp3 (+ a few shared /audio/*.mp3).
const OWN = ["bell", "boom", "boom_big", "boom_small", "buzz_loop", "chop", "click", "cloth1", "cloth2", "creak1", "creak2", "creak3", "crunch", "draw1", "draw2", "drum", "horn", "horn_boss", "latch", "metal1", "metal_heavy", "plank1", "plank2", "punch1", "punch2", "rock1", "rock2", "skitter_loop", "slice1", "slice2", "soft1", "soft2", "spit", "splat", "squish", "step0", "step1", "step2", "step3", "step4", "taiko", "thunder", "whoosh", "whoosh_fast", "whoosh_heavy", "wind_loop", "wood_heavy1", "wood_heavy2"];
const SHARED = ["fw-magic-cast", "fw-rally", "fw-territory-win", "fw-low-hp", "fw-win", "fw-lose", "wall-break", "fw-ambush", "fw-clash", "fw-card-select", "fw-berserker"];
/** play("step") picks one of these at random */
const GROUPS: Record<string, string[]> = { step: ["step0", "step1", "step2", "step3", "step4"], creak: ["creak1", "creak2", "creak3"], wood: ["wood_heavy1", "wood_heavy2"], plank: ["plank1", "plank2"], punch: ["punch1", "punch2"], soft: ["soft1", "soft2"], rock: ["rock1", "rock2"], slice: ["slice1", "slice2"], draw: ["draw1", "draw2"], cloth: ["cloth1", "cloth2"] };
const MUTE_KEY = "ra:siege:muted";
type P3 = { x: number; y: number; z: number };
export type PlayOpts = { vol?: number; rate?: number; at?: P3 | null; gap?: number; vary?: number };

export class SiegeAudio {
  ctx: AudioContext | null = null; master: GainNode | null = null; bus: GainNode | null = null; bufs = new Map<string, AudioBuffer>(); loading: Promise<void> | null = null;
  muted = false; last: Record<string, number> = {}; voices = 0; lis = { x: 0, y: 10, z: 0, rx: 1, rz: 0 };
  loops = new Map<string, { src: AudioBufferSourceNode; g: GainNode }>(); music: HTMLAudioElement | null = null; musicWant: { file: string; vol: number } | null = null; musicFade = 0;
  constructor() { try { this.muted = localStorage.getItem(MUTE_KEY) === "1"; } catch {} }

  /** call from a user gesture: browsers only start audio after one */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) { const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return; this.ctx = new AC(); const c = this.ctx!; this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(c.destination); this.bus = c.createGain(); this.bus.gain.value = 0.9; this.bus.connect(this.master); this.load(); }
    const cx = this.ctx; if (cx && cx.state === "suspended") void cx.resume().catch(() => {});
    if (this.musicWant && (!this.music || this.music.paused) && !this.muted) this.setMusic(this.musicWant.file, this.musicWant.vol, true);
  }
  load() {
    if (this.loading || !this.ctx) return this.loading; const c = this.ctx;
    const one = async (name: string, url: string) => { try { const r = await fetch(url); const ab = await r.arrayBuffer(); const b = await new Promise<AudioBuffer>((res, rej) => c.decodeAudioData(ab, res, rej)); this.bufs.set(name, b); } catch {} };
    this.loading = Promise.all([...OWN.map((n) => one(n, `/audio/siege/${n}.mp3`)), ...SHARED.map((n) => one(n, `/audio/${n}.mp3`))]).then(() => {});
    return this.loading;
  }
  /** where the ears are: camera position + its right vector (for panning) */
  listen(x: number, y: number, z: number, rx: number, rz: number) { const L = this.lis; L.x = x; L.y = y; L.z = z; const n = Math.hypot(rx, rz) || 1; L.rx = rx / n; L.rz = rz / n; }
  private spatial(at: P3 | null | undefined) {
    if (!at) return { g: 1, pan: 0 }; const L = this.lis; const dx = at.x - L.x, dy = at.y - L.y, dz = at.z - L.z; const d = Math.hypot(dx, dy, dz);
    return { g: Math.max(0.06, 1 / (1 + Math.pow(d / 22, 1.5))), pan: Math.max(-0.85, Math.min(0.85, (dx * L.rx + dz * L.rz) / Math.max(12, d * 0.9))) };
  }
  play(name: string, o: PlayOpts = {}) {
    const c = this.ctx; if (!c || this.muted || !this.bus || c.state !== "running") return;
    const pick = GROUPS[name] ? GROUPS[name][(Math.random() * GROUPS[name].length) | 0] : name; const b = this.bufs.get(pick); if (!b) return;
    const now = performance.now(); if (now - (this.last[name] || 0) < (o.gap ?? 45)) return; this.last[name] = now; if (this.voices > 28) return;
    const { g, pan } = this.spatial(o.at); const vol = (o.vol ?? 1) * g; if (vol < 0.02) return;
    const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * (o.vary ?? 0.08));
    const gn = c.createGain(); gn.gain.value = vol; let tail: AudioNode = gn; src.connect(gn);
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; gn.connect(p); tail = p; }
    tail.connect(this.bus); this.voices++; src.onended = () => { this.voices--; try { src.disconnect(); gn.disconnect(); } catch {} }; src.start();
  }
  /** a looping bed whose volume you keep steering (0 = silent) */
  bed(name: string, vol: number) {
    const c = this.ctx; if (!c || !this.bus) return; let L = this.loops.get(name);
    if (!L) { const b = this.bufs.get(name); if (!b || vol <= 0.001) return; const src = c.createBufferSource(); src.buffer = b; src.loop = true; src.loopStart = 0.05; src.loopEnd = Math.max(0.1, b.duration - 0.05); const g = c.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.bus); src.start(0, 0.05); L = { src, g }; this.loops.set(name, L); }
    L.g.gain.setTargetAtTime(Math.max(0, vol), c.currentTime, 0.35);
  }
  beds(off = true) { if (off) for (const [, L] of this.loops) L.g.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.4); }
  setMusic(file: string | null, vol = 0.35, force = false) {
    if (typeof window === "undefined") return; this.musicWant = file ? { file, vol } : null;
    const cur = this.music; if (!force && cur && file && cur.dataset.file === file) { cur.volume = this.muted ? 0 : vol; if (cur.paused && !this.muted) void cur.play().catch(() => {}); return; }
    if (cur) { const a = cur; let v = a.volume; const id = window.setInterval(() => { v -= 0.04; if (v <= 0) { a.pause(); window.clearInterval(id); } else a.volume = v; }, 60); this.music = null; }
    if (!file || this.muted) return;
    const a = new Audio(file.startsWith("siege-") ? `/audio/siege/${file}.mp3` : `/audio/${file}.mp3`); a.loop = true; a.volume = 0; a.dataset.file = file; this.music = a;
    void a.play().then(() => { let v = 0; const id = window.setInterval(() => { v = Math.min(vol, v + 0.03); a.volume = v; if (v >= vol || this.music !== a) window.clearInterval(id); }, 80); }).catch(() => {});
  }
  setMuted(m: boolean) {
    this.muted = m; try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch {}
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    if (m) { this.music?.pause(); } else if (this.musicWant) this.setMusic(this.musicWant.file, this.musicWant.vol, true);
  }
  destroy() { this.music?.pause(); this.music = null; for (const [, L] of this.loops) { try { L.src.stop(); } catch {} } this.loops.clear(); try { void this.ctx?.close(); } catch {} this.ctx = null; }
}
