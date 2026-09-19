// Dev-only: renders a faction rider seated in a procedural kart, for the Rebel Grand Prix sprite sheets.
// ?f=<faction>&k=<chassis> ; window.__kart(yaw, opts) poses + rotates, window.__shot() returns a PNG data URL.
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF, useFBX } from "@react-three/drei";
import { AnimationMixer, Box3, BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3, type Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export const CHASSIS: Record<string, { len: number; wid: number; hgt: number; wheel: number; bar: boolean; spoiler: boolean; nose: number }> = {
  scout:   { len: 1.15, wid: 0.72, hgt: 0.30, wheel: 0.19, bar: false, spoiler: false, nose: 0.55 },
  soldier: { len: 1.30, wid: 0.85, hgt: 0.36, wheel: 0.23, bar: false, spoiler: true,  nose: 0.45 },
  tank:    { len: 1.45, wid: 1.00, hgt: 0.46, wheel: 0.30, bar: true,  spoiler: false, nose: 0.35 },
};

function buildKart(H: number, k: string, paint: string, accent: string) {
  const c = CHASSIS[k] || CHASSIS.soldier; const L = c.len * H * 0.92, W = c.wid * H * 0.95, HG = c.hgt * H * 0.72, R = c.wheel * H * 0.95;
  const g = new Group();
  const mPaint = new MeshStandardMaterial({ color: paint, metalness: 0.35, roughness: 0.45 });
  const mDark = new MeshStandardMaterial({ color: "#2a2a30", metalness: 0.2, roughness: 0.8 });
  const mTire = new MeshStandardMaterial({ color: "#1a1a1e", roughness: 0.95 });
  const mRim = new MeshStandardMaterial({ color: "#c9c9d2", metalness: 0.8, roughness: 0.3 });
  const mAcc = new MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.35 });
  const mGlow = new MeshStandardMaterial({ color: "#ffb347", emissive: "#ff7a1a", emissiveIntensity: 1.2 });
  // floor pan + body
  const pan = new Mesh(new BoxGeometry(L, HG * 0.35, W * 0.9), mDark); pan.position.set(0, R * 0.9, 0); g.add(pan);
  const body = new Mesh(new BoxGeometry(L * 0.78, HG, W * 0.78), mPaint); body.position.set(L * 0.04, R * 0.9 + HG * 0.55, 0); g.add(body);
  // nose (front is +x)
  const nose = new Mesh(new BoxGeometry(L * c.nose, HG * 0.75, W * 0.5), mPaint); nose.position.set(L * 0.42, R * 0.9 + HG * 0.42, 0); g.add(nose);
  const noseTip = new Mesh(new BoxGeometry(L * 0.08, HG * 0.5, W * 0.62), mAcc); noseTip.position.set(L * 0.66, R * 0.9 + HG * 0.4, 0); g.add(noseTip);
  // seat back + cockpit cutout
  const seat = new Mesh(new BoxGeometry(L * 0.12, HG * 0.8, W * 0.5), mDark); seat.position.set(-L * 0.3, R * 0.9 + HG * 1.2, 0); g.add(seat);
  // steering column + wheel
  const col = new Mesh(new CylinderGeometry(H * 0.012, H * 0.012, H * 0.22, 6), mDark); col.position.set(L * 0.2, R * 0.9 + HG * 1.15, 0); col.rotation.z = 0.7; g.add(col);
  const wheel = new Mesh(new TorusGeometry(H * 0.075, H * 0.012, 6, 14), mDark); wheel.position.set(L * 0.13, R * 0.9 + HG * 1.35, 0); wheel.rotation.y = Math.PI / 2; wheel.rotation.x = 0; wheel.rotateOnAxis(new Vector3(0, 0, 1), 0.7); g.add(wheel);
  // wheels
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const t = new Mesh(new CylinderGeometry(R, R, W * 0.16, 12), mTire); t.rotation.x = Math.PI / 2; t.position.set(sx * L * 0.36, R, sz * (W * 0.5 + W * 0.08)); g.add(t);
    const rim = new Mesh(new CylinderGeometry(R * 0.55, R * 0.55, W * 0.17, 8), mRim); rim.rotation.x = Math.PI / 2; rim.position.copy(t.position); g.add(rim);
  }
  // exhausts (rear, -x)
  for (const sz of [1, -1]) { const ex = new Mesh(new CylinderGeometry(H * 0.03, H * 0.035, L * 0.18, 8), mDark); ex.rotation.z = Math.PI / 2; ex.position.set(-L * 0.48, R * 1.1, sz * W * 0.22); g.add(ex); const fl = new Mesh(new SphereGeometry(H * 0.03, 8, 6), mGlow); fl.position.set(-L * 0.58, R * 1.1, sz * W * 0.22); g.add(fl); }
  if (c.spoiler) { const sp = new Mesh(new BoxGeometry(L * 0.1, HG * 0.14, W * 0.95), mAcc); sp.position.set(-L * 0.48, R * 0.9 + HG * 1.75, 0); g.add(sp); for (const sz of [1, -1]) { const st = new Mesh(new BoxGeometry(L * 0.06, HG * 0.8, W * 0.05), mDark); st.position.set(-L * 0.48, R * 0.9 + HG * 1.35, sz * W * 0.4); g.add(st); } }
  if (c.bar) { const bar = new Mesh(new TorusGeometry(W * 0.32, H * 0.02, 6, 12, Math.PI), mRim); bar.position.set(-L * 0.24, R * 0.9 + HG * 1.15, 0); bar.rotation.y = Math.PI / 2; g.add(bar); }
  // faction stripe
  const stripe = new Mesh(new BoxGeometry(L * 0.8, HG * 0.06, W * 0.12), mAcc); stripe.position.set(L * 0.04, R * 0.9 + HG * 1.06, 0); g.add(stripe);
  return { g, seatY: R * 0.9 + HG * 1.05, seatX: -L * 0.14 };
}

