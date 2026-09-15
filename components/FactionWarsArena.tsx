// components/FactionWarsArena.tsx
//
// PRESENTATION ONLY. The shared 3D duel stage for Faction Wars (solo + PvP):
// one r3f scene with both fighters facing each other, lit in the defending faction's colour.
// It replaces the two white 120x140 portrait canvases. Game logic never changes here —
// it still drives animations through `player3DAnim` / `enemy3DAnim` props and the
// legacy `window.__fw3dPlayPlayer(anim)` / `window.__fw3dPlayEnemy(anim)` globals.
//
// Everything cinematic in here (hit reactions, hit-stop, damage numbers, move VFX, KO slow-mo,
// camera work, territory fly-in) is derived from the props the game already sends — anims and HP.
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, Color, DoubleSide, Fog, type Group, type Mesh, type PointLight, type SpotLight } from "three";
import ArenaCharacter, { preloadFaction, type ArenaAnim } from "./arena/ArenaCharacter";

export type FWAnim = ArenaAnim;
export type FWBattleAnim = "idle" | "clash" | "win" | "lose";

export type ArenaFighter = {
  id: string;            // faction id
  name: string;
  color: string;         // faction colour (#rrggbb)
  borderColor: string;
  anim: FWAnim;
  hp: number;            // 0..100
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
  /** Banner shown during the fly-in when a new match-up starts, e.g. "TERRITORY 3 · SHOGUN'S HOLD". */
  title?: string;
};

declare global {
  interface Window {
    __fw3dPlayPlayer?: (a: FWAnim) => void;
    __fw3dPlayEnemy?: (a: FWAnim) => void;
  }
}

type Side = "player" | "enemy";
const SIDE_X: Record<Side, number> = { player: -0.9, enemy: 0.9 };
const OFFENSIVE: FWAnim[] = ["attack", "magic", "trick"];
const IMPACT_MS = 300;      // when the swing lands inside the clip
const HITSTOP_MS = 90;
const CLIP_BUSY_MS = 650;   // don't interrupt an offensive clip younger than this with a "hit"

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

// ── shared mutable "director" state, read by useFrame components ─────────────
type Director = {
  punch: number;                 // camera punch-in impulse (decays)
  shake: number;
  intro: number | null;          // ms timestamp when fly-in started
  ko: { side: Side; at: number } | null;
  lowHp: { player: boolean; enemy: boolean };
  knock: { player: number; enemy: number }; // knockback offsets
  lunge: boolean;
};
const newDirector = (): Director => ({ punch: 0, shake: 0, intro: null, ko: null, lowHp: { player: false, enemy: false }, knock: { player: 0, enemy: 0 }, lunge: false });

