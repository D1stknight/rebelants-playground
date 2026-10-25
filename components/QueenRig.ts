// components/QueenRig.ts
// The Queen as a real-time skinned 3D model (public/models/queen/queen_web.glb, rigged in Blender by tools/queen-sprites/rig_queen.py).
// Her arms are driven by two-bone IK with springs, so the staff moves like a held object: the wrist leads, the elbow follows,
// the staff keeps its weight (overshoot on strikes, settle after). The camera is the one the sprite faces were painted from,
// so QueenStage can keep laying the 2-D face expressions over her head.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export type QueenPose = "rest" | "point" | "raise" | "strike" | "droop" | "cheer" | "talk";
type V3 = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** critically-damped-ish spring on a vector (k stiffness, d damping ratio) */
class Spring {
  x: V3; vel = v(); constructor(x: V3) { this.x = x.clone(); }
  step(target: V3, dt: number, k: number, d: number) {
    const w = Math.sqrt(k); const c = 2 * d * w;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))); const h = dt / n;
    for (let i = 0; i < n; i++) { const a = target.clone().sub(this.x).multiplyScalar(k).sub(this.vel.clone().multiplyScalar(c)); this.vel.addScaledVector(a, h); this.x.addScaledVector(this.vel, h); }
    return this.x;
  }
}

type Arm = { up: THREE.Bone; fore: THREE.Bone; hand: THREE.Bone; S: V3; W0: V3; E0: V3; a: number; b: number; staff0: V3 | null; wrist: Spring; dir: Spring | null; pole: Spring };

