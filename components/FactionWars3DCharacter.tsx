import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  AnimationClip,
  AnimationMixer,
  DoubleSide,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type Group,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type SamuraiAnimState =
  | "idle"
  | "attack"
  | "magic"
  | "trick"
  | "defend"
  | "hit"
  | "win"
  | "lose";

type FactionWars3DCharacterProps = {
  factionId: string;
  side?: "player" | "enemy";
  animState?: SamuraiAnimState;
};

const SAMURAI_ANIMATION_PATHS: Record<SamuraiAnimState, string> = {
  idle: "/faction-wars/characters/samurai/idle.fbx",
  attack: "/faction-wars/characters/samurai/attack.fbx",
  magic: "/faction-wars/characters/samurai/magic.fbx",
    trick: "/faction-wars/characters/samurai/special.fbx",
  defend: "/faction-wars/characters/samurai/defend.fbx",
  hit: "/faction-wars/characters/samurai/hit.fbx",
  win: "/faction-wars/characters/samurai/win.fbx",
  lose: "/faction-wars/characters/samurai/lose.fbx",
};

const SAMURAI_ANIMATION_KEYS = Object.keys(
  SAMURAI_ANIMATION_PATHS
) as SamuraiAnimState[];

function retargetMixamoClipToUnderscoreBones(clip: AnimationClip) {
  const retargetedClip = clip.clone();

  retargetedClip.tracks = retargetedClip.tracks
    .map((track) => {
      track.name = track.name.replace(
        /^mixamorig(?!_)([A-Z][^.]*)(\..+)$/,
        "mixamorig_$1$2"
      );

      return track;
    })
    // Keep the character locked inside the battle card.
    // Mixamo position tracks can move the root/hips upward or out of frame.
    .filter((track) => track.name.endsWith(".quaternion"));

  return retargetedClip;
}

function SamuraiModel({
  side = "player",
  animState = "idle",
}: {
  side?: "player" | "enemy";
  animState?: SamuraiAnimState;
}) {
  const groupRef = useRef<Group | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<SamuraiAnimState, AnimationAction>>>({});
  const currentActionRef = useRef<AnimationAction | null>(null);

  const gltf = useGLTF("/faction-wars/characters/samurai/samurai.glb") as any;

  const animationFbxs = useLoader(
    FBXLoader,
    SAMURAI_ANIMATION_KEYS.map((key) => SAMURAI_ANIMATION_PATHS[key])
  ) as any[];

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

    scene.position.set(0, 0.05, 0);
    scene.scale.setScalar(0.020);

    return scene;
  }, [gltf.scene]);

  useEffect(() => {
    if (!clonedScene || !animationFbxs?.length) return;

    const mixer = new AnimationMixer(clonedScene);
    const actions: Partial<Record<SamuraiAnimState, AnimationAction>> = {};

    SAMURAI_ANIMATION_KEYS.forEach((key, index) => {
      const fbx = animationFbxs[index];
      const sourceClip = fbx?.animations?.[0];

      if (!sourceClip) {
        console.warn("[FactionWars3D] Missing animation clip", key);
        return;
      }

      const clip = retargetMixamoClipToUnderscoreBones(sourceClip);
      const action = mixer.clipAction(clip);

      if (key === "idle") {
        action.setLoop(LoopRepeat, Infinity);
      } else {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }

      actions[key] = action;

      console.log("[FactionWars3D] Animation ready", {
        key,
        sourceName: sourceClip.name,
        duration: clip.duration,
        sourceTracks: sourceClip.tracks?.length,
        retargetedTracks: clip.tracks?.length,
        hasPositionTracks: clip.tracks?.some((track: any) =>
          track.name.endsWith(".position")
        ),
        firstTracks: clip.tracks?.slice(0, 5).map((track: any) => track.name),
      });
    });

    mixerRef.current = mixer;
    actionsRef.current = actions;

    const playAnimation = (nextAnim: SamuraiAnimState) => {
      const nextAction = actionsRef.current[nextAnim];

      if (!nextAction) {
        console.warn("[FactionWars3D] Missing action", nextAnim);
        return;
      }

      const currentAction = currentActionRef.current;

      if (currentAction && currentAction !== nextAction) {
        currentAction.fadeOut(0.12);
      }

      nextAction.reset();
      nextAction.fadeIn(0.12);
      nextAction.play();

      currentActionRef.current = nextAction;

      console.log("[FactionWars3D] Playing animation", nextAnim);
    };

    const handleFinished = () => {
      if (currentActionRef.current && currentActionRef.current !== actions.idle) {
        playAnimation("idle");
      }
    };

    mixer.addEventListener("finished", handleFinished);

   const triggerName =
  side === "enemy" ? "__fw3dPlayEnemy" : "__fw3dPlayPlayer";

(window as any)[triggerName] = (nextAnim: SamuraiAnimState) => {
  playAnimation(nextAnim);
};

    console.log("[FactionWars3D] Console animation trigger ready. Try:");
    console.log('window.__fw3dPlay("attack")');
    console.log('window.__fw3dPlay("magic")');
    console.log('window.__fw3dPlay("trick")');
    console.log('window.__fw3dPlay("defend")');
    console.log('window.__fw3dPlay("hit")');
    console.log('window.__fw3dPlay("win")');
    console.log('window.__fw3dPlay("lose")');

    playAnimation("idle");

    return () => {
      mixer.removeEventListener("finished", handleFinished);
      mixer.stopAllAction();

     delete (window as any)[triggerName];

      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
    };
  }, [clonedScene, animationFbxs]);

  useEffect(() => {
    const action = actionsRef.current[animState];

    if (!action || !(window as any).__fw3dPlay) return;

    (window as any).__fw3dPlay(animState);
  }, [animState]);

  useFrame(({ clock }, delta) => {
    mixerRef.current?.update(delta);

    if (!groupRef.current) return;

    const t = clock.getElapsedTime();

    groupRef.current.position.y = Math.sin(t * 2.1) * 0.006;
    groupRef.current.rotation.y =
      (side === "enemy" ? -0.25 : 0.25) + Math.sin(t * 1.4) * 0.018;

    groupRef.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.003);
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
  animState = "idle",
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
          <SamuraiModel side={side} animState={animState} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/faction-wars/characters/samurai/samurai.glb");
