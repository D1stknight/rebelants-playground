// components/HiveDescent/FactionCharacter.tsx
// Phase D: load a rigged GLB character and apply Mixamo animations from FBX files.
//
// Usage:
//   <FactionCharacter
//     factionId="samurai"
//     animState="walk"         // 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'die'
//     onMissingAssets={() => /* fallback to procedural */}
//   />
//
// Behavior:
// - Loads /descent/models/factions/${factionId}.glb on mount
// - Loads /descent/models/animations/{idle,walk,run,attack,hurt,die}.fbx ONCE (shared across all factions)
// - Retargets animations onto the loaded skeleton at runtime
// - Crossfades between animations smoothly (200ms)
// - One-shot animations (attack/hurt) auto-return to idle when finished
// - Falls back gracefully if any asset fails to load

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type AnimStateName = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'die';

interface FactionCharacterProps {
  factionId: string;
  animState: AnimStateName;
  onMissingAssets?: () => void;
}

// One-shot animations (don't loop, return to idle when done)
const ONE_SHOT: Record<AnimStateName, boolean> = {
  idle: false,
  walk: false,
  run: false,
  attack: true,
  hurt: true,
  die: true, // die holds final pose
};

// Module-level cache so animations are loaded only once globally (shared across factions)
const animCache: Partial<Record<AnimStateName, THREE.AnimationClip>> = {};
let animCachePromise: Promise<void> | null = null;

function loadAnimationsOnce(): Promise<void> {
  if (animCachePromise) return animCachePromise;
  const fbxLoader = new FBXLoader();
  const names: AnimStateName[] = ['idle', 'walk', 'run', 'attack', 'hurt', 'die'];
  animCachePromise = Promise.all(names.map(name => {
    return new Promise<void>((resolve) => {
      fbxLoader.load(
        `/descent/models/animations/${name}.fbx`,
        (fbx) => {
          if (fbx.animations && fbx.animations.length > 0) {
            const clip = fbx.animations[0];
            clip.name = name;
            animCache[name] = clip;
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn(`[FactionCharacter] Failed to load animation ${name}:`, err);
          resolve(); // resolve even on failure — fallback handles it
        }
      );
    });
  })).then(() => undefined);
  return animCachePromise;
}

export default function FactionCharacter({ factionId, animState, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<AnimStateName, THREE.AnimationAction>>>({});
  const currentActionRef = useRef<AnimStateName | null>(null);
  const lastStateRef = useRef<AnimStateName>(animState);

  const [gltf, setGltf] = useState<{ scene: THREE.Group } | null>(null);
  const [animsReady, setAnimsReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Load the GLB
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.load(
      `/descent/models/factions/${factionId}.glb`,
      (loaded) => {
        if (cancelled) return;
        // Clone the scene so each instance has its own skeleton (SkeletonUtils handles bone uniqueness)
        const cloned = cloneSkeleton(loaded.scene) as THREE.Group;
        // Ensure all materials cast/receive shadows
        cloned.traverse((obj: any) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        setGltf({ scene: cloned });
      },
      undefined,
      (err) => {
        if (cancelled) return;
        console.warn(`[FactionCharacter] Failed to load ${factionId}.glb:`, err);
        setLoadFailed(true);
        onMissingAssets?.();
      }
    );
    return () => { cancelled = true; };
  }, [factionId, onMissingAssets]);

  // Load all animations once globally
  useEffect(() => {
    let cancelled = false;
    loadAnimationsOnce().then(() => {
      if (!cancelled) {
        // Check that at least idle exists
        if (!animCache.idle) {
          console.warn('[FactionCharacter] No idle animation loaded — falling back to procedural');
          setLoadFailed(true);
          onMissingAssets?.();
        } else {
          setAnimsReady(true);
        }
      }
    });
    return () => { cancelled = true; };
  }, [onMissingAssets]);

  // Set up the mixer + actions when both GLB and animations are ready
  useEffect(() => {
    if (!gltf || !animsReady) return;
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixerRef.current = mixer;
    const actions: Partial<Record<AnimStateName, THREE.AnimationAction>> = {};
    (Object.keys(animCache) as AnimStateName[]).forEach(name => {
      const clip = animCache[name];
      if (!clip) return;
      const action = mixer.clipAction(clip);
      if (ONE_SHOT[name]) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      actions[name] = action;
    });
    actionsRef.current = actions;

    // Start with idle
    if (actions.idle) {
      actions.idle.play();
      currentActionRef.current = 'idle';
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
    };
  }, [gltf, animsReady]);

  // Watch animState and crossfade when it changes
  useEffect(() => {
    if (!mixerRef.current || !actionsRef.current) return;
    const mixer = mixerRef.current;
    const actions = actionsRef.current;
    const target = animState;
    const current = currentActionRef.current;
    if (current === target) return;

    const targetAction = actions[target];
    const currentAction = current ? actions[current] : null;
    if (!targetAction) {
      // Animation missing — try idle as a fallback
      if (target !== 'idle' && actions.idle && current !== 'idle') {
        actions.idle.reset().fadeIn(0.2).play();
        if (currentAction) currentAction.fadeOut(0.2);
        currentActionRef.current = 'idle';
      }
      return;
    }

    // Crossfade: target fades in, current fades out, both over 200ms
    targetAction.reset().fadeIn(0.2).play();
    if (currentAction && currentAction !== targetAction) {
      currentAction.fadeOut(0.2);
    }
    currentActionRef.current = target;
    lastStateRef.current = target;

    // Auto-return to idle for one-shot animations (except 'die')
    if (ONE_SHOT[target] && target !== 'die') {
      const clip = animCache[target];
      const duration = clip ? clip.duration * 1000 : 800;
      const handle = setTimeout(() => {
        // Only auto-return if we haven't moved on already
        if (currentActionRef.current === target && actions.idle) {
          actions.idle.reset().fadeIn(0.15).play();
          targetAction.fadeOut(0.15);
          currentActionRef.current = 'idle';
        }
      }, duration);
      return () => clearTimeout(handle);
    }
  }, [animState]);

  // Tick the mixer every frame
  useFrame((_, dt) => {
    if (mixerRef.current) mixerRef.current.update(dt);
  });

  // If asset load failed, render nothing — parent handles fallback
  if (loadFailed || !gltf) {
    return null;
  }

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
    </group>
  );
}
