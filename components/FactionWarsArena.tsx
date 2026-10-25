// components/FactionWarsArena.tsx
//
// PRESENTATION ONLY. The shared 3D duel stage for Faction Wars (solo + PvP): both fighters in one r3f scene,
// lit in the defending faction's colour. Game logic never changes here — it still drives the fighters through
// `player.anim` / `enemy.anim` and the legacy `window.__fw3dPlayPlayer(anim)` / `window.__fw3dPlayEnemy(anim)` globals.
//
// The fighters are driven by the code fight engine (components/fight): real punches, kicks, blocks, thrown stars and
// spells that land on the opponent, hit-stop and sparks — and when a fighter is knocked out, a finishing move
// (two per faction, stylised, no gore). The winner picks one when `finisherChoice` is on (solo), otherwise it's automatic.
// `window.__fwArenaFinish()` resolves once the finishing move is over, so the game can wait for it before moving on.
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Color, Fog, type PerspectiveCamera, type PointLight, type SpotLight } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FightStage, type StageEvent } from "./fight/stage";
import { finishersFor, type Finisher } from "./fight/finishers";

export type FWAnim = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";
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
  height?: string;       // CSS height; default clamp(250px, 44vw, 380px)
  /** Faction ids to warm up in the background (the whole team + all defenders) so rotations are instant. */
  preload?: string[];
  /** Banner shown during the fly-in when a new match-up starts, e.g. "TERRITORY 3 · SHOGUN'S HOLD". */
  title?: string;
  /** Let the player pick the finishing move when they win (solo). Otherwise it's picked automatically. */
  finisherChoice?: boolean;
  /** optional game sound hooks (useFWAudio().sfx) for the finishing moves */
  sfx?: Partial<Record<"clash" | "hitLight" | "hitHeavy" | "imperial" | "ultra" | "berserker", () => void>>;
};

declare global {
  interface Window {
    __fw3dPlayPlayer?: (a: FWAnim) => void;
    __fw3dPlayEnemy?: (a: FWAnim) => void;
    __fwArenaFinish?: () => Promise<void>;
  }
}

type Side = "player" | "enemy";
const SIDE_X: Record<Side, number> = { player: -0.78, enemy: 0.78 };
const SUPPORTED = ["ashigaru", "buke", "bushi", "kenshi", "ronin", "samurai", "shogun", "sohei", "warrior", "wokou", "yamabushi"];
const modelPath = (f: string) => `/faction-wars/characters/${SUPPORTED.includes(f) ? f : "samurai"}/${SUPPORTED.includes(f) ? f : "samurai"}.glb`;
export function preloadFaction(f: string) { useGLTF.preload(modelPath(f)); }

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
type Director = { punch: number; shake: number; intro: number | null; ko: { side: Side; at: number } | null; lowHp: { player: boolean; enemy: boolean } };
const newDirector = (): Director => ({ punch: 0, shake: 0, intro: null, ko: null, lowHp: { player: false, enemy: false } });

function Atmosphere({ fog, dir }: { fog: string; dir: React.MutableRefObject<Director> }) {
  const { scene } = useThree();
  const fogRef = useRef<Fog | null>(null);
  useEffect(() => { const f = new Fog(new Color(fog), 4.5, 15); fogRef.current = f; scene.fog = f; return () => { scene.fog = null; }; }, [scene, fog]);
  useFrame((_, dt) => {
    const f = fogRef.current; if (!f) return;
    const low = dir.current.lowHp.player || dir.current.lowHp.enemy;
    const targetFar = dir.current.ko ? 12 : low ? 11 : 15;
    f.far += (targetFar - f.far) * Math.min(1, dt * 2);
  });
  return null;
}

function Motes({ color, count = 45 }: { color: string; count?: number }) {
  const ref = useRef<any>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453) % 1, y: (Math.sin(i * 78.233) * 43758.5453) % 1, z: (Math.sin(i * 39.346) * 43758.5453) % 1, s: 0.5 + ((i * 7) % 5) / 5 })), [count]);
  useFrame(({ clock }) => {
    const g = ref.current; if (!g) return; const t = clock.getElapsedTime();
    g.children.forEach((m: any, i: number) => { const sd = seeds[i]; m.position.set(sd.x * 9 - 4.5, ((sd.y * 3 + t * 0.1 * sd.s) % 3) + 0.1, sd.z * 6 - 4); m.scale.setScalar(0.011 + Math.sin(t * 2 + i) * 0.004); });
  });
  return (
    <group ref={ref}>
      {seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 6, 6]} /><meshBasicMaterial color={color} transparent opacity={0.6} /></mesh>))}
    </group>
  );
}

