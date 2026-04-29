// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Current test: load the new Mixamo-rigged samurai.fbx model with no animation mixer.

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export type AnimStateName = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'die';

interface FactionCharacterProps {
  factionId: string;
  animState: AnimStateName;
  onMissingAssets?: () => void;
}

const GROUND_OFFSET = 0;
const RENDER_SCALE = 0.01;

export default function FactionCharacter({ factionId, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new FBXLoader();
    const modelPath = `/descent/models/factions/${factionId}.fbx`;

    console.log(`[HiveDescent FBX model test] Loading ${modelPath}`);

    loader.load(
      modelPath,
      (loaded: THREE.Group) => {
        if (cancelled) return;

        let foundSkinned = false;

        loaded.traverse((obj: any) => {
          if (obj.isSkinnedMesh) foundSkinned = true;
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            obj.frustumCulled = false;
          }
        });

        console.log(`[HiveDescent FBX model test] Skinned mesh found: ${foundSkinned}`);

        if (!foundSkinned) {
          setLoadFailed(true);
          onMissingAssets?.();
          return;
        }

        setLoadedScene(loaded);
      },
      undefined,
      (err: any) => {
        if (cancelled) return;
        console.warn('[HiveDescent FBX model test] FBX load failed:', err);
        setLoadFailed(true);
        onMissingAssets?.();
      }
    );

    return () => {
      cancelled = true;
    };
  }, [factionId, onMissingAssets]);

  useFrame(() => undefined);

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
