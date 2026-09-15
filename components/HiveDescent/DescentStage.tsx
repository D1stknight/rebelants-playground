// components/HiveDescent/DescentStage.tsx
// Hive Descent v3 stage: over-the-shoulder view down the tunnel. Your champion stands with its back
// to the camera; 1–3 corrupted enemies face you in an arc. Presentation only — driven by props.
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, useTexture } from "@react-three/drei";
import { AdditiveBlending, BackSide, Color, CylinderGeometry, DoubleSide, Fog, RepeatWrapping, SRGBColorSpace, type Group, type Mesh, type PerspectiveCamera, type Texture } from "three";
import ArenaCharacter, { type ArenaAnim } from "../arena/ArenaCharacter";
import type { Biome } from "./biomes";

export type StageActor = { id: number; factionId: string; anim: ArenaAnim; animKey: number; dead: boolean; scale: number; flashKey: number; pos: [number, number, number]; dissolveAt?: number | null };
export type StageFx = { id: number; kind: "sparks" | "slash" | "glyph" | "dome" | "poison" | "dust" | "dissolve"; x: number; z: number; color: string; t0: number; life: number };

type Props = {
  biome: Biome;
  player: StageActor;
  enemies: StageActor[];
  targetId: number | null;
  onPickTarget: (id: number) => void;
  shake: number;
  speedRef: React.MutableRefObject<number>;
  fx: StageFx[];
  /** DOM to draw above each enemy's head (name, HP, intent…) */
  renderEnemyLabel: (id: number) => React.ReactNode;
  /** Floating numbers anchored to enemies */
  renderEnemyFloats: (id: number) => React.ReactNode;
};

// Dev tuning without a rebuild: ?hdp=x,y,z (player) ?hdcam=x,y,z (camera) ?hdlook=x,y,z (look-at)
function q3(name: string, def: [number, number, number]): [number, number, number] {
  if (typeof window === "undefined") return def;
  const raw = new URLSearchParams(window.location.search).get(name); if (!raw) return def;
  const p = raw.split(",").map(Number); return p.length === 3 && p.every(Number.isFinite) ? (p as [number, number, number]) : def;
}
export const PLAYER_POS: [number, number, number] = q3("hdp", [0.95, 0, 0.2]);
const CAM_POS = q3("hdcam", [-0.9, 1.85, 3.9]);
const HFOV_DEG = 64;
const CAM_LOOK = q3("hdlook", [0.1, 1.0, -1.3]);
export function enemySlots(n: number): [number, number, number][] {
  if (n <= 1) return [[-0.1, 0, -1.5]];
  if (n === 2) return [[-1.0, 0, -1.4], [0.9, 0, -2.1]];
  return [[-1.6, 0, -1.2], [-0.25, 0, -2.3], [0.85, 0, -1.9]];
}
export const FX_LIFE: Record<StageFx["kind"], number> = { sparks: 450, slash: 280, glyph: 900, dome: 700, poison: 800, dust: 900, dissolve: 1400 };

function Atmosphere({ biome }: { biome: Biome }) {
  const { scene } = useThree();
  useEffect(() => { scene.fog = new Fog(new Color(biome.fogColor).multiplyScalar(0.45), 4, 15); return () => { scene.fog = null; }; }, [scene, biome.fogColor]);
  return null;
}

const TEX = ["/descent/tex/cave_diff.jpg", "/descent/tex/cave_nrm.jpg", "/descent/tex/cave_rough.jpg"];
function prepTex(t: Texture, rx: number, ry: number, srgb = false) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4; if (srgb) t.colorSpace = SRGBColorSpace; t.needsUpdate = true; return t; }
function wallTint(biome: Biome) { return new Color("#ffffff").lerp(new Color(biome.particleColor), 0.18); }

