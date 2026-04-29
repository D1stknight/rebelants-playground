// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Current test: auto-fit the new samurai.glb smaller and lift it above the ground.

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

const TARGET_HEIGHT = 1.45;
const MODEL_Y_OFFSET = 0.45;

export default function FactionCharacter({ factionId, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    const modelPath = `/descent/models/factions/${factionId}.glb`;

    console.log(`[HiveDescent GLB fit test] Loading ${modelPath}`);

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

        console.log('[HiveDescent GLB fit test] meshCount:', meshCount);
        console.log('[HiveDescent GLB fit test] skinnedMesh:', foundSkinned);
        console.log('[HiveDescent GLB fit test] box size:', size.toArray());
        console.log('[HiveDescent GLB fit test] box center:', center.toArray());

        if (meshCount === 0 || !Number.isFinite(size.y) || size.y <= 0) {
          console.warn('[HiveDescent GLB fit test] Model loaded but no usable mesh bounds found');
          setLoadFailed(true);
          onMissingAssets?.();
          return;
        }

        scene.position.set(-center.x, -box.min.y, -center.z);

        const nextScale = TARGET_HEIGHT / size.y;
        console.log('[HiveDescent GLB fit test] auto scale:', nextScale);

        setRenderScale(nextScale);
        setLoadedScene(scene);
      },
      undefined,
      (err: any) => {
        if (cancelled) return;
        console.warn('[HiveDescent GLB fit test] GLB load failed:', err);
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
        position={[0, MODEL_Y_OFFSET, 0]}
        rotation={[0, 0, 0]}
        scale={renderScale}
      >
        <primitive object={loadedScene} />
      </group>
    </group>
  );
}
