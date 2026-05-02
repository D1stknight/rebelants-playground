import React, { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  Box3,
  DoubleSide,
  MeshStandardMaterial,
  Vector3,
  type Group,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

type FactionWars3DCharacterProps = {
  factionId: string;
  side?: "player" | "enemy";
};

function SamuraiModel({ side = "player" }: { side?: "player" | "enemy" }) {
  const groupRef = useRef<Group | null>(null);
  const gltf = useGLTF("/faction-wars/characters/samurai/samurai.glb") as any;

  const clonedScene = useMemo(() => {
    const scene = clone(gltf.scene);

    const meshes: string[] = [];

    scene.traverse((obj: any) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        meshes.push(obj.name || "(unnamed mesh)");

        obj.visible = true;
        obj.frustumCulled = false;

        obj.material = new MeshStandardMaterial({
          color: "#00ff66",
          roughness: 0.55,
          metalness: 0.05,
          side: DoubleSide,
        });
      }
    });

    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    console.log("[FactionWars3D] Samurai debug bounds", {
      meshes,
      size: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z },
    });

    // Your GLB has strange huge bounds, so for now we use manual placement.
    // We are intentionally NOT doing scene.position.sub(center) in this test.
         scene.position.set(0, -0.35, 0);
    scene.scale.setScalar(0.028);

    return scene;
  }, [gltf.scene]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    const t = clock.getElapsedTime();

    groupRef.current.position.y = Math.sin(t * 2.1) * 0.025;
    groupRef.current.rotation.y =
      (side === "enemy" ? -0.25 : 0.25) + Math.sin(t * 1.4) * 0.035;

    groupRef.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.012);
  });

  return (
    <group
      ref={groupRef}
      position={[0, 0, 0]}
      rotation={[0, side === "enemy" ? -0.25 : 0.25, 0]}
      scale={1}
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
        camera={{ position: [0, 0.4, 5.5], fov: 42 }}
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[2, 4, 4]} intensity={1.8} />
        <directionalLight position={[-3, 2, 3]} intensity={0.9} />

        {/* Temporary debug cube. If you see this but not the Samurai, the GLB placement/scale is the issue. */}
        <mesh position={[1.2, 0, 0]}>
          <boxGeometry args={[0.35, 0.35, 0.35]} />
          <meshStandardMaterial color="red" />
        </mesh>

        <Suspense fallback={null}>
          <SamuraiModel side={side} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/faction-wars/characters/samurai/samurai.glb");
