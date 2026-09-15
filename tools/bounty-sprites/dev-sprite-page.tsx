import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF, useFBX } from "@react-three/drei";
import { AnimationMixer, Box3, BoxGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

function Rig({ fid }: { fid: string }) {
  const gltf = useGLTF(`/faction-wars/characters/${fid}/${fid}.glb`) as any;
  const idle = useFBX(`/faction-wars/characters/${fid}/idle.fbx`) as any;
  const attack = useFBX(`/faction-wars/characters/${fid}/attack.fbx`) as any;
  const lose = useFBX(`/faction-wars/characters/${fid}/lose.fbx`) as any;
  const hit = useFBX(`/faction-wars/characters/${fid}/hit.fbx`) as any;
  const { gl, scene, camera } = useThree();
  const ref = useRef<Object3D | null>(null);
  useEffect(() => {
    const s = clone(gltf.scene);
    s.traverse((o: any) => { if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m: any) => { if (m) { m.side = DoubleSide; } }); } });
    scene.add(s); ref.current = s;
    const bones: Record<string, any> = {}; s.traverse((o: any) => { if (o.isBone) bones[o.name.replace("mixamorig_", "").replace("mixamorig", "")] = o; });
    (window as any).__bones = Object.keys(bones);
    // blaster prop on the right hand
    const gun = new Group();
    const gm = new MeshStandardMaterial({ color: "#5c6170", metalness: 0.2, roughness: 0.6 }); const gm2 = new MeshStandardMaterial({ color: "#ff9a3c", emissive: "#ff6a00", emissiveIntensity: 0.6 });
    const barrel = new Mesh(new BoxGeometry(50, 10, 10), gm); barrel.position.set(22, 0, 0); gun.add(barrel);
    const body = new Mesh(new BoxGeometry(20, 15, 12), gm); body.position.set(0, -3, 0); gun.add(body);
    const tip = new Mesh(new BoxGeometry(7, 8, 8), gm2); tip.position.set(46, 0, 0); gun.add(tip);
    gun.visible = false; bones.RightHand?.add(gun);
    (window as any).__gun = (on: boolean, rx = 0, ry = 0, rz = 0, ox = 0, oy = 0, oz = 0) => { gun.visible = on; gun.rotation.set(rx, ry, rz); gun.position.set(ox, oy, oz); s.updateMatrixWorld(true); };
    // bake rest pose from idle frame 0 via a mixer
    const retarget = (clip: any) => { const c = clip.clone(); c.tracks = c.tracks.map((t: any) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; }).filter((t: any) => t.name.endsWith(".quaternion")); return c; };
    const mixer = new AnimationMixer(s);
    const clips: any = { idle: retarget(idle.animations[0]), attack: retarget(attack.animations[0]), lose: retarget(lose.animations[0]), hit: retarget(hit.animations[0]) };
    let action: any = null;
    (window as any).__clip = (name: string, t: number) => { if (action) action.stop(); action = mixer.clipAction(clips[name]); action.play(); action.time = t; mixer.update(0); s.updateMatrixWorld(true); };
    (window as any).__rot = (bone: string, x: number, y: number, z: number, add = true) => { const b = bones[bone]; if (!b) return "nobone " + bone; if (add) { b.rotation.x += x; b.rotation.y += y; b.rotation.z += z; } else b.rotation.set(x, y, z); s.updateMatrixWorld(true); return "ok"; };
    (window as any).__pos = (bone: string, x: number, y: number, z: number) => { const b = bones[bone]; if (!b) return; b.position.x += x; b.position.y += y; b.position.z += z; s.updateMatrixWorld(true); };
    (window as any).__fit = (h: number) => {
      s.updateMatrixWorld(true); const box = new Box3().setFromObject(s); const size = new Vector3(); box.getSize(size); const c = new Vector3(); box.getCenter(c);
      const cam = camera as any; cam.left = -h * 0.5; cam.right = h * 0.5; cam.top = h * 0.5; cam.bottom = -h * 0.5; cam.near = -100; cam.far = 100; cam.updateProjectionMatrix();
      cam.position.set(10, box.min.y + h * 0.5, 0); cam.lookAt(0, box.min.y + h * 0.5, 0); return [size.x, size.y, size.z, box.min.y];
    };
    (window as any).__fitFixed = (f: number[]) => { const cam = camera as any; const h = f[1] * 1.25; cam.left = -h * 0.5; cam.right = h * 0.5; cam.top = h * 0.5; cam.bottom = -h * 0.5; cam.near = -1000; cam.far = 1000; cam.updateProjectionMatrix(); cam.position.set(10, f[3] + h * 0.5, 0); cam.lookAt(0, f[3] + h * 0.5, 0); };
    (window as any).__setY = (ry: number) => { s.rotation.set(0, ry, 0); s.position.set(0, 0, 0); s.updateMatrixWorld(true); };
    (window as any).__tilt = (rz: number, dy: number, dx: number) => { s.rotation.z = rz; s.position.y = dy; s.position.z = dx; s.updateMatrixWorld(true); };
    (window as any).__shot = () => { gl.render(scene, camera); return gl.domElement.toDataURL("image/png"); };
    (window as any).__ready = true;
    return () => { scene.remove(s); };
  }, [gltf, idle, attack, lose, hit, gl, scene, camera]);
  return null;
}

export default function Dev() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const fid = q?.get("f") || "samurai";
  return (
    <div style={{ width: 512, height: 512, background: "#000" }}>
      <Canvas orthographic dpr={1} gl={{ preserveDrawingBuffer: true, alpha: true, antialias: false }} camera={{ position: [10, 1, 0], zoom: 1 }} frameloop="demand" style={{ width: 512, height: 512, background: "transparent" }}>
        <ambientLight intensity={2.6} />
        <hemisphereLight args={["#ffffff", "#806050", 1.2]} />
        <directionalLight position={[4, 6, 5]} intensity={2.8} />
        <directionalLight position={[-3, 2, -3]} intensity={1.2} color="#ffd0b0" />
        <Rig fid={fid} />
      </Canvas>
    </div>
  );
}
