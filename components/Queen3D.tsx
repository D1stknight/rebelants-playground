// components/Queen3D.tsx
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type Props = {
  active?: boolean;
  /** visual size of the model; 1 = default */
  scale?: number;
  /** small vertical nudge in 3D units (negative = lower) */
  y?: number;
};

function QueenModel({ active = false, scale = 1, y = 0 }: Props) {
  const { scene } = useGLTF('/models/queen/queen.glb');
  const ref = useRef<THREE.Group>(null!);

  useMemo(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => (mat as any).envMapIntensity = 0.7);
        } else if (m.material) {
          (m.material as any).envMapIntensity = 0.7;
        }
      }
    });
  }, [scene]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const pulse = active ? 1 + Math.sin(t * 4) * 0.03 : 1;
    ref.current.scale.set(scale * pulse, scale * pulse, scale * pulse);
    ref.current.position.y = y + (active ? Math.sin(t * 3) * 0.03 : Math.sin(t * 2) * 0.02);
    ref.current.rotation.y = Math.sin(t * 0.6) * 0.18;
  });

  return <primitive ref={ref} object={scene} />;
}

export default function Queen3D({ active, scale = 1, y = 0 }: Props) {
  return (
    <div className="queen3d" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 1.0, 2.35], fov: 30 }}
      >
        {/* lighting */}
        <ambientLight intensity={0.38} />
        <hemisphereLight color={'#8fb2ff'} groundColor={'#21324f'} intensity={0.55} />
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
          /* Lowered and centered better vs previous version */
          transform: translate(-50%, -52%);
          width: 520px;   /* larger viewport -> larger visual model */
          height: 300px;
          pointer-events: none;
          z-index: 12; /* below eggs (z:25), above rails */
        }
        @media (max-width: 480px) {
          .queen3d {
            width: 380px;
            height: 230px;
            transform: translate(-50%, -52%);
          }
        }
      `}</style>
    </div>
  );
}

useGLTF.preload('/models/queen/queen.glb');
