// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Stable visual baseline plus run.fbx mapped only to the run state.

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
const RUN_TIME_SCALE = 0.35;

let runClipCache: THREE.AnimationClip | null = null;
let runClipPromise: Promise<void> | null = null;

function loadRunAnimationOnce(): Promise<void> {
  if (runClipPromise) return runClipPromise;

  const fbxLoader = new FBXLoader();
  console.log('[HiveDescent run test] Loading /descent/models/animations/run.fbx');

  runClipPromise = new Promise<void>((resolve) => {
    fbxLoader.load(
      '/descent/models/animations/run.fbx',
      (fbx: any) => {
        const clip = fbx.animations?.[0] as THREE.AnimationClip | undefined;
        if (clip) {
          clip.name = 'run';
          runClipCache = clip;
          console.log(`[HiveDescent run test] Loaded run clip: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s`);
          console.log('[HiveDescent run debug] run.fbx first 5 track names:', clip.tracks.slice(0, 5).map((t) => t.name));
        } else {
          console.warn('[HiveDescent run test] No animation clip found in run.fbx');
        }
        resolve();
      },
      undefined,
      (err: any) => {
        console.warn('[HiveDescent run test] Failed to load run.fbx:', err);
        resolve();
      }
    );
  });

  return runClipPromise;
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

  console.log('[HiveDescent run debug] retargetClip source first 5 track names:', clip.tracks.slice(0, 5).map((t) => t.name));

  for (const track of clip.tracks) {
    const lastDot = track.name.lastIndexOf('.');
    if (lastDot === -1) continue;

    const sourceBone = track.name.substring(0, lastDot);
    const property = track.name.substring(lastDot);

    if (newTracks.length < 5) {
      console.log(`[HiveDescent run debug] source track property: ${property} | bone: ${sourceBone}`);
    }

    // Keep only bone rotations for this test. Root position/scale tracks can cause flips, floating, or twitching.
    if (property !== '.quaternion') continue;

    const stripped = sourceBone.replace(/^mixamorig:?/i, '').toLowerCase();
    const target = boneMap.get(sourceBone.toLowerCase()) || boneMap.get(stripped);

    if (target) {
      const newTrack = track.clone();
      newTrack.name = target + property;
      newTracks.push(newTrack);
    }
  }

  console.log(`[HiveDescent run test] Retargeted run clip: ${newTracks.length} usable rotation tracks`);
  console.log('[HiveDescent run debug] retargeted first 5 track names:', newTracks.slice(0, 5).map((t) => t.name));
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

export default function FactionCharacter({ factionId, animState, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const runActionRef = useRef<THREE.AnimationAction | null>(null);
  const isRunPlayingRef = useRef(false);

  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [skinnedMesh, setSkinnedMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [runReady, setRunReady] = useState(false);
  const [runActionReady, setRunActionReady] = useState(false);
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

    loadRunAnimationOnce().then(() => {
      if (cancelled) return;
      if (runClipCache) setRunReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loadedScene || !skinnedMesh || !runReady || !runClipCache) return;

    const boneMap = buildBoneMap(skinnedMesh);
    console.log(`[HiveDescent run debug] bone map entries: ${boneMap.size}`);
    const mixer = new THREE.AnimationMixer(skinnedMesh);
    console.log('[HiveDescent run debug] AnimationMixer root object:', skinnedMesh.name || '(unnamed skinned mesh)');
    mixerRef.current = mixer;

    const retargetedRunClip = retargetClip(runClipCache, boneMap);
    if (retargetedRunClip.tracks.length > 0) {
      const action = mixer.clipAction(retargetedRunClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = RUN_TIME_SCALE;
      runActionRef.current = action;
      setRunActionReady(true);
      console.log('[HiveDescent run test] Run action ready');
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      runActionRef.current = null;
      isRunPlayingRef.current = false;
      setRunActionReady(false);
    };
  }, [loadedScene, skinnedMesh, runReady]);

  useEffect(() => {
    console.log(`[HiveDescent run debug] FactionCharacter animState prop: ${animState}`);
    const runAction = runActionRef.current;
    if (!runAction || !runActionReady) return;

    const shouldRun = animState === 'run';

    if (shouldRun && !isRunPlayingRef.current) {
      runAction.reset().fadeIn(0.15).play();
      isRunPlayingRef.current = true;
      console.log('[HiveDescent run test] Run animation started');
      console.log('[HiveDescent run debug] runAction.play() invoked');
    }

    if (!shouldRun && isRunPlayingRef.current) {
      runAction.fadeOut(0.15);
      isRunPlayingRef.current = false;
      console.log('[HiveDescent run test] Run animation stopped');
    }
  }, [animState, runActionReady]);

  useFrame((_, dt) => {
    if (mixerRef.current) mixerRef.current.update(dt);
  });

  if (loadFailed || !loadedScene) return null;

  return (
    <group ref={groupRef}>
      <group
        position={[0, GROUND_OFFSET, 0]}
        rotation={[0, 0, 0]}
        scale={RENDER_SCALE}
      >
        <primitive object={loadedScene} />
      </group>
    </group>
  );
}