function Rig({ fid, kid, paint, accent }: { fid: string; kid: string; paint: string; accent: string }) {
  const gltf = useGLTF(`/faction-wars/characters/${fid}/${fid}.glb`) as any;
  const idle = useFBX(`/faction-wars/characters/${fid}/idle.fbx`) as any;
  const { gl, scene, camera } = useThree();
  const ref = useRef<Object3D | null>(null);
  useEffect(() => {
    const root = new Group(); scene.add(root); ref.current = root;
    const s = clone(gltf.scene);
    s.traverse((o: any) => { if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m: any) => { if (m) m.side = DoubleSide; }); } });
    const bones: Record<string, any> = {}; s.traverse((o: any) => { if (o.isBone) bones[o.name.replace("mixamorig_", "").replace("mixamorig", "")] = o; });
    const retarget = (clip: any) => { const c = clip.clone(); c.tracks = c.tracks.map((t: any) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; }).filter((t: any) => t.name.endsWith(".quaternion")); return c; };
    const mixer = new AnimationMixer(s); const action = mixer.clipAction(retarget(idle.animations[0])); action.play(); action.time = 0.2; mixer.update(0); s.updateMatrixWorld(true);
    // standing height
    const box = new Box3().setFromObject(s); const size = new Vector3(); box.getSize(size); const H = size.y; const minY = box.min.y;
    const { g: kart, seatY, seatX } = buildKart(H, kid, paint, accent);
    root.add(kart); root.add(s);
    (window as any).__H = H;
    (window as any).__pose = (o: any = {}) => {
      // seated: thighs forward, shins down, arms to the wheel, slight forward lean
      const rot = (b: string, x: number, y: number, z: number) => { const bb = bones[b]; if (bb) bb.rotation.set(bb.rotation.x + x, bb.rotation.y + y, bb.rotation.z + z); };
      action.stop(); action.play(); action.time = 0.2; mixer.update(0);
      const P = { thigh: -1.45, shin: 1.35, arm: -0.8, fore: -0.55, lean: 0.05, ...o };
      rot("LeftUpLeg", P.thigh, 0, 0.12); rot("RightUpLeg", P.thigh, 0, -0.12); rot("LeftLeg", P.shin, 0, 0); rot("RightLeg", P.shin, 0, 0);
      rot("LeftArm", P.arm, 0, 0.35); rot("RightArm", P.arm, 0, -0.35); rot("LeftForeArm", P.fore, 0, 0); rot("RightForeArm", P.fore, 0, 0);
      rot("Spine", P.lean, 0, 0); rot("Head", -0.25, 0, 0); if (o.head) rot("Head", o.head[0], o.head[1], o.head[2]);
      s.rotation.set(0, Math.PI / 2, 0); // face +x (kart front)
      s.updateMatrixWorld(true);
      const hips = bones.Hips; const hp = new Vector3(); hips.getWorldPosition(hp);
      // put hips on the seat
      s.position.set(seatX - hp.x, seatY - hp.y + (o.dy || 0), -hp.z); s.updateMatrixWorld(true);
      return [H, seatY, seatX];
    };
    (window as any).__yaw = (a: number) => { root.rotation.set(0, a, 0); root.updateMatrixWorld(true); };
    (window as any).__cam = (hMul: number, pitch = 0.36) => {
      // frame the whole kart+rider: fixed square window sized from the root bbox at yaw 0 so every angle shares one scale
      root.rotation.set(0, 0, 0); root.updateMatrixWorld(true);
      const bb = new Box3().setFromObject(root); const sz = new Vector3(); bb.getSize(sz); const ctr = new Vector3(); bb.getCenter(ctr);
      const h = Math.max(sz.x, sz.y, sz.z) * hMul;
      const cam = camera as any; cam.left = -h * 0.5; cam.right = h * 0.5; cam.top = h * 0.5; cam.bottom = -h * 0.5; cam.near = -1000; cam.far = 1000; cam.updateProjectionMatrix();
      const cy = bb.min.y + sz.y * 0.5; cam.position.set(0, cy + Math.sin(pitch) * 10, Math.cos(pitch) * 10); cam.lookAt(0, cy, 0); cam.updateMatrixWorld(true);
      return [sz.x, sz.y, sz.z, bb.min.y];
    };
    (window as any).__shot = () => { gl.render(scene, camera); return gl.domElement.toDataURL("image/png"); };
    (window as any).__ready = true;
    return () => { scene.remove(root); };
  }, [gltf, idle, gl, scene, camera, kid, paint, accent]);
  return null;
}

export default function Dev() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const fid = q?.get("f") || "samurai"; const kid = q?.get("k") || "soldier"; const paint = "#" + (q?.get("p") || "c0392b"); const accent = "#" + (q?.get("a") || "ffd166");
  return (
    <div style={{ width: 512, height: 512, background: "#000" }}>
      <Canvas orthographic dpr={1} gl={{ preserveDrawingBuffer: true, alpha: true, antialias: false }} camera={{ position: [0, 2, 10], zoom: 1 }} frameloop="demand" style={{ width: 512, height: 512, background: "transparent" }}>
        <ambientLight intensity={2.2} />
        <hemisphereLight args={["#ffffff", "#705040", 1.3]} />
        <directionalLight position={[3, 8, 6]} intensity={2.6} />
        <directionalLight position={[-4, 3, -4]} intensity={1.1} color="#ffd0b0" />
        <Rig fid={fid} kid={kid} paint={paint} accent={accent} />
      </Canvas>
    </div>
  );
}
