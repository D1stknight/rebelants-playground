// Dev-only: renders a faction rider seated in a procedural kart, for the Rebel Grand Prix sprite sheets.
// ?f=<faction>&k=<chassis> ; window.__kart(yaw, opts) poses + rotates, window.__shot() returns a PNG data URL.
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF, useFBX } from "@react-three/drei";
import { AnimationMixer, Box3, BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3, type Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

export const CHASSIS: Record<string, { len: number; wid: number; noseL: number; wingF: number; wingR: number; wheelF: number; wheelR: number; pod: number; airbox: number; halo: boolean; trim: number }> = {
  //           body len  body wid  nose   front wing  rear wing  wheelF  wheelR  side pod  airbox  halo   gold trim
  scout:   { len: 1.55, wid: 0.26, noseL: 0.65, wingF: 0.80, wingR: 0.70, wheelF: 0.14, wheelR: 0.17, pod: 0.10, airbox: 0.14, halo: false, trim: 0 },
  soldier: { len: 1.75, wid: 0.30, noseL: 0.60, wingF: 0.95, wingR: 0.85, wheelF: 0.16, wheelR: 0.20, pod: 0.16, airbox: 0.18, halo: true,  trim: 0 },
  tank:    { len: 1.85, wid: 0.36, noseL: 0.45, wingF: 1.05, wingR: 1.00, wheelF: 0.19, wheelR: 0.26, pod: 0.24, airbox: 0.22, halo: true,  trim: 0 },
  drone:   { len: 1.95, wid: 0.26, noseL: 0.80, wingF: 0.90, wingR: 0.75, wheelF: 0.15, wheelR: 0.19, pod: 0.12, airbox: 0.12, halo: false, trim: 0 },
  royal:   { len: 1.80, wid: 0.32, noseL: 0.60, wingF: 1.00, wingR: 0.95, wheelF: 0.17, wheelR: 0.22, pod: 0.18, airbox: 0.26, halo: true,  trim: 1 },
};

function buildKart(H: number, k: string, paint: string, accent: string) {
  const c = CHASSIS[k] || CHASSIS.soldier; const L = c.len * H * 0.85, W = c.wid * H * 0.9;
  const g = new Group();
  const mPaint = new MeshStandardMaterial({ color: paint, metalness: 0.4, roughness: 0.4 });
  const mDark = new MeshStandardMaterial({ color: "#22222a", metalness: 0.3, roughness: 0.7 });
  const mCarbon = new MeshStandardMaterial({ color: "#3a3a44", metalness: 0.5, roughness: 0.5 });
  const mTire = new MeshStandardMaterial({ color: "#16161a", roughness: 0.95 });
  const mRim = new MeshStandardMaterial({ color: c.trim ? "#e6c15a" : "#c9c9d2", metalness: 0.85, roughness: 0.3 });
  const mAcc = new MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.4 });
  const mGold = new MeshStandardMaterial({ color: "#e6c15a", metalness: 0.9, roughness: 0.25 });
  const mGlow = new MeshStandardMaterial({ color: "#ffb347", emissive: "#ff7a1a", emissiveIntensity: 1.2 });
  const RF = c.wheelF * H, RR = c.wheelR * H; const floor = RR * 0.55;   // ride height
  const add = (m: Mesh) => { g.add(m); return m; };
  // monocoque: floor + tub + raised cockpit
  add(new Mesh(new BoxGeometry(L * 0.75, H * 0.03, W * 2.2), mCarbon)).position.set(-L * 0.05, floor, 0);
  add(new Mesh(new BoxGeometry(L * 0.62, H * 0.16, W), mPaint)).position.set(-L * 0.02, floor + H * 0.09, 0);
  add(new Mesh(new BoxGeometry(L * 0.3, H * 0.1, W * 0.9), mPaint)).position.set(-L * 0.12, floor + H * 0.22, 0);   // cockpit rim
  // nose: tapered from body front to the tip (+x)
  const ng = new CylinderGeometry(H * 0.05, W * 0.5, L * c.noseL, 4); ng.rotateY(Math.PI / 4); ng.rotateZ(-Math.PI / 2);
  const nose = new Mesh(ng, mPaint); nose.position.set(L * 0.29 + L * c.noseL * 0.5, floor + H * 0.1, 0); g.add(nose);
  // front wing + end plates
  const fw = add(new Mesh(new BoxGeometry(L * 0.14, H * 0.025, c.wingF * H), c.trim ? mGold : mAcc)); fw.position.set(L * 0.29 + L * c.noseL - L * 0.04, floor - H * 0.01, 0);
  for (const sz of [1, -1]) add(new Mesh(new BoxGeometry(L * 0.16, H * 0.08, H * 0.02), mPaint)).position.set(fw.position.x, floor + H * 0.03, sz * c.wingF * H * 0.5);
  // side pods
  for (const sz of [1, -1]) { const pod = add(new Mesh(new BoxGeometry(L * 0.34, H * 0.13, c.pod * H), mPaint)); pod.position.set(-L * 0.12, floor + H * 0.08, sz * (W * 0.5 + c.pod * H * 0.5)); const inlet = add(new Mesh(new BoxGeometry(L * 0.04, H * 0.09, c.pod * H * 0.8), mDark)); inlet.position.set(L * 0.05, floor + H * 0.08, sz * (W * 0.5 + c.pod * H * 0.5)); }
  // engine cover + airbox behind the driver
  add(new Mesh(new BoxGeometry(L * 0.3, H * 0.16, W * 0.7), mPaint)).position.set(-L * 0.33, floor + H * 0.22, 0);
  const ab = add(new Mesh(new BoxGeometry(L * 0.12, c.airbox * H, W * 0.5), mPaint)); ab.position.set(-L * 0.2, floor + H * 0.3 + c.airbox * H * 0.5, 0);
  add(new Mesh(new BoxGeometry(L * 0.04, c.airbox * H * 0.6, W * 0.35), mDark)).position.set(-L * 0.14, floor + H * 0.32 + c.airbox * H * 0.5, 0);
  // halo
  if (c.halo) { const halo = new Mesh(new TorusGeometry(W * 0.75, H * 0.012, 6, 16, Math.PI), c.trim ? mGold : mCarbon); halo.position.set(-L * 0.1, floor + H * 0.34, 0); halo.rotation.x = Math.PI; halo.rotation.z = Math.PI; halo.rotation.set(-Math.PI / 2, 0, 0); g.add(halo); add(new Mesh(new BoxGeometry(L * 0.14, H * 0.012, H * 0.012), mCarbon)).position.set(L * 0.0, floor + H * 0.34, 0); }
  // rear wing on pylons
  const rw = add(new Mesh(new BoxGeometry(L * 0.1, H * 0.03, c.wingR * H), c.trim ? mGold : mAcc)); rw.position.set(-L * 0.46, floor + H * 0.42, 0);
  add(new Mesh(new BoxGeometry(L * 0.1, H * 0.02, c.wingR * H * 0.9), mPaint)).position.set(-L * 0.44, floor + H * 0.36, 0);
  for (const sz of [1, -1]) add(new Mesh(new BoxGeometry(L * 0.12, H * 0.14, H * 0.02), mPaint)).position.set(-L * 0.46, floor + H * 0.38, sz * c.wingR * H * 0.5);
  add(new Mesh(new BoxGeometry(L * 0.06, H * 0.2, W * 0.3), mCarbon)).position.set(-L * 0.42, floor + H * 0.25, 0);
  // exhaust
  for (const sz of [1, -1]) { add(new Mesh(new CylinderGeometry(H * 0.02, H * 0.025, L * 0.08, 8), mDark)).rotation.z = Math.PI / 2; g.children[g.children.length - 1].position.set(-L * 0.5, floor + H * 0.12, sz * W * 0.3); add(new Mesh(new SphereGeometry(H * 0.022, 8, 6), mGlow)).position.set(-L * 0.55, floor + H * 0.12, sz * W * 0.3); }
  // wheels: exposed, on suspension arms
  const wheel = (x: number, sz: number, R: number, wd: number) => {
    const t = add(new Mesh(new CylinderGeometry(R, R, wd, 14), mTire)); t.rotation.x = Math.PI / 2; t.position.set(x, R, sz * (W * 0.5 + c.pod * H + R * 0.55 + wd * 0.5));
    const rim = add(new Mesh(new CylinderGeometry(R * 0.6, R * 0.6, wd * 1.05, 8), mRim)); rim.rotation.x = Math.PI / 2; rim.position.copy(t.position);
    for (const dz of [0.25, -0.25]) { const arm = add(new Mesh(new BoxGeometry(H * 0.02, H * 0.02, t.position.z - sz * W * 0.5), mCarbon)); arm.position.set(x + dz * L * 0.06, R * 1.05, sz * (W * 0.5) + (t.position.z - sz * W * 0.5) / 2); }
  };
  for (const sz of [1, -1]) { wheel(L * 0.3, sz, RF, H * 0.09); wheel(-L * 0.36, sz, RR, H * 0.12); }
  // livery stripe + number plate on the nose
  add(new Mesh(new BoxGeometry(L * 0.5, H * 0.004, W * 0.25), mAcc)).position.set(L * 0.02, floor + H * 0.171, 0);
  return { g, seatY: floor + H * 0.05, seatX: -L * 0.11 };
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
      const P = { thigh: -1.5, shin: 1.45, arm: -0.75, fore: -0.7, lean: 0.02, ...o };
      rot("LeftUpLeg", P.thigh, 0, 0.12); rot("RightUpLeg", P.thigh, 0, -0.12); rot("LeftLeg", P.shin, 0, 0); rot("RightLeg", P.shin, 0, 0);
      rot("LeftArm", P.arm, 0, 0.35); rot("RightArm", P.arm, 0, -0.35); rot("LeftForeArm", P.fore, 0, 0); rot("RightForeArm", P.fore, 0, 0);
      rot("Spine", P.lean, 0, 0); rot("Head", -0.15, 0, 0); if (o.head) rot("Head", o.head[0], o.head[1], o.head[2]);
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