/** Packed-earth shaft: a lumpy inverted cylinder with a tiled rock texture + normal map, so the walls catch the lights. */
function Tunnel({ biome }: { biome: Biome }) {
  const [map, nrm, rough] = useTexture(TEX) as Texture[];
  const maps = useMemo(() => [prepTex(map.clone(), 4, 4, true), prepTex(nrm.clone(), 4, 4), prepTex(rough.clone(), 4, 4)], [map, nrm, rough]);
  const geo = useMemo(() => {
    const g = new CylinderGeometry(3.7, 3.0, 22, 56, 28, true);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const a = Math.atan2(z, x); const r = Math.hypot(x, z);
      const n = Math.sin(a * 3 + y * 0.7) * 0.22 + Math.sin(a * 7 - y * 1.3) * 0.1 + Math.sin(a * 13 + y * 2.9) * 0.05 + Math.sin(y * 0.9) * 0.12;
      const k = (r + n) / r; pos.setX(i, x * k); pos.setZ(i, z * k);
    }
    g.computeVertexNormals(); return g;
  }, []);
  const roots = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const side = i % 2 ? 1 : -1; const r = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1); const r2 = Math.abs((Math.sin(i * 78.233) * 43758.5453) % 1);
    const x = side * (1.6 + r * 1.4); const h = 0.9 + r2 * 1.6; const ceil = 1.35 + Math.sqrt(Math.max(0, 3.4 * 3.4 - x * x));
    return { x, y: ceil - h / 2 + 0.15, z: -2.2 - (i / 14) * 10, h, tilt: side * (0.1 + r * 0.25), w: 0.05 + r2 * 0.06 };
  }), []);
  const tint = useMemo(() => wallTint(biome), [biome]);
  return (
    <group>
      <mesh geometry={geo} position={[0, 1.35, -7]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial map={maps[0]} normalMap={maps[1]} roughnessMap={maps[2]} normalScale={[1.4, 1.4] as any} side={BackSide} color={tint} roughness={1} metalness={0} />
      </mesh>
      {roots.map((r, i) => (
        <mesh key={`r${i}`} position={[r.x, r.y, r.z]} rotation={[0, 0, r.tilt]} castShadow>
          <cylinderGeometry args={[r.w * 0.3, r.w, r.h, 6]} />
          <meshStandardMaterial color="#2a1a12" roughness={1} />
        </mesh>
      ))}
      {/* far end: darkness with a faint glow the fog eats into */}
      <mesh position={[0, 1.35, -17.9]}>
        <circleGeometry args={[4.2, 32]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <pointLight position={[0, 2.2, -6]} intensity={2.2} distance={7} color={biome.particleColor} />
      <pointLight position={[0, 1.8, -11]} intensity={1.6} distance={7} color={biome.keyLightColor} />
    </group>
  );
}

function Ground({ biome }: { biome: Biome }) {
  const [map, nrm, rough] = useTexture(TEX) as Texture[];
  const maps = useMemo(() => [prepTex(map.clone(), 2.5, 5, true), prepTex(nrm.clone(), 2.5, 5), prepTex(rough.clone(), 2.5, 5)], [map, nrm, rough]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, -6]} receiveShadow>
        <planeGeometry args={[10, 24]} />
        <meshStandardMaterial map={maps[0]} normalMap={maps[1]} roughnessMap={maps[2]} normalScale={[0.9, 0.9] as any} color="#8a7466" roughness={1} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, -1.7]}>
        <ringGeometry args={[2.3, 2.38, 64]} />
        <meshBasicMaterial color={biome.particleColor} transparent opacity={0.22} />
      </mesh>
    </group>
  );
}

function Motes({ color, count = 50 }: { color: string; count?: number }) {
  const ref = useRef<Group | null>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453) % 1, y: (Math.sin(i * 78.233) * 43758.5453) % 1, z: (Math.sin(i * 39.346) * 43758.5453) % 1, s: 0.5 + ((i * 7) % 5) / 5 })), [count]);
  useFrame(({ clock }) => {
    const g = ref.current; if (!g) return; const t = clock.getElapsedTime();
    g.children.forEach((m, i) => { const sd = seeds[i]; m.position.set(sd.x * 7 - 3.5, ((sd.y * 3 + t * 0.1 * sd.s) % 3) + 0.1, sd.z * 9 - 7); m.scale.setScalar(0.012 + Math.sin(t * 2 + i) * 0.004); });
  });
  return (
    <group ref={ref}>
      {seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 6, 6]} /><meshBasicMaterial color={color} transparent opacity={0.6} /></mesh>))}
    </group>
  );
}

function CameraRig({ shakeRef, focus }: { shakeRef: React.MutableRefObject<number>; focus: React.MutableRefObject<[number, number, number] | null> }) {
  const { camera, size } = useThree();
  const cur = useRef({ lx: CAM_LOOK[0], ly: CAM_LOOK[1], lz: CAM_LOOK[2] });
  useEffect(() => {
    const cam = camera as PerspectiveCamera; const aspect = size.width / Math.max(1, size.height);
    const vf = Math.max(38, Math.min(80, (2 * Math.atan(Math.tan((HFOV_DEG * Math.PI) / 360) / aspect) * 180) / Math.PI));
    cam.fov = vf; cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime(); const s = shakeRef.current; shakeRef.current *= Math.exp(-dt * 7);
    const f = focus.current;
    const tl = f ? [CAM_LOOK[0] + f[0] * 0.45, CAM_LOOK[1], CAM_LOOK[2] + (f[2] - CAM_LOOK[2]) * 0.4] : CAM_LOOK;
    const c = cur.current; const a = Math.min(1, dt * 4);
    c.lx += (tl[0] - c.lx) * a; c.ly += (tl[1] - c.ly) * a; c.lz += (tl[2] - c.lz) * a;
    camera.position.set(CAM_POS[0] + Math.sin(t * 0.3) * 0.05 + (Math.random() - 0.5) * s * 0.08, CAM_POS[1] + Math.sin(t * 0.45) * 0.03 + (Math.random() - 0.5) * s * 0.05, CAM_POS[2]);
    camera.lookAt(c.lx, c.ly, c.lz);
  });
  return null;
}

