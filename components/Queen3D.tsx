// components/Queen3D.tsx
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type Props = {
  active?: boolean;
  /** visual size of the model; 1 = default. We'll pass 0.9 from Shuffle.tsx */
  scale?: number;
  /** vertical nudge of the model in 3D space */
  y?: number;
};

function QueenModel({ active = false, scale = 1, y = 0 }: Props) {
  // Path is from the web root because the file lives under /public
  const { scene } = useGLTF('/models/queen/queen.glb');
  const ref = useRef<THREE.Group>(null!);

  // turn on basic shadows for all meshes inside the GLB
  useMemo(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => (mat as any).envMapIntensity = 0.6);
        } else if (m.material) {
          (m.material as any).envMapIntensity = 0.6;
        }
      }
    });
  }, [scene]);

  // subtle idle motion; pulse a bit when shuffling
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!ref.current) return;
    const sPulse = active ? 1 + Math.sin(t * 4) * 0.03 : 1;
    ref.current.scale.set(scale * sPulse, scale * sPulse, scale * sPulse);
    ref.current.position.y = y + (active ? Math.sin(t * 3) * 0.03 : Math.sin(t * 2) * 0.02);
    ref.current.rotation.y = Math.sin(t * 0.6) * 0.2;
  });

  return <primitive ref={ref} object={scene} />;
}

export default function Queen3D({ active, scale = 1, y = 0 }: Props) {
  return (
    <div className="queen3d" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 0.9, 2.4], fov: 30 }}
      >
        {/* lighting */}
        <ambientLight intensity={0.35} />
        {/* hemisphereLight typing prefers color/groundColor */}
        <hemisphereLight color={'#89a3ff'} groundColor={'#223355'} intensity={0.5} />

        {/* a gentle spotlight from above */}
        <spotLight
          position={[2.8, 3.5, 3.1]}
          angle={0.4}
          penumbra={0.35}
          intensity={1.15}
          castShadow
        />

        <group position={[0, 0, 0]}>
          <QueenModel active={!!active} scale={scale} y={y} />
        </group>

        <ContactShadows
          opacity={0.35}
          scale={4.2}
          blur={2.4}
          far={4}
          resolution={768}
          position={[0, -0.1, 0]}
        />

        <Environment preset="city" />
      </Canvas>

      <style jsx>{`
        .queen3d {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -58%); /* sits behind the middle egg */
          width: 460px;
          height: 260px;
          pointer-events: none;
          z-index: 12; /* below eggs (z:25 in your CSS), above rails */
        }

        @media (max-width: 480px) {
          .queen3d {
            width: 360px;
            height: 220px;
            transform: translate(-50%, -56%);
          }
        }
      `}</style>
    </div>
  );
}

useGLTF.preload('/models/queen/queen.glb');
