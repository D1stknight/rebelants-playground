import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';

type Prize =
  | { type: 'crate'; label: 'Common Crate' | 'Rare Crate' | 'Ultra Loot Crate'; rarity: 'common' | 'rare' | 'ultra' }
  | { type: 'none'; label: 'Nothing this time' };

type ModalState = { title: string; text?: string } | null;

/** ---------- Tiny 3D Samurai Ant made from simple meshes (placeholder until GLB) ---------- */
type SamuraiAntProps = { running: boolean; progress: number };
function SamuraiAnt({ running, progress }: SamuraiAntProps) {
  const group = useRef<THREE.Group>(null!);
  const bob = useRef(0);

  // body pieces
  const mats = useMemo(() => {
    return {
      body: new THREE.MeshStandardMaterial({ color: 0x7a4b21, metalness: 0.2, roughness: 0.7 }),
      eye: new THREE.MeshStandardMaterial({ color: 0xff3a2f, emissive: 0x7a140f, emissiveIntensity: 0.7 }),
      cloth: new THREE.MeshStandardMaterial({ color: 0x2f6fff, metalness: 0.1, roughness: 0.9 }),
      sword: new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8, roughness: 0.25 })
    };
  }, []);

  const geom = useMemo(() => {
    return {
      head: new THREE.SphereGeometry(0.35, 24, 24),
      eye: new THREE.SphereGeometry(0.09, 16, 16),
      torso: new THREE.SphereGeometry(0.28, 18, 18),
      limb: new THREE.CapsuleGeometry(0.06, 0.24, 8, 16),
      sword: new THREE.BoxGeometry(0.5, 0.03, 0.03),
      handle: new THREE.CylinderGeometry(0.04, 0.04, 0.15, 12)
    };
  }, []);

  useFrame((_state, delta) => {
    // subtle breathing / bobbing
    bob.current += delta * (running ? 6 : 2);
    const y = Math.sin(bob.current) * 0.03 + (running ? 0.02 : 0);
    if (group.current) {
      group.current.position.y = y;
      // run wobble
      const wobble = running ? Math.sin(bob.current * 2) * 0.15 : 0;
      group.current.rotation.z = wobble;
    }
  });

  // horizontal position follows progress (0..1) inside the canvas logical width
  useEffect(() => {
    if (!group.current) return;
    // canvas scene is -3..3 on X; keep ant inside ~[-2.6, 2.6]
    const min = -2.6;
    const max = 2.6;
    const x = min + (max - min) * progress;
    group.current.position.x = x;
  }, [progress]);

  return (
    <group ref={group} position={[-2.6, 0, 0]}>
      {/* head */}
      <mesh geometry={geom.head} material={mats.body} position={[0, 0.55, 0]} />
      {/* eyes */}
      <mesh geometry={geom.eye} material={mats.eye} position={[-0.13, 0.55, 0.28]} />
      <mesh geometry={geom.eye} material={mats.eye} position={[0.13, 0.55, 0.28]} />
      {/* antennae */}
      <mesh material={mats.body} position={[-0.2, 0.95, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.45, 10]} />
        <meshStandardMaterial color={0x7a4b21} />
      </mesh>
      <mesh material={mats.body} position={[0.2, 0.95, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.45, 10]} />
        <meshStandardMaterial color={0x7a4b21} />
      </mesh>

      {/* torso / gi */}
      <mesh geometry={geom.torso} material={mats.cloth} position={[0, 0.2, 0]} />
      {/* arms (swing when running) */}
      <group position={[0, 0.25, 0]} rotation={[0, 0, Math.sin(bob.current) * 0.2]}>
        <mesh geometry={geom.limb} material={mats.body} position={[-0.35, 0, 0]} rotation={[0, 0, 0.9]} />
        <mesh geometry={geom.limb} material={mats.body} position={[0.35, 0, 0]} rotation={[0, 0, -0.9]} />
      </group>

      {/* legs */}
      <mesh geometry={geom.limb} material={mats.body} position={[-0.12, -0.15, 0]} rotation={[0, 0, 0.2]} />
      <mesh geometry={geom.limb} material={mats.body} position={[0.12, -0.15, 0]} rotation={[0, 0, -0.2]} />

      {/* katana on back */}
      <mesh geometry={geom.sword} material={mats.sword} position={[0, 0.45, -0.2]} rotation={[0, 0.8, 0.1]} />
      <mesh geometry={geom.handle} material={mats.sword} position={[-0.2, 0.4, -0.22]} rotation={[0, 0, Math.PI / 2]} />
    </group>
  );
}

