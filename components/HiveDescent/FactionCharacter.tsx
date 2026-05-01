// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Current test: visible GLB model plus all 6 Mixamo animations mapped to game states.

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export type AnimStateName = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'die';

interface FactionCharacterProps {
  factionId: string;
  animState: AnimStateName;
  onMissingAssets?: () => void;
}

const TARGET_HEIGHT = 0.9;
const MODEL_Y_OFFSET = 0.42;
const DIE_Y_OFFSET = 0.12;
const IDLE_TIME_SCALE = 1;
const WALK_TIME_SCALE = 1;
const RUN_TIME_SCALE = 0.8;
const ONE_SHOT_TIME_SCALE = 1;

const ONE_SHOT: Record<AnimStateName, boolean> = {
  idle: false,
  walk: false,
  run: false,
  attack: true,
  hurt: true,
  die: true,
};

const animClipCache: Partial<Record<AnimStateName, THREE.AnimationClip>> = {};
let animClipPromise: Promise<void> | null = null;

function loadAnimationsOnce(): Promise<void> {
  if (animClipPromise) return animClipPromise;

  const fbxLoader = new FBXLoader();
  const names: AnimStateName[] = ['idle', 'walk', 'run', 'attack', 'hurt', 'die'];

  animClipPromise = Promise.all(names.map((name) => {
    return new Promise<void>((resolve) => {
      fbxLoader.load(
        `/descent/models/animations/${name}.fbx`,
        (fbx: any) => {
          const clip = fbx.animations?.[0] as THREE.AnimationClip | undefined;
          if (clip) {
            clip.name = name;
            animClipCache[name] = clip;
            console.log(`[HiveDescent animation test] Loaded ${name}.fbx: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s`);
            console.log(`[HiveDescent animation test] ${name}.fbx first tracks:`, clip.tracks.slice(0, 5).map((t) => t.name));
          } else {
            console.warn(`[HiveDescent animation test] ${name}.fbx loaded but had no animation clip`);
          }
          resolve();
        },
        undefined,
        (err: any) => {
          console.warn(`[HiveDescent animation test] Failed to load ${name}.fbx:`, err);
          resolve();
        }
      );
    });
  })).then(() => undefined);

  return animClipPromise;
}

function buildBoneMap(scene: THREE.Group): Map<string, string> {
  const map = new Map<string, string>();

  scene.traverse((obj: any) => {
    if (!obj.isBone || !obj.name) return;
    const fullName = obj.name;
    const lower = fullName.toLowerCase();
    const stripped = fullName.replace(/^mixamorig:?/i, '').toLowerCase();
    map.set(lower, fullName);
    if (stripped && stripped !== lower) map.set(stripped, fullName);
  });

  console.log(`[HiveDescent animation test] Bone map entries: ${map.size}`);
  return map;
}

function retargetClip(clip: THREE.AnimationClip, boneMap: Map<string, string>): THREE.AnimationClip {
  const newTracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    const lastDot = track.name.lastIndexOf('.');
    if (lastDot === -1) continue;

    const sourceBone = track.name.substring(0, lastDot);
    const property = track.name.substring(lastDot);

         const normalizedSourceBone = sourceBone.replace(/^mixamorig:?/i, '').toLowerCase();

    // Keep only rotations. Root position/scale tracks can cause floating, flipping, or jitter.
    if (property !== '.quaternion') continue;

    // Still skip Hips rotation so the character does not flip onto his stomach.
    if (normalizedSourceBone === 'hips') continue;

    const target = boneMap.get(sourceBone.toLowerCase()) || boneMap.get(normalizedSourceBone);
    if (target) {
      const newTrack = track.clone();
      newTrack.name = target + property;
      newTracks.push(newTrack);
    }
  }

  console.log(`[HiveDescent animation test] Retargeted ${clip.name} clip: ${newTracks.length} usable tracks`);
  console.log('[HiveDescent animation test] Retargeted first tracks:', newTracks.slice(0, 5).map((t) => t.name));
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

function timeScaleFor(name: AnimStateName): number {
  if (name === 'idle') return IDLE_TIME_SCALE;
  if (name === 'walk') return WALK_TIME_SCALE;
  if (name === 'run') return RUN_TIME_SCALE;
  return ONE_SHOT_TIME_SCALE;
}

