// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Current test: idle.fbx maps to idle, run.fbx maps to run, run slowed down.

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

const GROUND_OFFSET = 1.25;
const RENDER_SCALE = 1.25;
const RUN_TIME_SCALE = 0.45;

const animCache: Partial<Record<AnimStateName, THREE.AnimationClip>> = {};
let animCachePromise: Promise<void> | null = null;

function loadAnimationsOnce(): Promise<void> {
  if (animCachePromise) return animCachePromise;

  const fbxLoader = new FBXLoader();
  const names: AnimStateName[] = ['idle', 'run'];
  console.log('[FactionCharacter movement test] Loading idle.fbx and run.fbx');

  animCachePromise = Promise.all(names.map(name => {
    return new Promise<void>((resolve) => {
      fbxLoader.load(
        `/descent/models/animations/${name}.fbx`,
        (fbx: any) => {
          if (fbx.animations && fbx.animations.length > 0) {
            const clip = fbx.animations[0];
            clip.name = name;
            animCache[name] = clip;
            console.log(`[movement test] Loaded ${name}: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s`);
            for (let i = 0; i < Math.min(3, clip.tracks.length); i++) {
              console.log(`  track[${i}]: ${clip.tracks[i].name}`);
            }
          }
          resolve();
        },
        undefined,
        (err: any) => {
          console.warn(`[movement test] Failed ${name}:`, err);
          resolve();
        }
      );
    });
  })).then(() => undefined);

  return animCachePromise;
}

function buildBoneMap(skinnedMesh: THREE.SkinnedMesh): Map<string, string> {
  const map = new Map<string, string>();
  const skeleton = skinnedMesh.skeleton;
  if (!skeleton) return map;

  console.log(`[movement test] Skeleton has ${skeleton.bones.length} bones`);
  for (const bone of skeleton.bones) {
    const fullName = bone.name;
    const lower = fullName.toLowerCase();
    const stripped = fullName.replace(/^mixamorig:?/i, '').toLowerCase();
    map.set(lower, fullName);
    if (stripped && stripped !== lower) map.set(stripped, fullName);
  }
  return map;
}

function retargetClip(clip: THREE.AnimationClip, boneMap: Map<string, string>): THREE.AnimationClip {
  const newTracks: THREE.KeyframeTrack[] = [];
  let kept = 0;
  let dropped = 0;
  let skippedPos = 0;
  let skippedScale = 0;

  for (const track of clip.tracks) {
    const lastDot = track.name.lastIndexOf('.');
    if (lastDot === -1) {
      newTracks.push(track);
      continue;
    }

    const fbxBone = track.name.substring(0, lastDot);
    const property = track.name.substring(lastDot);

    if (property === '.position') {
      skippedPos++;
      continue;
    }
    if (property === '.scale') {
      skippedScale++;
      continue;
    }

    const stripped = fbxBone.replace(/^mixamorig:?/i, '').toLowerCase();
    const target = boneMap.get(fbxBone.toLowerCase()) || boneMap.get(stripped);

    if (target) {
      const newTrack = track.clone();
      newTrack.name = target + property;
      newTracks.push(newTrack);
      kept++;
    } else {
      dropped++;
    }
  }

  console.log(`[movement test retarget] ${clip.name}: kept ${kept}/${clip.tracks.length} rot, skipped ${skippedPos} pos + ${skippedScale} scale, dropped ${dropped}`);
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

export default function FactionCharacter({ factionId, animState, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<AnimStateName, THREE.AnimationAction>>>({});
  const currentActionRef = useRef<AnimStateName | null>(null);

  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [skinnedMesh, setSkinnedMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [animsReady, setAnimsReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    const modelPath = `/descent/models/factions/${factionId}.glb`;
    console.log(`[movement test] Loading ${modelPath}`);

    loader.load(
      modelPath,
      (loaded: any) => {
        if (cancelled) return;

        const scene = loaded.scene as THREE.Group;
        let foundSkinned: THREE.SkinnedMesh | null = null;

        scene.traverse((obj: any) => {
          if (obj.isSkinnedMesh && !foundSkinned) foundSkinned = obj;
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            obj.frustumCulled = false;
          }
        });

        if (!foundSkinned) {
          console.warn('[movement test] No SkinnedMesh found in GLB');
          setLoadFailed(true);
          onMissingAssets?.();
          return;
        }

        const sm = foundSkinned as THREE.SkinnedMesh;
        console.log(`[movement test] SkinnedMesh: ${sm.name}, bones=${sm.skeleton?.bones.length || 0}`);
        setLoadedScene(scene);
        setSkinnedMesh(sm);
      },
      undefined,
      (err: any) => {
        if (cancelled) return;
        console.warn('[movement test] GLB load failed:', err);
        setLoadFailed(true);
        onMissingAssets?.();
      }
    );

    return () => {
      cancelled = true;
    };
  }, [factionId, onMissingAssets]);

  useEffect(() => {
    let cancelled = false;
    loadAnimationsOnce().then(() => {
      if (cancelled) return;
      if (!animCache.idle || !animCache.run) {
        console.warn('[movement test] Missing idle or run animation');
        setLoadFailed(true);
        onMissingAssets?.();
      } else {
        setAnimsReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onMissingAssets]);

  useEffect(() => {
    if (!loadedScene || !skinnedMesh || !animsReady) return;

    const boneMap = buildBoneMap(skinnedMesh);
    const mixer = new THREE.AnimationMixer(skinnedMesh);
    mixerRef.current = mixer;

    const actions: Partial<Record<AnimStateName, THREE.AnimationAction>> = {};

    const idleClip = animCache.idle ? retargetClip(animCache.idle, boneMap) : null;
    if (idleClip && idleClip.tracks.length > 0) {
      const idleAction = mixer.clipAction(idleClip);
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.timeScale = 1;
      actions.idle = idleAction;
    }

    const runClip = animCache.run ? retargetClip(animCache.run, boneMap) : null;
    if (runClip && runClip.tracks.length > 0) {
      const runAction = mixer.clipAction(runClip);
      runAction.setLoop(THREE.LoopRepeat, Infinity);
      runAction.timeScale = RUN_TIME_SCALE;
      actions.run = runAction;
    }

    actionsRef.current = actions;

    if (actions.idle) {
      actions.idle.play();
      currentActionRef.current = 'idle';
      console.log('[movement test] Started idle animation');
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
    };
  }, [loadedScene, skinnedMesh, animsReady]);

  useEffect(() => {
    if (!mixerRef.current) return;

    const actions = actionsRef.current;
    const target: AnimStateName = animState === 'run' ? 'run' : 'idle';
    const current = currentActionRef.current;
    if (current === target) return;

    const targetAction = actions[target];
    const currentAction = current ? actions[current] : null;
    if (!targetAction) return;

    targetAction.reset().fadeIn(0.2).play();
    if (currentAction && currentAction !== targetAction) currentAction.fadeOut(0.2);
    currentActionRef.current = target;
  }, [animState]);

  useFrame((_, dt) => {
    if (mixerRef.current) mixerRef.current.update(dt);
  });

  if (loadFailed || !loadedScene) return null;

  return (
    <group ref={groupRef}>
      <group
        position={[0, GROUND_OFFSET, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={RENDER_SCALE}
      >
        <primitive object={loadedScene} />
      </group>
    </group>
  );
}
