// components/Queen3D.tsx
import React, { Suspense, memo, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';
import type { Group } from 'three'; // <-- add the THREE type

type Queen3DProps = {
  /** When true (during shuffling), do a slightly snappier idle animation */
  active?: boolean;
};

/** Render the GLB queen model from /public/models/queen/queen.glb */
function QueenModel({
  active = false,
  ...props
}: Queen3DProps & JSX.IntrinsicElements['group']) {
  // Path is from the web root because it lives under /public
  const { scene } = useGLTF('/models/queen/queen.glb');
  const ref = useRef<Group>(null!); // <-- use the imported Group type

  // Turn on shadows for all meshes in the scene
  useMemo(() => {
    scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  // Gentle bob + micro sway; a touch faster when `active`
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const baseY = -0.35;
    const bob = (active ? 0.03 : 0.015) * Math.sin(t * (active ? 3 : 1.8));
    const sway = (active ? 0.06 : 0.03) * Math.sin(t * (active ? 1.4 : 0.8));

    if (ref.current) {
      ref.current.position.y = baseY + bob;
      ref.current.rotation.y = Math.PI + sway;
    }
  });

  return (
    <group ref={ref} {...props}>
      <primitive
        object={scene}
        position={[0, 0, 0]}
        rotation={[0, Math.PI, 0]} // face camera; flip if needed
        scale={1.0}
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
      camera={{ fov: 28, position: [0, 1.1, 4.2] }}
    >
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[2.5, 3.5, 2.5]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      <Suspense fallback={null}>
        <QueenModel active={active} />
        <ContactShadows
          position={[0, -0.6, 0]}
          opacity={0.35}
          scale={5}
          blur={2}
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