function Atmosphere({ fog, dir }: { fog: string; dir: React.MutableRefObject<Director> }) {
  const { scene } = useThree();
  const fogRef = useRef<Fog | null>(null);
  useEffect(() => { const f = new Fog(new Color(fog), 4.5, 15); fogRef.current = f; scene.fog = f; return () => { scene.fog = null; }; }, [scene, fog]);
  useFrame((_, dt) => {
    const f = fogRef.current; if (!f) return;
    const low = dir.current.lowHp.player || dir.current.lowHp.enemy;
    const targetFar = dir.current.ko ? 9 : low ? 11 : 15;
    f.far += (targetFar - f.far) * Math.min(1, dt * 2);
  });
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

const CAM_BASE = { y: 1.05, z: 3.9, lookY: 0.92 };

function CameraRig({ dir }: { dir: React.MutableRefObject<Director> }) {
  const { camera } = useThree();
  const cur = useRef({ x: 0, y: CAM_BASE.y, z: CAM_BASE.z, lx: 0, ly: CAM_BASE.lookY, lz: 0 });
  useFrame(({ clock }, dt) => {
    const d = dir.current; const t = clock.getElapsedTime(); const now = performance.now();
    let tx = Math.sin(t * 0.25) * 0.1, ty = CAM_BASE.y + Math.sin(t * 0.4) * 0.03, tz = CAM_BASE.z, lx = 0, ly = CAM_BASE.lookY, lz = 0, ease = 6;
    if (d.intro != null) {
      const k = Math.min(1, (now - d.intro) / 1500);
      const e = 1 - Math.pow(1 - k, 3);
      // start low over the player's shoulder, swing round to the duel angle
      tx = -2.2 * (1 - e); ty = 0.9 + (CAM_BASE.y - 0.9) * e; tz = 1.0 + (CAM_BASE.z - 1.0) * e;
      lx = 0.9 * (1 - e); ly = 1.0 - 0.08 * e; ease = 30;
      if (k >= 1) d.intro = null;
    } else if (d.ko) {
      const k = Math.min(1, (now - d.ko.at) / 1100);
      const sx = SIDE_X[d.ko.side];
      tx = sx * 0.55; ty = 0.95; tz = 2.9; lx = sx * 0.8; ly = 0.7 + 0.1 * (1 - k); ease = 3.5;
    }
    d.punch *= Math.exp(-dt * 9); tz -= d.punch * 0.35;
    d.shake *= Math.exp(-dt * 7);
    const s = d.shake;
    const c = cur.current; const a = Math.min(1, dt * ease);
    c.x += (tx - c.x) * a; c.y += (ty - c.y) * a; c.z += (tz - c.z) * a; c.lx += (lx - c.lx) * a; c.ly += (ly - c.ly) * a; c.lz += (lz - c.lz) * a;
    camera.position.set(c.x + (Math.random() - 0.5) * s * 0.09, c.y + (Math.random() - 0.5) * s * 0.06, c.z);
    camera.lookAt(c.lx, c.ly, c.lz);
  });
  return null;
}

function Lights({ pal, playerColor, enemyColor, dir }: { pal: ReturnType<typeof palette>; playerColor: string; enemyColor: string; dir: React.MutableRefObject<Director> }) {
  const amb = useRef<any>(null); const key = useRef<any>(null); const pl = useRef<PointLight | null>(null); const el = useRef<PointLight | null>(null); const spot = useRef<SpotLight | null>(null);
  const red = useMemo(() => new Color("#ff3b3b"), []);
  const pc = useMemo(() => new Color(playerColor), [playerColor]); const ec = useMemo(() => new Color(enemyColor), [enemyColor]);
  useFrame(({ clock }, dt) => {
    const d = dir.current; const t = clock.getElapsedTime(); const a = Math.min(1, dt * 4);
    const dim = d.ko ? 0.25 : 1;
    if (amb.current) amb.current.intensity += (1.15 * dim - amb.current.intensity) * a;
    if (key.current) key.current.intensity += (1.9 * dim - key.current.intensity) * a;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    if (pl.current) { pl.current.color.copy(pc); if (d.lowHp.player) pl.current.color.lerp(red, 0.5 + 0.5 * pulse); pl.current.intensity += ((d.lowHp.player ? 2.2 + pulse * 1.6 : 2.2) - pl.current.intensity) * a; }
    if (el.current) { el.current.color.copy(ec); if (d.lowHp.enemy) el.current.color.lerp(red, 0.5 + 0.5 * pulse); el.current.intensity += ((d.lowHp.enemy ? 2.2 + pulse * 1.6 : 2.2) - el.current.intensity) * a; }
    if (spot.current) {
      const winnerX = d.ko ? -SIDE_X[d.ko.side] : 0;
      spot.current.intensity += ((d.ko ? 14 : 0) - spot.current.intensity) * a;
      spot.current.position.set(winnerX, 4.2, 1.2); spot.current.target.position.set(winnerX, 0.8, 0.1); spot.current.target.updateMatrixWorld();
    }
  });
  return (
    <>
      <ambientLight ref={amb} color={pal.ambient} intensity={1.15} />
      <hemisphereLight args={[pal.key, "#05060a", 0.6]} />
      <directionalLight ref={key} position={[2.5, 4, 3]} intensity={1.9} color={pal.key} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-3, 2.5, 2]} intensity={0.9} color={pal.rim} />
      <pointLight ref={pl} position={[-1.4, 1.6, 0.8]} intensity={2.2} distance={4} color={playerColor} />
      <pointLight ref={el} position={[1.4, 1.6, 0.8]} intensity={2.2} distance={4} color={enemyColor} />
      <spotLight ref={spot} position={[0, 4.2, 1.2]} angle={0.5} penumbra={0.6} intensity={0} color="#fff3d6" distance={9} />
    </>
  );
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

