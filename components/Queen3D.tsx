// components/Queen3D.tsx
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type Props = {
  active?: boolean;
  scale?: number; // visual size of the queen model
  y?: number;     // small vertical nudge in scene space (negative => lower)
};

function QueenModel({ active = false, scale = 1, y = 0 }: Props) {
  const { scene } = useGLTF('/models/queen/queen.glb');
  const ref = useRef<THREE.Group>(null!);

  // enable shadows + a touch of env lighting on materials
  useMemo(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        const setEnv = (mat: any) => (mat.envMapIntensity = 0.7);
        if (Array.isArray(m.material)) m.material.forEach(setEnv);
        else if (m.material) setEnv(m.material);
      }
    });
  }, [scene]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = active ? 1 + Math.sin(t * 4) * 0.03 : 1;
    ref.current.scale.set(scale * pulse, scale * pulse, scale * pulse);
    ref.current.position.y = y + (active ? Math.sin(t * 3) * 0.03 : Math.sin(t * 2) * 0.02);
    ref.current.rotation.y = Math.sin(t * 0.55) * 0.16;
  });

  return <primitive ref={ref} object={scene} />;
}

export default function Queen3D({ active, scale = .7, y = -0.36 }: Props) {
  return (
    <div className="queen3d" aria-hidden="true">
      <Canvas dpr={[1, 2]} shadows camera={{ position: [0, 1.05, 2.05], fov: 30 }}>
        {/* lighting */}
        <ambientLight intensity={0.38} />
        <hemisphereLight color={'#8fb2ff'} groundColor={'#21324f'} intensity={0.55} />
        <spotLight position={[2.6, 3.4, 3.1]} angle={0.4} penumbra={0.35} intensity={1.15} castShadow />

        <group position={[0, 0, 0]}>
          <QueenModel active={!!active} scale={scale} y={y} />
        </group>

        <ContactShadows opacity={0.35} scale={4.2} blur={2.4} far={4} resolution={768} position={[0, -0.1, 0]} />
        <Environment preset="city" />
      </Canvas>

      <style jsx>{`
        .queen3d {
          position: absolute;
          left: 50%;
          top: 50%;
          /* lower than center and big */
          transform: translate(-50%, -28%);
          width: 760px;
          height: 420px;
          pointer-events: none;
          z-index: 12; /* eggs are z:25 */
        }
        @media (max-width: 480px) {
          .queen3d {
            width: 520px;
            height: 300px;
            transform: translate(-50%, -32%);
          }
        }
      `}</style>
    </div>
  );
}

useGLTF.preload('/models/queen/queen.glb');
