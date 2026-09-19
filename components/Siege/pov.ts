// components/Siege/pov.ts — The Siege, first-person battlements (over the shoulder). three.js.
// Your ant stands on the wall-walk with her back to the camera; the horde runs up the field toward the gate below.
// Move the pointer to aim (landing marker on the ground), press to charge, release to throw. Same Hud contract as the side view.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { type Hud, type Callbacks, KIT, WAVES } from "./shared";

const G = 20; const WALL_TOP = 9, WALL_Z = -1.5, WALL_T = 3;      // wall face toward the field at z = WALL_Z - WALL_T/2 = -3
const FIELD_Z = WALL_Z - WALL_T / 2;                               // where the horde stops and gnaws at the gate
const CLIPS = ["idle", "attack", "magic", "special", "win"] as const;
type Spider = { g: THREE.Group; legs: THREE.Group[]; x: number; y: number; z: number; climb: number; hp: number; size: number; speed: number; ph: number; stun: number; dead: boolean; arrived: boolean; wob: number };
type Shot = { m: THREE.Object3D; p: THREE.Vector3; v: THREE.Vector3; kind: "spear" | "orb" | "arrow"; life: number; dmg: number; hit: Set<Spider>; light?: THREE.PointLight; k: number; ally?: boolean };
type Part = { s: THREE.Sprite; v: THREE.Vector3; life: number; life0: number; g: number; grow: number; size: number };
type Bolt = { l: THREE.Line; life: number };

