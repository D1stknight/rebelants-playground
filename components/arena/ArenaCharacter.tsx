// components/arena/ArenaCharacter.tsx
// A Faction Wars 3D character placed inside a shared r3f scene (no Canvas of its own). Used by the FW arena and Hive Descent.
// Adapted from FactionWars3DCharacter: same GLB + Mixamo FBX pipeline, plus a "corrupted" tint for hive enemies.
import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { AnimationClip, AnimationMixer, Box3, Color, DoubleSide, LoopOnce, LoopRepeat, type AnimationAction, type Group } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

export type ArenaAnim = "idle" | "attack" | "magic" | "trick" | "defend" | "hit" | "win" | "lose";
const ANIMS: ArenaAnim[] = ["idle", "attack", "magic", "trick", "defend", "hit", "win", "lose"];
export const SUPPORTED = ["ashigaru", "buke", "bushi", "kenshi", "ronin", "samurai", "shogun", "sohei", "warrior", "wokou", "yamabushi"];

const modelPath = (f: string) => `/faction-wars/characters/${f}/${f}.glb`;
const animPath = (f: string, a: ArenaAnim) => `/faction-wars/characters/${f}/${a === "trick" ? "special" : a}.fbx`;

// FW's own canvas uses 0.02 with a far camera; the shared duel arena sits much closer.
const BASE_MODEL_SCALE = 0.011;
/** Dev tuning: `?hdscale=0.009` overrides the model scale (no rebuild needed to eyeball sizes). */
export function modelScale(): number {
  if (typeof window === "undefined") return BASE_MODEL_SCALE;
  const v = parseFloat(new URLSearchParams(window.location.search).get("hdscale") || "");
  return Number.isFinite(v) && v > 0 ? v : BASE_MODEL_SCALE;
}

function retarget(clip: AnimationClip) {
  const c = clip.clone();
  c.tracks = c.tracks
    .map((t) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; })
    .filter((t) => t.name.endsWith(".quaternion"));
  return c;
}

const DEFAULT_HOLD: ArenaAnim[] = ["lose"];

export type ArenaCharacterProps = {
  factionId: string;
  anim: ArenaAnim;
  animKey: number;                 // bump to replay the same anim
  position?: [number, number, number];
  rotationY?: number;
  scale?: number;
  corrupted?: boolean;             // hive enemy look: darkened + pink emissive
  corruptColor?: string;
  dead?: boolean;
  holdOn?: ArenaAnim[];            // one-shot anims that freeze on their last frame instead of returning to idle (default: lose)
  speedRef?: React.MutableRefObject<number>; // shared time scale (hit-stop, slow-mo); 1 = normal
  flashKey?: number;               // bump to flash the model red (took a hit)
  idleSpeed?: number;              // idle clip time scale (heavier breathing at low HP)
  dissolveAt?: number | null;      // performance.now() when the body started disintegrating (1.3s: glow, fade, rise, gone)
  actionSpeed?: number;            // time scale for attack/magic/trick clips (1 = as authored)
  clipOffsets?: Partial<Record<ArenaAnim, number>>; // seconds to skip at the start of a clip (trim Mixamo wind-ups)
};