/** Lunge toward the centre on clash, knockback on hit, hold ground otherwise. */
function Stance({ side, dir, children }: { side: Side; dir: React.MutableRefObject<Director>; children: React.ReactNode }) {
  const ref = useRef<Group | null>(null);
  useFrame((_, dt) => {
    const g = ref.current; if (!g) return; const d = dir.current;
    const dirIn = side === "player" ? 1 : -1;
    d.knock[side] *= Math.exp(-dt * 6);
    const target = (d.lunge ? dirIn * 0.28 : 0) - dirIn * d.knock[side];
    g.position.x += (target - g.position.x) * Math.min(1, dt * 12);
  });
  return <group ref={ref}>{children}</group>;
}

// ── VFX ───────────────────────────────────────────────────────────────────────
type FxKind = "sparks" | "slash" | "glyph" | "embers" | "shadow" | "dome" | "dust";
type Fx = { id: number; kind: FxKind; side: Side; color: string; t0: number; life: number };
const FX_LIFE: Record<FxKind, number> = { sparks: 450, slash: 280, glyph: 900, embers: 900, shadow: 500, dome: 700, dust: 900 };

function FxNode({ fx }: { fx: Fx }) {
  const g = useRef<Group | null>(null);
  const seeds = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2 + (Math.sin(i * 7.1) % 1) * 0.4, v: 0.9 + ((i * 37) % 10) / 10, r: 0.3 + ((i * 13) % 7) / 10 })), []);
  const x = SIDE_X[fx.side]; const facing = fx.side === "player" ? 1 : -1;
  useFrame(() => {
    const G = g.current; if (!G) return;
    const k = Math.min(1, (performance.now() - fx.t0) / fx.life); const e = 1 - Math.pow(1 - k, 2);
    G.visible = k < 1;
    switch (fx.kind) {
      case "sparks": G.children.forEach((m, i) => { const s = seeds[i]; m.position.set(x + Math.cos(s.a) * e * s.r * 1.2 - facing * 0.15, 1.05 + Math.sin(s.a) * e * s.r - e * e * 0.4, 0.35 + Math.sin(i) * 0.1); m.scale.setScalar(0.035 * (1 - k) * s.v); }); break;
      case "slash": { const m = G.children[0] as Mesh; m.position.set(x - facing * 0.1, 1.0, 0.4); m.rotation.z = -facing * (0.6 + e * 1.4); m.scale.setScalar(0.55 + e * 0.5); (m.material as any).opacity = 0.85 * (1 - k); break; }
      case "glyph": { const m = G.children[0] as Mesh; m.position.set(x, 0.035, 0.1); m.rotation.z = e * 2.5; m.scale.setScalar(0.6 + e * 0.5); (m.material as any).opacity = 0.9 * (1 - k * k); break; }
      case "embers": G.children.forEach((m, i) => { const s = seeds[i]; m.position.set(x + Math.cos(s.a) * s.r * 0.7, 0.1 + e * (1.4 + s.v * 0.8), 0.1 + Math.sin(s.a) * s.r * 0.5); m.scale.setScalar(0.028 * (1 - k)); }); break;
      case "shadow": { const m = G.children[0] as Mesh; m.position.set(x, 0.9, 0.1); m.scale.set(0.5 + e * 1.3, 0.9 + e * 0.6, 1); (m.material as any).opacity = 0.7 * (1 - k); break; }
      case "dome": { const m = G.children[0] as Mesh; m.position.set(x, 0.85, 0.1); m.scale.setScalar(0.9 + Math.sin(k * Math.PI) * 0.12); (m.material as any).opacity = 0.35 * Math.sin(k * Math.PI); break; }
      case "dust": { const m = G.children[0] as Mesh; m.position.set(x, 0.04, 0.1); m.scale.setScalar(0.3 + e * 1.4); (m.material as any).opacity = 0.55 * (1 - k); break; }
    }
  });
  return (
    <group ref={g}>
      {fx.kind === "sparks" && seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 5, 5]} /><meshBasicMaterial color={i % 3 ? "#ffd166" : "#ffffff"} transparent blending={AdditiveBlending} depthWrite={false} /></mesh>))}
      {fx.kind === "slash" && (<mesh><ringGeometry args={[0.62, 0.8, 32, 1, 0, 1.9]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.85} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} /></mesh>)}
      {fx.kind === "glyph" && (<mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.45, 0.62, 6, 1]} /><meshBasicMaterial color={fx.color} transparent opacity={0.9} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} /></mesh>)}
      {fx.kind === "embers" && seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 5, 5]} /><meshBasicMaterial color={fx.color} transparent blending={AdditiveBlending} depthWrite={false} /></mesh>))}
      {fx.kind === "shadow" && (<mesh><planeGeometry args={[1, 1]} /><meshBasicMaterial color="#1a0a2a" transparent opacity={0.7} depthWrite={false} /></mesh>)}
      {fx.kind === "dome" && (<mesh><sphereGeometry args={[0.95, 24, 16]} /><meshBasicMaterial color={fx.color} transparent opacity={0.3} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} /></mesh>)}
      {fx.kind === "dust" && (<mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.5, 0.9, 32]} /><meshBasicMaterial color="#8a8073" transparent opacity={0.55} side={DoubleSide} depthWrite={false} /></mesh>)}
    </group>
  );
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
type Float = { id: number; side: Side; text: string; color: string; big: boolean };

