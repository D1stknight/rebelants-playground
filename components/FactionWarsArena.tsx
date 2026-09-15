// components/FactionWarsArena.tsx
//
// PRESENTATION ONLY. The shared 3D duel stage for Faction Wars (solo + PvP):
// one r3f scene with both fighters facing each other, lit in the defending faction's colour.
// It replaces the two white 120x140 portrait canvases. Game logic never changes here —
// it still drives animations through `player3DAnim` / `enemy3DAnim` props and the
// legacy `window.__fw3dPlayPlayer(anim)` / `window.__fw3dPlayEnemy(anim)` globals.
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Color, Fog, type Group } from "three";
import ArenaCharacter, { preloadFaction, type ArenaAnim } from "./arena/ArenaCharacter";

export type FWAnim = ArenaAnim;
export type FWBattleAnim = "idle" | "clash" | "win" | "lose";

export type ArenaFighter = {
  id: string;            // faction id
  name: string;
  color: string;         // faction colour (#rrggbb)
  borderColor: string;
  anim: FWAnim;
  hp: number;            // 0..100 — drives the low-HP vignette
  label: string;         // "Warrior 2/5" / "Territory Defender"
  symbolSrc: string;     // faction symbol image
};

export type FactionWarsArenaProps = {
  player: ArenaFighter;
  enemy: ArenaFighter;
  battleAnim: FWBattleAnim;
  /** Register the legacy window.__fw3dPlay* globals (solo mode calls them). Default true. */
  registerGlobals?: boolean;
  height?: string;       // CSS height; default clamp(230px, 40vw, 340px)
  /** Faction ids to warm up in the background (the whole team + all defenders) so rotations are instant. */
  preload?: string[];
};

declare global {
  interface Window {
    __fw3dPlayPlayer?: (a: FWAnim) => void;
    __fw3dPlayEnemy?: (a: FWAnim) => void;
  }
}

// ── palette from a faction colour ─────────────────────────────────────────────
function mix(a: string, b: string, t: number) { return "#" + new Color(a).lerp(new Color(b), t).getHexString(); }
function palette(defenderColor: string, playerColor: string) {
  return {
    skyTop: mix(defenderColor, "#000000", 0.62),
    skyBottom: mix(defenderColor, "#05060a", 0.88),
    fog: mix(defenderColor, "#05060a", 0.84),
    ambient: mix(defenderColor, "#ffffff", 0.6),
    key: mix(defenderColor, "#ffffff", 0.7),
    rim: mix(playerColor, "#ffffff", 0.65),
    ring: defenderColor,
    motes: mix(defenderColor, "#ffffff", 0.3),
  };
}

function Atmosphere({ fog }: { fog: string }) {
  const { scene } = useThree();
  useEffect(() => { scene.fog = new Fog(new Color(fog), 4.5, 15); return () => { scene.fog = null; }; }, [scene, fog]);
  return null;
}

function Motes({ color, count = 45 }: { color: string; count?: number }) {
  const ref = useRef<Group | null>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453) % 1, y: (Math.sin(i * 78.233) * 43758.5453) % 1, z: (Math.sin(i * 39.346) * 43758.5453) % 1, s: 0.5 + ((i * 7) % 5) / 5 })), [count]);
  useFrame(({ clock }) => {
    const g = ref.current; if (!g) return; const t = clock.getElapsedTime();
    g.children.forEach((m, i) => { const sd = seeds[i]; m.position.set(sd.x * 9 - 4.5, ((sd.y * 3 + t * 0.1 * sd.s) % 3) + 0.1, sd.z * 6 - 4); m.scale.setScalar(0.011 + Math.sin(t * 2 + i) * 0.004); });
  });
  return (
    <group ref={ref}>
      {seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 6, 6]} /><meshBasicMaterial color={color} transparent opacity={0.6} /></mesh>))}
    </group>
  );
}

