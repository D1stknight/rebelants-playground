// lib/useDescentAudio.ts
// Hive Descent audio — same shape as useFWAudio (files live in /public/audio/*.mp3), own mute key.
import * as React from "react";

export function useDescentAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:hd:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted); mutedRef.current = muted;
  const musicRef = React.useRef<HTMLAudioElement | null>(null);
  const trackRef = React.useRef<string | null>(null);
  const lastPlay = React.useRef<Record<string, number>>({});

  const play = React.useCallback((file: string, vol = 1, minGapMs = 60) => {
    if (typeof window === "undefined" || mutedRef.current) return;
    const now = performance.now(); if (now - (lastPlay.current[file] || 0) < minGapMs) return; lastPlay.current[file] = now;
    try { const a = new Audio("/audio/" + file + ".mp3"); a.volume = vol; void a.play().catch(() => {}); } catch {}
  }, []);

  const music = React.useCallback((file: string | null, vol = 0.35) => {
    if (typeof window === "undefined") return;
    if (!file || mutedRef.current) { if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; } trackRef.current = null; return; }
    if (trackRef.current === file && musicRef.current && !musicRef.current.paused) { try { musicRef.current.volume = vol; } catch {} return; }
    if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
    try { const a = new Audio("/audio/" + file + ".mp3"); a.loop = true; a.volume = vol; void a.play().catch(() => {}); musicRef.current = a; trackRef.current = file; } catch {}
  }, []);

  const toggleMute = React.useCallback(() => {
    const next = !mutedRef.current;
    try { localStorage.setItem("ra:hd:muted", next ? "1" : "0"); } catch {}
    mutedRef.current = next;
    if (musicRef.current) { if (next) musicRef.current.pause(); else void musicRef.current.play().catch(() => {}); }
    setMuted(next);
  }, []);

  React.useEffect(() => () => { if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; } }, []);

  return React.useMemo(() => ({
    muted, toggleMute, music, play,
    sfx: {
      card: () => play("fw-card-flip", 0.5),
      deselect: () => play("fw-card-deselect", 0.4),
      hit: () => play("fw-attack-hit", 0.7),
      heavy: () => play("fw-hit-heavy", 0.8),
      block: () => play("fw-defend-block", 0.6),
      magic: () => play("fw-magic-cast", 0.6),
      trick: () => play("fw-trick-dodge", 0.6),
      playerHit: () => play("spider-hit", 0.7),
      enemyDie: () => play("ant-die", 0.7),
      lowHp: () => play("fw-low-hp", 0.6, 4000),
      floorClear: () => play("collect-crystal", 0.7),
      rally: () => play("fw-rally", 0.6),
      win: () => play("tunnel-win", 0.8),
      lose: () => play("tunnel-lose", 0.8),
      ambush: () => play("fw-ambush", 0.6),
    },
  }), [muted, toggleMute, music, play]);
}
