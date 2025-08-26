import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'

type PrizeDetail =
  | { title: string; type: 'crate'; rarity: 'common' | 'rare' | 'ultra'; label?: string }
  | { title: string; type: 'none' }

// ------- Stylized 3D ant (placeholder geometry) -------
function SamuraiAnt({ running, progress }: { running: boolean; progress: number }) {
  const group = useRef<THREE.Group>(null!)

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const amp = running ? 0.05 : 0.015
    const speed = running ? 6 : 2
    if (group.current) {
      group.current.position.y = 0.18 + Math.sin(t * speed) * amp
      group.current.rotation.z = Math.sin(t * speed * 0.5) * (running ? 0.06 : 0.02)
      const x = -2.2 + progress * 4.4
      group.current.position.x = x
    }
  })

  return (
    <group ref={group} position={[-2.2, 0.18, 0]}>
      <mesh castShadow position={[0, 0.12, 0]}>
        <sphereGeometry args={[0.18, 32, 32]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh castShadow position={[0.22, 0.22, 0]}>
        <sphereGeometry args={[0.16, 32, 32]} />
        <meshStandardMaterial color="#b45309" roughness={0.6} />
      </mesh>
      <mesh position={[0.28, 0.25, 0.08]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0.28, 0.25, -0.08]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.6} />
      </mesh>
      <mesh castShadow position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.22, 0.18, 0.22, 24]} />
        <meshStandardMaterial color="#2563eb" roughness={0.7} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 4]} position={[-0.06, 0.36, -0.04]}>
        <boxGeometry args={[0.36, 0.03, 0.03]} />
        <meshStandardMaterial color="#111827" metalness={0.2} roughness={0.4} />
      </mesh>
      <mesh position={[0.02, -0.02, 0.08]}>
        <boxGeometry args={[0.08, 0.04, 0.08]} />
        <meshStandardMaterial color="#b45309" />
      </mesh>
      <mesh position={[0.02, -0.02, -0.08]}>
        <boxGeometry args={[0.08, 0.04, 0.08]} />
        <meshStandardMaterial color="#b45309" />
      </mesh>
    </group>
  )
}

export default function Expedition3D() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [pct, setPct] = useState(0)

  const start = () => {
    if (running) return
    setRunning(true)
    setProgress(0)
    setPct(0)

    const dur = 5000
    const t0 = performance.now()

    const step = () => {
      const t = performance.now() - t0
      const p = Math.min(1, t / dur)
      setProgress(p)
      setPct(Math.round(p * 100))
      if (p < 1) requestAnimationFrame(step)
      else finish()
    }
    requestAnimationFrame(step)
  }

  async function finish() {
    try {
      // call the same API your 2D expedition used
      const res = await fetch('/api/expedition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: 'guest-' + Math.random().toString(36).slice(2, 8) }),
      })
      const data: any = await res.json()
      const payload = (data?.prize ?? data) as any

      let detail: PrizeDetail
      if (payload?.type === 'crate' && payload?.rarity) {
        detail = { title: 'You found:', type: 'crate', rarity: payload.rarity, label: payload.label }
      } else {
        detail = { title: 'You found:', type: 'none' }
      }

      window.dispatchEvent(new CustomEvent<PrizeDetail>('rebelants:prize', { detail }))
    } catch {
      window.dispatchEvent(
        new CustomEvent<PrizeDetail>('rebelants:prize', { detail: { title: 'You found:', type: 'none' } })
      )
    } finally {
      setTimeout(() => {
        setRunning(false)
        setProgress(0)
        setPct(0)
      }, 300)
    }
  }

  return (
    <section className="ant-card">
      <h2 className="title mb-2">Colony Forage Expedition</h2>
      <p className="subtitle mb-4">Send a samurai ant on a longer run. 5-second expedition with bigger rewards.</p>

      <div className="exp-wrap">
        <div className="exp-stage">
          <Canvas className="exp-canvas" dpr={[1, 2]} shadows camera={{ position: [0, 2.2, 5.5], fov: 45 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[3, 5, 2]} intensity={1.2} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
              <planeGeometry args={[8, 3]} />
              <meshStandardMaterial color="#0b1220" roughness={0.9} />
            </mesh>
            <Float speed={1.5} rotationIntensity={0.05} floatIntensity={0.02}>
              <mesh position={[0, 0.0, 0]}>
                <boxGeometry args={[4.6, 0.02, 0.08]} />
                <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.35} />
              </mesh>
            </Float>
            <SamuraiAnt running={running} progress={progress} />
          </Canvas>

          <div className="exp-ui">
            <div className="exp-bar">
              <div className="exp-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="exp-pct">{pct}%</div>
          </div>
        </div>

        <button className="btn btn-primary mt-4" onClick={start} disabled={running}>
          {running ? 'Marching…' : 'Start Expedition'}
        </button>
      </div>
    </section>
  )
}
