// components/Queen3D.tsx
import React, { Suspense, memo, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, useGLTF } from '@react-three/drei';

/** Loads the GLB from public/models/queen/queen.glb */
function QueenModel(props: JSX.IntrinsicElements['group']) {
  // IMPORTANT: path is from web root (public/)
  const { scene } = useGLTF('/models/queen/queen.glb');

  // enable shadows on all meshes
  useMemo(() => {
    scene.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }, [scene]);

  return (
    <group {...props}>
      {/* Adjust these three to fit your model nicely */}
      <primitive
        object={scene}
        position={[0, -0.35, 0]}     // lower a bit onto the ground
        rotation={[0, Math.PI, 0]}   // face forward (flip if backwards)
        scale={1.0}                  // size of the queen
      />
    </group>
  );
}
useGLTF.preload('/models/queen/queen.glb');

export default memo(function Queen3D() {
  return (
    <div className="queen-3d">
      <Canvas
        dpr={[1, 2]}
        shadows
        camera={{ fov: 28, position: [0, 1.1, 4.2] }}
      >
        {/* Simple, safe lighting (no custom props that cause TS errors) */}
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[2.5, 3.5, 2.5]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />

        <Suspense fallback={null}>
          <QueenModel />
          <ContactShadows
            position={[0, -0.6, 0]}
            opacity={0.35}
            scale={5}
            blur={2}
            far={4}
          />
          {/* Soft IBL for nicer materials */}
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
});