export class QueenRig {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera; root: THREE.Object3D;
  bones: Record<string, THREE.Bone> = {}; staff: THREE.Mesh | null = null; bodyMeshes: THREE.Mesh[] = []; rest: Record<string, THREE.Quaternion> = {};
  R!: Arm; L!: Arm; gemLocal = v(); headRest = { x: 0, y: 0, a: 0 };
  pose: QueenPose = "rest"; poseT = 0; t = 0; strikeKick = 0; size = v();
  spine0 = new THREE.Quaternion(); lean = 0; leanS = new Spring(v());
  private constructor(root: THREE.Object3D, canvas?: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x000000, 0); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.root = root; this.scene.add(root);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a2a20, 0.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.8); d1.position.set(2.5, 4, 3); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffd9a0, 0.5); d2.position.set(-3, 2, -2); this.scene.add(d2);
    root.traverse((o: any) => { if (o.isBone) { this.bones[o.name] = o; this.rest[o.name] = o.quaternion.clone(); } if (o.isMesh) { o.frustumCulled = false; if (/staff/i.test(o.name)) { this.staff = o; o.material = o.material.clone(); } else this.bodyMeshes.push(o); } });
    // bind-pose bounds, skinned (positions are quantized; the bones carry the dequantization)
    const box = new THREE.Box3(); root.updateMatrixWorld(true);
    root.traverse((o: any) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); } else if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    box.getSize(this.size); const c = v(); box.getCenter(c); c.y = box.min.y + this.size.y / 2;
    root.position.sub(c); root.position.y += this.size.y / 2; root.updateMatrixWorld(true);
    this.camera = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
    const dist = (this.size.y * 1.15) / (2 * Math.tan((22 * Math.PI) / 360)); this.camera.position.set(0, this.size.y * 0.5, dist); this.camera.lookAt(0, this.size.y * 0.5, 0); this.camera.updateProjectionMatrix();
    this.spine0.copy(this.bones.spine?.quaternion || new THREE.Quaternion());
    this.R = this.arm("upperarmR", "forearmR", "handR", v(-0.209, 0.735, 0.0));
    this.L = this.arm("upperarmL", "forearmL", "handL", null);
    const hp = this.toPx(this.wp(this.bones.head)); const top = this.toPx(this.bones.head.localToWorld(v(0, 0.2, 0)));
    this.headRest = { x: hp[0], y: hp[1], a: Math.atan2(top[1] - hp[1], top[0] - hp[0]) };
  }
  static async load(url: string, canvas?: HTMLCanvasElement) {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const g = await loader.loadAsync(url); return new QueenRig(g.scene, canvas);
  }
  private wp(o: THREE.Object3D) { return o.getWorldPosition(v()); }
  private arm(u: string, f: string, h: string, gem: V3 | null): Arm {
    const up = this.bones[u], fore = this.bones[f], hand = this.bones[h];
    const S = this.wp(up), E0 = this.wp(fore), W0 = this.wp(hand);
    let staff0: V3 | null = null;
    if (gem) {
      // the gem sits on the staff axis above the fist; z is taken from the hand so the axis is the staff itself
      const g = v(gem.x, gem.y, W0.z + 0.0); this.gemLocal = hand.worldToLocal(g.clone()); staff0 = g.clone().sub(W0).normalize();
    }
    return { up, fore, hand, S, W0, E0, a: S.distanceTo(E0), b: E0.distanceTo(W0), staff0, wrist: new Spring(W0), dir: staff0 ? new Spring(staff0) : null, pole: new Spring(E0.clone().sub(S)) };
  }
  /** 1024² frame pixel of a world point (the frame the sprite layers were cut from) */
  toPx(p: V3): [number, number] { const q = p.clone().project(this.camera); return [(q.x * 0.5 + 0.5) * 1024, (-q.y * 0.5 + 0.5) * 1024]; }
  gemPx() { this.root.updateMatrixWorld(true); return this.toPx(this.R.hand.localToWorld(this.gemLocal.clone())); }
  /** head pivot + rotation relative to rest, in frame px (QueenStage moves the painted face with it) */
  headPx() { const hp = this.toPx(this.wp(this.bones.head)); const top = this.toPx(this.bones.head.localToWorld(v(0, 0.2, 0))); return { x: hp[0], y: hp[1], dx: hp[0] - this.headRest.x, dy: hp[1] - this.headRest.y, da: Math.atan2(top[1] - hp[1], top[0] - hp[0]) - this.headRest.a, px: this.headRest.x, py: this.headRest.y }; }
  /** crop the render to a region of the 1024 frame (QueenStage uses the old body box) and size the canvas */
  setView(box: [number, number, number, number], cssW: number, cssH: number, dpr: number) {
    this.camera.setViewOffset(1024, 1024, box[0], box[1], box[2] - box[0], box[3] - box[1]); this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(cssW, cssH, false);
  }
  aim = new THREE.Vector2(-0.8, 0.6);   // screen direction from her staff hand to the egg (x right, y down; un-mirrored frame)
  setAim(x: number, y: number) { const l = Math.hypot(x, y) || 1; this.aim.set(x / l, y / l); }
  /** a bolt leaves the gem: the staff kicks back and settles (spring velocity impulse) */
  recoil(power = 1) { const k = 0.9 * power; this.R.wrist.vel.add(v(0.12 * k, 0.35 * k, -0.08 * k)); this.R.dir?.vel.add(v(0.9 * k, 2.2 * k, 0)); this.leanS.vel.x += 0.25 * k; }
  setPose(p: QueenPose) { if (p !== this.pose) { this.pose = p; this.poseT = 0; if (p === "strike") this.strikeKick = 1; } }

  // targets per pose (relative to the shoulder / rest wrist), staff direction and elbow pole
  private targets(): { wR: V3; dR: V3; pR: V3; wL: V3; pL: V3; lean: number } {
    const R = this.R, L = this.L, t = this.t; const br = Math.sin(t * 1.9) * 0.004;   // breathing
    const S = R.S, SL = L.S; const restDir = R.staff0!.clone();
    const sway = Math.sin(t * 1.3) * 0.05;
    switch (this.pose) {
      case "point": { const a = this.aim;
        // egg on her free-hand side: staff held up and leaning over, the left hand points at it (no mirroring, the face stays put)
        if (a.x > 0) return { wR: S.clone().add(v(-0.08, 0.06 + br, 0.05)), dR: v(-0.08 + a.x * 0.08, 1, 0.03).normalize(), pR: v(-0.8, -0.3, -0.2), wL: L.W0.clone().add(v(0.004, 0.008, 0.008)), pL: L.E0.clone().sub(SL), lean: 0.03 };
        return { wR: S.clone().add(v(-0.1 + a.x * 0.03, -0.03 - a.y * 0.02, 0.09)), dR: v(a.x * 0.75, 0.62 - a.y * 0.35, 0.12).normalize(), pR: v(-0.4, -0.6, -0.4), wL: L.W0.clone().add(v(0, br, 0)), pL: L.E0.clone().sub(SL), lean: -0.03 }; }
      case "raise": return { wR: S.clone().add(v(-0.085, 0.13, 0.05)), dR: v(-0.1 + sway * 0.4, 1, 0.02).normalize(), pR: v(-0.8, -0.3, -0.2), wL: L.W0.clone().add(v(0.01, 0.01 + br, 0.01)), pL: L.E0.clone().sub(SL), lean: 0.04 };
      case "strike": { const a = this.aim;
        if (a.x > 0) return { wR: S.clone().add(v(-0.085, 0.12, 0.06)), dR: v(-0.05 + a.x * 0.12, 1, 0.04).normalize(), pR: v(-0.8, -0.3, -0.2), wL: L.W0.clone().add(v(0.006, 0.012, 0.012)), pL: L.E0.clone().sub(SL), lean: 0.05 };
        return { wR: S.clone().add(v(-0.1 + a.x * 0.05, -0.02 - a.y * 0.03, 0.1)), dR: v(a.x, -a.y * 0.8 + 0.1, 0.1).normalize(), pR: v(-0.3, -0.7, -0.3), wL: L.W0.clone().add(v(0.01, 0.02, 0.02)), pL: L.E0.clone().sub(SL), lean: -0.07 }; }
      case "droop": return { wR: R.W0.clone().add(v(-0.008, -0.03, 0.0)), dR: v(-0.48, 0.88, 0.05).normalize(), pR: R.E0.clone().sub(S), wL: L.W0.clone().add(v(-0.005, -0.01, 0)), pL: L.E0.clone().sub(SL), lean: 0.02 };
      case "cheer": return { wR: S.clone().add(v(-0.08, 0.14, 0.06)), dR: v(-0.22 + sway, 1, 0.03).normalize(), pR: v(-0.8, -0.3, -0.2), wL: L.W0.clone().add(v(0.006, 0.015, 0.012)), pL: L.E0.clone().sub(SL), lean: 0.0 };
      case "talk": return { wR: R.W0.clone().add(v(-0.006, 0.02 + br + Math.sin(t * 3.1) * 0.006, 0.02)), dR: restDir.clone().add(v(-0.12 + Math.sin(t * 2.2) * 0.05, 0, 0.05)).normalize(), pR: R.E0.clone().sub(S), wL: L.W0.clone().add(v(-0.004, 0.01 + Math.sin(t * 3.4) * 0.004, 0.01)), pL: L.E0.clone().sub(SL), lean: Math.sin(t * 1.7) * 0.01 };
      default: return { wR: R.W0.clone().add(v(0, br, 0)), dR: restDir.clone().add(v(Math.sin(t * 0.9) * 0.025, 0, 0)).normalize(), pR: R.E0.clone().sub(S), wL: L.W0.clone().add(v(0, br * 0.8, 0)), pL: L.E0.clone().sub(SL), lean: Math.sin(t * 0.8) * 0.006 };
    }
  }

  update(dt: number) {
    this.t += dt; this.poseT += dt; this.strikeKick = Math.max(0, this.strikeKick - dt * 3);
    const T = this.targets();
    // stiffness per pose: strikes snap with overshoot, everything else eases
    const fast = this.pose === "strike" ? [260, 0.42] : this.pose === "raise" ? [90, 0.7] : this.pose === "point" ? [110, 0.65] : [60, 0.85];
    const R = this.R, L = this.L;
    // reset to rest, then lean the spine (the face layer follows the head)
    for (const n of Object.keys(this.bones)) this.bones[n].quaternion.copy(this.rest[n]);
    const lean = this.leanS.step(v(T.lean, 0, 0), dt, 40, 0.8).x;
    if (this.bones.spine) this.bones.spine.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, lean)));
    this.root.updateMatrixWorld(true);
    this.solve(R, R.wrist.step(T.wR, dt, fast[0], fast[1]), R.pole.step(T.pR, dt, 50, 0.9), R.dir!.step(T.dR, dt, fast[0] * 0.9, fast[1]));
    this.solve(L, L.wrist.step(T.wL, dt, 70, 0.75), L.pole.step(T.pL, dt, 50, 0.9), null);
  }

  /** two-bone IK: shoulder stays, wrist goes to w, elbow bends toward the pole, then the hand turns the staff to dir */
  private solve(A: Arm, w: V3, pole: V3, dir: V3 | null) {
    const S = this.wp(A.up); const toW = w.clone().sub(S); let d = toW.length(); const n = toW.clone().normalize();
    d = Math.min(A.a + A.b - 1e-4, Math.max(Math.abs(A.a - A.b) + 1e-4, d));
    const cosA = (A.a * A.a + d * d - A.b * A.b) / (2 * A.a * d); const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = pole.clone().sub(n.clone().multiplyScalar(pole.dot(n))); if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0); perp.normalize();
    const E = S.clone().add(n.clone().multiplyScalar(A.a * cosA)).add(perp.multiplyScalar(A.a * sinA));
    const W = S.clone().add(n.clone().multiplyScalar(d));
    this.aimBone(A.up, this.wp(A.fore), E);
    this.aimBone(A.fore, this.wp(A.hand), W);
    if (dir && A.staff0) {
      const cur = this.R.hand.localToWorld(this.gemLocal.clone()).sub(this.wp(A.hand)).normalize();
      this.turn(A.hand, cur, dir.clone().normalize());
    }
  }
  /** rotate bone b (in world space, about its head) so its child point `from` swings onto `to` */
  private aimBone(b: THREE.Bone, from: V3, to: V3) {
    const h = this.wp(b); this.turn(b, from.clone().sub(h).normalize(), to.clone().sub(h).normalize());
  }
  private turn(b: THREE.Bone, a: V3, c: V3) {
    const q = new THREE.Quaternion().setFromUnitVectors(a, c);
    const wq = b.getWorldQuaternion(new THREE.Quaternion()); const nq = q.multiply(wq);
    const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    b.quaternion.copy(pq.invert().multiply(nq)); b.updateMatrixWorld(true);
  }
  render() { this.renderer.render(this.scene, this.camera); }

  // ── painted faces, glued to the head in 3-D ────────────────────────────────────────────────────────────────
  // Each head vertex gets the (u, v) where it appeared in the 1024 frame the faces were painted on (its rest-pose projection
  // through this camera, inside the face box). The body shader blends the painted expression over the final colour at that
  // uv, so the face moves, leans and tilts with the head exactly — no separate layer that can drift or double up.
  faceU: Record<string, { value: any }> | null = null; faceTex: Record<string, THREE.Texture> = {};
  setFaces(images: Record<string, HTMLImageElement>, box: number[], mouth: number[] | null) {
    const bw = box[2] - box[0], bh = box[3] - box[1]; const cam = this.camera.clone(); cam.clearViewOffset(); cam.updateProjectionMatrix();
    for (const [n, img] of Object.entries(images)) { if (n === "idle") continue; const t = new THREE.Texture(img); t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; this.faceTex[n] = t; }
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); blank.needsUpdate = true; this.faceTex.__none = blank;
    const U = this.faceU = { uFaceA: { value: blank }, uFaceB: { value: blank }, uFaceMix: { value: 1 }, uMouthA: { value: blank }, uMouthB: { value: blank }, uMouthMix: { value: 1 }, uMouth: { value: new THREE.Vector4(mouth ? (mouth[0] - box[0]) / bw : 0.5, mouth ? (mouth[1] - box[1]) / bh : 0.8, mouth ? mouth[2] / bw : 0.1, mouth ? mouth[3] / bh : 0.1) } };
    this.root.updateMatrixWorld(true); for (const n of Object.keys(this.bones)) this.bones[n].quaternion.copy(this.rest[n]); this.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (const m of this.bodyMeshes as any[]) {
      const pos = m.geometry.getAttribute("position"); const uv = new Float32Array(pos.count * 2);
      if (m.isSkinnedMesh) m.skeleton.update();
      for (let i = 0; i < pos.count; i++) {
        if (m.isSkinnedMesh) m.getVertexPosition(i, p); else p.fromBufferAttribute(pos, i); p.applyMatrix4(m.matrixWorld);
        const head = p.y > 0.5; p.project(cam); const fx = (p.x * 0.5 + 0.5) * 1024, fy = (-p.y * 0.5 + 0.5) * 1024;
        const u = (fx - box[0]) / bw, v = (fy - box[1]) / bh; const ok = head && u > -0.02 && u < 1.02 && v > -0.02 && v < 1.02;
        uv[i * 2] = ok ? u : -1; uv[i * 2 + 1] = ok ? v : -1;
      }
      m.geometry.setAttribute("faceUV", new THREE.BufferAttribute(uv, 2));
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 faceUV; varying vec2 vFaceUV;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvFaceUV = faceUV;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vFaceUV; uniform sampler2D uFaceA; uniform sampler2D uFaceB; uniform float uFaceMix; uniform sampler2D uMouthA; uniform sampler2D uMouthB; uniform float uMouthMix; uniform vec4 uMouth;")
          .replace("#include <dithering_fragment>", `#include <dithering_fragment>
            if (vFaceUV.x >= 0.0) {
              vec2 fu = clamp(vFaceUV, 0.0, 1.0);
              vec4 fa = texture2D(uFaceA, fu), fb = texture2D(uFaceB, fu);
              float fA = mix(fb.a, fa.a, uFaceMix); vec3 fP = mix(fb.rgb * fb.a, fa.rgb * fa.a, uFaceMix);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fP / max(fA, 1e-3), fA);
              vec2 md = (fu - uMouth.xy) / uMouth.zw; float inM = 1.0 - smoothstep(0.8, 1.0, length(md));
              if (inM > 0.0) { vec4 ma = texture2D(uMouthA, fu), mb = texture2D(uMouthB, fu); float mA = mix(mb.a, ma.a, uMouthMix); vec3 mP = mix(mb.rgb * mb.a, ma.rgb * ma.a, uMouthMix); gl_FragColor.rgb = mix(gl_FragColor.rgb, mP / max(mA, 1e-3), mA * inM); }
            }`);
      };
      mat.needsUpdate = true;
    }
  }
  /** expression cross-fade: from `prev` to `cur` by `mix` (0..1); mouth viseme the same way; null = the bare 3-D face */
  setFaceState(cur: string | null, prev: string | null, mix: number, vCur: string | null, vPrev: string | null, vMix: number) {
    const U = this.faceU; if (!U) return; const T = (n: string | null) => (n && this.faceTex[n]) || this.faceTex.__none;
    U.uFaceA.value = T(cur); U.uFaceB.value = T(prev); U.uFaceMix.value = mix; U.uMouthA.value = T(vCur); U.uMouthB.value = T(vPrev); U.uMouthMix.value = vMix;
  }
  /** second pass: only the staff + gripping hand, depth-tested against the body (so it still hides behind her), for drawing over the face layers */
  renderStaff() {
    if (!this.staff) return false; const prev = this.bodyMeshes.map((m) => (m.material as THREE.Material).colorWrite);
    this.bodyMeshes.forEach((m) => ((m.material as THREE.Material).colorWrite = false)); this.renderer.render(this.scene, this.camera);
    this.bodyMeshes.forEach((m, i) => ((m.material as THREE.Material).colorWrite = prev[i])); return true;
  }
  dispose() { this.renderer.dispose(); }
}