const CAM_BASE = { y: 1.1, z: 4.15, lookY: 0.98, fov: 36 };

function CameraRig({ dir, stage }: { dir: React.MutableRefObject<Director>; stage: FightStage }) {
  const { camera } = useThree();
  const cur = useRef({ x: 0, y: CAM_BASE.y, z: CAM_BASE.z, lx: 0, ly: CAM_BASE.lookY, lz: 0, fov: CAM_BASE.fov });
  useEffect(() => { stage.fx.camera = camera; }, [camera, stage]);
  useFrame(({ clock }, dt) => {
    const d = dir.current; const t = clock.getElapsedTime(); const now = performance.now();
    let tx = Math.sin(t * 0.25) * 0.1, ty = CAM_BASE.y + Math.sin(t * 0.4) * 0.03, tz = CAM_BASE.z, lx = 0, ly = CAM_BASE.lookY, lz = 0, ease = 6, fov = CAM_BASE.fov;
    const shot = stage.cam;
    if (shot) {
      tx = shot.pos.x; ty = shot.pos.y; tz = shot.pos.z; lx = shot.look.x; ly = shot.look.y; lz = shot.look.z; ease = shot.ease || 4; fov = shot.fov || CAM_BASE.fov;
    } else if (d.intro != null) {
      const k = Math.min(1, (now - d.intro) / 1500);
      const e = 1 - Math.pow(1 - k, 3);
      // start low over the player's shoulder, swing round to the duel angle
      tx = -2.6 * (1 - e); ty = 1.25 - (1.25 - CAM_BASE.y) * e; tz = 1.9 + (CAM_BASE.z - 1.9) * e;
      lx = 0.9 * (1 - e); ly = 1.0 - 0.08 * e; ease = 30;
      if (k >= 1) d.intro = null;
    } else if (d.ko) {
      const sx = SIDE_X[d.ko.side];
      tx = sx * 0.35; ty = 1.18; tz = 3.6; lx = sx * 0.45; ly = 1.0; ease = 3;
    }
    d.punch *= Math.exp(-dt * 9); tz -= d.punch * 0.25;
    d.shake *= Math.exp(-dt * 7);
    const s = d.shake;
    const c = cur.current; const a = Math.min(1, dt * ease);
    c.x += (tx - c.x) * a; c.y += (ty - c.y) * a; c.z += (tz - c.z) * a; c.lx += (lx - c.lx) * a; c.ly += (ly - c.ly) * a; c.lz += (lz - c.lz) * a; c.fov += (fov - c.fov) * a;
    camera.position.set(c.x + (Math.random() - 0.5) * s * 0.09, c.y + (Math.random() - 0.5) * s * 0.06, c.z);
    const pc = camera as PerspectiveCamera; if (Math.abs(pc.fov - c.fov) > 0.01) { pc.fov = c.fov; pc.updateProjectionMatrix(); }
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
    const dim = d.ko ? 0.6 : 1;
    if (amb.current) amb.current.intensity += (1.15 * dim - amb.current.intensity) * a;
    if (key.current) key.current.intensity += (1.9 * dim - key.current.intensity) * a;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    if (pl.current) { pl.current.color.copy(pc); if (d.lowHp.player) pl.current.color.lerp(red, 0.5 + 0.5 * pulse); pl.current.intensity += ((d.lowHp.player ? 2.2 + pulse * 1.6 : 2.2) - pl.current.intensity) * a; }
    if (el.current) { el.current.color.copy(ec); if (d.lowHp.enemy) el.current.color.lerp(red, 0.5 + 0.5 * pulse); el.current.intensity += ((d.lowHp.enemy ? 2.2 + pulse * 1.6 : 2.2) - el.current.intensity) * a; }
    if (spot.current) {
      const winnerX = d.ko ? -SIDE_X[d.ko.side] : 0;
      spot.current.intensity += ((d.ko ? 10 : 0) - spot.current.intensity) * a;
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} receiveShadow>
        <circleGeometry args={[3.8, 48]} />
        <meshStandardMaterial color="#0b0c12" roughness={0.95} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[3.6, 3.8, 64]} />
        <meshBasicMaterial color={ring} transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <ringGeometry args={[1.25, 1.3, 48]} />
        <meshBasicMaterial color={ring} transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

/** loads both fighters' models into the fight engine and ticks it */
function Fighters({ stage, player, enemy }: { stage: FightStage; player: ArenaFighter; enemy: ArenaFighter }) {
  const gp = useGLTF(modelPath(player.id)) as any;
  const ge = useGLTF(modelPath(enemy.id)) as any;
  useEffect(() => { const m = cloneSkinned(gp.scene); m.scale.setScalar(0.011); stage.setFighter("player", m, player.id, player.color); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gp.scene, player.id, stage]);
  useEffect(() => { const m = cloneSkinned(ge.scene); m.scale.setScalar(0.011); stage.setFighter("enemy", m, enemy.id, enemy.color); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ge.scene, enemy.id, stage]);
  useFrame((_, dt) => stage.update(dt));
  return <primitive object={stage.group} />;
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

type Float = { id: number; side: Side; text: string; color: string; big: boolean };
type Choice = { side: Side; options: Finisher[]; until: number };

export default function FactionWarsArena({ player, enemy, battleAnim, registerGlobals = true, height = "clamp(250px, 44vw, 380px)", preload, title, finisherChoice = false, sfx }: FactionWarsArenaProps) {
  const p = useAnimChannel(player.anim);
  const e = useAnimChannel(enemy.anim);
  const dir = useRef<Director>(newDirector());
  const stage = useMemo(() => new FightStage(), []);
  const [floats, setFloats] = useState<Float[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [whiteFlash, setWhiteFlash] = useState<{ n: number; color: string; a: number }>({ n: 0, color: "#fff", a: 0.75 });
  const [callout, setCallout] = useState<{ text: string; color: string; n: number } | null>(null);
  const [finTitle, setFinTitle] = useState<{ text: string; color: string; n: number } | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const idRef = useRef(1);
  const timers = useRef<number[]>([]);
  const later = useCallback((ms: number, fn: () => void) => { const t = window.setTimeout(fn, ms); timers.current.push(t); return t; }, []);
  const sfxRef = useRef(sfx); sfxRef.current = sfx;
  const finState = useRef<{ active: boolean; running: boolean; waiters: (() => void)[] }>({ active: false, running: false, waiters: [] });
  const pending = useRef<{ float: Partial<Record<Side, Float[]>>; ko: Side | null; koTimer: number | null }>({ float: {}, ko: null, koTimer: null });
  const lastImpact = useRef<Record<Side, number>>({ player: 0, enemy: 0 });
  const colors = useRef({ player: player.color, enemy: enemy.color }); colors.current = { player: player.color, enemy: enemy.color };
  const choiceRef = useRef(finisherChoice); choiceRef.current = finisherChoice;
  useEffect(() => () => { timers.current.forEach(clearTimeout); finState.current.waiters.splice(0).forEach((r) => r()); }, []);

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

  // a new match-up drops the previous knock-out's choice and lets anyone waiting on its finisher move on
  useEffect(() => {
    setChoice(null); const fs = finState.current;
    if (fs.active && !stage.fin) { fs.active = false; fs.running = false; fs.waiters.splice(0).forEach((r) => r()); }
  }, [player.id, enemy.id, stage]);

  // the game can wait for the finishing move before it moves on
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fn = () => (finState.current.active ? new Promise<void>((res) => finState.current.waiters.push(res)) : Promise.resolve());
    window.__fwArenaFinish = fn;
    return () => { if (window.__fwArenaFinish === fn) delete window.__fwArenaFinish; };
  }, []);

  const spawnFloat = useCallback((f: Float) => {
    setFloats((x) => [...x, f]);
    later(1150, () => setFloats((x) => x.filter((y) => y.id !== f.id)));
  }, [later]);
  const flushFloats = useCallback((side: Side) => { const list = pending.current.float[side]; if (list?.length) { list.forEach(spawnFloat); pending.current.float[side] = []; } }, [spawnFloat]);

  const finishDone = useCallback(() => {
    const fs = finState.current; fs.running = false;
    later(900, () => { fs.active = false; fs.waiters.splice(0).forEach((r) => r()); });
  }, [later]);
  const runFinisher = useCallback((winner: Side, f: Finisher) => {
    setChoice(null);
    const Wf = stage.f[winner]; if (!stage.koSide || !Wf || !finishersFor(Wf.faction).includes(f)) return;   // stale choice from an earlier match-up
    finState.current.running = true;
    sfxRef.current?.clash?.();
    stage.runFinisher(winner, f).then(finishDone);
  }, [stage, finishDone]);

  const startKO = useCallback((loser: Side) => {
    const pd = pending.current; if (pd.koTimer) { clearTimeout(pd.koTimer); pd.koTimer = null; } pd.ko = null;
    if (stage.koSide) return;
    stage.ko(loser);
    dir.current.ko = { side: loser, at: performance.now() };
    const winner: Side = loser === "player" ? "enemy" : "player";
    const W = stage.f[winner]; if (!W) { finishDone(); return; }
    const options = finishersFor(W.faction);
    later(650, () => { setCallout({ text: "FINISH THEM!", color: "#ff3b3b", n: idRef.current++ }); sfxRef.current?.berserker?.(); });
    if (winner === "player" && choiceRef.current) {
      // every delayed step checks it still belongs to this knock-out (a new match-up can arrive before the 5 s choice runs out)
      const same = () => stage.f[winner] === W && stage.koSide === loser;
      later(1100, () => { if (same()) setChoice({ side: winner, options, until: performance.now() + 5000 }); });
      later(6100, () => { if (same() && finState.current.active && !finState.current.running && !stage.fin) runFinisher(winner, options[Math.floor(Math.random() * options.length)]); });
    } else {
      later(1900, () => { if (stage.f[winner] === W && stage.koSide === loser) runFinisher(winner, options[Math.floor(Math.random() * options.length)]); });
    }
  }, [stage, later, runFinisher, finishDone]);

  // engine events → overlays, shake, sounds; the HP numbers pop exactly when the blow lands
  useEffect(() => stage.on((ev: StageEvent) => {
    const d = dir.current;
    if (ev.type === "impact") {
      lastImpact.current[ev.target] = performance.now();
      flushFloats(ev.target);
      if (pending.current.ko === ev.target) startKO(ev.target);
      d.punch = Math.max(d.punch, ev.blocked ? 0.3 : 0.5 + ev.power * 0.2);
      if (stage.fin) (ev.power >= 3 ? sfxRef.current?.hitHeavy : sfxRef.current?.hitLight)?.();
    }
    if (ev.type === "shake") d.shake = Math.max(d.shake, ev.amount);
    if (ev.type === "screenFlash") setWhiteFlash((w) => ({ n: w.n + 1, color: ev.color, a: Math.min(0.85, ev.strength) }));
    if (ev.type === "title") { setFinTitle({ text: ev.text, color: ev.color, n: idRef.current++ }); sfxRef.current?.ultra?.(); }
  }), [stage, flushFloats, startKO]);

  // ── fresh match-up → fly-in + banner + reset
  const matchKey = `${player.id}|${enemy.id}`;
  useEffect(() => {
    p.play("idle"); e.play("idle");
    const d = dir.current; d.ko = null; d.intro = performance.now();
    pending.current = { float: {}, ko: null, koTimer: null };
    setChoice(null); setCallout(null); setFinTitle(null);
    const fs = finState.current; fs.active = false; fs.running = false; fs.waiters.splice(0).forEach((r) => r());
    if (title) { setBanner(title); later(1700, () => setBanner(null)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey]);

  // game anims → engine
  useEffect(() => { if (p.key > 0) stage.play("player", p.anim); }, [p.key, p.anim, stage]);
  useEffect(() => { if (e.key > 0) stage.play("enemy", e.anim); }, [e.key, e.anim, stage]);

  // ── HP deltas → damage / heal numbers, KO
  const prevHp = useRef({ player: player.hp, enemy: enemy.hp, key: matchKey });
  useEffect(() => {
    const prev = prevHp.current;
    if (prev.key !== matchKey) { prevHp.current = { player: player.hp, enemy: enemy.hp, key: matchKey }; return; }
    (["enemy", "player"] as Side[]).forEach((side) => {   // the game checks the defender first: if both drop to 0, the player wins
      const now = side === "player" ? player.hp : enemy.hp; const was = prev[side];
      if (now === was) return;
      const delta = now - was;
      if (delta < 0) {
        const guarded = stage.f[side]?.guarding || (side === "player" ? p.anim : e.anim) === "defend";
        const big = -delta >= 20;
        const f: Float = { id: idRef.current++, side, text: `${guarded ? "🛡 " : ""}-${-delta}`, color: guarded ? "#9ca3af" : big ? "#fde68a" : "#ffffff", big };
        // the blow may already have landed (the result arrives after the swing) — otherwise wait for it
        const landed = performance.now() - lastImpact.current[side] < 700;
        if (landed) spawnFloat(f); else { (pending.current.float[side] ||= []).push(f); later(1100, () => flushFloats(side)); }
        if (big) dir.current.shake = Math.max(dir.current.shake, 0.8);
        if (now <= 0 && !stage.koSide && !pending.current.ko) {
          pending.current.ko = side; finState.current.active = true;
          pending.current.koTimer = later(landed ? 150 : 1200, () => { if (pending.current.ko === side) startKO(side); });
        }
      } else if (delta > 0) {
        spawnFloat({ id: idRef.current++, side, text: `+${delta}`, color: "#4ade80", big: false });
      }
    });
    prevHp.current = { player: player.hp, enemy: enemy.hp, key: matchKey };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.hp, enemy.hp, matchKey]);

  // low-HP cues
  dir.current.lowHp.player = player.hp > 0 && player.hp < 25;
  dir.current.lowHp.enemy = enemy.hp > 0 && enemy.hp < 25;
  useEffect(() => { if (battleAnim === "clash") dir.current.shake = Math.max(dir.current.shake, 0.4); }, [battleAnim]);

  // finisher-choice countdown
  const [, force] = useState(0);
  useEffect(() => { if (!choice) return; const t = setInterval(() => force((x) => x + 1), 100); return () => clearInterval(t); }, [choice]);

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
  const left = choice ? Math.max(0, choice.until - performance.now()) : 0;

  return (
    <div style={{ position: "relative", width: "100%", height, borderRadius: 14, overflow: "hidden", marginBottom: 14, border: "1px solid rgba(255,255,255,0.08)",
      background: `radial-gradient(ellipse at 50% 15%, ${pal.skyTop} 0%, ${pal.skyBottom} 60%, #000 100%)` }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 22% 55%, ${player.color}33 0%, transparent 55%), radial-gradient(ellipse at 78% 55%, ${enemy.color}33 0%, transparent 55%)`, transition: "background .5s" }} />
      <Canvas dpr={[1, 1.5]} shadows gl={{ alpha: true, antialias: true }} camera={{ position: [0, CAM_BASE.y, CAM_BASE.z], fov: CAM_BASE.fov, near: 0.1, far: 60 }} style={{ position: "absolute", inset: 0 }}>
        <Atmosphere fog={pal.fog} dir={dir} />
        <CameraRig dir={dir} stage={stage} />
        <Lights pal={pal} playerColor={player.color} enemyColor={enemy.color} dir={dir} />
        <Ground ring={pal.ring} />
        <Motes color={pal.motes} />
        <Suspense fallback={null}>
          <Fighters stage={stage} player={player} enemy={enemy} />
        </Suspense>
      </Canvas>

      {/* damage / heal numbers over the fighters */}
      {floats.map((f) => (
        <div key={f.id} style={{ position: "absolute", left: f.side === "player" ? "32%" : "68%", top: "30%", pointerEvents: "none",
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
      {callout && (
        <div key={callout.n} style={{ position: "absolute", left: 0, right: 0, top: "14%", textAlign: "center", pointerEvents: "none", animation: "fwCallout 1.6s ease-out both" }}>
          <span style={{ fontWeight: 900, fontStyle: "italic", fontSize: "clamp(26px, 6.5vw, 58px)", letterSpacing: "0.04em", color: "#ffe1d0", WebkitTextStroke: "2px #5a0000", textShadow: `0 0 24px ${callout.color}, 0 4px 0 #2a0000` }}>{callout.text}</span>
        </div>
      )}
      {choice && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, animation: "fwRise .35s ease-out both" }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.22em", color: "#fff", opacity: 0.8, textShadow: "0 1px 4px #000" }}>CHOOSE YOUR FINISHER</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", padding: "0 10px" }}>
            {choice.options.map((f) => (
              <button key={f.id} onClick={() => runFinisher(choice.side, f)}
                style={{ cursor: "pointer", padding: "10px 16px", borderRadius: 10, border: `2px solid ${player.color}`, background: "linear-gradient(180deg, rgba(20,8,8,0.92), rgba(60,10,10,0.92))", color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", boxShadow: `0 0 18px ${player.color}88`, textTransform: "uppercase" }}>
                ☠ {f.name}
              </button>
            ))}
          </div>
          <div style={{ width: 180, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(left / 5000) * 100}%`, background: player.color }} />
          </div>
        </div>
      )}
      {finTitle && (
        <div key={finTitle.n} style={{ position: "absolute", left: 0, right: 0, bottom: "16%", textAlign: "center", pointerEvents: "none", animation: "fwTitle 2.4s ease-out both" }}>
          <div style={{ fontWeight: 900, fontSize: "clamp(22px, 5.6vw, 50px)", letterSpacing: "0.12em", color: "#fff", WebkitTextStroke: `1.5px ${finTitle.color}`, textShadow: `0 0 26px ${finTitle.color}, 0 0 60px ${finTitle.color}aa, 0 3px 6px #000` }}>{finTitle.text}</div>
          <div style={{ fontWeight: 900, fontSize: "clamp(10px, 1.8vw, 14px)", letterSpacing: "0.5em", color: finTitle.color, marginTop: 4, textShadow: "0 1px 4px #000" }}>FINISHER</div>
        </div>
      )}
      {player.hp < 25 && player.hp > 0 && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(90deg, rgba(248,113,113,0.28), transparent 45%)", animation: "fwPulse 1.1s ease-in-out infinite" }} />}
      {enemy.hp < 25 && enemy.hp > 0 && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(270deg, rgba(248,113,113,0.28), transparent 45%)", animation: "fwPulse 1.1s ease-in-out infinite" }} />}
      {whiteFlash.n > 0 && <div key={whiteFlash.n} style={{ position: "absolute", inset: 0, pointerEvents: "none", background: whiteFlash.color, opacity: 0, animation: "fwWhite .32s ease-out both", ["--fwA" as any]: whiteFlash.a }} />}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.5) 100%)" }} />
      <style>{`
        @keyframes fwFloat{0%{opacity:0;transform:translate(-50%,14px) scale(.6)}18%{opacity:1;transform:translate(-50%,-4px) scale(1.15)}70%{opacity:1;transform:translate(-50%,-26px) scale(1)}100%{opacity:0;transform:translate(-50%,-46px) scale(.95)}}
        @keyframes fwBanner{0%{opacity:0;transform:scale(1.08)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}
        @keyframes fwPulse{0%,100%{opacity:.55}50%{opacity:1}}
        @keyframes fwWhite{0%{opacity:var(--fwA,.75)}100%{opacity:0}}
        @keyframes fwCallout{0%{opacity:0;transform:scale(2.2)}14%{opacity:1;transform:scale(1)}78%{opacity:1;transform:scale(1.04)}100%{opacity:0;transform:scale(1.1)}}
        @keyframes fwTitle{0%{opacity:0;transform:scale(1.5);filter:blur(6px)}12%{opacity:1;transform:scale(1);filter:blur(0)}85%{opacity:1}100%{opacity:0}}
        @keyframes fwRise{0%{opacity:0;transform:translateY(16px)}100%{opacity:1;transform:translateY(0)}}
      `}</style>
    </div>
  );
}

SUPPORTED.forEach((f) => useGLTF.preload(modelPath(f)));
