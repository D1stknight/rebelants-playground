// components/Queen3D.tsx
import * as THREE from 'three';
import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Float } from '@react-three/drei';

type Props = { active?: boolean };

export default function Queen3D({ active = false }: Props) {
  // Absolutely position the canvas in the shuffle scene, clicks pass through
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 12, pointerEvents: 'none' }}>
      <Canvas
        dpr={[1, 2]}
        shadows
        camera={{ position: [0, 0.65, 3.1], fov: 32 }}
      >
        <Scene active={active} />
      </Canvas>
    </div>
  );
}

/** tiny 3‑tone gradient texture for MeshToonMaterial (no external files) */
function useToonGradient() {
  return useMemo(() => {
    const stops = [new THREE.Color('#24171b'), new THREE.Color('#6b3e2b'), new THREE.Color('#ffe3a3')];
    const data = new Uint8Array(stops.length * 3);
    stops.forEach((c, i) => {
      data[i * 3 + 0] = Math.round(c.r * 255);
      data[i * 3 + 1] = Math.round(c.g * 255);
      data[i * 3 + 2] = Math.round(c.b * 255);
    });
    const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBFormat);
    tex.needsUpdate = true;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);
}

function Scene({ active }: Props) {
  return (
    <>
      {/* soft sky/ground light + a rim light from behind */}
      <hemisphereLight args={['#89a3ff', '#223355', 0.35]} />
      <directionalLight
        position={[2.2, 2.2, 2.5]}
        intensity={0.9}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-3, 1.5, -2]} intensity={0.65} color="#a2d5ff" />

      <Float
        floatIntensity={active ? 1.4 : 0.6}
        rotationIntensity={active ? 0.6 : 0.25}
        speed={active ? 1.5 : 0.9}
      >
        <group position={[0, -0.25, 0]}>
          <Throne />
          <QueenModel active={active} />
        </group>
      </Float>

      <ContactShadows
        opacity={0.35}
        scale={6}
        blur={2.2}
        far={4}
        resolution={1024}
        position={[0, -0.3, 0]}
      />
    </>
  );
}

function Throne() {
  const gold = new THREE.Color('#d49b2e');
  const red = new THREE.Color('#6b1d1d');
  return (
    <group position={[0, -0.05, -0.45]}>
      {/* back panel */}
      <mesh castShadow receiveShadow position={[0, 0.65, -0.1]}>
        <boxGeometry args={[1.2, 1.3, 0.12]} />
        <meshToonMaterial color={red} />
      </mesh>
      {/* frame */}
      <mesh castShadow receiveShadow position={[0, 0.65, -0.12]}>
        <boxGeometry args={[1.26, 1.36, 0.18]} />
        <meshToonMaterial color={gold} />
      </mesh>
      {/* seat */}
      <mesh castShadow receiveShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[0.9, 0.18, 0.9]} />
        <meshToonMaterial color={gold} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.14, 0]}>
        <boxGeometry args={[0.86, 0.12, 0.86]} />
        <meshToonMaterial color={red} />
      </mesh>
    </group>
  );
}

