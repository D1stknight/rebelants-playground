import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  DoubleSide,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type Group,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type FactionWars3DCharacterProps = {
  factionId: string;
  side?: "player" | "enemy";
};

function retargetMixamoClipToUnderscoreBones(clip: AnimationClip) {
  const retargetedClip = clip.clone();

  retargetedClip.tracks.forEach((track) => {
    track.name = track.name.replace(
      /^mixamorig(?!_)([A-Z][^.]*)(\..+)$/,
      "mixamorig_$1$2"
    );
  });

  return retargetedClip;
}

function SamuraiModel({ side = "player" }: { side?: "player" | "enemy" }) {
  const groupRef = useRef<Group | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const idleActionRef = useRef<AnimationAction | null>(null);

  const gltf = useGLTF("/faction-wars/characters/samurai/samurai.glb") as any;
  const idleFbx = useLoader(
    FBXLoader,
    "/faction-wars/characters/samurai/idle.fbx"
  ) as any;

  const clonedScene = useMemo(() => {
    const scene = clone(gltf.scene);

    scene.traverse((obj: any) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.visible = true;
        obj.frustumCulled = false;

        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

        materials.forEach((mat: any) => {
          if (!mat) return;
          mat.transparent = false;
          mat.opacity = 1;
          mat.side = DoubleSide;
          mat.needsUpdate = true;
        });
      }
    });

    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    console.log("[FactionWars3D] Samurai model loaded", {
      size: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z },
      idleAnimations: idleFbx.animations?.map((a: any) => a.name) || [],
    });

    scene.position.set(0, 0.05, 0);
    scene.scale.setScalar(0.020);

    return scene;
  }, [gltf.scene, idleFbx.animations]);

  useEffect(() => {
    if (!clonedScene || !idleFbx?.animations?.length) return;

        const mixer = new AnimationMixer(clonedScene);
    const sourceIdleClip = idleFbx.animations[0];
    const idleClip = retargetMixamoClipToUnderscoreBones(sourceIdleClip);

    console.log("[FactionWars3D] Retargeted idle animation", {
      sourceFirstTracks: sourceIdleClip.tracks?.slice(0, 8).map((track: any) => track.name),
      retargetedFirstTracks: idleClip.tracks?.slice(0, 8).map((track: any) => track.name),
    });

    const idleAction = mixer.clipAction(idleClip);
    idleAction.reset();
    idleAction.setLoop(LoopRepeat, Infinity);
    idleAction.fadeIn(0.2);
    idleAction.play();

    mixerRef.current = mixer;
    idleActionRef.current = idleAction;

    console.log("[FactionWars3D] Playing idle animation", {
      clipName: idleClip.name,
      duration: idleClip.duration,
      tracks: idleClip.tracks?.length,
      firstTracks: idleClip.tracks?.slice(0, 8).map((track: any) => track.name),
    });

    return () => {
      idleAction.stop();
      mixer.stopAllAction();
      mixerRef.current = null;
      idleActionRef.current = null;
    };
  }, [clonedScene, idleFbx]);

  useFrame(({ clock }, delta) => {
    mixerRef.current?.update(delta);

    if (!groupRef.current) return;

    const t = clock.getElapsedTime();

    groupRef.current.position.y = Math.sin(t * 2.1) * 0.012;
    groupRef.current.rotation.y =
      (side === "enemy" ? -0.25 : 0.25) + Math.sin(t * 1.4) * 0.025;

    groupRef.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.006);
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
        background: "#ffffff",
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0.4, 5.5], fov: 42 }}
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
        }}
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[2, 4, 4]} intensity={1.8} />
        <directionalLight position={[-3, 2, 3]} intensity={0.9} />

        <Suspense fallback={null}>
          <SamuraiModel side={side} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/faction-wars/characters/samurai/samurai.glb");