export default function FactionCharacter({ factionId, animState }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<AnimStateName, THREE.AnimationAction>>>({});
  const currentActionRef = useRef<AnimStateName | null>(null);
  const oneShotTimeoutRef = useRef<number | null>(null);

  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [animationsReady, setAnimationsReady] = useState(false);
  const [actionsReady, setActionsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    const modelPath = `/descent/models/factions/${factionId}.glb`;

    console.log(`[HiveDescent GLB clean test] Loading ${modelPath}`);

    loader.load(
      modelPath,
      (loaded: any) => {
        if (cancelled) return;

        const scene = loaded.scene as THREE.Group;
        let meshCount = 0;
        let foundSkinned = false;

        scene.traverse((obj: any) => {
          if (obj.isSkinnedMesh) foundSkinned = true;
          if (obj.isMesh) {
            meshCount++;
            obj.castShadow = true;
            obj.receiveShadow = true;
            obj.frustumCulled = false;
          }
        });

        const box = new THREE.Box3().setFromObject(scene);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        console.log('[HiveDescent GLB clean test] meshCount:', meshCount);
        console.log('[HiveDescent GLB clean test] skinnedMesh:', foundSkinned);
        console.log('[HiveDescent GLB clean test] box size:', size.toArray());
        console.log('[HiveDescent GLB clean test] box center:', center.toArray());

        if (meshCount === 0 || !Number.isFinite(size.y) || size.y <= 0) {
          console.warn('[HiveDescent GLB clean test] Model loaded but no usable mesh bounds found');
          return;
        }

        scene.position.set(-center.x, -box.min.y, -center.z);

        const nextScale = TARGET_HEIGHT / size.y;
        console.log('[HiveDescent GLB clean test] auto scale:', nextScale);

        setRenderScale(nextScale);
        setLoadedScene(scene);
      },
      undefined,
      (err: any) => {
        if (cancelled) return;
        console.warn('[HiveDescent GLB clean test] GLB load failed:', err);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [factionId]);

  useEffect(() => {
    let cancelled = false;
    loadAnimationsOnce().then(() => {
      if (cancelled) return;
      if (animClipCache.idle && animClipCache.run) setAnimationsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loadedScene || !animationsReady) return;

    const boneMap = buildBoneMap(loadedScene);
    const mixer = new THREE.AnimationMixer(loadedScene);
    mixerRef.current = mixer;

    const nextActions: Partial<Record<AnimStateName, THREE.AnimationAction>> = {};

    (['idle', 'walk', 'run', 'attack', 'hurt', 'die'] as AnimStateName[]).forEach((name) => {
      const sourceClip = animClipCache[name];
      if (!sourceClip) return;

      const retargetedClip = retargetClip(sourceClip, boneMap);
      if (retargetedClip.tracks.length === 0) return;

      const action = mixer.clipAction(retargetedClip);
      action.timeScale = timeScaleFor(name);

      if (ONE_SHOT[name]) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }

      nextActions[name] = action;
    });

    actionsRef.current = nextActions;
    setActionsReady(true);
    console.log('[HiveDescent animation test] All available actions ready');

    return () => {
      if (oneShotTimeoutRef.current) window.clearTimeout(oneShotTimeoutRef.current);
      oneShotTimeoutRef.current = null;
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
      setActionsReady(false);
    };
  }, [loadedScene, animationsReady]);

  useEffect(() => {
    console.log(`[HiveDescent animation test] animState: ${animState}`);
    if (!actionsReady) return;

    const actions = actionsRef.current;
    const target: AnimStateName = actions[animState]
      ? animState
      : animState === 'walk' && actions.walk
        ? 'walk'
        : animState === 'run' && actions.run
          ? 'run'
          : 'idle';

    const targetAction = actions[target];
    const current = currentActionRef.current;
    const currentAction = current ? actions[current] : null;

    if (!targetAction || current === target) return;

    if (oneShotTimeoutRef.current) {
      window.clearTimeout(oneShotTimeoutRef.current);
      oneShotTimeoutRef.current = null;
    }

    targetAction.reset().fadeIn(0.15).play();
    if (currentAction && currentAction !== targetAction) currentAction.fadeOut(0.15);
    currentActionRef.current = target;

    console.log(`[HiveDescent animation test] Switched animation to ${target}`);

    if (ONE_SHOT[target] && target !== 'die') {
      const durationMs = Math.max(250, (animClipCache[target]?.duration || 0.7) * 1000 / timeScaleFor(target));
      oneShotTimeoutRef.current = window.setTimeout(() => {
        const fallback: AnimStateName = actions.run ? 'run' : 'idle';
        const fallbackAction = actions[fallback] || actions.idle;
        if (!fallbackAction || currentActionRef.current !== target) return;

        fallbackAction.reset().fadeIn(0.15).play();
        targetAction.fadeOut(0.15);
        currentActionRef.current = fallback;
        oneShotTimeoutRef.current = null;
        console.log(`[HiveDescent animation test] One-shot ${target} finished, returned to ${fallback}`);
      }, durationMs);
    }
  }, [animState, actionsReady]);

  useFrame((_, dt) => {
    if (mixerRef.current) mixerRef.current.update(dt);
  });

   const effectiveYOffset = animState === 'die' ? 0.35 : MODEL_Y_OFFSET;

   const effectiveYOffset = animState === 'die' ? DIE_Y_OFFSET : MODEL_Y_OFFSET;

  return (
    <group ref={groupRef}>
      {loadedScene && (
        <group
          position={[0, effectiveYOffset, 0]}
          rotation={[0, 0, 0]}
          scale={renderScale}
        >
          <primitive object={loadedScene} />
        </group>
      )}
    </group>
  );
}
