// dev-only (copy to pages/dev/qrig.tsx): render the rigged queen (public/models/queen/queen_rig.glb, built by rig_queen.py)
// with the same camera + lights as dev-queen-page.tsx, so frames line up with the face layers painted on q_front.png.
// window.__pose({ bone: [rx, ry, rz] degrees, … }) poses bones relative to rest; __shot() → PNG; __gem() → staff-top px.
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

function Q() {
  const { scene } = useGLTF("/models/queen/queen_rig.glb") as any;
  const g = useRef<THREE.Group>(null!);
  const { gl, camera } = useThree();
  useEffect(() => {
    const bones: Record<string, THREE.Bone> = {}; const rest: Record<string, THREE.Quaternion> = {};
    scene.traverse((o: any) => { if (o.isBone) { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); } if (o.isMesh) o.frustumCulled = false; });
    const box = new THREE.Box3().setFromObject(scene); const size = new THREE.Vector3(); box.getSize(size); const c = new THREE.Vector3(); box.getCenter(c);
    scene.position.sub(c); scene.position.y += size.y / 2;
    const w = window as any;
    w.__bones = Object.keys(bones);
    w.__pose = (p: Record<string, number[]>) => {
      for (const n of Object.keys(bones)) bones[n].quaternion.copy(rest[n]);
      for (const [n, r] of Object.entries(p)) { const b = bones[n]; if (!b) continue; const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180, "XYZ")); b.quaternion.copy(rest[n]).multiply(q); }
      scene.updateMatrixWorld(true);
    };
    const cam = camera as THREE.PerspectiveCamera; cam.fov = 22; const d = (size.y * 1.15) / (2 * Math.tan((cam.fov * Math.PI) / 360)); cam.position.set(0, size.y * 0.5, d); cam.lookAt(0, size.y * 0.5, 0); cam.updateProjectionMatrix();
    // staff top: a point rigidly attached to hand.R (the gem centre in rest pose)
    const gemRest = new THREE.Vector3(-0.209, 0.735, 0.12); // three coords (x, y, z=-blender y) relative to the centred model
    let gemLocal: THREE.Vector3 | null = null;
    w.__gem = () => { const h = bones["handR"]; if (!h) return null; if (!gemLocal) { w.__pose({}); gemLocal = h.worldToLocal(gemRest.clone()); } const p = h.localToWorld(gemLocal.clone()); p.project(cam); return [(p.x * 0.5 + 0.5) * 1024, (-p.y * 0.5 + 0.5) * 1024]; };
    w.__shot = () => { gl.render((g.current as any).parent, camera); return gl.domElement.toDataURL("image/png"); };
    w.__ready = true;
  }, [scene, gl, camera]);
  return <group ref={g}><primitive object={scene} /></group>;
}

export default function QueenRigDev() {
  return (
    <div style={{ width: 1024, height: 1024, background: "transparent" }}>
      <Canvas gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }} dpr={1} camera={{ position: [0, 1, 3], fov: 22 }} style={{ background: "transparent" }} onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}>
        <ambientLight intensity={1.1} />
        <hemisphereLight color={"#cfe0ff"} groundColor={"#3a2a20"} intensity={0.6} />
        <directionalLight position={[2.5, 4, 3]} intensity={1.8} />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} color={"#ffd9a0"} />
        <Q />
      </Canvas>
    </div>
  );
}