export class SiegePov {
  canvas: HTMLCanvasElement; cb: Callbacks; faction = "ashigaru"; over = false; ready = false;
  renderer!: THREE.WebGLRenderer; scene!: THREE.Scene; camera!: THREE.PerspectiveCamera; composer!: EffectComposer; clock = new THREE.Clock();
  tex: Record<string, THREE.Texture> = {}; hero: THREE.Object3D | null = null; mixer: THREE.AnimationMixer | null = null; actions: Record<string, THREE.AnimationAction> = {}; current: THREE.AnimationAction | null = null; heroSpin = 0;
  spiders: Spider[] = []; shots: Shot[] = []; parts: Part[] = []; bolts: Bolt[] = []; flames: THREE.Sprite[] = []; torchLights: THREE.PointLight[] = [];
  marker!: THREE.Mesh; aim = new THREE.Vector3(0, 0, -30); pointer = { x: 0.5, y: 0.5, down: false }; charge = 0; charging = false; reload = 0; reloadTime = 1.1;
  state: Hud["state"] = "ready"; gateHp = 1000; gateMax = 1000; wave = 0; score = 0; kills = 0; msg: string | null = null; msgT = 0; hordeLeft = 0; spawnQueue: { at: number; fn: () => void }[] = []; waveT = 0; waveDone = false; hudT = 0; t = 0; shake = 0; archerCd = 2;
  camBase = new THREE.Vector3(0.9, WALL_TOP + 3.4, 2.6); camLook = new THREE.Vector3(0.9, WALL_TOP - 1.5, -30);
  spiderMat = new THREE.MeshStandardMaterial({ color: 0x2a1d3a, roughness: 0.55, metalness: 0.1 }); spiderMat2 = new THREE.MeshStandardMaterial({ color: 0x4b2a6b, roughness: 0.45, metalness: 0.15, emissive: 0x160a24 }); eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b }); legMat = new THREE.MeshStandardMaterial({ color: 0x1d1626, roughness: 0.7 });
  spearGeo!: THREE.BufferGeometry; boltMat = new THREE.LineBasicMaterial({ color: 0xcfe1ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(canvas: HTMLCanvasElement, cb: Callbacks) { this.canvas = canvas; this.cb = cb; }

  async init() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" }); this.renderer = r;
    r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0a0d1c); this.scene.fog = new THREE.FogExp2(0x161226, 0.0062);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400); this.camera.position.copy(this.camBase); this.camera.lookAt(this.camLook);
    const tl = new THREE.TextureLoader(); const load = (n: string, p: string) => new Promise<void>((res) => tl.load(p, (t) => { t.colorSpace = THREE.SRGBColorSpace; this.tex[n] = t; res(); }, undefined, () => res()));
    await Promise.all([load("wall", "/siege/art/wall_tile.png"), load("ground", "/siege/art/ground_tile.png"), load("backdrop", "/siege/art/backdrop.png"), ...["glow", "flare", "spark", "smoke", "dirt", "ring", "flame", "bolt2", "star"].map((n) => load(n, `/siege/fx/${n}.png`))]);
    this.buildWorld(); this.buildFx();
    const rp = new RenderPass(this.scene, this.camera); const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.82); this.composer = new EffectComposer(r); this.composer.addPass(rp); this.composer.addPass(bloom);
    this.fit(); window.addEventListener("resize", this.fitBound); requestAnimationFrame(this.fitBound); setTimeout(this.fitBound, 300);
    this.bindInput(); await this.setFaction(this.faction);
    this.ready = true; (window as any).__siege = this; this.pushHud(); this.loop();
  }
  fitBound = () => this.fit();
  fit() { const el = this.canvas.parentElement || this.canvas; const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight); this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.fov = w / h < 1.2 ? 72 : 58; this.camera.updateProjectionMatrix(); }
  destroy() { this.over = true; window.removeEventListener("resize", this.fitBound); try { this.renderer.dispose(); } catch {} }

  // ── the world
  buildWorld() {
    const S = this.scene; const wallTex = this.tex.wall, gTex = this.tex.ground;
    if (wallTex) { wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping; wallTex.anisotropy = 4; } if (gTex) { gTex.wrapS = gTex.wrapT = THREE.RepeatWrapping; gTex.repeat.set(60, 60); gTex.anisotropy = 4; }
    const stone = (rx: number, ry: number) => { const m = new THREE.MeshStandardMaterial({ color: 0xa7adbd, roughness: 0.92, metalness: 0.02 }); if (wallTex) { const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); m.map = t; } return m; };
    // ground (the field) + a trampled road toward the gate
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xc8bfae, roughness: 1, map: gTex || null })); ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = true; S.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 120), new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 1, transparent: true, opacity: 0.55 })); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, FIELD_Z - 60); S.add(road);
    // the wall: a long block, the walk on top, merlons along the field edge, a gate arch below the player
    const wall = new THREE.Mesh(new THREE.BoxGeometry(90, WALL_TOP, WALL_T), stone(30, 3)); wall.position.set(0, WALL_TOP / 2, WALL_Z); wall.receiveShadow = true; wall.castShadow = true; S.add(wall);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(90, 0.25, WALL_T + 0.4), stone(30, 1)); walk.position.set(0, WALL_TOP + 0.12, WALL_Z); walk.receiveShadow = true; S.add(walk);
    const mer = stone(0.5, 0.6);
    for (let x = -44; x <= 44; x += 1.5) { if (Math.abs(x) < 0.9) continue; const m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.25, 0.6), mer); m.position.set(x, WALL_TOP + 0.85, FIELD_Z + 0.3); m.castShadow = true; m.receiveShadow = true; S.add(m); }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(90, 0.5, 0.6), mer); lip.position.set(0, WALL_TOP + 0.45, FIELD_Z + 0.3); S.add(lip);   // low parapet under the merlons
    // gate below: dark arch + wooden door + iron bands
    const arch = new THREE.Mesh(new THREE.BoxGeometry(4.2, 5.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 })); arch.position.set(0, 2.7, FIELD_Z + 0.05); S.add(arch);
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4.9, 0.25), new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.85 })); door.position.set(0, 2.45, FIELD_Z - 0.05); S.add(door);
    for (const y of [1.2, 2.4, 3.6]) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: 0x24242c, roughness: 0.5, metalness: 0.6 })); b.position.set(0, y, FIELD_Z - 0.06); S.add(b); }
    // towers either side + roofs + battlements
    for (const tx of [-13, 13]) {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.0, 17, 24), stone(8, 5)); tw.position.set(tx, 8.5, WALL_Z - 1); tw.castShadow = true; tw.receiveShadow = true; S.add(tw);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.5, 24), mer); ring.position.set(tx, 17.2, WALL_Z - 1); S.add(ring);
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.6), mer); m.position.set(tx + Math.cos(a) * 3.8, 17.9, WALL_Z - 1 + Math.sin(a) * 3.8); m.rotation.y = -a; S.add(m); }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 5.5, 24), new THREE.MeshStandardMaterial({ color: tx < 0 ? 0x4a2f6a : 0x6a2a3a, roughness: 0.8 })); roof.position.set(tx, 21.1, WALL_Z - 1); roof.castShadow = true; S.add(roof);
      this.torch(tx + (tx < 0 ? 4.2 : -4.2), WALL_TOP + 2.2, WALL_Z + 0.6, 1.6);
    }
    // the keep behind the wall (silhouette + windows)
    const keep = new THREE.Mesh(new THREE.BoxGeometry(22, 26, 12), stone(7, 8)); keep.position.set(-4, 13, WALL_Z + 14); keep.castShadow = true; keep.receiveShadow = true; S.add(keep);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(15, 8, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a4f, roughness: 0.9 })); keepRoof.position.set(-4, 30, WALL_Z + 14); keepRoof.rotation.y = Math.PI / 4; S.add(keepRoof);
    const win = new THREE.MeshBasicMaterial({ color: 0xffb347 }); for (const [wx, wy] of [[-10, 16], [-6, 19], [-1, 16], [3, 21], [-8, 23], [1, 12]]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.1), win); w.position.set(wx, wy, WALL_Z + 8 - 0.01); S.add(w); }
    // torches along the walk
    for (const tx of [-6.5, -3.2, 3.2, 6.5]) this.torch(tx, WALL_TOP + 1.9, WALL_Z + 1.1, 1.1);
    // scattered rocks and dead trees in the field, distant hills
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4d4a52, roughness: 0.95 });
    for (let i = 0; i < 60; i++) { const s = 0.4 + Math.random() * 1.6; const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat); const x = (Math.random() - 0.5) * 160, z = FIELD_Z - 6 - Math.random() * 130; if (Math.abs(x) < 6) continue; m.position.set(x, s * 0.4, z); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); m.castShadow = true; m.receiveShadow = true; S.add(m); }
    // painted backdrop (sky, moon, mountains) as a far billboard; the sky dome fills what it does not cover
    if (this.tex.backdrop) { const bd = new THREE.Mesh(new THREE.PlaneGeometry(1000, 440), new THREE.MeshBasicMaterial({ map: this.tex.backdrop, fog: false, depthWrite: false })); bd.position.set(0, 120, -330); S.add(bd); }
    const skyGeo = new THREE.SphereGeometry(380, 24, 16); const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {}, vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }", fragmentShader: "varying vec3 vP; float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } void main(){ float h = normalize(vP).y; vec3 top = vec3(0.03,0.04,0.10); vec3 mid = vec3(0.10,0.10,0.23); vec3 hor = vec3(0.30,0.17,0.24); vec3 c = h > 0.25 ? mix(mid, top, (h-0.25)/0.75) : mix(hor, mid, clamp(h/0.25, 0.0, 1.0)); vec2 uv = normalize(vP).xz / max(0.05, h + 0.4) * 60.0; float s = step(0.9985, hash(floor(uv))) * clamp(h * 3.0, 0.0, 1.0); c += s * 0.9; gl_FragColor = vec4(c, 1.0); }" });
    const sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -10; S.add(sky);
    // lights: moon key (shadows), cool fill, warm fill from the torches
    const moonL = new THREE.DirectionalLight(0xbfc8ff, 2.4); moonL.position.set(60, 90, -80); moonL.castShadow = true; moonL.shadow.mapSize.set(2048, 2048); const sc = moonL.shadow.camera as THREE.OrthographicCamera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 300; moonL.shadow.bias = -0.0008; S.add(moonL); S.add(moonL.target);
    S.add(new THREE.HemisphereLight(0x6a7ab8, 0x2a2028, 1.25));
    // aim marker on the ground
    this.marker = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 40), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); this.marker.rotation.x = -Math.PI / 2; this.marker.position.set(0, 0.06, -30); S.add(this.marker);
    // spear geometry (shared): shaft + tip, pointing along -z
    const shaft = new THREE.CylinderGeometry(0.035, 0.05, 2.4, 6); shaft.rotateX(-Math.PI / 2); const tip = new THREE.ConeGeometry(0.09, 0.45, 6); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, -1.4); this.spearGeo = shaft; (this as any).tipGeo = tip;
  }
  torch(x: number, y: number, z: number, k: number) {
    const l = new THREE.PointLight(0xff9a3a, 11 * k, 22, 1.8); l.position.set(x, y, z); l.userData.k = k; this.scene.add(l); this.torchLights.push(l);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flame, color: 0xffc36a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); f.scale.set(0.6 * k, 1.0 * k, 1); f.position.set(x, y + 0.2, z); this.scene.add(f); this.flames.push(f);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xff9a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })); g.scale.set(2.2 * k, 2.2 * k, 1); g.position.set(x, y, z); this.scene.add(g); this.flames.push(g);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x5a4030, emissive: 0x2a1a10 })); post.position.set(x, y - 0.8, z); this.scene.add(post);
  }
  buildFx() { /* particle pool is created on demand */ }

  // ── your ant
  async setFaction(fid: string) {
    this.faction = fid; if (this.hero) { this.scene.remove(this.hero); this.hero = null; this.mixer = null; this.actions = {}; this.current = null; }
    this.reloadTime = fid === "yamabushi" ? 1.5 : 1.1;
    const gl = new GLTFLoader(); const dr = new DRACOLoader(); dr.setDecoderPath("/draco/"); gl.setDRACOLoader(dr); const fb = new FBXLoader();
    const gltf = await gl.loadAsync(`/faction-wars/characters/${fid}/${fid}.glb`); if (this.over || this.faction !== fid) return;
    const s = gltf.scene; s.traverse((o: any) => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m) { m.side = THREE.DoubleSide; m.transparent = false; m.opacity = 1; } } });
    s.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(s); const h = Math.max(0.01, box.max.y - box.min.y); const k = 1.85 / h; s.scale.setScalar(k); s.position.set(-1.7, WALL_TOP + 0.25 - box.min.y * k, WALL_Z + 0.55); s.rotation.y = Math.PI;   // back to the camera, facing the field
    this.scene.add(s); this.hero = s;
    const mixer = new THREE.AnimationMixer(s); this.mixer = mixer;
    const fbxs = await Promise.all(CLIPS.map((c) => fb.loadAsync(`/faction-wars/characters/${fid}/${c}.fbx`).catch(() => null))); if (this.over || this.faction !== fid) return;
    CLIPS.forEach((c, i) => { const src = fbxs[i]?.animations?.[0]; if (!src) return; const clip = src.clone(); clip.tracks = clip.tracks.map((t) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; }).filter((t) => t.name.endsWith(".quaternion")); const a = mixer.clipAction(clip); if (c === "idle") a.setLoop(THREE.LoopRepeat, Infinity); else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } this.actions[c] = a; });
    mixer.addEventListener("finished", () => { if (this.current && this.current !== this.actions.idle) this.play("idle"); });
    this.play("idle");
  }
  play(n: string, speed = 1) { const a = this.actions[n] || this.actions.idle; if (!a) return; if (this.current && this.current !== a) this.current.fadeOut(0.1); a.reset(); a.setEffectiveTimeScale(speed); a.fadeIn(0.1); a.play(); this.current = a; }

  // ── input: pointer aims, press charges, release throws
  bindInput() {
    const cv = this.canvas; const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); this.pointer.x = (e.clientX - r.left) / r.width; this.pointer.y = (e.clientY - r.top) / r.height; };
    cv.addEventListener("pointermove", (e) => pos(e));
    cv.addEventListener("pointerdown", (e) => { pos(e); if (this.state === "ready") { this.start(); return; } if (this.state !== "play" || this.reload > 0) return; this.charging = true; this.charge = 0; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    const up = (e: PointerEvent) => { if (!this.charging) return; pos(e); this.charging = false; this.fire(Math.min(1, this.charge / 0.7)); this.charge = 0; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  }
  updateAim() {
    const ndc = new THREE.Vector2(this.pointer.x * 2 - 1, -(this.pointer.y * 2 - 1)); const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3(); const wallHit = new THREE.Vector3();
    const onWall = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -FIELD_Z), wallHit) && wallHit.y > 0.5 && wallHit.y < WALL_TOP - 0.4;
    const ok = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    if (onWall) { this.aim.lerp(new THREE.Vector3(wallHit.x, wallHit.y, FIELD_Z - 0.6), 0.4); }
    else if (ok && hit.z < FIELD_Z - 2) { this.aim.lerp(new THREE.Vector3(hit.x, 0, hit.z), 0.35); } else { const far = rc.ray.at(60, new THREE.Vector3()); this.aim.lerp(new THREE.Vector3(far.x, 0, Math.min(FIELD_Z - 6, far.z)), 0.35); }
    this.aim.z = Math.min(FIELD_Z - 0.6, Math.max(-140, this.aim.z)); this.aim.x = Math.max(-70, Math.min(70, this.aim.x));
    this.marker.position.set(this.aim.x, this.aim.y + 0.06, this.aim.z); this.marker.rotation.x = this.aim.y > 0.2 ? 0 : -Math.PI / 2; const d = Math.hypot(this.aim.x, this.aim.z); const ms = 0.8 + d * 0.02 + (this.charging ? this.charge * 1.4 : 0); this.marker.scale.set(ms, ms, 1); (this.marker.material as THREE.MeshBasicMaterial).color.setHex(this.charging && this.charge > 0.65 ? 0xff8a4a : 0xffd27a);
  }
  /** launch velocity from `from` to land on `to` with speed `sp` (low arc); falls back to a 40° lob when out of range */
  ballistic(from: THREE.Vector3, to: THREE.Vector3, sp: number) {
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y; const dist = Math.hypot(dx, dz); const disc = sp ** 4 - G * (G * dist * dist + 2 * dy * sp * sp);
    let ang: number; if (disc < 0) ang = 0.7; else ang = Math.atan((sp * sp - Math.sqrt(disc)) / (G * dist));
    const vh = Math.cos(ang) * sp, vy = Math.sin(ang) * sp; return new THREE.Vector3((dx / dist) * vh, vy, (dz / dist) * vh);
  }
  hand() { return new THREE.Vector3(-1.3, WALL_TOP + 1.9, WALL_Z + 0.1); }
  fire(k: number) {
    if (this.state !== "play") return; this.reload = this.reloadTime * (0.8 + k * 0.5); const kit = KIT[this.faction] || KIT.ashigaru; this.play(kit.clip, 1.5); this.cb.onSfx?.("launch"); this.shake = Math.max(this.shake, 0.15 + k * 0.2);
    if (this.faction === "yamabushi") { const p = this.hand(); const v = this.ballistic(p, this.aim, 28); this.spawnOrb(p, v, k); this.say(k > 0.65 ? "Yamabushi: STORM CALL!" : "Yamabushi: Storm Orb", 0.8); return; }
    // Ashigaru: one spear, or a volley of five when charged
    const n = k > 0.65 ? 5 : 1; const p = this.hand();
    for (let i = 0; i < n; i++) { const tgt = this.aim.clone(); if (n > 1) { tgt.x += (i - 2) * 2.2 + (Math.random() - 0.5); tgt.z += (Math.random() - 0.5) * 3; } const v = this.ballistic(p, tgt, 34); this.spawnSpear(p.clone().add(new THREE.Vector3((i - (n - 1) / 2) * 0.15, 0, 0)), v, k); }
    this.say(n > 1 ? "Ashigaru: SPEAR VOLLEY!" : "Ashigaru: Spear!", 0.7);
  }
  spawnSpear(p: THREE.Vector3, v: THREE.Vector3, k: number, ally = false) {
    const m = new THREE.Group(); const sh = new THREE.Mesh(this.spearGeo, new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.7 })); const tp = new THREE.Mesh((this as any).tipGeo, new THREE.MeshStandardMaterial({ color: 0xe6ebdc, roughness: 0.3, metalness: 0.7 })); m.add(sh, tp); if (ally) m.scale.setScalar(0.55); m.position.copy(p); this.scene.add(m);
    this.shots.push({ m, p: p.clone(), v, kind: ally ? "arrow" : "spear", life: 6, dmg: ally ? 25 : 90 + k * 40, hit: new Set(), k, ally });
  }
  spawnOrb(p: THREE.Vector3, v: THREE.Vector3, k: number) {
    const m = new THREE.Group(); const core = new THREE.Mesh(new THREE.SphereGeometry(0.28 + k * 0.18, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdfe8ff })); const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0x9ec7ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(3.2 + k * 2, 3.2 + k * 2, 1); m.add(core, halo);
    const light = new THREE.PointLight(0x9ec7ff, 30 + k * 30, 30, 1.6); m.add(light); m.position.copy(p); this.scene.add(m);
    this.shots.push({ m, p: p.clone(), v, kind: "orb", life: 6, dmg: 80 + k * 50, hit: new Set(), light, k });
  }

  // ── the horde
  spawnSpider(size = 1) {
    const g = new THREE.Group(); const legs: THREE.Group[] = [];
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), this.spiderMat2); abd.scale.set(1, 0.8, 1.25); abd.position.set(0, 0.55, 0.45); abd.castShadow = true; g.add(abd);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), this.spiderMat); head.position.set(0, 0.5, -0.35); head.castShadow = true; g.add(head);
    for (const ex of [-0.13, 0.13]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), this.eyeMat); e.position.set(ex, 0.58, -0.66); g.add(e); }
    for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 4; i++) {
      const hip = new THREE.Group(); hip.position.set(side * 0.3, 0.55, -0.3 + i * 0.25); const up = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.9, 5), this.legMat); up.position.set(side * 0.4, 0.15, 0); up.rotation.z = side * -1.1; hip.add(up);
      const knee = new THREE.Group(); knee.position.set(side * 0.78, 0.3, 0); const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.95, 5), this.legMat); lo.position.set(side * 0.18, -0.42, 0); lo.rotation.z = side * 0.45; knee.add(lo); hip.add(knee);
      hip.rotation.y = side * (i - 1.5) * 0.38; g.add(hip); legs.push(hip);
    }
    g.scale.setScalar(size * 1.7); const x = (Math.random() - 0.5) * 44, z = FIELD_Z - 75 - Math.random() * 25; g.position.set(x, 0, z); this.scene.add(g);
    this.spiders.push({ g, legs, x, y: 0, z, climb: 0, hp: 60 * size * size, size, speed: (7.5 + Math.random() * 2.5) / Math.sqrt(size), ph: Math.random() * 6, stun: 0, dead: false, arrived: false, wob: Math.random() * 6 }); this.hordeLeft++;
  }
  stepSpiders(dt: number) {
    for (const s of this.spiders) {
      if (s.dead) continue; if (s.stun > 0) { s.stun -= dt; continue; }
      if (!s.arrived) {
        const tx = Math.sign(s.x) * Math.max(0, Math.abs(s.x) - 1.2 * dt * s.speed * 0.5) + Math.sin(this.t * 0.7 + s.wob) * 0.02; s.x = tx; s.z += s.speed * dt; s.g.position.set(s.x, 0, s.z);
        s.g.rotation.y = Math.PI + Math.atan2(-Math.sin(this.t * 0.7 + s.wob) * 0.04, 1); const ph = this.t * 11 + s.ph;
        s.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * 1.3) * 0.5; });
        if (s.z >= FIELD_Z - 2.6 * s.size) { s.arrived = true; s.z = FIELD_Z - 2.6 * s.size; }
      } else {
        // it climbs the wall face; at the top it hangs on the parapet and tears at the stone
        const top = WALL_TOP - 0.2; const ph = this.t * 9 + s.ph;
        if (s.y < top) { s.y = Math.min(top, s.y + s.speed * 0.32 * dt); s.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * 1.3) * 0.45; }); this.hurtGate(dt * 1.5 * s.size); }
        else { s.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.t * 22 + i) * 0.25; }); this.hurtGate(dt * 9 * s.size); if (Math.random() < dt * 0.8) this.puff(new THREE.Vector3(s.x, top + 0.9, FIELD_Z + 0.2), "spark", 3, 0xffd27a, 0.6, 0.5); }
        s.z = FIELD_Z - 0.55 * s.size; s.g.position.set(s.x, s.y, s.z); s.g.rotation.set(-Math.PI / 2 + 0.15, Math.PI, 0);
      }
    }
  }
  center(s: Spider) { return new THREE.Vector3(s.x, s.y + 0.8 * s.size, s.z); }
  hurt(s: Spider, d: number) {
    if (s.dead) return; s.hp -= d; s.stun = Math.max(s.stun, 0.25); if (s.hp > 0) { this.puff(s.g.position.clone().add(new THREE.Vector3(0, 0.8 * s.size, 0)), "spark", 3, 0xc4b5fd, 0.5, 0.25); return; }
    s.dead = true; this.kills++; this.score += Math.round(10 * s.size); this.hordeLeft--; this.cb.onSfx?.("squish");
    const p = this.center(s); this.puff(p, "dirt", 10, 0x8b5cf6, 1.2 * s.size, 3.5); this.puff(p, "glow", 3, 0xc4b5fd, 2 * s.size, 0.8, 0.5); this.puff(p, "smoke", 4, 0x6a5a7a, 1.6 * s.size, 1.2, 0.9);
    // the body flips and sinks
    const g = s.g; const t0 = this.t; const y0 = s.y; const tick = () => { if (this.over) return; const k = this.t - t0; g.rotation.x += 0.15; g.position.y = y0 - k * k * 6; if (k < 1.4) requestAnimationFrame(tick); else this.scene.remove(g); }; tick();
  }
  spidersNear(p: THREE.Vector3, r: number) { return this.spiders.filter((s) => !s.dead && this.center(s).distanceTo(p) <= r + s.size * 1.1); }

  // ── shots: spears pierce along their path and pin the ground; orbs burst into chain lightning; ally arrows from the towers
  stepShots(dt: number) {
    for (const sh of this.shots) {
      sh.life -= dt; if (sh.life <= 0) continue; const prev = sh.p.clone(); sh.v.y -= G * dt; sh.p.addScaledVector(sh.v, dt); sh.m.position.copy(sh.p);
      if (sh.kind !== "orb") { const dir = sh.v.clone().normalize(); sh.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir); }
      else { sh.m.children[0].rotation.y += dt * 6; if (Math.random() < 0.8) this.puff(sh.p, "spark", 1, 0x9ec7ff, 0.5, 0.15, 0.25); }
      // hits along the segment
      for (const s of this.spidersNear(sh.p, sh.kind === "orb" ? 1.4 : 1.0)) { if (sh.hit.has(s)) continue; sh.hit.add(s); void prev;
        if (sh.kind === "orb") { this.stormBurst(sh); sh.life = 0; break; } this.hurt(s, sh.dmg); if (sh.kind === "arrow") { sh.life = 0; break; } sh.v.multiplyScalar(0.7); }
      if (sh.life <= 0) continue;
      if (sh.p.y <= 0.05) { if (sh.kind === "orb") this.stormBurst(sh); else { sh.p.y = 0.05; sh.m.position.copy(sh.p); this.puff(sh.p, "dirt", sh.kind === "arrow" ? 2 : 5, 0x9c8a6a, 0.7, 2); if (sh.kind === "spear") { for (const s of this.spidersNear(sh.p, 2.2 + sh.k)) if (!sh.hit.has(s)) { sh.hit.add(s); this.hurt(s, sh.dmg * 0.6); s.stun = 1.2; } this.ringFx(sh.p, 0xffd27a, 3 + sh.k * 2); this.shake = Math.max(this.shake, 0.2); this.cb.onSfx?.("impact"); } sh.v.set(0, 0, 0); sh.life = Math.min(sh.life, 1.2); (sh as any).stuck = true; } }
      if (sh.p.z > FIELD_Z - 0.2 && sh.p.y < WALL_TOP + 0.3 && !(sh as any).stuck) { if (sh.kind === "orb") this.stormBurst(sh); else this.puff(sh.p, "spark", 3, 0xffd27a, 0.5, 1.5); sh.life = 0; }   // into the wall face
    }
    for (const sh of this.shots) if (sh.life <= 0) { this.scene.remove(sh.m); sh.light?.dispose(); }
    this.shots = this.shots.filter((sh) => sh.life > 0);
    for (const sh of this.shots) if ((sh as any).stuck) { /* stays pinned until life runs out */ }
  }
  stormBurst(sh: Shot) {
    const p = sh.p.clone(); p.y = Math.max(p.y, 0.6); const n = 6 + Math.round(sh.k * 6); const r = 9 + sh.k * 6;
    const targets = this.spiders.filter((s) => !s.dead).map((s) => ({ s, d: this.center(s).distanceTo(p) })).filter((o) => o.d <= r).sort((a, b) => a.d - b.d).slice(0, n);
    let from = p; this.puff(p, "flare", 1, 0xbfd6ff, 8 + sh.k * 6, 0, 0.3); this.ringFx(p, 0x9ec7ff, 6 + sh.k * 6); this.shake = Math.max(this.shake, 0.6 + sh.k * 0.5); this.cb.onSfx?.("crash");
    const flash = new THREE.PointLight(0x9ec7ff, 260, 60, 1.5); flash.position.copy(p); this.scene.add(flash); setTimeout(() => this.scene.remove(flash), 120);
    for (const { s } of targets) { const to = this.center(s); this.bolt(from, to); this.hurt(s, sh.dmg); s.stun = 1.4; this.puff(to, "spark", 4, 0xbfd6ff, 1.2, 1.5); from = to; }
    if (!targets.length) this.puff(p, "dirt", 8, 0x9c8a6a, 1, 3);
  }
  bolt(a: THREE.Vector3, b: THREE.Vector3) {
    const pts: THREE.Vector3[] = []; const n = 9; for (let i = 0; i <= n; i++) { const t = i / n; const q = a.clone().lerp(b, t); if (i > 0 && i < n) q.add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2)); pts.push(q); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.boltMat.clone()); this.scene.add(l); this.bolts.push({ l, life: 0.22 });
    const l2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7c9cff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); l2.scale.setScalar(1.002); this.scene.add(l2); this.bolts.push({ l: l2, life: 0.3 });
  }
  stepArchers(dt: number) {
    this.archerCd -= dt; if (this.archerCd > 0) return; this.archerCd = 1.6 + Math.random() * 1.4;
    const live = this.spiders.filter((s) => !s.dead && s.z > FIELD_Z - 70); if (!live.length) return; const s = live[(Math.random() * Math.min(4, live.length)) | 0];
    const from = new THREE.Vector3(Math.random() < 0.5 ? -11 : 11, WALL_TOP + 9.5, WALL_Z); const to = new THREE.Vector3(s.x, 0.5, s.z + s.speed * 0.9); this.spawnSpear(from, this.ballistic(from, to, 40), 0, true);
  }

  // ── gate / waves / flow
  hurtGate(d: number) { if (this.state !== "play") return; this.gateHp = Math.max(0, this.gateHp - d); if (this.gateHp <= 0) this.end(false); }
  start() { if (this.state !== "ready") return; this.state = "play"; this.gateHp = this.gateMax; this.wave = 0; this.score = 0; this.kills = 0; this.nextWave(); this.pushHud(); }
  nextWave() {
    if (this.wave >= WAVES.length) { this.end(true); return; }
    const w = WAVES[this.wave]; this.wave++; this.waveDone = false; this.say(this.wave === WAVES.length ? "FINAL WAVE — hold the gate!" : `WAVE ${this.wave}`, 2.2); if (this.wave === 4) this.cb.onSfx?.("horn");
    let t = 1.2; this.spawnQueue = [];
    for (let i = 0; i < w.crawlers; i++) { this.spawnQueue.push({ at: t, fn: () => this.spawnSpider(0.85 + Math.random() * 0.4) }); t += w.gap * (0.6 + Math.random() * 0.8); }
    for (let i = 0; i < w.big + (w.tower || 0) + (w.ram || 0); i++) this.spawnQueue.push({ at: 2 + Math.random() * t, fn: () => this.spawnSpider(1.7 + Math.random() * 0.5) });
    this.spawnQueue.sort((a, b) => a.at - b.at); this.waveT = 0;
  }
  end(won: boolean) { if (this.state !== "play") return; this.state = won ? "won" : "lost"; this.say(won ? "THE HORN SOUNDS — the gate held 👑" : "THE GATE HAS FALLEN", 4); this.cb.onSfx?.(won ? "win" : "lose"); if (!won) { this.shake = 2; this.puff(new THREE.Vector3(0, 3, FIELD_Z), "smoke", 30, 0x6a5a5a, 6, 3, 2.2); } this.pushHud(); setTimeout(() => this.cb.onEnd?.({ won, score: this.score, kills: this.kills, waves: this.wave }), 1500); }
  say(m: string, t = 1.6) { this.msg = m; this.msgT = t; this.pushHud(); }
  pushHud() { this.cb.onHud({ gate: Math.ceil(this.gateHp), gateMax: this.gateMax, wave: this.wave, waves: WAVES.length, horde: Math.max(0, this.hordeLeft), score: this.score, kills: this.kills, reload: this.reloadTime > 0 ? Math.max(0, this.reload / (this.reloadTime * 1.3)) : 0, state: this.state, msg: this.msg, charge: this.charging ? Math.min(1, this.charge / 0.7) : 0 }); }

  // ── VFX: additive sprite particles, expanding rings
  puff(p: THREE.Vector3, tex: string, n: number, color: number, size: number, speed: number, life = 0.6) {
    for (let i = 0; i < n; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[tex], color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); const sz = size * (0.6 + Math.random() * 0.8); s.scale.set(sz, sz, 1); s.position.copy(p); s.material.rotation = Math.random() * 6.28; this.scene.add(s);
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI; const v = speed * (0.3 + Math.random()); const lf = life * (0.6 + Math.random() * 0.6);
      this.parts.push({ s, v: new THREE.Vector3(Math.cos(a) * Math.sin(b) * v, Math.abs(Math.cos(b)) * v + v * 0.4, Math.sin(a) * Math.sin(b) * v), life: lf, life0: lf, g: speed > 0 ? 9 : 0, grow: 1 + Math.random() * 0.8, size: sz }); }
  }
  ringFx(p: THREE.Vector3, color: number, r: number) { const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.08, p.z); this.scene.add(m); const t0 = this.t; const tick = () => { if (this.over) return; const k = (this.t - t0) / 0.45; if (k >= 1) { this.scene.remove(m); return; } m.scale.setScalar(1 + k * r); (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k); requestAnimationFrame(tick); }; tick(); }

  // ── loop
  loop = () => { if (this.over) return; requestAnimationFrame(this.loop); const dt = Math.min(0.05, this.clock.getDelta()); this.t += dt; if (this.state === "play") this.step(dt); this.render(dt); };
  step(dt: number) {
    this.waveT += dt; if (this.reload > 0) this.reload -= dt; if (this.charging) this.charge += dt; if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) { this.msg = null; this.pushHud(); } }
    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveT) this.spawnQueue.shift()!.fn();
    this.stepSpiders(dt); this.stepShots(dt); this.stepArchers(dt);
    if (!this.waveDone && !this.spawnQueue.length && this.hordeLeft <= 0) { this.waveDone = true; this.score += 50 * this.wave; setTimeout(() => { if (this.state === "play") this.nextWave(); }, 1800); }
    this.hudT += dt; if (this.hudT > 0.12) { this.hudT = 0; this.pushHud(); }
  }
  render(dt: number) {
    this.mixer?.update(dt); this.updateAim();
    // hero turns a little toward the aim
    if (this.hero) { const want = Math.atan2(this.aim.x - this.hero.position.x, -(this.aim.z - this.hero.position.z)); this.heroSpin += (want * 0.6 - this.heroSpin) * Math.min(1, dt * 6); this.hero.rotation.y = Math.PI + this.heroSpin; }
    for (const [i, f] of this.flames.entries()) { if (!f.userData.sy) f.userData.sy = f.scale.y; const k = 0.85 + Math.sin(this.t * 11 + i * 1.7) * 0.12 + Math.random() * 0.08; f.scale.y = f.userData.sy * k; (f.material as THREE.SpriteMaterial).opacity = (i % 2 === 0 ? 0.9 : 0.35) * k; }
    for (const [i, l] of this.torchLights.entries()) l.intensity = 11 * (0.9 + Math.sin(this.t * 9 + i * 2.1) * 0.12 + Math.random() * 0.1) * (l.userData.k || 1);
    for (const p of this.parts) { p.life -= dt; p.s.position.addScaledVector(p.v, dt); p.v.y -= p.g * dt; const k = Math.max(0, p.life / p.life0); (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.5); const sz = p.size * (1 + (1 - k) * (p.grow - 1)); p.s.scale.set(sz, sz, 1); }
    for (const p of this.parts) if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); } this.parts = this.parts.filter((p) => p.life > 0);
    for (const b of this.bolts) { b.life -= dt; (b.l.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / 0.25); } for (const b of this.bolts) if (b.life <= 0) { this.scene.remove(b.l); b.l.geometry.dispose(); } this.bolts = this.bolts.filter((b) => b.life > 0);
    // camera: over the shoulder, eases toward the aim, kicks on impact
    const look = this.camLook.clone(); look.x += this.aim.x * 0.12; look.z = Math.min(-8, this.aim.z * 0.35); const cp = this.camBase.clone(); cp.x += this.aim.x * 0.02 + (this.charging ? -this.charge * 0.25 : 0);
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); cp.x += (Math.random() - 0.5) * this.shake * 0.25; cp.y += (Math.random() - 0.5) * this.shake * 0.2; }
    this.camera.position.lerp(cp, Math.min(1, dt * 5)); this.camera.lookAt(look);
    this.composer.render();
  }
}
