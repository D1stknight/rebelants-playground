// components/HiveDescent/DescentCharacter.tsx
// A Faction Wars 3D character placed inside a shared scene (no Canvas of its own).
// Adapted from FactionWars3DCharacter: same GLB + Mixamo FBX pipeline, plus a "corrupted" tint for hive enemies.
import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { AnimationClip, AnimationMixer, Color, DoubleSide, LoopOnce, LoopRepeat, type AnimationAction, type Group } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

export type DescentAnim = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";
const ANIMS: DescentAnim[] = ["idle", "attack", "magic", "trick", "defend", "hit", "win", "lose"];
export const SUPPORTED = ["ashigaru", "buke", "bushi", "kenshi", "ronin", "samurai", "shogun", "sohei", "warrior", "wokou", "yamabushi"];

const modelPath = (f: string) => `/faction-wars/characters/${f}/${f}.glb`;
const animPath = (f: string, a: DescentAnim) => `/faction-wars/characters/${f}/${a === "trick" ? "special" : a}.fbx`;

function retarget(clip: AnimationClip) {
  const c = clip.clone();
  c.tracks = c.tracks
    .map((t) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; })
    .filter((t) => t.name.endsWith(".quaternion"));
  return c;
}

export type DescentCharacterProps = {
  factionId: string;
  anim: DescentAnim;
  animKey: number;                 // bump to replay the same anim
  position?: [number, number, number];
  rotationY?: number;
  scale?: number;
  corrupted?: boolean;             // hive enemy look: darkened + pink emissive
  corruptColor?: string;
  dead?: boolean;
};

export default function DescentCharacter({ factionId, anim, animKey, position = [0, 0, 0], rotationY = 0, scale = 1, corrupted = false, corruptColor = "#ff3399", dead = false }: DescentCharacterProps) {
  const fid = SUPPORTED.includes(factionId) ? factionId : "samurai";
  const groupRef = useRef<Group | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<DescentAnim, AnimationAction>>>({});
  const currentRef = useRef<AnimationAction | null>(null);
  const holdRef = useRef(false);   // true while a one-shot anim should stay on its last frame (death)

  const gltf = useGLTF(modelPath(fid)) as any;
  const fbxs = useLoader(FBXLoader, ANIMS.map((a) => animPath(fid, a))) as any[];

  const scene = useMemo(() => {
    const s = clone(gltf.scene);
    s.traverse((o: any) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.visible = true; o.frustumCulled = false; o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cloned = mats.map((m: any) => {
          if (!m) return m;
          const mm = m.clone(); mm.transparent = false; mm.opacity = 1; mm.side = DoubleSide;
          if (corrupted) {
            if (mm.color) mm.color = mm.color.clone().multiplyScalar(0.45).lerp(new Color(corruptColor), 0.18);
            if ("emissive" in mm) { mm.emissive = new Color(corruptColor); mm.emissiveIntensity = 0.55; }
          }
          mm.needsUpdate = true; return mm;
        });
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
      }
    });
    s.position.set(0, 0.05, 0);
    s.scale.setScalar(0.020);
    return s;
  }, [gltf.scene, corrupted, corruptColor]);

  useEffect(() => {
    if (!scene || !fbxs?.length) return;
    const mixer = new AnimationMixer(scene);
    const actions: Partial<Record<DescentAnim, AnimationAction>> = {};
    ANIMS.forEach((key, i) => {
      const src = fbxs[i]?.animations?.[0]; if (!src) return;
      const a = mixer.clipAction(retarget(src));
      if (key === "idle") a.setLoop(LoopRepeat, Infinity); else { a.setLoop(LoopOnce, 1); a.clampWhenFinished = true; }
      actions[key] = a;
    });
    mixerRef.current = mixer; actionsRef.current = actions;
    const onFinished = () => { if (holdRef.current) return; const idle = actionsRef.current.idle; if (idle && currentRef.current !== idle) { currentRef.current?.fadeOut(0.15); idle.reset().fadeIn(0.15).play(); currentRef.current = idle; } };
    mixer.addEventListener("finished", onFinished);
    const idle = actions.idle; if (idle) { idle.reset().play(); currentRef.current = idle; }
    return () => { mixer.removeEventListener("finished", onFinished); mixer.stopAllAction(); mixerRef.current = null; actionsRef.current = {}; currentRef.current = null; };
  }, [scene, fbxs]);

  // play on (anim, animKey) change
  useEffect(() => {
    const next = actionsRef.current[anim]; if (!next) return;
    holdRef.current = anim === "lose";
    const cur = currentRef.current;
    if (cur && cur !== next) cur.fadeOut(0.12);
    next.reset().fadeIn(0.12).play();
    currentRef.current = next;
  }, [anim, animKey]);

  useFrame(({ clock }, dt) => {
    mixerRef.current?.update(dt);
    const g = groupRef.current; if (!g) return;
    const t = clock.getElapsedTime();
    g.position.set(position[0], position[1] + (dead ? 0 : Math.sin(t * 2.1) * 0.006), position[2]);
    g.rotation.y = rotationY + (dead ? 0 : Math.sin(t * 1.4) * 0.02);
    g.scale.setScalar(scale * (1 + Math.sin(t * 2.2) * 0.003));
  });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}

SUPPORTED.forEach((f) => useGLTF.preload(modelPath(f)));