function FxNode({ fx }: { fx: StageFx }) {
  const g = useRef<Group | null>(null);
  const seeds = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2 + (Math.sin(i * 7.1) % 1) * 0.4, v: 0.9 + ((i * 37) % 10) / 10, r: 0.3 + ((i * 13) % 7) / 10 })), []);
  useFrame(() => {
    const G = g.current; if (!G) return;
    const k = Math.min(1, (performance.now() - fx.t0) / fx.life); const e = 1 - Math.pow(1 - k, 2);
    G.visible = k < 1;
    const { x, z } = fx;
    switch (fx.kind) {
      case "sparks": G.children.forEach((m, i) => { const s = seeds[i]; m.position.set(x + Math.cos(s.a) * e * s.r * 1.2, 1.05 + Math.sin(s.a) * e * s.r - e * e * 0.4, z + 0.3 + Math.sin(i) * 0.1); m.scale.setScalar(0.035 * (1 - k) * s.v); }); break;
      case "slash": { const m = G.children[0] as Mesh; m.position.set(x, 1.0, z + 0.35); m.rotation.z = 0.6 + e * 1.4; m.scale.setScalar(0.55 + e * 0.5); (m.material as any).opacity = 0.85 * (1 - k); break; }
      case "glyph": { const m = G.children[0] as Mesh; m.position.set(x, 0.035, z); m.rotation.z = e * 2.5; m.scale.setScalar(0.6 + e * 0.5); (m.material as any).opacity = 0.9 * (1 - k * k); break; }
      case "dome": { const m = G.children[0] as Mesh; m.position.set(x, 0.85, z); m.scale.setScalar(0.9 + Math.sin(k * Math.PI) * 0.12); (m.material as any).opacity = 0.2 * Math.sin(k * Math.PI); break; }
      case "poison": G.children.forEach((m, i) => { const s = seeds[i]; m.position.set(x + Math.cos(s.a) * s.r * 0.6, 0.2 + e * (1.2 + s.v * 0.6), z + Math.sin(s.a) * s.r * 0.4); m.scale.setScalar(0.03 * (1 - k)); }); break;
      case "dust": { const m = G.children[0] as Mesh; m.position.set(x, 0.04, z); m.scale.setScalar(0.3 + e * 1.4); (m.material as any).opacity = 0.55 * (1 - k); break; }
      case "dissolve": G.children.forEach((m, i) => { const s = seeds[i]; const kk = Math.min(1, Math.max(0, (k - (i % 5) * 0.08) / 0.8)); m.position.set(x + Math.cos(s.a + kk * 2) * s.r * 0.45, 0.3 + kk * (1.6 + s.v * 0.7), z + Math.sin(s.a + kk * 2) * s.r * 0.3); m.scale.setScalar(0.04 * Math.sin(kk * Math.PI) * s.v); }); break;
    }
  });
  return (
    <group ref={g}>
      {fx.kind === "sparks" && seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 5, 5]} /><meshBasicMaterial color={i % 3 ? fx.color : "#ffffff"} transparent blending={AdditiveBlending} depthWrite={false} /></mesh>))}
      {fx.kind === "slash" && (<mesh><ringGeometry args={[0.62, 0.8, 32, 1, 0, 1.9]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.85} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} /></mesh>)}
      {fx.kind === "glyph" && (<mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.45, 0.62, 6, 1]} /><meshBasicMaterial color={fx.color} transparent opacity={0.9} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} /></mesh>)}
      {fx.kind === "dome" && (<mesh><sphereGeometry args={[0.75, 24, 16]} /><meshBasicMaterial color={fx.color} transparent opacity={0.2} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} /></mesh>)}
      {fx.kind === "poison" && seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 5, 5]} /><meshBasicMaterial color={fx.color} transparent blending={AdditiveBlending} depthWrite={false} /></mesh>))}
      {fx.kind === "dust" && (<mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.5, 0.9, 32]} /><meshBasicMaterial color="#8a8073" transparent opacity={0.55} side={DoubleSide} depthWrite={false} /></mesh>)}
      {fx.kind === "dissolve" && seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 5, 5]} /><meshBasicMaterial color={i % 4 ? fx.color : "#ffffff"} transparent blending={AdditiveBlending} depthWrite={false} /></mesh>))}
    </group>
  );
}

