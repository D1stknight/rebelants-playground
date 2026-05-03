// lib/useFWAudio.ts
//
// Faction Wars audio hook — extracted near-verbatim from components/FactionWars.tsx.
//
// IMPORTANT: This is a deliberate duplicate. components/FactionWars.tsx still has
// its own inline copy of useFWAudio (so AI mode is untouched and cannot break).
// This new file exists so PvP UI can import the same audio behavior without
// touching FactionWars.tsx. Once PvP is stable we can switch FactionWars.tsx to
// import from here too — but that is NOT part of this commit.
//
// If you change one, change both. Or kill the inline copy in FactionWars.tsx
// and consolidate. Both are safe.

import * as React from "react";

export function useFWAudio() {
  const [muted, setMuted] = React.useState<boolean>(() => {
    try { return localStorage.getItem("ra:fw:muted") === "1"; } catch { return false; }
  });
  const mutedRef = React.useRef(muted);
  mutedRef.current = muted;
  const musicRef = React.useRef<HTMLAudioElement | null>(null);
  const lowHpFiredRef = React.useRef(false);
  const play = React.useCallback((file: string, vol = 1) => {
    if (typeof window === "undefined" || mutedRef.current) return;
    try { const a = new Audio("/audio/" + file + ".mp3"); a.volume = vol; void a.play().catch(() => {}); } catch {}
  }, []);
  const switchMusic = React.useCallback((file: string, vol = 0.35) => {
    if (typeof window === "undefined") return;
    if (musicRef.current) { musicRef.current.pause(); musicRef.current = null; }
    if (mutedRef.current) return;
    try {
      const a = new Audio("/audio/" + file + ".mp3");
      a.loop = true; a.volume = vol;
      void a.play().catch(() => {}); musicRef.current = a;
    } catch {}
  }, []);
  const startTheme = React.useCallback(() => switchMusic("fw-theme-intro", 0.4), [switchMusic]);
  const startMusic = React.useCallback(() => switchMusic("fw-battle", 0.35), [switchMusic]);
  const startEpic  = React.useCallback(() => switchMusic("fw-battle-epic", 0.5), [switchMusic]);
  const stopMusic  = React.useCallback(() => {
    if (musicRef.current) { musicRef.current.pause(); musicRef.current.currentTime = 0; musicRef.current = null; }
  }, []);
  const resetLowHp = React.useCallback(() => { lowHpFiredRef.current = false; }, []);
  const toggleMute = React.useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { localStorage.setItem("ra:fw:muted", next ? "1" : "0"); } catch {}
      if (musicRef.current) { if (next) { musicRef.current.volume = 0; musicRef.current.pause(); } else { musicRef.current.volume = 0.35; musicRef.current.play().catch(()=>{}); } }
      return next;
    });
  }, []);
  const sfx = React.useMemo(() => ({
    startTheme:    () => startTheme(),
    startBattle:   () => startMusic(),
    startEpic:     () => startEpic(),
    stopMusic:     () => stopMusic(),
    clash:         () => play("fw-clash", 0.6),
    roundStart:    () => play("fw-round-start", 0.6),
    attackHit:     () => play("fw-attack-hit", 0.7),
    defendBlock:   () => play("fw-defend-block", 0.7),
    magicCast:     () => play("fw-magic-cast", 0.6),
    trickDodge:    () => play("fw-trick-dodge", 0.7),
    hitLight:      () => play("fw-hit-light", 0.5),
    hitHeavy:      () => play("fw-hit-heavy", 0.8),
    lowHp:         () => { if (!lowHpFiredRef.current) { lowHpFiredRef.current = true; play("fw-low-hp", 0.5); } },
    berserker:     () => play("fw-berserker", 0.9),
    sacrifice:     () => play("fw-sacrifice", 0.9),
    imperial:      () => play("fw-imperial", 0.85),
    heal:          () => play("fw-heal", 0.8),
    plunder:       () => play("fw-plunder", 0.85),
    bloodPrice:    () => play("fw-blood-price", 0.9),
    counter:       () => play("fw-counter", 0.85),
    rally:         () => play("fw-rally", 0.85),
    ambush:        () => play("fw-ambush", 0.85),
    cardFlip:      () => play("fw-card-flip", 0.4),
    cardSelect:    () => play("fw-card-select", 0.5),
    cardDeselect:  () => play("fw-card-deselect", 0.4),
    territoryWin:  () => play("fw-territory-win", 0.8),
    territoryLose: () => play("fw-territory-lose", 0.7),
    win:           () => { stopMusic(); play("fw-win", 0.8); },
    ultra:         () => { stopMusic(); play("fw-ultra", 0.9); },
    lose:          () => { stopMusic(); play("fw-lose", 0.7); },
    crateOpen:     () => play("fw-crate-open", 0.8),
    crateReward:   () => play("fw-crate-reward", 0.7),
  }), [play, startTheme, startMusic, startEpic, stopMusic]);
  return { muted, toggleMute, startTheme, startMusic, startEpic, stopMusic, resetLowHp, sfx };
}

export default useFWAudio;
