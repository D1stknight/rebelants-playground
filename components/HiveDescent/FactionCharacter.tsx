// components/HiveDescent/FactionCharacter.tsx
// Phase D v2: load a rigged GLB character + retarget Mixamo FBX animations.
//
// Key fix in v2: when an FBX animation is loaded, three.js treats its track names as
// the bone names from the FBX file's internal skeleton (e.g. "mixamorig:LeftArm.position").
// If the GLB skeleton uses different bone names or hierarchy, the AnimationMixer can't
// find matching nodes and silently does nothing. The fix is to:
//   1. Find the GLB's actual skeleton bones
//   2. Walk each animation track and rewrite the prefix to match a real bone
//   3. Drop tracks that have no matching bone in the GLB
//
// Also adds console logging so we can verify what's happening.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
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

const ONE_SHOT: Record<AnimStateName, boolean> = {
  idle: false,
  walk: false,
  run: false,
  attack: true,
  hurt: true,
  die: true,
};

// Module-level cache: animations are loaded once globally
const animCache: Partial<Record<AnimStateName, THREE.AnimationClip>> = {};
let animCachePromise: Promise<void> | null = null;

function loadAnimationsOnce(): Promise<void> {
  if (animCachePromise) return animCachePromise;
  const fbxLoader = new FBXLoader();
  const names: AnimStateName[] = ['idle', 'walk', 'run', 'attack', 'hurt', 'die'];
  console.log('[FactionCharacter] Loading 6 animations from /descent/models/animations/');
  animCachePromise = Promise.all(names.map(name => {
    return new Promise<void>((resolve) => {
      fbxLoader.load(
        `/descent/models/animations/${name}.fbx`,
        (fbx: any) => {
          if (fbx.animations && fbx.animations.length > 0) {
            const clip = fbx.animations[0];
            clip.name = name;
            animCache[name] = clip;
            console.log(`[FactionCharacter] Loaded ${name}: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s duration`);
            if (clip.tracks.length > 0) {
              console.log(`  First track: ${clip.tracks[0].name}`);
            }
          } else {
            console.warn(`[FactionCharacter] ${name}.fbx has no animations`);
          }
          resolve();
        },
        undefined,
        (err: any) => {
          console.warn(`[FactionCharacter] Failed to load ${name}:`, err);
          resolve();
        }
      );
    });
  })).then(() => {
    console.log(`[FactionCharacter] All animations loaded. Cache:`, Object.keys(animCache));
  });
  return animCachePromise;
}

/**
 * Retarget an animation clip to a new skeleton.
 * Mixamo FBX clips have track names like "mixamorigHips.position" (no colon, prefix concatenated).
 * The GLB skeleton has bones named "mixamorig:Hips" (with colon, original Mixamo naming).
 * We rewrite tracks to match the GLB's bone names by:
 *   1. Stripping any "mixamorig" prefix from the FBX track name
 *   2. Looking for a matching bone in the GLB by base name (e.g. "Hips")
 */
function retargetClip(clip: THREE.AnimationClip, targetSkeleton: THREE.Bone[]): THREE.AnimationClip {
  // Build a lookup of GLB bone basename -> full name
  // GLB bones might be "mixamorig:Hips" or "Hips" or "mixamorigHips" — be flexible
  const targetBoneByBase: Map<string, string> = new Map();
  targetSkeleton.forEach(bone => {
    const fullName = bone.name;
    // Strip any "mixamorig:" or "mixamorig" prefix
    let base = fullName.replace(/^mixamorig:?/, '');
    targetBoneByBase.set(base.toLowerCase(), fullName);
    targetBoneByBase.set(fullName.toLowerCase(), fullName); // also try full match
  });

  const newTracks: THREE.KeyframeTrack[] = [];
  let kept = 0;
  let dropped = 0;
  for (const track of clip.tracks) {
    // Track name format: "BoneName.property" e.g. "mixamorigHips.position"
    const lastDot = track.name.lastIndexOf('.');
    if (lastDot === -1) {
      newTracks.push(track);
      continue;
    }
    const fbxBoneName = track.name.substring(0, lastDot);
    const property = track.name.substring(lastDot); // ".position"
    
    // Strip mixamorig prefix from fbxBoneName
    const baseName = fbxBoneName.replace(/^mixamorig:?/, '');
    const targetName = targetBoneByBase.get(baseName.toLowerCase()) || targetBoneByBase.get(fbxBoneName.toLowerCase());
    
    if (targetName) {
      // Clone the track with the new name
      const newTrack = track.clone();
      newTrack.name = targetName + property;
      newTracks.push(newTrack);
      kept++;
    } else {
      dropped++;
    }
  }
  console.log(`[retarget] ${clip.name}: kept ${kept}/${clip.tracks.length} tracks (${dropped} dropped — no matching bone)`);

  const newClip = new THREE.AnimationClip(clip.name, clip.duration, newTracks);
  return newClip;
}

