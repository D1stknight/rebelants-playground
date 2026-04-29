// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Current test: use the animation clip from test.glb, but keep the real Samurai model.

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type AnimStateName = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'die';

interface FactionCharacterProps {
  factionId: string;
  animState: AnimStateName;
  onMissingAssets?: () => void;
}

const GROUND_OFFSET = 1.25;
const RENDER_SCALE = 1.25;
const RUN_TIME_SCALE = 0.35;

let testClip: THREE.AnimationClip | null = null;
let testClipPromise: Promise<void> | null = null;

function loadTestGlbAnimationOnce(): Promise<void> {
  if (testClipPromise) return testClipPromise;

  const loader = new GLTFLoader();
  console.log('[test-glb-clip] Loading animation clip from /descent/anim-test/test.glb');

  testClipPromise = new Promise<void>((resolve) => {
    loader.load(
      '/descent/anim-test/test.glb',
      (loaded: any) => {
        const clip = loaded.animations?.[0] as THREE.AnimationClip | undefined;
        if (clip) {
          clip.name = 'run';
          testClip = clip;
          console.log(`[test-glb-clip] Loaded clip: ${clip.name}, ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s`);
        } else {
          console.warn('[test-glb-clip] No animation clip found in test.glb');
        }
        resolve();
      },
      undefined,
      (err: any) => {
        console.warn('[test-glb-clip] Failed to load test.glb animation:', err);
        resolve();
      }
    );
  });

  return testClipPromise;
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
    if (lastDot === -1) continue;

    const sourceBone = track.name.substring(0, lastDot);
    const property = track.name.substring(lastDot);

    if (property === '.position' || property === '.scale') continue;

    const stripped = sourceBone.replace(/^mixamorig:?/i, '').toLowerCase();
    const target = boneMap.get(sourceBone.toLowerCase()) || boneMap.get(stripped);

    if (target) {
      const newTrack = track.clone();
      newTrack.name = target + property;
      newTracks.push(newTrack);
    }
  }

  console.log(`[test-glb-clip] Retargeted ${clip.name}: ${newTracks.length} usable tracks`);
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

export default function FactionCharacter({ factionId, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [skinnedMesh, setSkinnedMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [clipReady, setClipReady] = useState(false);
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
    loadTestGlbAnimationOnce().then(() => {
      if (cancelled) return;
      if (!testClip) {
        setLoadFailed(true);
        onMissingAssets?.();
      } else {
        setClipReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onMissingAssets]);

  useEffect(() => {
    if (!loadedScene || !skinnedMesh || !clipReady || !testClip) return;

    const boneMap = buildBoneMap(skinnedMesh);
    const mixer = new THREE.AnimationMixer(skinnedMesh);
    mixerRef.current = mixer;

    const runClip = retargetClip(testClip, boneMap);
    if (runClip.tracks.length > 0) {
      const runAction = mixer.clipAction(runClip);
      runAction.setLoop(THREE.LoopRepeat, Infinity);
      runAction.timeScale = RUN_TIME_SCALE;
      runAction.reset().play();
      console.log('[test-glb-clip] Playing test.glb animation clip on Samurai model');
    } else {
      console.warn('[test-glb-clip] No usable tracks after retarget');
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [loadedScene, skinnedMesh, clipReady]);

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
