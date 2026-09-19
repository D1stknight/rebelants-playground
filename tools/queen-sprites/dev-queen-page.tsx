// dev-only: render the static queen GLB on a transparent canvas for sprite frames (tools/queen-sprites)
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

function Q() {
  const { scene } = useGLTF("/models/queen/queen.glb") as any;
  const g = useRef<THREE.Group>(null!);
  const { gl, camera } = useThree();
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene); const size = new THREE.Vector3(); box.getSize(size); const c = new THREE.Vector3(); box.getCenter(c);
    scene.position.sub(c); scene.position.y += size.y / 2; // feet at y=0, centred
    const w = window as any;
    w.__setY = (ry: number) => { g.current.rotation.y = ry; };
    w.__cam = (h: number, tilt = 0) => { const cam = camera as THREE.PerspectiveCamera; cam.fov = 22; const d = (size.y * 1.15) / (2 * Math.tan((cam.fov * Math.PI) / 360)); cam.position.set(0, size.y * 0.5 + tilt, d); cam.lookAt(0, size.y * 0.5, 0); cam.updateProjectionMatrix(); void h; };
    w.__shot = () => { gl.render((g.current as any).parent, camera); return gl.domElement.toDataURL("image/png"); };
    w.__size = [size.x, size.y, size.z];
    w.__cam(0);
    w.__ready = true;
  }, [scene, gl, camera]);
  return <group ref={g}><primitive object={scene} /></group>;
}

export default function QueenDev() {
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