function CameraRig({ shake }: { shake: number }) {
  const { camera } = useThree();
  const shakeRef = useRef(0); shakeRef.current = shake;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime(); const s = shakeRef.current;
    camera.position.set(Math.sin(t * 0.25) * 0.1 + (Math.random() - 0.5) * s * 0.07, 1.05 + Math.sin(t * 0.4) * 0.03 + (Math.random() - 0.5) * s * 0.05, 3.9);
    camera.lookAt(0, 0.92, 0);
  });
  return null;
}

function Ground({ ring }: { ring: string }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[3.8, 48]} />
        <meshStandardMaterial color="#0b0c12" roughness={0.95} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[3.6, 3.8, 64]} />
        <meshBasicMaterial color={ring} transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[1.25, 1.3, 48]} />
        <meshBasicMaterial color={ring} transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

/** Lunge toward the centre on clash, hold ground otherwise. */
function Lunge({ side, active, children }: { side: 1 | -1; active: boolean; children: React.ReactNode }) {
  const ref = useRef<Group | null>(null);
  useFrame((_, dt) => {
    const g = ref.current; if (!g) return;
    const target = active ? side * 0.28 : 0;
    g.position.x += (target - g.position.x) * Math.min(1, dt * 12);
  });
  return <group ref={ref}>{children}</group>;
}

// ── anim plumbing: prop path + legacy globals → (anim, animKey) ───────────────
function useAnimChannel(propAnim: FWAnim) {
  const [state, setState] = useState<{ anim: FWAnim; key: number }>({ anim: propAnim, key: 0 });
  const lastProp = useRef<FWAnim>(propAnim);
  const current = useRef<FWAnim>(propAnim);
  current.current = state.anim;
  const play = useCallback((a: FWAnim) => { setState((s) => ({ anim: a, key: s.key + 1 })); }, []);
  useEffect(() => {
    // mirror the old FactionWars3DCharacter prop semantics: react to prop changes, skip if already playing that action
    if (propAnim === lastProp.current) return;
    lastProp.current = propAnim;
    if (propAnim !== current.current) play(propAnim);
  }, [propAnim, play]);
  return { ...state, play };
}

const HOLD: FWAnim[] = ["win", "lose"];

