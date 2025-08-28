// components/Queen3D.tsx
'use client';

import React, { useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

function QueenModel({ active = false }: { active?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Mesh>(null);
  const wingR = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const bobAmp = active ? 0.06 : 0.02;
    if (group.current) group.current.position.y = Math.sin(t * 2) * bobAmp;
    const flap = Math.sin(t * 8) * 0.35;
    if (wingL.current) wingL.current.rotation.z = 0.45 + flap;
    if (wingR.current) wingR.current.rotation.z = -0.45 - flap;
  });

  return (
    <group ref={group} position={[0, 0.05, 0]} scale={1.2}>
      {/* --- throne (simple, stylized) --- */}
      <group position={[0, -0.05, -0.22]}>
        <mesh position={[0, -0.26, 0]}>
          <boxGeometry args={[1.3, 0.28, 0.3]} />
          <meshStandardMaterial color="#3b1d02" metalness={0.1} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.45, 0]}>
          <boxGeometry args={[1.05, 0.95, 0.26]} />
          <meshStandardMaterial color="#4b2303" metalness={0.15} roughness={0.85} />
        </mesh>
        <mesh position={[0, 1.0, 0]}>
          <torusGeometry args={[0.72, 0.06, 16, 64]} />
          <meshStandardMaterial color="#c48a1d" metalness={0.6} roughness={0.35} />
        </mesh>
      </group>

      {/* --- body segments --- */}
      <mesh position={[0, -0.02, 0.12]} castShadow>
        <sphereGeometry args={[0.46, 48, 48]} />
        <meshStandardMaterial color="#3a2a1d" metalness={0.2} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.32, 0]} castShadow>
        <sphereGeometry args={[0.31, 48, 48]} />
        <meshStandardMaterial color="#2b1e14" metalness={0.2} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.62, 0.02]} castShadow>
        <sphereGeometry args={[0.23, 48, 48]} />
        <meshStandardMaterial color="#1d120b" metalness={0.15} roughness={0.9} />
      </mesh>

      {/* eyes */}
      <mesh position={[0.12, 0.64, 0.23]}>
        <sphereGeometry args={[0.06, 24, 24]} />
        <meshStandardMaterial color="#111922" emissive="#0a0d10" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[-0.12, 0.64, 0.23]}>
        <sphereGeometry args={[0.06, 24, 24]} />
        <meshStandardMaterial color="#111922" emissive="#0a0d10" emissiveIntensity={0.35} />
      </mesh>

      {/* crown */}
      <group position={[0, 0.82, 0]}>
        <mesh position={[0, 0.08, 0]}>
          <torusGeometry args={[0.17, 0.05, 16, 64]} />
          <meshStandardMaterial color="#f3c64b" metalness={0.92} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.25, 0]}>
          <coneGeometry args={[0.16, 0.24, 5]} />
          <meshStandardMaterial color="#f6dc7a" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.25, 0.12]}>
          <sphereGeometry args={[0.06, 24, 24]} />
          <meshStandardMaterial color="#ff546b" emissive="#ff546b" emissiveIntensity={0.8} />
        </mesh>
      </group>

      {/* wings */}
      <mesh ref={wingL} position={[-0.24, 0.38, -0.02]} rotation={[0, 0, 0.5]} castShadow>
        <planeGeometry args={[0.5, 0.3]} />
        <meshPhysicalMaterial color="#cfe9ff" transparent opacity={0.28} transmission={0.15} roughness={0.35} />
      </mesh>
      <mesh ref={wingR} position={[0.24, 0.38, -0.02]} rotation={[0, 0, -0.5]} castShadow>
        <planeGeometry args={[0.5, 0.3]} />
        <meshPhysicalMaterial color="#cfe9ff" transparent opacity={0.28} transmission={0.15} roughness={0.35} />
      </mesh>

      {/* sword (simple) */}
      <group position={[0.36, 0.4, 0.14]} rotation={[0, 0, -0.45]}>
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.06, 0.3, 0.06]} />
          <meshStandardMaterial color="#c9cfe0" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[0, -0.03, 0]} castShadow>
          <boxGeometry args={[0.18, 0.06, 0.06]} />
          <meshStandardMaterial color="#c48a1d" metalness={0.85} roughness={0.25} />
        </mesh>
      </group>

      {/* antennae */}
      <mesh position={[0.13, 0.83, 0.02]} rotation={[0, 0, 0.9]}>
        <cylinderGeometry args={[0.01, 0.01, 0.34, 12]} />
        <meshStandardMaterial color="#2b1e14" />
      </mesh>
      <mesh position={[-0.13, 0.83, 0.02]} rotation={[0, 0, -0.9]}>
        <cylinderGeometry args={[0.01, 0.01, 0.34, 12]} />
        <meshStandardMaterial color="#2b1e14" />
      </mesh>
    </group>
  );
}

function Scene({ active }: { active: boolean }) {
  return (
    <>
      {/* lighting */}
      <ambientLight intensity={0.35} />
      <hemisphereLight skyColor={'#89a3ff'} groundColor={'#223355'} intensity={0.5} />
      <spotLight position={[2.5, 3.5, 3]} angle={0.4} penumbra={0.3} intensity={1.2} castShadow />
      <QueenModel active={active} />
      <ContactShadows opacity={0.35} scale={5} blur={2.2} far={4} resolution={1024} />
      <EffectComposer>
        <Bloom intensity={0.6} luminanceThreshold={0.25} luminanceSmoothing={0.15} />
      </EffectComposer>
    </>
  );
}

export default function Queen3D({ active = false }: { active?: boolean }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 1.2, 3.2], fov: 35 }}
      gl={{ antialias: true, physicallyCorrectLights: true }}
    >
      <Scene active={active} />
    </Canvas>
  );
}
