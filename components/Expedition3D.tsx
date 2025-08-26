// components/Expedition3D.tsx
'use client'
// @ts-nocheck

import React, { useRef, useState, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Float, Html } from '@react-three/drei'
import * as THREE from 'three'
import PrizeModal from './PrizeModal'

/** ------- Simple prize fetch (reuses your existing API) ------- */
async function getPrize(seed: string) {
  const res = await fetch('/api/expedition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed })
  })
  return res.json()
}

/** ------- 3D Ant made from simple shapes (placeholder until GLB) ------- */
function SamuraiAnt({ running, progress }) {
  const group = useRef()
  const t = useRef(0)

  useFrame((_, delta) => {
    t.current += delta * (running ? 6 : 1)
    if (!group.current) return

    // Bob + tiny tilt to feel alive
    const bob = Math.sin(t.current * 6) * 0.06
    group.current.position.y = 0.22 + bob
    group.current.rotation.z = Math.sin(t.current * 2) * 0.06

    // Move across X from -1.9 → 1.9
    const x = THREE.MathUtils.lerp(-1.9, 1.9, progress)
    group.current.position.x = x
  })

  return (
    <group ref={group} position={[-1.9, 0.22, 0]} castShadow>
      {/* Body */}
      <mesh castShadow>
        <sphereGeometry args={[0.18, 32, 32]} />
        <meshStandardMaterial color={'#ffb257'} metalness={0.1} roughness={0.45} />
      </mesh>

      {/* Head */}
      <mesh position={[0.0, 0.22, 0]} castShadow>
        <sphereGeometry args={[0.14, 32, 32]} />
        <meshStandardMaterial color={'#ffb257'} metalness={0.1} roughness={0.45} />
      </mesh>

      {/* Kimono (torso wrap) */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.22, 24]} />
        <meshStandardMaterial color={'#3c6ff7'} metalness={0} roughness={0.8} />
      </mesh>

      {/* Katana on back */}
      <mesh position={[0.08, 0.23, -0.05]} rotation={[Math.PI * 0.07, 0.2, -0.2]}>
        <boxGeometry args={[0.02, 0.36, 0.02]} />
        <meshStandardMaterial color={'#222'} />
      </mesh>
      <mesh position={[0.0, 0.23, -0.07]} rotation={[Math.PI * 0.07, 0.15, 0.1]}>
        <boxGeometry args={[0.02, 0.34, 0.02]} />
        <meshStandardMaterial color={'#222'} />
      </mesh>

      {/* Legs (6 quick cylinders that wiggle while running) */}
      {[ -0.12, -0.06, 0.0, 0.06, 0.12, 0.18 ].map((x, i) => (
        <Leg key={i} x={x} running={running} phase={i * 0.5} />
      ))}
    </group>
  )
}

function Leg({ x = 0, running, phase = 0 }) {
  const ref = useRef()
  useFrame((_, delta) => {
    if (!ref.current) return
    const t = performance.now() / 1000 + phase
    const a = running ? Math.sin(t * 12) * 0.55 : 0
    ref.current.rotation.x = -Math.PI / 2 + a
  })
  return (
    <mesh ref={ref} position={[x, 0.02, 0.1]} castShadow>
      <cylinderGeometry args={[0.015, 0.01, 0.26, 10]} />
      <meshStandardMaterial color={'#2a2222'} roughness={0.6} />
    </mesh>
  )
}

/** ------- Track, glow, markers ------- */
function Track() {
  return (
    <group>
      {/* Base slab */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[4.2, 0.04, 0.62]} />
        <meshStandardMaterial color={'#0f1a2d'} roughness={0.95} />
      </mesh>

      {/* Emissive line */}
      <mesh position={[0, 0.025, 0]}>
        <boxGeometry args={[4.0, 0.01, 0.04]} />
        <meshStandardMaterial color={'#0ff'} emissive={'#00d9ff'} emissiveIntensity={1.2} />
      </mesh>

      {/* Markers */}
      {[-1.4, -0.35, 0.7, 1.75].map((x, i) => (
        <mesh key={i} position={[x, 0.03, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.02, 18]} />
          <meshStandardMaterial color={'#7ef7c1'} emissive={'#7ef7c1'} emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

/** ------- Scene container ------- */
function ExpeditionScene({ running, progress }: { running: boolean; progress: number }) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 1.4, 3.4], fov: 40 }}
      gl={{ antialias: true }}
      style={{ width: '100%', height: 340, borderRadius: 12 }}
    >
      {/* soft background */}
      <color attach="background" args={['#0a1220']} />
      <fog attach="fog" args={['#0a1220', 6, 12]} />

      {/* lights */}
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[4, 5, 3]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <hemisphereLight color={'#7ab8ff'} groundColor={'#09111d'} intensity={0.4} />

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color={'#0b1526'} roughness={1} metalness={0} />
      </mesh>

      <Float floatIntensity={0.2} rotationIntensity={0.02}>
        <Track />
      </Float>

      <SamuraiAnt running={running} progress={progress} />

      {/* soft environment */}
      <Environment preset="city" />
    </Canvas>
  )
}

/** ------- UI wrapper reusing your modal ------- */
export default function Expedition3D() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)    // 0..1 for the 3D scene
  const [modal, setModal] = useState<{ title: string; text?: string; rarity?: 'common'|'rare'|'ultra' } | null>(null)
  const seed = useMemo(() => 'guest-' + Math.random().toString(36).slice(2, 8), [])

  async function run() {
    if (busy) return
    setBusy(true)
    setModal(null)
    setProgress(0)

    const duration = 5_000 // 5s
    const start = performance.now()

    // animate locally
    const step = () => {
      const now = performance.now()
      const t = Math.min(1, (now - start) / duration)
      setProgress(t)
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)

    // wait for duration, then get prize
    await new Promise(r => setTimeout(r, duration + 100))
    const result = await getPrize(seed)
    const p = result?.prize

    if (p?.type === 'crate') {
      setModal({ title: p.label, rarity: p.rarity })
    } else {
      setModal({ title: 'Nothing this time', text: 'Try again soon!' })
    }
    setBusy(false)
  }

  return (
    <section className="ant-card">
      <h2 className="title mb-2">Colony Forage Expedition</h2>
      <p className="subtitle mb-4">Send a samurai ant on a longer run. 5-second expedition with bigger rewards.</p>

      <div className="exp-card">
        <ExpeditionScene running={busy} progress={progress} />
      </div>

      <button className="btn btn-primary mt-4" onClick={run} disabled={busy}>
        {busy ? 'Marching…' : 'Start Expedition'}
      </button>

      {modal && (
        <PrizeModal
          title={modal.title}
          rarity={modal.rarity}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  )
}
