// dev-only (copy to pages/dev/siege-sprite.tsx): renders a rigged faction GLB with the Siege lighting rig — warm torch key from the
// front-left, cool moonlight fill from behind-right, thin rim — for tools/siege-sprites/render.js to grab animation frames.
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF, useFBX } from "@react-three/drei";
import { ACESFilmicToneMapping, AnimationMixer, Box3, DoubleSide, SRGBColorSpace, Vector3, type Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const CLIPS = ["idle", "attack", "magic", "special", "hit", "win", "defend", "lose"] as const;
function Rig({ fid }: { fid: string }) {
  const gltf = useGLTF(`/faction-wars/characters/${fid}/${fid}.glb`) as any;
  const fbx = CLIPS.map((c) => useFBX(`/faction-wars/characters/${fid}/${c}.fbx`) as any);   // eslint-disable-line react-hooks/rules-of-hooks
  const { gl, scene, camera } = useThree();
  const ref = useRef<Object3D | null>(null);
  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping; gl.toneMappingExposure = 1.45; gl.outputColorSpace = SRGBColorSpace;
    const s = clone(gltf.scene);
    s.traverse((o: any) => { if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m: any) => { if (m) { m.side = DoubleSide; if ("envMapIntensity" in m) m.envMapIntensity = 0.5; } }); } });
    scene.add(s); ref.current = s;
    const retarget = (clip: any) => { const c = clip.clone(); c.tracks = c.tracks.map((t: any) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; }).filter((t: any) => t.name.endsWith(".quaternion")); return c; };
    const mixer = new AnimationMixer(s); const clips: any = {}; CLIPS.forEach((c, i) => { clips[c] = retarget(fbx[i].animations[0]); });
    let action: any = null;
    (window as any).__clipLen = (name: string) => clips[name]?.duration || 1;
    (window as any).__clip = (name: string, t: number) => { if (action) action.stop(); action = mixer.clipAction(clips[name]); action.play(); action.time = t; mixer.update(0); s.updateMatrixWorld(true); };
    (window as any).__fit = (h: number) => { s.updateMatrixWorld(true); const box = new Box3().setFromObject(s); const size = new Vector3(); box.getSize(size); const cam = camera as any; cam.left = -h * 0.5; cam.right = h * 0.5; cam.top = h * 0.5; cam.bottom = -h * 0.5; cam.near = -1000; cam.far = 1000; cam.updateProjectionMatrix(); cam.position.set(10, box.min.y + h * 0.5, 0); cam.lookAt(0, box.min.y + h * 0.5, 0); return [size.x, size.y, size.z, box.min.y]; };
    (window as any).__fitFixed = (f: number[], mul = 1.3) => { const cam = camera as any; const h = f[1] * mul; cam.left = -h * 0.5; cam.right = h * 0.5; cam.top = h * 0.5; cam.bottom = -h * 0.5; cam.near = -1000; cam.far = 1000; cam.updateProjectionMatrix(); cam.position.set(10, f[3] + h * 0.5, 0); cam.lookAt(0, f[3] + h * 0.5, 0); };
    (window as any).__setY = (ry: number) => { s.rotation.set(0, ry, 0); s.position.set(0, 0, 0); s.updateMatrixWorld(true); };
    (window as any).__shot = () => { gl.render(scene, camera); return gl.domElement.toDataURL("image/png"); };
    (window as any).__ready = true;
    return () => { scene.remove(s); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, gl, scene, camera]);
  return null;
}

export default function Dev() {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const fid = q?.get("f") || "ronin";
  return (
    <div style={{ width: 512, height: 512, background: "#000" }}>
      <Canvas orthographic dpr={1} gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }} camera={{ position: [10, 1, 0], zoom: 1 }} frameloop="demand" style={{ width: 512, height: 512, background: "transparent" }}>
        <ambientLight intensity={1.6} color="#a9b8d8" />
        <hemisphereLight args={["#8fa4d0", "#4a3a2e", 1.3]} />
        <directionalLight position={[3, 3.5, 6]} intensity={5.5} color="#ffc27a" />       {/* torch key: warm, front-left-ish (camera looks down -x) */}
        <directionalLight position={[-4, 6, -5]} intensity={2.4} color="#9db8ff" />      {/* moon fill: cool, behind-right */}
        <directionalLight position={[-6, 2, 2]} intensity={3.8} color="#eaf1ff" />       {/* rim from behind the far side */}
        <Rig fid={fid} />
      </Canvas>
    </div>
  );
}