export default function FactionWarsArena({ player, enemy, battleAnim, registerGlobals = true, height = "clamp(230px, 40vw, 340px)", preload }: FactionWarsArenaProps) {
  const preloadKey = (preload || []).join(",");
  // warm the rest of the roster only after the current pair has had the network to itself
  useEffect(() => {
    const ids = Array.from(new Set(preloadKey.split(",").filter(Boolean)));
    if (!ids.length) return;
    const t = setTimeout(() => ids.forEach((f) => { try { preloadFaction(f); } catch {} }), 6000);
    return () => clearTimeout(t);
  }, [preloadKey]);
  const p = useAnimChannel(player.anim);
  const e = useAnimChannel(enemy.anim);

  useEffect(() => {
    if (!registerGlobals || typeof window === "undefined") return;
    window.__fw3dPlayPlayer = p.play; window.__fw3dPlayEnemy = e.play;
    return () => { if (window.__fw3dPlayPlayer === p.play) delete window.__fw3dPlayPlayer; if (window.__fw3dPlayEnemy === e.play) delete window.__fw3dPlayEnemy; };
  }, [registerGlobals, p.play, e.play]);

  // fresh fighter → fresh idle (new territory / warrior rotation)
  useEffect(() => { p.play("idle"); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [player.id]);
  useEffect(() => { e.play("idle"); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [enemy.id]);

  const pal = useMemo(() => palette(enemy.color, player.color), [enemy.color, player.color]);
  const clash = battleAnim === "clash";
  const shake = clash ? 1 : 0;
  const playerLost = battleAnim === "lose", enemyLost = battleAnim === "win";

  const nameTag = (f: ArenaFighter, side: "left" | "right", dim: boolean) => (
    <div style={{ position: "absolute", top: 10, left: side === "left" ? 12 : undefined, right: side === "right" ? 12 : undefined, display: "flex", alignItems: "center", gap: 8, flexDirection: side === "left" ? "row" : "row-reverse", opacity: dim ? 0.45 : 1, transition: "opacity .4s", pointerEvents: "none" }}>
      <div style={{ width: 30, height: 30, borderRadius: 7, overflow: "hidden", background: "rgba(0,0,0,0.65)", border: `1px solid ${f.borderColor}`, boxShadow: `0 0 14px ${f.color}55` }}>
        <img src={f.symbolSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 3 }} />
      </div>
      <div style={{ textAlign: side === "left" ? "left" : "right", textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
        <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", color: f.color }}>{f.name.toUpperCase()}</div>
        <div style={{ fontSize: 9, opacity: 0.55 }}>{f.label}</div>
      </div>
    </div>
  );

  return (
    <div style={{ position: "relative", width: "100%", height, borderRadius: 14, overflow: "hidden", marginBottom: 14, border: "1px solid rgba(255,255,255,0.08)",
      background: `radial-gradient(ellipse at 50% 15%, ${pal.skyTop} 0%, ${pal.skyBottom} 60%, #000 100%)` }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 22% 55%, ${player.color}33 0%, transparent 55%), radial-gradient(ellipse at 78% 55%, ${enemy.color}33 0%, transparent 55%)`, transition: "background .5s" }} />
      <Canvas dpr={[1, 1.5]} shadows gl={{ alpha: true, antialias: true }} camera={{ position: [0, 1.05, 3.9], fov: 36, near: 0.1, far: 40 }} style={{ position: "absolute", inset: 0 }}>
        <Atmosphere fog={pal.fog} />
        <CameraRig shake={shake} />
        <ambientLight color={pal.ambient} intensity={1.15} />
        <hemisphereLight args={[pal.key, "#05060a", 0.6]} />
        <directionalLight position={[2.5, 4, 3]} intensity={1.9} color={pal.key} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 2.5, 2]} intensity={0.9} color={pal.rim} />
        <pointLight position={[-1.4, 1.6, 0.8]} intensity={2.2} distance={4} color={player.color} />
        <pointLight position={[1.4, 1.6, 0.8]} intensity={2.2} distance={4} color={enemy.color} />
        <Ground ring={pal.ring} />
        <Motes color={pal.motes} />
        <Suspense fallback={null}>
          <Lunge side={1} active={clash}>
            <ArenaCharacter factionId={player.id} anim={p.anim} animKey={p.key} position={[-0.9, 0, 0.1]} rotationY={0.75} dead={playerLost} holdOn={HOLD} />
          </Lunge>
          <Lunge side={-1} active={clash}>
            <ArenaCharacter factionId={enemy.id} anim={e.anim} animKey={e.key} position={[0.9, 0, 0.1]} rotationY={-0.75} dead={enemyLost} holdOn={HOLD} />
          </Lunge>
        </Suspense>
      </Canvas>

      {/* overlays */}
      {nameTag(player, "left", playerLost)}
      {nameTag(enemy, "right", enemyLost)}
      <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: clash ? 40 : 24, fontWeight: 900, transition: "all .2s", lineHeight: 1,
          textShadow: clash ? "0 0 30px #fbbf24" : battleAnim === "win" ? "0 0 20px #34d399" : battleAnim === "lose" ? "0 0 20px #f87171" : "0 0 10px rgba(0,0,0,0.8)",
          transform: clash ? "scale(1.3)" : "scale(1)" }}>
          {clash ? "💥" : battleAnim === "win" ? "✅" : battleAnim === "lose" ? "💀" : "⚔️"}
        </div>
        <div style={{ fontSize: 9, fontWeight: 900, opacity: 0.35, letterSpacing: "0.12em", marginTop: 2 }}>VS</div>
      </div>
      {player.hp < 25 && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(90deg, rgba(248,113,113,0.28), transparent 45%)" }} />}
      {enemy.hp < 25 && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(270deg, rgba(248,113,113,0.28), transparent 45%)" }} />}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.5) 100%)" }} />
    </div>
  );
}
