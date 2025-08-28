// components/Queen3D.tsx
import React, { Suspense, memo, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import type { Group } from 'three';

type Queen3DProps = {
  /** When true (during shuffling) the idle motion is a bit livelier */
  active?: boolean;
};

/* ---------------- Model ---------------- */
function QueenModel({
  active = false,
  ...props
}: Queen3DProps & JSX.IntrinsicElements['group']) {
  // GLB lives under /public/models/queen/queen.glb
  const { scene } = useGLTF('/models/queen/queen.glb');

  const ref = useRef<Group>(null!);

  // Make sure all meshes cast/receive shadows
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
  const BASE_Y = -0.58;        // ⬅️ lower = further down (we had ~ -0.30 before)
  const BOB_IDLE = 0.025;
  const BOB_ACTIVE = 0.055;
  const SWAY_IDLE = 0.04;
  const SWAY_ACTIVE = 0.08;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const bob = (active ? BOB_ACTIVE : BOB_IDLE) * Math.sin(t * (active ? 3.0 : 1.6));
    const sway = (active ? SWAY_ACTIVE : SWAY_IDLE) * Math.sin(t * (active ? 1.3 : 0.75));
    if (ref.current) {
      ref.current.position.y = BASE_Y + bob; // move whole model lower
      ref.current.rotation.y = Math.PI + sway;
    }
  });

  return (
    <group ref={ref} {...props}>
      <primitive
        object={scene}
        position={[0, 0, 0]}
        rotation={[0, Math.PI, 0]}
        scale={1.0}     // bump to 2.0 if you want larger
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
        position: [0, 0.95, 3.2], // you can pull back slightly if you want more headroom
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

/* ---------------- Exported component ---------------- */
export default memo(function Queen3D(props: Queen3DProps) {
  return (
    <div className="queen-3d" aria-hidden="true">
      <Queen3DCanvas {...props} />
    </div>
  );
});
