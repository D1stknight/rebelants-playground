// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Current test: always play the real run action to verify run setup.

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
  const names: AnimStateName[] = ['run'];
  console.log('[constant run test] Loading run.fbx');

  animCachePromise = Promise.all(names.map(name => {
    return new Promise<void>((resolve) => {
      fbxLoader.load(
        `/descent/models/animations/${name}.fbx`,
        (fbx: any) => {
          if (fbx.animations && fbx.animations.length > 0) {
            const clip = fbx.animations[0];
            clip.name = name;
            animCache[name] = clip;
            console.log(`[constant run test] Loaded ${name}: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s`);
          }
          resolve();
        },
        undefined,
        (err: any) => {
          console.warn(`[constant run test] Failed ${name}:`, err);
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

  for (const track of clip.tracks) {
    const lastDot = track.name.lastIndexOf('.');
    if (lastDot === -1) {
      newTracks.push(track);
      continue;
    }

    const fbxBone = track.name.substring(0, lastDot);
    const property = track.name.substring(lastDot);

    if (property === '.position' || property === '.scale') continue;

    const stripped = fbxBone.replace(/^mixamorig:?/i, '').toLowerCase();
    const target = boneMap.get(fbxBone.toLowerCase()) || boneMap.get(stripped);

    if (target) {
      const newTrack = track.clone();
      newTrack.name = target + property;
      newTracks.push(newTrack);
    }
  }

  console.log(`[constant run test] ${clip.name}: ${newTracks.length} usable tracks`);
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

export default function FactionCharacter({ factionId, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [skinnedMesh, setSkinnedMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [animsReady, setAnimsReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    const modelPath = `/descent/models/factions/${factionId}.glb`;

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
          setLoadFailed(true);
          onMissingAssets?.();
          return;
        }

        setLoadedScene(scene);
        setSkinnedMesh(foundSkinned as THREE.SkinnedMesh);
      },
      undefined,
      () => {
        if (cancelled) return;
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
      if (!animCache.run) {
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

    const runClip = animCache.run ? retargetClip(animCache.run, boneMap) : null;
    if (runClip && runClip.tracks.length > 0) {
      const runAction = mixer.clipAction(runClip);
      runAction.setLoop(THREE.LoopRepeat, Infinity);
      runAction.timeScale = RUN_TIME_SCALE;
      runAction.reset().play();
      console.log('[constant run test] Run action playing');
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [loadedScene, skinnedMesh, animsReady]);

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
