// components/HiveDescent/DescentArena.tsx
// The duel stage: biome-lit r3f scene with the player's champion and the current corrupted enemy.
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Color, Fog, type Group, type Mesh } from "three";
import DescentCharacter, { type DescentAnim } from "./DescentCharacter";
import type { Biome } from "./biomes";

export type ArenaActor = { factionId: string; anim: DescentAnim; animKey: number; dead: boolean; scale?: number; corrupted?: boolean };

type Props = { biome: Biome; player: ArenaActor; enemy: ArenaActor | null; shake: number; flash: string | null };

function Atmosphere({ biome }: { biome: Biome }) {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new Fog(new Color(biome.fogColor), 4, 14);
    return () => { scene.fog = null; };
  }, [scene, biome.fogColor]);
  return null;
}

function Motes({ color, count = 60 }: { color: string; count?: number }) {
  const ref = useRef<Group | null>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453) % 1, y: (Math.sin(i * 78.233) * 43758.5453) % 1, z: (Math.sin(i * 39.346) * 43758.5453) % 1, s: 0.5 + ((i * 7) % 5) / 5 })), [count]);
  useFrame(({ clock }) => {
    const g = ref.current; if (!g) return; const t = clock.getElapsedTime();
    g.children.forEach((m, i) => { const sd = seeds[i]; m.position.set(sd.x * 8 - 4, ((sd.y * 3 + t * 0.12 * sd.s) % 3) + 0.1, sd.z * 6 - 4); const sc = 0.012 + Math.sin(t * 2 + i) * 0.004; m.scale.setScalar(sc); });
  });
  return (
    <group ref={ref}>
      {seeds.map((_, i) => (<mesh key={i}><sphereGeometry args={[1, 6, 6]} /><meshBasicMaterial color={color} transparent opacity={0.7} /></mesh>))}
    </group>
  );
}

// Dev tuning: `?hdcam=y,z,lookY` (e.g. hdcam=1.1,4.6,0.8)
function camParams(): [number, number, number] {
  const def: [number, number, number] = [1.15, 4.7, 0.8];
  if (typeof window === "undefined") return def;
  const raw = new URLSearchParams(window.location.search).get("hdcam");
  if (!raw) return def;
  const p = raw.split(",").map(Number);
  return p.length === 3 && p.every((n) => Number.isFinite(n)) ? (p as [number, number, number]) : def;
}

function CameraRig({ shake }: { shake: number }) {
  const { camera } = useThree();
  const shakeRef = useRef(0); shakeRef.current = shake;
  const cp = useMemo(camParams, []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime(); const s = shakeRef.current;
    camera.position.set(Math.sin(t * 0.25) * 0.12 + (Math.random() - 0.5) * s * 0.06, cp[0] + Math.sin(t * 0.4) * 0.03 + (Math.random() - 0.5) * s * 0.05, cp[1]);
    camera.lookAt(0, cp[2], 0);
  });
  return null;
}

function Ground({ biome }: { biome: Biome }) {
  const ref = useRef<Mesh | null>(null);
  return (
    <group>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[3.4, 48]} />
        <meshStandardMaterial color={biome.skyBottom} roughness={0.95} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[3.2, 3.4, 64]} />
        <meshBasicMaterial color={biome.particleColor} transparent opacity={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[1.05, 1.1, 48]} />
        <meshBasicMaterial color={biome.keyLightColor} transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

export default function DescentArena({ biome, player, enemy, shake, flash }: Props) {
  return (
    <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 20%, ${biome.skyTop} 0%, ${biome.skyBottom} 60%, #000 100%)` }}>
      <Canvas dpr={[1, 1.5]} shadows gl={{ alpha: true, antialias: true }} camera={{ position: [0, 1.25, 4.9], fov: 40, near: 0.1, far: 40 }} style={{ position: "absolute", inset: 0 }}>
        <Atmosphere biome={biome} />
        <CameraRig shake={shake} />
        <ambientLight color={biome.ambientColor} intensity={1.1} />
        <hemisphereLight args={[biome.keyLightColor, biome.skyBottom, 0.6]} />
        <directionalLight position={[2.5, 4, 3]} intensity={2.0} color={biome.keyLightColor} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 2.5, 2]} intensity={0.8} color="#ffffff" />
        <pointLight position={[1.3, 1.6, 0.6]} intensity={enemy ? 3 : 0} distance={4} color={enemy?.corrupted ? "#ff3399" : biome.keyLightColor} />
        <Ground biome={biome} />
        <Motes color={biome.particleColor} />
        <Suspense fallback={null}>
          <DescentCharacter factionId={player.factionId} anim={player.anim} animKey={player.animKey} position={[-0.95, 0, 0.1]} rotationY={0.7} scale={player.scale ?? 1} dead={player.dead} />
          {enemy && (
            <DescentCharacter key={`${enemy.factionId}-${enemy.scale}`} factionId={enemy.factionId} anim={enemy.anim} animKey={enemy.animKey} position={[0.95, 0, 0.1]} rotationY={-0.7} scale={enemy.scale ?? 1} corrupted={enemy.corrupted !== false} corruptColor={biome.particleColor} dead={enemy.dead} />
          )}
        </Suspense>
      </Canvas>
      {flash && <div style={{ position: "absolute", inset: 0, background: flash, pointerEvents: "none", animation: "hdFlash .35s ease-out both" }} />}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
      <style>{`@keyframes hdFlash{from{opacity:.9}to{opacity:0}}`}</style>
    </div>
  );
}