function QueenModel({ active = false }: Props) {
  const gradient = useToonGradient();
  const group = useRef<THREE.Group>(null!);

  // idle breathe + slight bob
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.getElapsedTime();
    const amp = active ? 0.03 : 0.015;
    group.current.position.y = Math.sin(t * 2) * amp;
    group.current.rotation.x = Math.sin(t * 1.6) * (active ? 0.08 : 0.04);
  });

  return (
    <group ref={group} position={[0, 0.1, 0]}>
      {/* Warm aura disc behind her */}
      <mesh position={[0, 0.25, -0.35]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.1, 48]} />
        <meshBasicMaterial transparent opacity={0.5} color={'#ffdf8a'} />
      </mesh>

      {/* --- Body with chibi proportions --- */}
      {/* abdomen */}
      <mesh castShadow position={[0, -0.05, 0]}>
        <sphereGeometry args={[0.48, 32, 32]} />
        <meshToonMaterial color={'#3d2318'} gradientMap={gradient} />
      </mesh>
      {/* thorax */}
      <mesh castShadow position={[0, 0.22, 0.05]} scale={[0.9, 0.8, 0.9]}>
        <sphereGeometry args={[0.36, 32, 32]} />
        <meshToonMaterial color={'#4c2b1c'} gradientMap={gradient} />
      </mesh>
      {/* head (big!) */}
      <mesh castShadow position={[0, 0.55, 0.08]} scale={[1.1, 1, 1.05]}>
        <sphereGeometry args={[0.42, 32, 32]} />
        <meshToonMaterial color={'#4a2c1c'} gradientMap={gradient} />
      </mesh>

      {/* eyes */}
      <group position={[0, 0.55, 0.42]}>
        <Eye x={-0.18} />
        <Eye x={0.18} />
      </group>

      {/* antennae */}
      <Antenna side={-1} />
      <Antenna side={1} />

      {/* collar */}
      <mesh castShadow position={[0, 0.36, 0.1]} scale={[1.2, 0.35, 1.2]}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshToonMaterial color={'#fff3cc'} gradientMap={gradient} />
      </mesh>

      {/* crown + gem */}
      <Crown gradient={gradient} />

      {/* sword */}
      <Sword />
    </group>
  );
}

function Eye({ x = 0 }: { x?: number }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial color={'#121214'} roughness={0.25} metalness={0.1} />
      </mesh>
      {/* highlight */}
      <mesh position={[-0.03, 0.03, 0.05]} scale={[0.3, 0.3, 0.3]}>
        <sphereGeometry args={[0.11, 16, 16]} />
        <meshBasicMaterial color={'white'} />
      </mesh>
    </group>
  );
}

function Antenna({ side = 1 }: { side?: number }) {
  const gradient = useToonGradient();
  const curve = useMemo(() => {
    const s = side;
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.18, 0.65, 0.05),
      new THREE.Vector3(s * 0.28, 0.85, 0.0),
      new THREE.Vector3(s * 0.15, 1.0, 0.05),
    ]);
  }, [side]);
  const geom = useMemo(() => new THREE.TubeGeometry(curve, 32, 0.03, 8, false), [curve]);
  return (
    <mesh castShadow geometry={geom}>
      <meshToonMaterial color={'#2a1811'} gradientMap={gradient} />
    </mesh>
  );
}

function Crown({ gradient }: { gradient: THREE.Texture }) {
  return (
    <group position={[0, 0.82, 0.0]}>
      {/* band */}
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.32, 0.06, 12, 64]} />
        <meshToonMaterial color={'#f0c44a'} gradientMap={gradient} />
      </mesh>
      {/* prongs */}
      {[-0.22, 0, 0.22].map((x, i) => (
        <mesh key={i} castShadow position={[x, -0.02, 0.0]}>
          <coneGeometry args={[0.1, 0.22, 12]} />
          <meshToonMaterial color={'#f0c44a'} gradientMap={gradient} />
        </mesh>
      ))}
      {/* gem */}
      <mesh castShadow position={[0, 0.12, 0.02]}>
        <octahedronGeometry args={[0.08, 0]} />
        <meshStandardMaterial
          color={'#ff5577'}
          emissive={'#ff88aa'}
          emissiveIntensity={0.3}
          roughness={0.2}
          metalness={0.2}
        />
      </mesh>
    </group>
  );
}

function Sword() {
  return (
    <group position={[-0.42, 0.35, 0.2]} rotation={[0, 0, -0.5]}>
      {/* blade */}
      <mesh castShadow>
        <boxGeometry args={[0.06, 0.6, 0.04]} />
        <meshStandardMaterial color={'#d9dee7'} metalness={0.8} roughness={0.35} />
      </mesh>
      {/* guard */}
      <mesh castShadow position={[0, -0.34, 0]}>
        <boxGeometry args={[0.16, 0.04, 0.06]} />
        <meshToonMaterial color={'#e2b34e'} />
      </mesh>
      {/* handle */}
      <mesh castShadow position={[0, -0.46, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.25, 10]} />
        <meshToonMaterial color={'#2e2e2e'} />
      </mesh>
    </group>
  );
}
