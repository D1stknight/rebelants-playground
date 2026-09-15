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

  const play = React.useCallback((file: string, vol = 1, minGapMs = 60) => {
    if (typeof window === "undefined" || mutedRef.current) return;
    const now = performance.now(); if (now - (lastPlay.current[file] || 0) < minGapMs) return; lastPlay.current[file] = now;
    try { const a = new Audio("/audio/" + file + ".mp3"); a.volume = vol; void a.play().catch(() => {}); } catch {}
  }, []);

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

  React.useEffect(() => () => { if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; } }, []);

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