export default function FactionCharacter({ factionId, animState, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<AnimStateName, THREE.AnimationAction>>>({});
  const currentActionRef = useRef<AnimStateName | null>(null);

  const [gltfScene, setGltfScene] = useState<THREE.Group | null>(null);
  const [animsReady, setAnimsReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Load the GLB
  useEffect(() => {
    let cancelled = false;
    console.log(`[FactionCharacter] Loading /descent/models/factions/${factionId}.glb`);
    const loader = new GLTFLoader();
    loader.load(
      `/descent/models/factions/${factionId}.glb`,
      (loaded: any) => {
        if (cancelled) return;
        const cloned = cloneSkeleton(loaded.scene) as THREE.Group;
        // Collect bones for debug
        const bones: string[] = [];
        cloned.traverse((obj: any) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            obj.frustumCulled = false; // skinned meshes can have wrong bounds
          }
          if (obj.isBone) bones.push(obj.name);
        });
        console.log(`[FactionCharacter] GLB loaded. Bones (${bones.length}):`, bones.slice(0, 10).join(', '), bones.length > 10 ? '...' : '');
        setGltfScene(cloned);
      },
      undefined,
      (err: any) => {
        if (cancelled) return;
        console.warn(`[FactionCharacter] Failed to load ${factionId}.glb:`, err);
        setLoadFailed(true);
        onMissingAssets?.();
      }
    );
    return () => { cancelled = true; };
  }, [factionId, onMissingAssets]);

  // Load all animations once
  useEffect(() => {
    let cancelled = false;
    loadAnimationsOnce().then(() => {
      if (!cancelled) {
        if (!animCache.idle) {
          console.warn('[FactionCharacter] No idle animation — falling back to procedural');
          setLoadFailed(true);
          onMissingAssets?.();
        } else {
          setAnimsReady(true);
        }
      }
    });
    return () => { cancelled = true; };
  }, [onMissingAssets]);

  // Wire up mixer + actions when both are ready
  useEffect(() => {
    if (!gltfScene || !animsReady) return;
    
    // Collect target skeleton bones
    const bones: THREE.Bone[] = [];
    gltfScene.traverse((obj: any) => {
      if (obj.isBone) bones.push(obj);
    });
    console.log(`[FactionCharacter] Setting up mixer with ${bones.length} bones in target skeleton`);

    const mixer = new THREE.AnimationMixer(gltfScene);
    mixerRef.current = mixer;
    const actions: Partial<Record<AnimStateName, THREE.AnimationAction>> = {};
    
    (Object.keys(animCache) as AnimStateName[]).forEach(name => {
      const rawClip = animCache[name];
      if (!rawClip) return;
      // Retarget the clip to our skeleton's bone names
      const clip = retargetClip(rawClip, bones);
      if (clip.tracks.length === 0) {
        console.warn(`[FactionCharacter] ${name} has no usable tracks after retargeting — skipping`);
        return;
      }
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
    console.log(`[FactionCharacter] Actions ready:`, Object.keys(actions));

    if (actions.idle) {
      actions.idle.play();
      currentActionRef.current = 'idle';
      console.log(`[FactionCharacter] Started idle animation`);
    } else {
      console.warn(`[FactionCharacter] No idle action created — character will be stiff`);
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
    };
  }, [gltfScene, animsReady]);

  // Watch animState and crossfade
  useEffect(() => {
    if (!mixerRef.current) return;
    const actions = actionsRef.current;
    const target = animState;
    const current = currentActionRef.current;
    if (current === target) return;

    const targetAction = actions[target];
    const currentAction = current ? actions[current] : null;
    if (!targetAction) {
      if (target !== 'idle' && actions.idle && current !== 'idle') {
        actions.idle.reset().fadeIn(0.2).play();
        if (currentAction) currentAction.fadeOut(0.2);
        currentActionRef.current = 'idle';
      }
      return;
    }

    targetAction.reset().fadeIn(0.2).play();
    if (currentAction && currentAction !== targetAction) {
      currentAction.fadeOut(0.2);
    }
    currentActionRef.current = target;

    if (ONE_SHOT[target] && target !== 'die') {
      const clip = animCache[target];
      const duration = clip ? clip.duration * 1000 : 800;
      const handle = setTimeout(() => {
        if (currentActionRef.current === target && actions.idle) {
          actions.idle.reset().fadeIn(0.15).play();
          targetAction.fadeOut(0.15);
          currentActionRef.current = 'idle';
        }
      }, duration);
      return () => clearTimeout(handle);
    }
  }, [animState]);

  useFrame((_, dt) => {
    if (mixerRef.current) mixerRef.current.update(dt);
  });

  if (loadFailed || !gltfScene) {
    return null;
  }

  return (
    <group ref={groupRef}>
      <primitive object={gltfScene} />
    </group>
  );
}
