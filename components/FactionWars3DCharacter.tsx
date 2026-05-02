import React, { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { Group } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

type FactionWars3DCharacterProps = {
  factionId: string;
  side?: "player" | "enemy";
};

function SamuraiModel({ side = "player" }: { side?: "player" | "enemy" }) {
  const groupRef = useRef<Group | null>(null);
  const gltf = useGLTF("/faction-wars/characters/samurai/samurai.glb") as any;

  const clonedScene = useMemo(() => {
    return clone(gltf.scene);
  }, [gltf.scene]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    const t = clock.getElapsedTime();

    groupRef.current.position.y = -1.15 + Math.sin(t * 2.1) * 0.035;
    groupRef.current.rotation.y =
      (side === "enemy" ? -0.35 : 0.35) + Math.sin(t * 1.4) * 0.05;

    const breath = 1.15 + Math.sin(t * 2.2) * 0.018;
    groupRef.current.scale.setScalar(breath);
  });

  return (
    <group
      ref={groupRef}
      position={[0, -1.15, 0]}
      rotation={[0, side === "enemy" ? -0.35 : 0.35, 0]}
      scale={1.15}
    >
      <primitive object={clonedScene} />
    </group>
  );
}

export default function FactionWars3DCharacter({
  factionId,
  side = "player",
}: FactionWars3DCharacterProps) {
  if (factionId !== "samurai") return null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        inset: 0,
        background: "transparent",
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0.55, 3.3], fov: 36 }}
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      >
        <ambientLight intensity={1.25} />
        <directionalLight position={[2, 4, 4]} intensity={1.55} />
        <directionalLight position={[-3, 2, 3]} intensity={0.65} />

        <Suspense fallback={null}>
          <SamuraiModel side={side} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/faction-wars/characters/samurai/samurai.glb");
