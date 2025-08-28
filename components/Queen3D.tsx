// components/Queen3D.tsx
import React, { Suspense, memo, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import type { Group } from 'three';

type Queen3DProps = {
  /** When true (during shuffling), do a slightly snappier idle animation */
  active?: boolean;
};

function QueenModel({
  active = false,
  ...props
}: Queen3DProps & JSX.IntrinsicElements['group']) {
  const { scene } = useGLTF('/models/queen/queen.glb');
  const ref = useRef<Group>(null!);

  // turn on shadows
  useMemo(() => {
    scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  // idle bob + sway; faster when active
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const bob = (active ? 0.05 : 0.025) * Math.sin(t * (active ? 3 : 1.6));
    const sway = (active ? 0.08 : 0.04) * Math.sin(t * (active ? 1.3 : 0.75));
    if (ref.current) {
      ref.current.position.y = -0.3 + bob;
      ref.current.rotation.y = Math.PI + sway;
    }
  });

  return (
    <group ref={ref} {...props}>
      <primitive
        object={scene}
        position={[0, 0, 0]}
        rotation={[0, Math.PI, 0]}
        scale={1.8}               {/* <— bigger */}
      />
    </group>
  );
}
useGLTF.preload('/models/queen/queen.glb');

function Queen3DCanvas({ active = false }: Queen3DProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      // closer camera so the queen fills the area
      camera={{ fov: 26, position: [0, 0.95, 3.2] }}
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
          position={[0, -0.58, 0]}
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

export default memo(function Queen3D(props: Queen3DProps) {
  return (
    <div className="queen-3d" aria-hidden="true">
      <Queen3DCanvas {...props} />
    </div>
  );
});