function TargetRing({ pos, color }: { pos: [number, number, number]; color: string }) {
  const ref = useRef<Mesh | null>(null);
  useFrame(({ clock }) => { const m = ref.current; if (!m) return; const t = clock.getElapsedTime(); m.rotation.z = t * 1.2; const s = 1 + Math.sin(t * 4) * 0.06; m.scale.set(s, s, 1); });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[pos[0], 0.04, pos[2]]}>
      <ringGeometry args={[0.55, 0.64, 6, 1]} />
      <meshBasicMaterial color={color} transparent opacity={0.85} side={DoubleSide} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

export default function DescentStage({ biome, player, enemies, targetId, onPickTarget, shake, speedRef, fx, renderEnemyLabel, renderEnemyFloats }: Props) {
  const shakeRef = useRef(0); useEffect(() => { if (shake > 0) shakeRef.current = Math.max(shakeRef.current, shake); }, [shake]);
  const focus = useRef<[number, number, number] | null>(null);
  const target = enemies.find((e) => e.id === targetId) || null; focus.current = target ? target.pos : null;
  return (
    <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 30%, ${biome.skyTop} 0%, ${biome.skyBottom} 55%, #000 100%)` }}>
      <Canvas dpr={[1, 1.5]} shadows gl={{ alpha: true, antialias: true }} camera={{ position: CAM_POS, fov: 42, near: 0.1, far: 40 }} style={{ position: "absolute", inset: 0 }}>
        <Atmosphere biome={biome} />
        <CameraRig shakeRef={shakeRef} focus={focus} />
        <ambientLight color={biome.ambientColor} intensity={1.0} />
        <hemisphereLight args={[biome.keyLightColor, biome.skyBottom, 0.6]} />
        <directionalLight position={[2, 4, 3]} intensity={1.7} color={biome.keyLightColor} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 3, -2]} intensity={0.7} color="#ffffff" />
        <pointLight position={[0.2, 2.0, -1.6]} intensity={3} distance={6} color={biome.particleColor} />
        <pointLight position={[-0.6, 1.4, 2.2]} intensity={1.6} distance={4} color="#ffe9c4" />
        <Suspense fallback={null}><Tunnel biome={biome} /><Ground biome={biome} /></Suspense>
        <Motes color={biome.particleColor} />
        {target && !target.dead && <TargetRing pos={target.pos} color="#ffd166" />}
        <Suspense fallback={<Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}><div style={{ fontFamily: "'Noto Serif JP', serif", letterSpacing: "0.4em", fontSize: 12, color: biome.particleColor, whiteSpace: "nowrap", textShadow: "0 0 20px #000", animation: "hdPulse 1.2s ease-in-out infinite" }}>◆ THE HIVE STIRS ◆</div><style>{`@keyframes hdPulse{0%,100%{opacity:.35}50%{opacity:1}}`}</style></Html>}>
          <ArenaCharacter factionId={player.factionId} anim={player.anim} animKey={player.animKey} position={PLAYER_POS} rotationY={Math.PI - 0.15} dead={player.dead} speedRef={speedRef} flashKey={player.flashKey} holdOn={["lose"]} actionSpeed={1.25} />
          {enemies.map((e) => (
            <group key={e.id}>
              <ArenaCharacter factionId={e.factionId} anim={e.anim} animKey={e.animKey} position={e.pos} rotationY={-e.pos[0] * 0.25} scale={e.scale} corrupted corruptColor={biome.particleColor} dead={e.dead} speedRef={speedRef} flashKey={e.flashKey} holdOn={["lose"]} dissolveAt={e.dissolveAt ?? null} actionSpeed={1.15} />
              {!e.dead && (
                <mesh position={[e.pos[0], 0.95 * e.scale, e.pos[2]]} onClick={(ev) => { ev.stopPropagation(); onPickTarget(e.id); }}>
                  <boxGeometry args={[0.9, 1.9 * e.scale, 0.6]} />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
              )}
              <Html position={[e.pos[0], 2.05 * e.scale + 0.15, e.pos[2]]} center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
                {renderEnemyLabel(e.id)}
              </Html>
              <Html position={[e.pos[0], 1.3 * e.scale, e.pos[2]]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
                {renderEnemyFloats(e.id)}
              </Html>
            </group>
          ))}
        </Suspense>
        {fx.map((f) => <FxNode key={f.id} fx={f} />)}
      </Canvas>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(0,0,0,0.55) 100%)" }} />
    </div>
  );
}