export default function FactionWarsArena({ player, enemy, battleAnim, registerGlobals = true, height = "clamp(230px, 40vw, 340px)", preload, title }: FactionWarsArenaProps) {
  const p = useAnimChannel(player.anim);
  const e = useAnimChannel(enemy.anim);
  const dir = useRef<Director>(newDirector());
  const speedRef = useRef(1);
  const [fx, setFx] = useState<Fx[]>([]);
  const [floats, setFloats] = useState<Float[]>([]);
  const [flash, setFlash] = useState<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [banner, setBanner] = useState<string | null>(null);
  const [whiteFlash, setWhiteFlash] = useState(0);
  const idRef = useRef(1);
  const timers = useRef<number[]>([]);
  const lastOffensive = useRef<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const later = useCallback((ms: number, fn: () => void) => { const t = window.setTimeout(fn, ms); timers.current.push(t); }, []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // warm the rest of the roster only after the current pair has had the network to itself
  const preloadKey = (preload || []).join(",");
  useEffect(() => {
    const ids = Array.from(new Set(preloadKey.split(",").filter(Boolean)));
    if (!ids.length) return;
    const t = setTimeout(() => ids.forEach((f) => { try { preloadFaction(f); } catch {} }), 6000);
    return () => clearTimeout(t);
  }, [preloadKey]);

  useEffect(() => {
    if (!registerGlobals || typeof window === "undefined") return;
    window.__fw3dPlayPlayer = p.play; window.__fw3dPlayEnemy = e.play;
    return () => { if (window.__fw3dPlayPlayer === p.play) delete window.__fw3dPlayPlayer; if (window.__fw3dPlayEnemy === e.play) delete window.__fw3dPlayEnemy; };
  }, [registerGlobals, p.play, e.play]);

  const spawnFx = useCallback((kind: FxKind, side: Side, color: string) => {
    const id = idRef.current++; const life = FX_LIFE[kind];
    setFx((f) => [...f, { id, kind, side, color, t0: performance.now(), life }]);
    later(life + 50, () => setFx((f) => f.filter((x) => x.id !== id)));
  }, [later]);
  const spawnFloat = useCallback((side: Side, text: string, color: string, big = false) => {
    const id = idRef.current++;
    setFloats((f) => [...f, { id, side, text, color, big }]);
    later(1150, () => setFloats((f) => f.filter((x) => x.id !== id)));
  }, [later]);

  // ── fresh match-up → fly-in + banner + idle
  const matchKey = `${player.id}|${enemy.id}`;
  useEffect(() => {
    p.play("idle"); e.play("idle");
    const d = dir.current; d.ko = null; d.intro = performance.now(); d.knock.player = 0; d.knock.enemy = 0; speedRef.current = 1;
    if (title) { setBanner(title); later(1700, () => setBanner(null)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey]);

  // ── impact choreography: an offensive clip on one side lands on the other side ~IMPACT_MS later
  const impact = useCallback((attacker: Side, kind: FWAnim) => {
    const target: Side = attacker === "player" ? "enemy" : "player";
    const tColor = attacker === "player" ? player.color : enemy.color;
    if (kind === "magic") { spawnFx("glyph", attacker, tColor); spawnFx("embers", attacker, tColor); }
    if (kind === "trick") spawnFx("shadow", attacker, tColor);
    later(IMPACT_MS, () => {
      const d = dir.current;
      if (kind === "attack") spawnFx("slash", target, "#ffffff");
      spawnFx("sparks", target, tColor);
      d.knock[target] = 0.22; d.punch = 1; d.shake = Math.max(d.shake, 1);
      setFlash((f) => ({ ...f, [target]: f[target] + 1 }));
      speedRef.current = 0.02; later(HITSTOP_MS, () => { if (!d.ko) speedRef.current = 1; });
      const busy = performance.now() - lastOffensive.current[target] < CLIP_BUSY_MS;
      const targetAnim = target === "player" ? p.anim : e.anim;
      if (!busy && targetAnim !== "defend" && targetAnim !== "lose" && targetAnim !== "win") (target === "player" ? p : e).play("hit");
    });
  }, [player.color, enemy.color, spawnFx, later, p, e]);

  useEffect(() => { if (p.key > 0 && OFFENSIVE.includes(p.anim)) { lastOffensive.current.player = performance.now(); impact("player", p.anim); } if (p.key > 0 && p.anim === "defend") spawnFx("dome", "player", player.color); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.key]);
  useEffect(() => { if (e.key > 0 && OFFENSIVE.includes(e.anim)) { lastOffensive.current.enemy = performance.now(); impact("enemy", e.anim); } if (e.key > 0 && e.anim === "defend") spawnFx("dome", "enemy", enemy.color); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [e.key]);

  // ── HP deltas → damage / heal numbers on the fighters, KO drama
  const prevHp = useRef({ player: player.hp, enemy: enemy.hp, key: matchKey });
  useEffect(() => {
    const prev = prevHp.current;
    if (prev.key !== matchKey) { prevHp.current = { player: player.hp, enemy: enemy.hp, key: matchKey }; return; }
    (["player", "enemy"] as Side[]).forEach((side) => {
      const now = side === "player" ? player.hp : enemy.hp; const was = prev[side];
      if (now === was) return;
      const delta = now - was;
      const guarded = (side === "player" ? p.anim : e.anim) === "defend";
      // line the number up with the attacker's swing landing (HP often updates before the clip connects)
      const attacker: Side = side === "player" ? "enemy" : "player";
      const sinceSwing = performance.now() - lastOffensive.current[attacker];
      const wait = sinceSwing < IMPACT_MS ? IMPACT_MS - sinceSwing : 0;
      if (delta < 0) {
        const big = -delta >= 20;
        later(wait, () => {
          spawnFloat(side, `${guarded ? "🛡 " : ""}-${-delta}`, guarded ? "#9ca3af" : big ? "#fde68a" : "#ffffff", big);
          if (big) { setWhiteFlash((w) => w + 1); dir.current.shake = Math.max(dir.current.shake, 1.6); }
          if (now <= 0) {
            const d = dir.current; d.ko = { side, at: performance.now() };
            speedRef.current = 0.3; later(1000, () => { speedRef.current = 1; });
            later(420, () => spawnFx("dust", side, "#8a8073"));
          }
        });
      } else if (delta > 0) {
        spawnFloat(side, `+${delta}`, "#4ade80");
      }
    });
    prevHp.current = { player: player.hp, enemy: enemy.hp, key: matchKey };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.hp, enemy.hp, matchKey]);

  // low-HP cues / clash lunge
  dir.current.lowHp.player = player.hp > 0 && player.hp < 25;
  dir.current.lowHp.enemy = enemy.hp > 0 && enemy.hp < 25;
  dir.current.lunge = battleAnim === "clash";
  useEffect(() => { if (battleAnim === "clash") dir.current.shake = Math.max(dir.current.shake, 0.7); }, [battleAnim]);

  const pal = useMemo(() => palette(enemy.color, player.color), [enemy.color, player.color]);
  const clash = battleAnim === "clash";
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
      <Canvas dpr={[1, 1.5]} shadows gl={{ alpha: true, antialias: true }} camera={{ position: [0, CAM_BASE.y, CAM_BASE.z], fov: 36, near: 0.1, far: 40 }} style={{ position: "absolute", inset: 0 }}>
        <Atmosphere fog={pal.fog} dir={dir} />
        <CameraRig dir={dir} />
        <Lights pal={pal} playerColor={player.color} enemyColor={enemy.color} dir={dir} />
        <Ground ring={pal.ring} />
        <Motes color={pal.motes} />
        <Suspense fallback={null}>
          <Stance side="player" dir={dir}>
            <ArenaCharacter factionId={player.id} anim={p.anim} animKey={p.key} position={[SIDE_X.player, 0, 0.1]} rotationY={0.75} dead={playerLost} holdOn={HOLD} speedRef={speedRef} flashKey={flash.player} idleSpeed={dir.current.lowHp.player ? 1.35 : 1} />
          </Stance>
          <Stance side="enemy" dir={dir}>
            <ArenaCharacter factionId={enemy.id} anim={e.anim} animKey={e.key} position={[SIDE_X.enemy, 0, 0.1]} rotationY={-0.75} dead={enemyLost} holdOn={HOLD} speedRef={speedRef} flashKey={flash.enemy} idleSpeed={dir.current.lowHp.enemy ? 1.35 : 1} />
          </Stance>
        </Suspense>
        {fx.map((f) => <FxNode key={f.id} fx={f} />)}
      </Canvas>

      {/* damage / heal numbers over the fighters */}
      {floats.map((f) => (
        <div key={f.id} style={{ position: "absolute", left: f.side === "player" ? "30%" : "70%", top: "34%", pointerEvents: "none",
          fontWeight: 900, fontSize: f.big ? 34 : 24, color: f.color, letterSpacing: "0.02em",
          textShadow: `0 0 18px ${f.color}aa, 0 2px 4px rgba(0,0,0,0.9)`, animation: `fwFloat ${f.big ? "1.1s" : "1s"} cubic-bezier(0.2,0.9,0.3,1) both` }}>
          {f.text}
        </div>
      ))}

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
      {banner && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", animation: "fwBanner 1.7s ease-out both" }}>
          <div style={{ fontWeight: 900, fontSize: "clamp(16px, 3.2vw, 30px)", letterSpacing: "0.3em", color: "#fff", textShadow: `0 0 30px ${enemy.color}, 0 2px 8px rgba(0,0,0,0.9)`, padding: "10px 22px", borderTop: `1px solid ${enemy.color}88`, borderBottom: `1px solid ${enemy.color}88`, background: "rgba(0,0,0,0.35)" }}>{banner}</div>
        </div>
      )}
      {player.hp < 25 && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(90deg, rgba(248,113,113,0.28), transparent 45%)", animation: "fwPulse 1.1s ease-in-out infinite" }} />}
      {enemy.hp < 25 && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(270deg, rgba(248,113,113,0.28), transparent 45%)", animation: "fwPulse 1.1s ease-in-out infinite" }} />}
      {whiteFlash > 0 && <div key={whiteFlash} style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "#fff", animation: "fwWhite .28s ease-out both" }} />}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.5) 100%)" }} />
      <style>{`
        @keyframes fwFloat{0%{opacity:0;transform:translate(-50%,14px) scale(.6)}18%{opacity:1;transform:translate(-50%,-4px) scale(1.15)}70%{opacity:1;transform:translate(-50%,-26px) scale(1)}100%{opacity:0;transform:translate(-50%,-46px) scale(.95)}}
        @keyframes fwBanner{0%{opacity:0;transform:scale(1.08)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}
        @keyframes fwPulse{0%,100%{opacity:.55}50%{opacity:1}}
        @keyframes fwWhite{0%{opacity:.75}100%{opacity:0}}
      `}</style>
    </div>
  );
}
