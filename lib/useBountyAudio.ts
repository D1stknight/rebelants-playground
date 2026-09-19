// lib/useBountyAudio.ts
// Bounty Hunters audio — same shape as useBountyAudio, own mute key, run-and-gun SFX mapped onto the existing /audio set.
import * as React from "react";

export function useBountyAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:bh:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted); mutedRef.current = muted;
  const musicRef = React.useRef<HTMLAudioElement | null>(null);
  const trackRef = React.useRef<string | null>(null);
  const wantRef = React.useRef<{ file: string; vol: number } | null>(null);   // last requested track, so unmuting mid-floor starts it
  const lastPlay = React.useRef<Record<string, number>>({});

  // SFX go through Web Audio (one decoded buffer per file, cheap BufferSource per shot). Creating an <audio> element per
  // gunshot — 10+ a second — stuttered badly on iPhone. Falls back to <audio> where AudioContext is missing.
  const ctxRef = React.useRef<AudioContext | null>(null);
  const bufRef = React.useRef<Record<string, AudioBuffer | "loading" | "failed">>({});
  const getCtx = React.useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    try { const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return null; ctxRef.current = new AC(); } catch { return null; }
    return ctxRef.current;
  }, []);
  React.useEffect(() => {
    // iOS keeps the context suspended until a gesture — resume on the first touch/key
    const kick = () => { const c = ctxRef.current || getCtx(); if (c && c.state === "suspended") c.resume().catch(() => {}); };
    window.addEventListener("pointerdown", kick, { passive: true }); window.addEventListener("keydown", kick); window.addEventListener("touchstart", kick, { passive: true });
    return () => { window.removeEventListener("pointerdown", kick); window.removeEventListener("keydown", kick); window.removeEventListener("touchstart", kick); };
  }, [getCtx]);
  const loadBuf = React.useCallback((file: string) => {
    const c = getCtx(); if (!c || bufRef.current[file]) return;
    bufRef.current[file] = "loading";
    fetch("/audio/" + file + ".mp3").then((r) => r.arrayBuffer()).then((ab) => new Promise<AudioBuffer>((res, rej) => { const p: any = c.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); })).then((b) => { bufRef.current[file] = b; }).catch(() => { bufRef.current[file] = "failed"; });
  }, [getCtx]);

  const play = React.useCallback((file: string, vol = 1, minGapMs = 60) => {
    if (typeof window === "undefined" || mutedRef.current) return;
    const now = performance.now(); if (now - (lastPlay.current[file] || 0) < minGapMs) return; lastPlay.current[file] = now;
    const c = getCtx(); const b = bufRef.current[file];
    if (c && b && typeof b !== "string") {
      try { if (c.state === "suspended") c.resume().catch(() => {}); const src = c.createBufferSource(); src.buffer = b; const g = c.createGain(); g.gain.value = vol; src.connect(g); g.connect(c.destination); src.start(); } catch {}
      return;
    }
    if (c && !b) { loadBuf(file); return; }                 // first use: start decoding, skip this one
    if (!c || b === "failed") { try { const a = new Audio("/audio/" + file + ".mp3"); a.volume = vol; void a.play().catch(() => {}); } catch {} }
  }, [getCtx, loadBuf]);
  // warm the common shots so the first ones aren't swallowed
  React.useEffect(() => { const t = setTimeout(() => { for (const f of ["fw-hit-light", "fw-hit-heavy", "fw-card-flip", "fw-card-deselect", "collect-crumb", "spider-hit", "fw-trick-dodge"]) loadBuf(f); }, 300); return () => clearTimeout(t); }, [loadBuf]);

  const music = React.useCallback((file: string | null, vol = 0.35) => {
    if (typeof window === "undefined") return;
    wantRef.current = file ? { file, vol } : null;
    if (!file || mutedRef.current) { if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; } trackRef.current = null; return; }
    if (trackRef.current === file && musicRef.current && !musicRef.current.paused) { try { musicRef.current.volume = vol; } catch {} return; }
    if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
    try { const a = new Audio("/audio/" + file + ".mp3"); a.loop = true; a.volume = vol; void a.play().catch(() => {}); musicRef.current = a; trackRef.current = file; } catch {}
  }, []);

  const toggleMute = React.useCallback(() => {
    const next = !mutedRef.current;
    try { localStorage.setItem("ra:bh:muted", next ? "1" : "0"); } catch {}
    mutedRef.current = next;
    if (next) { if (musicRef.current) musicRef.current.pause(); }
    else if (musicRef.current) void musicRef.current.play().catch(() => {});
    else if (wantRef.current) music(wantRef.current.file, wantRef.current.vol);
    setMuted(next);
  }, [music]);

  React.useEffect(() => () => { if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; } try { ctxRef.current?.close(); } catch {} ctxRef.current = null; }, []);

  return React.useMemo(() => ({
    muted, toggleMute, music, play,
    sfx: {
      shot: () => play("fw-hit-light", 0.35, 90),
      laser: () => play("fw-magic-cast", 0.4, 150),
      eshot: () => play("fw-card-deselect", 0.25, 120),
      hit: () => play("fw-card-flip", 0.3, 60),
      kill: () => play("fw-hit-heavy", 0.55, 80),
      bossdie: () => play("fw-territory-win", 0.8),
      die: () => play("ant-die", 0.8),
      hurt: () => play("spider-hit", 0.55, 150),
      jump: () => play("fw-trick-dodge", 0.18, 120),
      coin: () => play("collect-crumb", 0.5, 80),
      heal: () => play("fw-heal", 0.6),
      power: () => play("fw-crate-reward", 0.6),
      crate: () => play("fw-crate-open", 0.5),
      ambush: () => play("fw-ambush", 0.7),
      stomp: () => play("fw-clash", 0.6),
      win: () => play("fw-win", 0.8),
      lose: () => play("fw-lose", 0.8),
    },
  }), [muted, toggleMute, music, play]);
}
