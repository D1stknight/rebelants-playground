// components/Queen3D.tsx
import React, { Suspense, useMemo } from 'react';
import { Canvas, ThreeElements } from '@react-three/fiber';
import { ContactShadows, Environment } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

type Props = { active?: boolean };

function Crown() {
  return (
    <group position={[0, 1.25, 0]}>
      <mesh castShadow position={[0, 0.12, 0]}>
        <torusGeometry args={[0.38, 0.08, 12, 36]} />
        <meshStandardMaterial color={'#f4c04a'} metalness={0.7} roughness={0.35} />
      </mesh>
      {/* front spike */}
      <mesh castShadow position={[0, 0.5, 0.18]} rotation={[-0.5, 0, 0]}>
        <coneGeometry args={[0.18, 0.45, 4]} />
        <meshStandardMaterial color={'#f7d56a'} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* jewel */}
      <mesh castShadow position={[0, 0.72, 0.24]}>
        <icosahedronGeometry args={[0.09, 0]} />
        <meshStandardMaterial color={'#ff6a6a'} metalness={0.2} roughness={0.1} emissive={'#ff6a6a'} emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

function Sword() {
  return (
    <group position={[0.55, 0.6, 0.3]} rotation={[0, 0.35, -0.3]}>
      {/* blade */}
      <mesh castShadow>
        <boxGeometry args={[0.08, 1.1, 0.06]} />
        <meshStandardMaterial color={'#cfd7ff'} metalness={0.5} roughness={0.25} />
      </mesh>
      {/* guard */}
      <mesh castShadow position={[0, -0.55, 0]}>
        <boxGeometry args={[0.28, 0.08, 0.12]} />
        <meshStandardMaterial color={'#f4c04a'} metalness={0.7} roughness={0.35} />
      </mesh>
      {/* handle */}
      <mesh castShadow position={[0, -0.75, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.28, 12]} />
        <meshStandardMaterial color={'#6b3f1a'} roughness={0.7} />
      </mesh>
    </group>
  );
}

function QueenModel({ active = false }: { active?: boolean }) {
  // subtle breathing scale
  const scale = useMemo(() => (active ? 1.03 : 1.0), [active]);

  return (
    <group position={[0, -0.2, 0]} scale={scale}>
      {/* abdomen */}
      <mesh castShadow receiveShadow position={[0, -0.1, 0]}>
        <sphereGeometry args={[0.9, 32, 32]} />
        <meshStandardMaterial color={'#201a2e'} roughness={0.6} metalness={0.1} />
      </mesh>
      {/* thorax */}
      <mesh castShadow position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.55, 32, 32]} />
        <meshStandardMaterial color={'#26233c'} roughness={0.55} metalness={0.12} />
      </mesh>
      {/* head */}
      <mesh castShadow position={[0, 1.2, 0.05]}>
        <sphereGeometry args={[0.38, 32, 32]} />
        <meshStandardMaterial color={'#2e2546'} roughness={0.5} metalness={0.12} />
      </mesh>

      {/* eyes */}
      <mesh castShadow position={[-0.16, 1.23, 0.32]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={'#111'} />
      </mesh>
      <mesh castShadow position={[0.16, 1.23, 0.32]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={'#111'} />
      </mesh>

      {/* antennae */}
      <mesh castShadow position={[-0.22, 1.55, 0.0]} rotation={[0.6, 0.0, 0.4]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 12]} />
        <meshStandardMaterial color={'#2a203f'} roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0.22, 1.55, 0.0]} rotation={[0.6, 0.0, -0.4]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 12]} />
        <meshStandardMaterial color={'#2a203f'} roughness={0.6} />
      </mesh>

      {/* neck ruff */}
      <mesh castShadow position={[0, 0.95, 0]}>
        <torusGeometry args={[0.45, 0.12, 12, 24]} />
        <meshStandardMaterial color={'#e9e6f2'} roughness={0.9} />
      </mesh>

      <Crown />
      <Sword />
    </group>
  );
}

export default function Queen3D({ active = false }: Props) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      linear
      camera={{ position: [0, 1.6, 5.5], fov: 35 }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* lighting */}
      <ambientLight intensity={0.35} />
      {/* FIXED: use args instead of skyColor/groundColor props */}
      <hemisphereLight args={['#89a3ff', '#223355', 0.5]} />
      <spotLight position={[2.5, 3.5, 3]} angle={0.4} penumbra={0.3} intensity={1.2} castShadow />

      <Suspense fallback={null}>
        <QueenModel active={active} />
        {/* soft ground shadow */}
        <ContactShadows opacity={0.35} scale={5} blur={2.2} far={4} resolution={1024} />
        {/* subtle room reflections */}
        <Environment preset="city" />
        {/* glow */}
        <EffectComposer>
          <Bloom
            intensity={active ? 1.1 : 0.6}
            luminanceThreshold={0.28}
            luminanceSmoothing={0.55}
            radius={0.85}
          />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
