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

type FactionAnimState =
  | "idle"
  | "attack"
  | "magic"
  | "trick"
  | "defend"
  | "hit"
  | "win"
  | "lose";

type SupportedFaction3D = "samurai" | "bushi";

type FactionWars3DCharacterProps = {
  factionId: string;
  side?: "player" | "enemy";
  animState?: FactionAnimState;
};

const SUPPORTED_3D_FACTIONS: SupportedFaction3D[] = ["samurai", "bushi"];

const ANIMATION_KEYS: FactionAnimState[] = [
  "idle",
  "attack",
  "magic",
  "trick",
  "defend",
  "hit",
  "win",
  "lose",
];

function isSupported3DFaction(factionId: string): factionId is SupportedFaction3D {
  return SUPPORTED_3D_FACTIONS.includes(factionId as SupportedFaction3D);
}

function getModelPath(factionId: SupportedFaction3D) {
  return `/faction-wars/characters/${factionId}/${factionId}.glb`;
}

function getAnimationPath(factionId: SupportedFaction3D, anim: FactionAnimState) {
  const fileName = anim === "trick" ? "special" : anim;
  return `/faction-wars/characters/${factionId}/${fileName}.fbx`;
}

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

function FactionModel({
  factionId,
  side = "player",
  animState = "idle",
}: {
  factionId: SupportedFaction3D;
  side?: "player" | "enemy";
  animState?: FactionAnimState;
}) {
  const groupRef = useRef<Group | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<FactionAnimState, AnimationAction>>>({});
  const currentActionRef = useRef<AnimationAction | null>(null);

  const modelPath = getModelPath(factionId);
  const animationPaths = useMemo(
    () => ANIMATION_KEYS.map((key) => getAnimationPath(factionId, key)),
    [factionId]
  );

  const gltf = useGLTF(modelPath) as any;

  const animationFbxs = useLoader(FBXLoader, animationPaths) as any[];

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

    // Shared sweet spot from the Samurai battle card setup.
    // New factions should use the same Meshy/Mixamo export scale whenever possible.
    scene.position.set(0, 0.05, 0);
    scene.scale.setScalar(0.020);

    return scene;
  }, [gltf.scene]);

  useEffect(() => {
    if (!clonedScene || !animationFbxs?.length) return;

    const mixer = new AnimationMixer(clonedScene);
    const actions: Partial<Record<FactionAnimState, AnimationAction>> = {};

    ANIMATION_KEYS.forEach((key, index) => {
      const fbx = animationFbxs[index];
      const sourceClip = fbx?.animations?.[0];

      if (!sourceClip) {
        console.warn("[FactionWars3D] Missing animation clip", { factionId, key });
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
    });

    mixerRef.current = mixer;
    actionsRef.current = actions;

    const playAnimation = (nextAnim: FactionAnimState) => {
      const nextAction = actionsRef.current[nextAnim];

      if (!nextAction) {
        console.warn("[FactionWars3D] Missing action", { factionId, nextAnim });
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
    };

    const handleFinished = () => {
      if (currentActionRef.current && currentActionRef.current !== actions.idle) {
        playAnimation("idle");
      }
    };

    mixer.addEventListener("finished", handleFinished);

    const triggerName = side === "enemy" ? "__fw3dPlayEnemy" : "__fw3dPlayPlayer";

    (window as any)[triggerName] = (nextAnim: FactionAnimState) => {
      playAnimation(nextAnim);
    };

    playAnimation("idle");

    return () => {
      mixer.removeEventListener("finished", handleFinished);
      mixer.stopAllAction();

      delete (window as any)[triggerName];

      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
    };
  }, [clonedScene, animationFbxs, factionId, side]);

  useEffect(() => {
    const triggerName = side === "enemy" ? "__fw3dPlayEnemy" : "__fw3dPlayPlayer";
    const action = actionsRef.current[animState];

    if (!action || !(window as any)[triggerName]) return;

    (window as any)[triggerName](animState);
  }, [animState, side]);

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
  if (!isSupported3DFaction(factionId)) return null;

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
          <FactionModel factionId={factionId} side={side} animState={animState} />
        </Suspense>
      </Canvas>
    </div>
  );
}

SUPPORTED_3D_FACTIONS.forEach((factionId) => {
  useGLTF.preload(getModelPath(factionId));
});
