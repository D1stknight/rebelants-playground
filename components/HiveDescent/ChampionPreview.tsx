// components/HiveDescent/ChampionPreview.tsx
// A champion standing in the hive, facing you — used by the faction picker. Same tunnel, floor, fog and rig as the battle stage.
import React, { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group } from "three";
import ArenaCharacter, { preloadFaction } from "../arena/ArenaCharacter";
import { Atmosphere, Ground, Motes, Tunnel } from "./DescentStage";
import { BIOMES, type Biome } from "./biomes";

const FONT = "'Noto Serif JP', 'Hiragino Mincho ProN', serif";

function Look({ x }: { x: number }) {
  const { camera } = useThree();
  useEffect(() => { camera.position.set(x, 1.3, 3.7); camera.lookAt(x * 0.85, 0.95, 0); }, [camera, x]);
  return null;
}

function Turntable({ children }: { children: React.ReactNode }) {
  const g = useRef<Group | null>(null);
  useFrame(({ clock }) => { const G = g.current; if (!G) return; G.rotation.y = Math.sin(clock.getElapsedTime() * 0.35) * 0.35; });
  return <group ref={g}>{children}</group>;
}

export default function ChampionPreview({ factionId, biome = BIOMES[0], x = 0, style }: { factionId: string; biome?: Biome; x?: number; style?: React.CSSProperties }) {
  useEffect(() => { preloadFaction(factionId); }, [factionId]);
  return (
    <div style={{ position: "absolute", inset: 0, ...style }}>
      <Canvas dpr={[1, 1.5]} shadows gl={{ alpha: true, antialias: true }} camera={{ position: [x, 1.35, 3.6], fov: 40, near: 0.1, far: 40 }} style={{ position: "absolute", inset: 0 }}>
        <Atmosphere biome={biome} />
        <Look x={x} />
        <ambientLight color={biome.ambientColor} intensity={1.0} />
        <hemisphereLight args={[biome.keyLightColor, biome.skyBottom, 0.6]} />
        <directionalLight position={[2, 4, 3]} intensity={1.8} color={biome.keyLightColor} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 3, 2]} intensity={0.8} color="#ffffff" />
        <pointLight position={[0, 2.2, 1.5]} intensity={2.4} distance={5} color="#ffe9c4" />
        <pointLight position={[0.2, 2.0, -1.6]} intensity={3} distance={6} color={biome.particleColor} />
        <Suspense fallback={null}><Tunnel biome={biome} /><Ground biome={biome} /></Suspense>
        <Motes color={biome.particleColor} />
        <Suspense fallback={<Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}><div style={{ fontFamily: FONT, letterSpacing: "0.4em", fontSize: 12, color: biome.particleColor, whiteSpace: "nowrap", textShadow: "0 0 20px #000", animation: "hdPulse 1.2s ease-in-out infinite" }}>◆ SUMMONING ◆</div><style>{`@keyframes hdPulse{0%,100%{opacity:.35}50%{opacity:1}}`}</style></Html>}>
          <Turntable>
            <ArenaCharacter key={factionId} factionId={factionId} anim="idle" animKey={0} position={[0, 0, 0.2]} rotationY={0} holdOn={["lose"]} />
          </Turntable>
        </Suspense>
      </Canvas>
    </div>
  );
}
