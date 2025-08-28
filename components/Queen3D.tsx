// components/Queen3D.tsx
import React, { Suspense, memo, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, GradientTexture, useGLTF } from '@react-three/drei';
import type { Group } from 'three';

type Queen3DProps = { active?: boolean };

/* ---------------- Model ---------------- */
function QueenModel({
  active = false,
  ...props
}: Queen3DProps & JSX.IntrinsicElements['group']) {
  // GLB lives under /public/models/queen/queen.glb
  const { scene } = useGLTF('/models/queen/queen.glb');
  const ref = useRef<Group>(null!);

  // Cast/receive shadows on all meshes
  useMemo(() => {
    scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  // --- placement + subtle animation ---
  // Lower baseY to push the character DOWN in the frame
  const BASE_Y = -0.58;        // lower value => further down
  const BOB_IDLE = 0.025;
  const BOB_ACTIVE = 0.055;
  const SWAY_IDLE = 0.04;
  const SWAY_ACTIVE = 0.08;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const bob = (active ? BOB_ACTIVE : BOB_IDLE) * Math.sin(t * (active ? 3.0 : 1.6));
    const sway = (active ? SWAY_ACTIVE : SWAY_IDLE) * Math.sin(t * (active ? 1.3 : 0.75));
    if (ref.current) {
      ref.current.position.y = BASE_Y + bob;      // ↓ sits lower now
      ref.current.rotation.y = Math.PI + sway;
    }
  });

  return (
    <group ref={ref} {...props}>
      {/* Soft gradient “backdrop” behind the queen */}
      <mesh position={[0, 0.05, -0.55]} scale={[5.6, 2.8, 1]}>
        <planeGeometry args={[4, 2.2]} />
        <meshBasicMaterial toneMapped={false}>
          <GradientTexture
            // top → middle → bottom
            stops={[0, 0.55, 1]}
            colors={['#0b1b31', '#152a46', '#0b1630']}
            size={1024}
          />
        </meshBasicMaterial>
      </mesh>

      {/* The model */}
      <primitive
        object={scene}
        position={[0, 0, 0]}
        rotation={[0, Math.PI, 0]}
        scale={0.9}   // You said you like ~0.90; tweak here if needed
      />
    </group>
  );
}
useGLTF.preload('/models/queen/queen.glb');

/* ---------------- Canvas Shell ---------------- */
function Queen3DCanvas({ active = false }: Queen3DProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{
        fov: 26,
        position: [0, 0.95, 3.2],
      }}
    >
      {/* lighting */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[2.2, 3.2, 2.2]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      <Suspense fallback={null}>
        <QueenModel active={active} />
        <ContactShadows
          position={[0, -0.9, 0]}
          opacity={0.35}
          scale={6}
          blur={2.2}
          far={4}
        />
        <Environment preset="city" />
      </Suspense>
    </Canvas>
  );
}

export default memo(function Queen3D({ active }: Queen3DProps) {
  return (
    <div className="queen-3d" aria-hidden="true">
      <Queen3DCanvas active={active} />
      <style jsx>{`
        .queen-3d {
          position: absolute;
          left: 50%;
          top: 40%;
          transform: translate(-50%, -50%);
          width: 320px;
          height: 220px;
          pointer-events: none;
          z-index: 12; /* under eggs (z:25), above rails */
        }
        @media (max-width: 480px) {
          .queen-3d { width: 260px; height: 180px; top: 42%; }
        }
      `}</style>
    </div>
  );
});