/** ---------- Ground + progress rail ---------- */
function Rail({ progress }: { progress: number }) {
  const rail = useRef<THREE.Mesh>(null!);
  const glow = useRef<THREE.Mesh>(null!);

  useEffect(() => {
    if (!glow.current) return;
    // scale glow along X based on progress
    glow.current.scale.x = Math.max(0.001, progress);
    // move origin so it fills left-to-right
    glow.current.position.x = -2.6 + 5.2 * (progress / 2);
  }, [progress]);

  return (
    <group position={[0, -0.75, 0]}>
      <mesh ref={rail} position={[0, 0, 0]}>
        <boxGeometry args={[5.2, 0.06, 0.2]} />
        <meshStandardMaterial color={0x2a3344} roughness={0.9} />
      </mesh>
      <mesh ref={glow} position={[-2.6, 0.01, 0]}>
        <boxGeometry args={[5.2, 0.04, 0.18]} />
        <meshStandardMaterial color={0x22cc88} emissive={0x22cc88} emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

/** ---------- The 3D scene canvas ---------- */
function ExpeditionScene({ running, progress }: { running: boolean; progress: number }) {
  return (
    <Canvas
      camera={{ position: [0, 0.6, 4], fov: 45 }}
      style={{ width: '100%', height: 260, borderRadius: 12 }}
      gl={{ antialias: true }}
    >
      {/* lights */}
      <hemisphereLight args={[0x88aaff, 0x223355, 0.6]} />
      <directionalLight position={[3, 3, 3]} intensity={1.2} />
      <directionalLight position={[-3, 2, 1]} intensity={0.3} />

      {/* background plane with soft gradient */}
      <mesh position={[0, 0, -1]}>
        <planeGeometry args={[8, 3]} />
        <meshBasicMaterial color={0x0f1623} />
      </mesh>

      <Rail progress={progress} />
      <SamuraiAnt running={running} progress={progress} />

      {/* HUD % label */}
      <Html position={[0, 0.95, 0]} center>
        <div style={{ color: '#cbd5e1', fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif' }}>
          {Math.round(progress * 100)}%
        </div>
      </Html>
    </Canvas>
  );
}

/** ---------- UI wrapper + game logic ---------- */
export default function Expedition3D() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [seed] = useState('guest-' + Math.random().toString(36).slice(2, 8));
  const [modal, setModal] = useState<ModalState>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setModal(null);
    setProgress(0);

    // simple 5s tween (60fps-ish)
    const start = performance.now();
    const duration = 5200;
    let raf = 0;
    const tick = (t: number) => {
      const e = Math.min(1, (t - start) / duration);
      // ease in-out
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * e);
      setProgress(eased);
      if (e < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    // call API while the animation runs
    let prize: Prize = { type: 'none', label: 'Nothing this time' };
    try {
      const res = await fetch('/api/expedition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed })
      }).then((r) => r.json());
      prize = res?.prize ?? prize;
    } catch (e) {
      // ignore network errors (show "nothing this time")
    }

    // wait to finish bar
    await new Promise((r) => setTimeout(r, duration));
    cancelAnimationFrame(raf);
    setProgress(1);

    if (prize.type === 'crate') {
      setModal({ title: prize.label });
    } else {
      setModal({ title: 'Nothing this time' });
    }

    // small reset pause
    await new Promise((r) => setTimeout(r, 600));
    setProgress(0);
    setBusy(false);
  }

  return (
    <section className="ant-card">
      <h2 className="title mb-2">Colony Forage Expedition</h2>
      <p className="subtitle mb-4">Send a samurai ant on a longer run. 5-second expedition with bigger rewards.</p>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <ExpeditionScene running={busy} progress={progress} />
      </div>

      <button disabled={busy} onClick={run} className="btn btn-primary mt-5">
        {busy ? 'Exploring…' : 'Start Expedition'}
      </button>

      {modal && (
        <div className="modal" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="title mb-1">You found:</h3>
            <p className="subtitle">{modal.title}</p>
            <button className="btn mt-4" onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