export default function ArenaCharacter({ factionId, anim, animKey, position = [0, 0, 0], rotationY = 0, scale = 1, corrupted = false, corruptColor = "#ff3399", dead = false, holdOn = DEFAULT_HOLD, speedRef, flashKey = 0, idleSpeed = 1, dissolveAt = null, actionSpeed = 1, clipOffsets }: ArenaCharacterProps) {
  const dissolveRef = useRef({ started: false, done: false });
  const matsRef = useRef<any[]>([]);
  const flashRef = useRef({ until: 0, applied: false });
  const fid = SUPPORTED.includes(factionId) ? factionId : "samurai";
  const groupRef = useRef<Group | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<ArenaAnim, AnimationAction>>>({});
  const currentRef = useRef<AnimationAction | null>(null);
  const holdRef = useRef(false);   // true while a one-shot anim should stay on its last frame (death)

  const gltf = useGLTF(modelPath(fid)) as any;
  const fbxs = useLoader(FBXLoader, ANIMS.map((a) => animPath(fid, a))) as any[];
  const fbxsRef = useRef(fbxs); fbxsRef.current = fbxs;   // useLoader hands back a fresh array each render — never depend on it directly

  const scene = useMemo(() => {
    const s = clone(gltf.scene);
    const mats: any[] = [];
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
          mm.needsUpdate = true; mats.push(mm); return mm;
        });
        o.material = Array.isArray(o.material) ? cloned : cloned[0];
      }
    });
    s.scale.setScalar(modelScale());
    // the GLB pivot sits around the hips: drop the model so its feet touch the arena floor
    s.updateMatrixWorld(true);
    const box = new Box3().setFromObject(s);
    s.position.set(0, (Number.isFinite(box.min.y) ? -box.min.y : 0) + 0.02, 0);
    matsRef.current = mats;
    return s;
  }, [gltf.scene, corrupted, corruptColor]);

  useEffect(() => {
    const fbxs = fbxsRef.current;
    if (!scene || !fbxs?.length) return;
    const mixer = new AnimationMixer(scene);
    const actions: Partial<Record<ArenaAnim, AnimationAction>> = {};
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
    const want = actions[anim]; if (want && anim !== "idle") { holdRef.current = holdOn.includes(anim); idle?.stop(); want.reset().play(); currentRef.current = want; }
    return () => { mixer.removeEventListener("finished", onFinished); mixer.stopAllAction(); mixerRef.current = null; actionsRef.current = {}; currentRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, fid]);

  // play on (anim, animKey) change
  useEffect(() => {
    const next = actionsRef.current[anim]; if (!next) return;
    holdRef.current = holdOn.includes(anim);
    const cur = currentRef.current;
    if (cur && cur !== next) cur.fadeOut(0.12);
    next.timeScale = anim === "attack" || anim === "magic" || anim === "trick" ? actionSpeed : 1;
    next.reset().fadeIn(0.12).play();
    const off = clipOffsets?.[anim]; if (off) next.time = off;
    currentRef.current = next;
  }, [anim, animKey]);

  useEffect(() => { if (flashKey > 0) flashRef.current.until = performance.now() + 140; }, [flashKey]);
  useEffect(() => { const idle = actionsRef.current.idle; if (idle) idle.timeScale = idleSpeed; }, [idleSpeed, scene]);

  useFrame(({ clock }, dt) => {
    mixerRef.current?.update(dt * (speedRef ? speedRef.current : 1));
    const fl = flashRef.current; const now = performance.now();
    if (now < fl.until) {
      if (!fl.applied) { matsRef.current.forEach((m) => { if (m && m.emissive) { m.userData._e = m.emissive.clone(); m.userData._i = m.emissiveIntensity; m.emissive.set("#ff2a2a"); m.emissiveIntensity = 0.9; } }); fl.applied = true; }
    } else if (fl.applied) {
      matsRef.current.forEach((m) => { if (m && m.userData._e) { m.emissive.copy(m.userData._e); m.emissiveIntensity = m.userData._i; } }); fl.applied = false;
    }
    const g = groupRef.current; if (!g) return;
    const t = clock.getElapsedTime();
    // disintegration: pink glow, fade to nothing, drift upward
    if (dissolveAt != null) {
      const k = Math.min(1, (now - dissolveAt) / 1300); const ds = dissolveRef.current;
      if (!ds.started) { ds.started = true; matsRef.current.forEach((m) => { if (!m) return; m.transparent = true; m.depthWrite = true; if (m.emissive) { m.emissive.set(corruptColor); } }); }
      matsRef.current.forEach((m) => { if (!m) return; m.opacity = Math.max(0, 1 - Math.pow(k, 1.6)); if (m.emissive) m.emissiveIntensity = 0.6 + k * 2.2; });
      g.position.set(position[0], position[1] + k * 0.35, position[2]); g.rotation.y = rotationY; g.scale.setScalar(scale * (1 - k * 0.15));
      if (k >= 1 && !ds.done) { ds.done = true; g.visible = false; }
      return;
    }
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

/** Warm the GLB + all 8 animation clips for a faction so it appears instantly when it enters the arena. */
export function preloadFaction(factionId: string) {
  const fid = SUPPORTED.includes(factionId) ? factionId : "samurai";
  useGLTF.preload(modelPath(fid));
  useLoader.preload(FBXLoader, ANIMS.map((a) => animPath(fid, a)));
}
