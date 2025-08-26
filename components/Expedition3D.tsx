import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import PrizeModal from './PrizeModal'

function SamuraiAnt({ running, progress }:{ running:boolean; progress:number }) {
  const group = useRef<THREE.Group>(null!)
  const t = useRef(0)

  // Bobbing / leg swing
  useFrame((state, dt) => {
    t.current += dt
    const g = group.current
    const x = THREE.MathUtils.lerp(-1.7, 1.7, progress) // track width
    const y = 0.12 + (running ? Math.sin(t.current*10)*0.04 : 0)
    if (g) g.position.set(x, y, 0)
    if (g) g.rotation.y = running ? Math.sin(t.current*4)*0.08 : 0
  })

  return (
    <group ref={group}>
      {/* body */}
      <mesh position={[0,0.15,0]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#ff7b00" metalness={0.1} roughness={0.7}/>
      </mesh>
      {/* head */}
      <mesh position={[0,0.3,0]}>
        <sphereGeometry args={[0.1, 24, 24]} />
        <meshStandardMaterial color="#ff9b2a" />
      </mesh>
      {/* eye visor */}
      <mesh position={[0.02,0.3,0.09]} rotation={[0,0,0]}>
        <planeGeometry args={[0.14,0.06]} />
        <meshBasicMaterial color="#111827" />
      </mesh>
      {/* kimono */}
      <mesh position={[0,0.09,0]} rotation={[0,0,0]}>
        <cylinderGeometry args={[0.09,0.13,0.14,24]} />
        <meshStandardMaterial color="#2563eb" metalness={0} roughness={1}/>
      </mesh>
      {/* feet */}
      <mesh position={[-0.05,0,0]}><boxGeometry args={[0.06,0.02,0.06]} /><meshStandardMaterial color="#ff7b00" /></mesh>
      <mesh position={[ 0.05,0,0]}><boxGeometry args={[0.06,0.02,0.06]} /><meshStandardMaterial color="#ff7b00" /></mesh>
      {/* katana */}
      <mesh position={[ -0.1,0.12,-0.02]} rotation={[0,0.4,0.1]}>
        <boxGeometry args={[0.22,0.01,0.01]} /><meshStandardMaterial color="#9ca3af" />
      </mesh>
    </group>
  )
}

export default function Expedition3D() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [modal, setModal] = useState({ open:false, label:'', sub:'' })

  // simple tween progress
  useEffect(() => {
    let id:number|undefined
    if (busy) {
      const start = performance.now()
      const run = () => {
        const pct = Math.min(1, (performance.now()-start)/5000)
        setProgress(pct)
        id = requestAnimationFrame(run)
        if (pct===1) {
          cancelAnimationFrame(id!)
          setBusy(false)
          setModal({ open:true, label:'Nothing this time', sub:'The wilds were quiet.' })
        }
      }
      id = requestAnimationFrame(run)
    }
    return () => { if (id) cancelAnimationFrame(id) }
  }, [busy])

  const lights = useMemo(() => (
    <>
      <ambientLight intensity={0.5}/>
      <directionalLight intensity={1} position={[2,3,2]}/>
    </>
  ), [])

  return (
    <section className="ant-card">
      <h2 className="title">Colony Forage Expedition</h2>
      <p className="subtitle mb-3">Send a samurai ant on a longer run. 5-second expedition with bigger rewards.</p>

      <div className="ant-scene">
        <Canvas orthographic camera={{ zoom: 180, position:[0,3,6] }}>
          {lights}
          {/* track plane */}
          <mesh rotation={[-Math.PI/2,0,0]} position={[0,0,0]}>
            <planeGeometry args={[5, 2]} />
            <meshStandardMaterial color="#0b122e" />
          </mesh>
          <SamuraiAnt running={busy} progress={progress} />
        </Canvas>

        {/* progress bar */}
        <div className="bar">
          <div className="bar-fill" style={{ width: `${Math.round(progress*100)}%` }} />
          <span className="bar-text">{Math.round(progress*100)}%</span>
        </div>
      </div>

      <div className="mt-3">
        <button className="btn" onClick={() => !busy && (setProgress(0), setBusy(true))} disabled={busy}>
          {busy ? 'Marching…' : 'Start Expedition'}
        </button>
      </div>

      <PrizeModal open={modal.open} onClose={() => setModal(m => ({...m, open:false}))} label={modal.label} sub={modal.sub} />
    </section>
  )
}
