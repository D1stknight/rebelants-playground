import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Vector3, type Group } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

type FactionWars3DCharacterProps = {
  factionId: string;
  side?: "player" | "enemy";
};

function FactionWarsCameraDebugger() {
  const { camera, gl } = useThree();

  useEffect(() => {
    (window as any).__fw3dCamera = camera;
    (window as any).__fw3dPrintCamera = () => {
      console.log("[FactionWars3D] Camera", {
        position: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        rotation: {
          x: camera.rotation.x,
          y: camera.rotation.y,
          z: camera.rotation.z,
        },
        zoom: (camera as any).zoom,
      });
    };

    console.log("[FactionWars3D] Camera debugger ready. Use window.__fw3dPrintCamera()");

    return () => {
      delete (window as any).__fw3dCamera;
      delete (window as any).__fw3dPrintCamera;
    };
  }, [camera]);

  return (
    <OrbitControls
      args={[camera, gl.domElement]}
      makeDefault
      enablePan
      enableZoom
      enableRotate
    />
  );
}

function SamuraiModel({ side = "player" }: { side?: "player" | "enemy" }) {
  const groupRef = useRef<Group | null>(null);
  const gltf = useGLTF("/faction-wars/characters/samurai/samurai.glb") as any;

    const clonedScene = useMemo(() => {
    const scene = clone(gltf.scene);

    scene.traverse((obj: any) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.visible = true;
        obj.frustumCulled = false;

        if (obj.material) {
          obj.material.transparent = false;
          obj.material.opacity = 1;
          obj.material.needsUpdate = true;
        }
      }
    });

    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    scene.position.sub(center);

       const manualScale = 0.0009;
    scene.scale.setScalar(manualScale);

    console.log("[FactionWars3D] Samurai GLB bounds", {
      size: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z },
      manualScale,
    });

    return scene;
  }, [gltf.scene]);

    useFrame(({ clock }) => {
    if (!groupRef.current) return;

    const t = clock.getElapsedTime();

    groupRef.current.position.y = Math.sin(t * 2.1) * 0.025;
    groupRef.current.rotation.y =
      (side === "enemy" ? -0.25 : 0.25) + Math.sin(t * 1.4) * 0.035;

    const breath = 1 + Math.sin(t * 2.2) * 0.012;
    groupRef.current.scale.setScalar(breath);
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
                            camera={{ position: [0, 0.15, 4.2], fov: 34 }}
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
        }}
      >
               <ambientLight intensity={1.25} />
        <directionalLight position={[2, 4, 4]} intensity={1.55} />
        <directionalLight position={[-3, 2, 3]} intensity={0.65} />

        <FactionWarsCameraDebugger />

        <Suspense fallback={null}>
          <SamuraiModel side={side} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/faction-wars/characters/samurai/samurai.glb");
