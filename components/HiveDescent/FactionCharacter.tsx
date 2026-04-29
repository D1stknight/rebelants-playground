// components/HiveDescent/FactionCharacter.tsx
// Hive Descent rigged faction character.
// Current test: show a temporary debug marker while testing the new samurai.glb load.

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

const TARGET_HEIGHT = 2.2;

export default function FactionCharacter({ factionId }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    const modelPath = `/descent/models/factions/${factionId}.glb`;

    console.log(`[HiveDescent GLB debug marker test] Loading ${modelPath}`);

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

        console.log('[HiveDescent GLB debug marker test] meshCount:', meshCount);
        console.log('[HiveDescent GLB debug marker test] skinnedMesh:', foundSkinned);
        console.log('[HiveDescent GLB debug marker test] box size:', size.toArray());
        console.log('[HiveDescent GLB debug marker test] box center:', center.toArray());

        if (meshCount === 0 || !Number.isFinite(size.y) || size.y <= 0) {
          console.warn('[HiveDescent GLB debug marker test] Model loaded but no usable mesh bounds found');
          setLoadFailed(true);
          return;
        }

        scene.position.set(-center.x, -box.min.y, -center.z);

        const nextScale = TARGET_HEIGHT / size.y;
        console.log('[HiveDescent GLB debug marker test] auto scale:', nextScale);

        setRenderScale(nextScale);
        setLoadedScene(scene);
      },
      undefined,
      (err: any) => {
        if (cancelled) return;
        console.warn('[HiveDescent GLB debug marker test] GLB load failed:', err);
        setLoadFailed(true);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [factionId]);

  useFrame(() => undefined);

  return (
    <group ref={groupRef}>
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[0.5, 2.2, 0.5]} />
        <meshBasicMaterial color="#00ff00" wireframe />
      </mesh>

      {loadFailed && (
        <mesh position={[0, 2.5, 0]}>
          <sphereGeometry args={[0.35, 16, 16]} />
          <meshBasicMaterial color="#ff0000" />
        </mesh>
      )}

      {loadedScene && (
        <group
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          scale={renderScale}
        >
          <primitive object={loadedScene} />
        </group>
      )}
    </group>
  );
}
