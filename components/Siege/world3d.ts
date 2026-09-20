// components/Siege/world3d.ts — The Siege: one three.js world, two cameras.
//   side  — the Citadel view: a ¾ cinematic shot along the wall; you man a catapult on the wall-walk (Ronin / Samurai / Warrior / Buke / Shogun).
//   pov   — the Battlements view: over the shoulder of your ant; you throw from the parapet (Ashigaru / Yamabushi / Kenshi / Sohei / Bushi / Wokou).
// Same controls in both: move to aim (marker on the ground or the wall face), hold to charge, release. Horde runs up the field (-z), climbs the wall
// face at z = FIELD_Z; silk towers and beetle rams roll up to the gate. Units are metres; the wall runs along x, the field is -z.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { clone as skClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { type Hud, type Callbacks, type View, KIT, WAVES, viewOf } from "./shared";

const G = 20; const WALL_TOP = 9, WALL_Z = -1.5, WALL_T = 3; const FIELD_Z = WALL_Z - WALL_T / 2;
const CLIPS = ["idle", "attack", "magic", "special", "win"] as const;
const CATAPULT = new THREE.Vector3(22, WALL_TOP + 0.25, WALL_Z); const POV_X = -8.8;   // where you stand in the battlements view (between the gatehouse and the west gate tower)
type Rig = { scene: THREE.Object3D; clips: Record<string, THREE.AnimationClip>; k: number; minY: number };
type Actor = { obj: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction>; current: THREE.AnimationAction | null; fid: string };
type Spider = { g: THREE.Group; legs: THREE.Group[]; x: number; y: number; z: number; hp: number; size: number; speed: number; ph: number; stun: number; dead: boolean; arrived: boolean; wob: number; pinned: number };
type Engine = { kind: "tower" | "ram"; g: THREE.Group; x: number; z: number; hp: number; hpMax: number; speed: number; arrived: boolean; dead: boolean; wheels: THREE.Mesh[]; bangT: number };
type Target = { pos: THREE.Vector3; r: number; s?: Spider; e?: Engine };
type ShotKind = "spear" | "orb" | "arrow" | "boulder" | "blade" | "ward" | "stake" | "hook" | "standard";
type Shot = { m: THREE.Object3D; p: THREE.Vector3; v: THREE.Vector3; kind: ShotKind; life: number; dmg: number; hit: Set<object>; light?: THREE.PointLight; k: number; ally?: boolean; sub?: string; rope?: THREE.Line; stuck?: boolean };
type Part = { s: THREE.Sprite; v: THREE.Vector3; life: number; life0: number; g: number; grow: number; size: number };
type Bolt = { l: THREE.Line; life: number };
type Zone = { kind: "ward" | "trap" | "standard"; pos: THREE.Vector3; r: number; life: number; life0: number; m: THREE.Object3D; tick: number; k: number };
type Fling = { s: Spider; v: THREE.Vector3; t: number; k: number };
const INTRO_LEN = 11;

const rigCache: Record<string, Promise<Rig>> = {};
function loadRig(fid: string): Promise<Rig> {
  if (!rigCache[fid]) rigCache[fid] = (async () => {
    const gl = new GLTFLoader(); const dr = new DRACOLoader(); dr.setDecoderPath("/draco/"); gl.setDRACOLoader(dr); const fb = new FBXLoader();
    const gltf = await gl.loadAsync(`/faction-wars/characters/${fid}/${fid}.glb`); const s = gltf.scene;
    s.traverse((o: any) => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m) { m.side = THREE.DoubleSide; m.transparent = false; m.opacity = 1; } } });
    s.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(s); const h = Math.max(0.01, box.max.y - box.min.y);
    const fbxs = await Promise.all(CLIPS.map((c) => fb.loadAsync(`/faction-wars/characters/${fid}/${c}.fbx`).catch(() => null)));
    const clips: Record<string, THREE.AnimationClip> = {};
    CLIPS.forEach((c, i) => { const src = fbxs[i]?.animations?.[0]; if (!src) return; const clip = src.clone(); clip.tracks = clip.tracks.map((t) => { t.name = t.name.replace(/^mixamorig(?!_)([A-Z][^.]*)(\..+)$/, "mixamorig_$1$2"); return t; }).filter((t) => t.name.endsWith(".quaternion")); clips[c] = clip; });
    return { scene: s, clips, k: 1.85 / h, minY: box.min.y };
  })();
  return rigCache[fid];
}

export class SiegeWorld {
  canvas: HTMLCanvasElement; cb: Callbacks; faction = "ronin"; view: View = "side"; over = false; ready = false;
  renderer!: THREE.WebGLRenderer; scene!: THREE.Scene; camera!: THREE.PerspectiveCamera; composer!: EffectComposer; clock = new THREE.Clock();
  tex: Record<string, THREE.Texture> = {}; hero: Actor | null = null; heroHome = new THREE.Vector3(); heroSpin = 0; garrison: { a: Actor; cd: number }[] = []; catapult!: THREE.Group; arm!: THREE.Group; armK = 0;
  spiders: Spider[] = []; engines: Engine[] = []; shots: Shot[] = []; parts: Part[] = []; bolts: Bolt[] = []; zones: Zone[] = []; flings: Fling[] = []; flames: THREE.Sprite[] = []; torchLights: THREE.PointLight[] = [];
  marker!: THREE.Mesh; aim = new THREE.Vector3(0, 0, -30); pointer = { x: 0.5, y: 0.6 }; charge = 0; charging = false; reload = 0; reloadTime = 1.2;
  state: Hud["state"] = "ready"; gateHp = 1000; gateMax = 1000; wave = 0; score = 0; kills = 0; msg: string | null = null; msgT = 0; hordeLeft = 0; spawnQueue: { at: number; fn: () => void }[] = []; waveT = 0; waveDone = false; hudT = 0; t = 0; shake = 0; rally = 0;
  leap: { t: number; from: THREE.Vector3; to: THREE.Vector3; phase: "fly" | "land" | "back"; k: number } | null = null; camKick = new THREE.Vector3();
  sky!: THREE.Mesh; intro = true; introT = 0; introPath!: THREE.CatmullRomCurve3; introLook!: THREE.CatmullRomCurve3;
  spiderMat = new THREE.MeshStandardMaterial({ color: 0x2a1d3a, roughness: 0.55, metalness: 0.1 }); spiderMat2 = new THREE.MeshStandardMaterial({ color: 0x4b2a6b, roughness: 0.45, metalness: 0.15, emissive: 0x160a24 }); eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b }); legMat = new THREE.MeshStandardMaterial({ color: 0x1d1626, roughness: 0.7 });
  silkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f80, roughness: 0.6, emissive: 0x1a0f2a }); silkMat2 = new THREE.MeshStandardMaterial({ color: 0x7c5cb0, roughness: 0.55, emissive: 0x24143a }); woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 }); shellMat = new THREE.MeshStandardMaterial({ color: 0x2a1f18, roughness: 0.4, metalness: 0.2 }); rockMat = new THREE.MeshStandardMaterial({ color: 0x6b6470, roughness: 0.95 });
  spearGeo!: THREE.BufferGeometry; tipGeo!: THREE.BufferGeometry; boltMat = new THREE.LineBasicMaterial({ color: 0xcfe1ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(canvas: HTMLCanvasElement, cb: Callbacks) { this.canvas = canvas; this.cb = cb; }

  async init() {
    this.view = viewOf(this.faction);
    // React strict mode mounts twice: the first instance is destroyed before its assets finish loading — never touch the canvas from it
    await Promise.resolve(); if (this.over) return;
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" }); this.renderer = r;
    r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0a0d1c); this.scene.fog = new THREE.FogExp2(0x161226, 0.0055);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1500);
    const tl = new THREE.TextureLoader(); const load = (n: string, p: string) => new Promise<void>((res) => tl.load(p, (t) => { t.colorSpace = THREE.SRGBColorSpace; this.tex[n] = t; res(); }, undefined, () => res()));
    await Promise.all([load("wall", "/siege/art/wall_tile.png"), load("ground", "/siege/art/ground_tile.png"), load("backdrop", "/siege/art/backdrop.png"), ...["glow", "flare", "spark", "smoke", "dirt", "ring", "flame", "bolt2", "star", "slash"].map((n) => load(n, `/siege/fx/${n}.png`))]);
    if (this.over) { r.dispose(); return; }
    this.buildWorld(); this.buildCatapult();
    const rp = new RenderPass(this.scene, this.camera); const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.84); this.composer = new EffectComposer(r); this.composer.addPass(rp); this.composer.addPass(bloom);
    this.placeCamera(true); this.fit(); window.addEventListener("resize", this.fitBound); requestAnimationFrame(this.fitBound); setTimeout(this.fitBound, 300);
    this.bindInput(); await Promise.all([this.buildGarrison().catch(() => {}), this.setFaction(this.faction)]); if (this.over) return;
    this.buildIntro();
    this.ready = true; (window as any).__siege = this; (window as any).__THREE = THREE; this.pushHud(); this.loop();
  }
  fitBound = () => this.fit();
  fit() { const el = this.canvas.parentElement || this.canvas; const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight); this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.fov = this.view === "pov" ? (w / h < 1.2 ? 72 : 58) : (w / h < 1.2 ? 62 : 46); this.camera.updateProjectionMatrix(); }
  destroy() { this.over = true; window.removeEventListener("resize", this.fitBound); try { this.renderer?.dispose(); this.renderer?.forceContextLoss?.(); } catch {} }

  // ── cameras
  camBase() { return this.view === "pov" ? new THREE.Vector3(POV_X + 2.6, WALL_TOP + 3.4, 2.6) : new THREE.Vector3(29.5, WALL_TOP + 4.6, -9.5); }
  camLook() { return this.view === "pov" ? new THREE.Vector3(POV_X + 2.6, WALL_TOP - 1.5, -30) : new THREE.Vector3(1, 6.5, -5); }
  placeCamera(snap = false) { const cp = this.camBase(), lk = this.camLook(); if (snap) { this.camera.position.copy(cp); this.camera.lookAt(lk); } }

  // ── the world
  buildWorld() {
    const S = this.scene; const wallTex = this.tex.wall, gTex = this.tex.ground;
    if (wallTex) { wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping; wallTex.anisotropy = 4; } if (gTex) { gTex.wrapS = gTex.wrapT = THREE.RepeatWrapping; gTex.repeat.set(60, 60); gTex.anisotropy = 4; }
    const stone = (rx: number, ry: number, tint = 0xa7adbd) => { const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.92, metalness: 0.02 }); if (wallTex) { const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); m.map = t; } return m; };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0xc8bfae, roughness: 1, map: gTex || null })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; S.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 140), new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 1, transparent: true, opacity: 0.55 })); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, FIELD_Z - 70); S.add(road);
    // curtain wall + walk + merlons + parapet lip; the wall-walk is where everyone stands
    const wall = new THREE.Mesh(new THREE.BoxGeometry(110, WALL_TOP, WALL_T), stone(36, 3)); wall.position.set(0, WALL_TOP / 2, WALL_Z); wall.receiveShadow = true; wall.castShadow = true; S.add(wall);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(110, 0.25, WALL_T + 0.4), stone(36, 1, 0x8f95a6)); walk.position.set(0, WALL_TOP + 0.12, WALL_Z); walk.receiveShadow = true; S.add(walk);
    const mer = stone(0.5, 0.6);
    for (let x = -54; x <= 54; x += 1.5) { if (Math.abs(x) < 0.9) continue; const m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.25, 0.6), mer); m.position.set(x, WALL_TOP + 0.85, FIELD_Z + 0.3); m.castShadow = true; m.receiveShadow = true; S.add(m); }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(110, 0.5, 0.6), mer); lip.position.set(0, WALL_TOP + 0.45, FIELD_Z + 0.3); S.add(lip);
    const back = new THREE.Mesh(new THREE.BoxGeometry(110, 0.9, 0.4), mer); back.position.set(0, WALL_TOP + 0.6, WALL_Z + WALL_T / 2 + 0.1); S.add(back);   // inner parapet
    // buttresses along the field face
    for (let x = -50; x <= 50; x += 10) { if (Math.abs(x) < 4) continue; const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, WALL_TOP - 0.6, 1.2), stone(1, 3, 0xb7bccb)); b.position.set(x, (WALL_TOP - 0.6) / 2, FIELD_Z - 0.5); b.castShadow = true; b.receiveShadow = true; S.add(b); }
    // gate: arch + door + bands + portcullis
    const arch = new THREE.Mesh(new THREE.BoxGeometry(4.6, 5.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 })); arch.position.set(0, 2.9, FIELD_Z + 0.05); S.add(arch);
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.8, 5.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.85 })); door.position.set(0, 2.6, FIELD_Z - 0.08); S.add(door);
    for (const y of [1.2, 2.5, 3.8]) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.18, 0.36), new THREE.MeshStandardMaterial({ color: 0x24242c, roughness: 0.5, metalness: 0.6 })); b.position.set(0, y, FIELD_Z - 0.1); S.add(b); }
    const gateStone = new THREE.Mesh(new THREE.BoxGeometry(6, WALL_TOP + 2.5, WALL_T + 1.2), stone(2.5, 4, 0xb7bccb)); gateStone.position.set(0, (WALL_TOP + 2.5) / 2, WALL_Z); gateStone.castShadow = true; gateStone.receiveShadow = true; S.add(gateStone);   // gatehouse block
    S.add(arch.clone()); const archFront = new THREE.Mesh(new THREE.BoxGeometry(4.6, 5.8, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0806 })); archFront.position.set(0, 2.9, FIELD_Z - 0.55); S.add(archFront); door.position.z = FIELD_Z - 0.75; arch.position.z = FIELD_Z - 0.7;
    for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.6), mer); m.position.set(-2.6 + i * 0.87, WALL_TOP + 3.05, FIELD_Z - 0.3); S.add(m); }
    // round towers flanking the gate and at the far ends, with roofs and battlements
    for (const [tx, rc] of [[-15.5, 0x4a2f6a], [15.5, 0x6a2a3a], [-42, 0x3a2a4f], [42, 0x3a2a4f]] as [number, number][]) {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.1, 17, 24), stone(8, 5)); tw.position.set(tx, 8.5, WALL_Z - 1); tw.castShadow = true; tw.receiveShadow = true; S.add(tw);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.5, 24), mer); ring.position.set(tx, 17.2, WALL_Z - 1); S.add(ring);
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.6), mer); m.position.set(tx + Math.cos(a) * 3.8, 17.9, WALL_Z - 1 + Math.sin(a) * 3.8); m.rotation.y = -a; S.add(m); }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 5.5, 24), new THREE.MeshStandardMaterial({ color: rc, roughness: 0.8 })); roof.position.set(tx, 21.1, WALL_Z - 1); roof.castShadow = true; S.add(roof);
      for (const wy of [6, 11]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.2), new THREE.MeshBasicMaterial({ color: 0xffb347 })); w.position.set(tx, wy, FIELD_Z - 1.05 + 0.02); S.add(w); }
      this.torch(tx + (tx < 0 ? 4.4 : -4.4), WALL_TOP + 2.2, WALL_Z + 0.6, 1.5);
    }
    // the keep behind the wall
    const keep = new THREE.Mesh(new THREE.BoxGeometry(24, 28, 14), stone(8, 9)); keep.position.set(-6, 14, WALL_Z + 16); keep.castShadow = true; keep.receiveShadow = true; S.add(keep);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(16.5, 9, 4), new THREE.MeshStandardMaterial({ color: 0x3a2a4f, roughness: 0.9 })); keepRoof.position.set(-6, 32.5, WALL_Z + 16); keepRoof.rotation.y = Math.PI / 4; S.add(keepRoof);
    const kt = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 36, 20), stone(7, 10)); kt.position.set(6, 18, WALL_Z + 12); kt.castShadow = true; S.add(kt); const ktr = new THREE.Mesh(new THREE.ConeGeometry(3.8, 6, 20), new THREE.MeshStandardMaterial({ color: 0x6a2a3a })); ktr.position.set(6, 39, WALL_Z + 12); S.add(ktr);
    const win = new THREE.MeshBasicMaterial({ color: 0xffb347 }); for (const [wx, wy] of [[-14, 16], [-10, 20], [-4, 16], [0, 22], [-12, 25], [-2, 12], [4, 26]]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.1), win); w.position.set(wx, wy, WALL_Z + 9 - 0.01); S.add(w); }
    for (const tx of [-32, -24, -10.6, -4.6, 4.6, 10.6, 20.5, 25.5, 31]) this.torch(tx, WALL_TOP + 1.9, WALL_Z + 1.1, 1.05);
    for (const tx of [-4.0, 4.0, 17.5, 27]) this.torch(tx, 6.2, FIELD_Z - 0.6, 1.3);
    // field dressing: rocks, dead trees, a broken cart
    for (let i = 0; i < 70; i++) { const s = 0.4 + Math.random() * 1.6; const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), new THREE.MeshStandardMaterial({ color: 0x4d4a52, roughness: 0.95 })); const x = (Math.random() - 0.5) * 180, z = FIELD_Z - 6 - Math.random() * 140; if (Math.abs(x) < 6) continue; m.position.set(x, s * 0.4, z); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); m.castShadow = true; m.receiveShadow = true; S.add(m); }
    for (let i = 0; i < 18; i++) { const x = (Math.random() - 0.5) * 170, z = FIELD_Z - 20 - Math.random() * 120; if (Math.abs(x) < 8) continue; const tr = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 5 + Math.random() * 3, 6), this.woodMat); trunk.position.y = 3; tr.add(trunk); for (let b = 0; b < 4; b++) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 2.5, 5), this.woodMat); br.position.set(0, 4 + b * 0.6, 0); br.rotation.set((Math.random() - 0.5) * 1.2, b * 1.7, 0.6 + Math.random() * 0.5); tr.add(br); } tr.position.set(x, 0, z); tr.castShadow = true; S.add(tr); }
    // painted backdrop + sky dome
    if (this.tex.backdrop) { const bd = new THREE.Mesh(new THREE.PlaneGeometry(1200, 530), new THREE.MeshBasicMaterial({ map: this.tex.backdrop, fog: false, depthWrite: false })); bd.position.set(0, 140, -380); S.add(bd); const bd2 = bd.clone(); bd2.position.set(-380, 140, -60); bd2.rotation.y = Math.PI / 2; S.add(bd2); }
    const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {}, vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }", fragmentShader: "varying vec3 vP; float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } void main(){ float h = normalize(vP).y; vec3 top = vec3(0.03,0.04,0.10); vec3 mid = vec3(0.10,0.10,0.23); vec3 hor = vec3(0.30,0.17,0.24); vec3 c = h > 0.25 ? mix(mid, top, (h-0.25)/0.75) : mix(hor, mid, clamp(h/0.25, 0.0, 1.0)); vec2 uv = normalize(vP).xz / max(0.05, h + 0.4) * 60.0; float s = step(0.9985, hash(floor(uv))) * clamp(h * 3.0, 0.0, 1.0); c += s * 0.9; gl_FragColor = vec4(c, 1.0); }" });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 24, 16), skyMat); sky.renderOrder = -10; S.add(sky); this.sky = sky;
    // lights
    const moonL = new THREE.DirectionalLight(0xbfc8ff, 3.0); moonL.position.set(70, 90, -90); moonL.castShadow = true; moonL.shadow.mapSize.set(2048, 2048); const sc = moonL.shadow.camera as THREE.OrthographicCamera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 320; moonL.shadow.bias = -0.0008; S.add(moonL); S.add(moonL.target);
    S.add(new THREE.HemisphereLight(0x6a7ab8, 0x2a2028, 1.5));
    // aim marker
    this.marker = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 40), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); this.marker.rotation.x = -Math.PI / 2; this.marker.position.set(0, 0.06, -30); S.add(this.marker);
    const shaft = new THREE.CylinderGeometry(0.035, 0.05, 2.4, 6); shaft.rotateX(-Math.PI / 2); const tip = new THREE.ConeGeometry(0.09, 0.45, 6); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, -1.4); this.spearGeo = shaft; this.tipGeo = tip;
  }
  torch(x: number, y: number, z: number, k: number) {
    const l = new THREE.PointLight(0xff9a3a, 11 * k, 22, 1.8); l.position.set(x, y, z); l.userData.k = k; this.scene.add(l); this.torchLights.push(l);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flame, color: 0xffc36a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); f.scale.set(0.6 * k, 1.0 * k, 1); f.position.set(x, y + 0.2, z); this.scene.add(f); this.flames.push(f);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xff9a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })); g.scale.set(2.2 * k, 2.2 * k, 1); g.position.set(x, y, z); this.scene.add(g); this.flames.push(g);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x5a4030, emissive: 0x2a1a10 })); post.position.set(x, y - 0.8, z); this.scene.add(post);
  }
  buildCatapult() {
    const c = new THREE.Group(); c.position.copy(CATAPULT); const w = this.woodMat;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 2.8), w); base.position.y = 0.5; base.castShadow = true; c.add(base);
    for (const dx of [-0.75, 0.75]) for (const dz of [-1.0, 1.0]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 12), this.shellMat); wh.rotation.z = Math.PI / 2; wh.position.set(dx, 0.34, dz); c.add(wh); }
    for (const dx of [-0.55, 0.55]) { const up = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.9, 0.18), w); up.position.set(dx, 1.55, -0.35); up.rotation.x = 0.35; c.add(up); }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 0.16), w); cross.position.set(0, 2.4, -0.7); c.add(cross);
    const arm = new THREE.Group(); arm.position.set(0, 1.25, 0.1); const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.0, 0.16), w); beam.position.y = 1.4; arm.add(beam); const cup = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.shellMat); cup.position.y = 2.95; cup.rotation.x = Math.PI; arm.add(cup); const cw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), this.shellMat); cw.position.y = -0.35; arm.add(cw); c.add(arm); this.arm = arm; arm.rotation.x = 0.95;
    this.scene.add(c); this.catapult = c;
  }
  cupPos() { const p = new THREE.Vector3(0, 2.95, 0); this.arm.localToWorld(p); return p; }

  // ── actors (rigged FW ants)
  async makeActor(fid: string, scale = 1): Promise<Actor> {
    const rig = await loadRig(fid); const obj = skClone(rig.scene) as THREE.Object3D; obj.scale.setScalar(rig.k * scale); obj.userData.minY = rig.minY * rig.k * scale;
    const mixer = new THREE.AnimationMixer(obj); const actions: Record<string, THREE.AnimationAction> = {};
    for (const [n, clip] of Object.entries(rig.clips)) { const a = mixer.clipAction(clip); if (n === "idle") a.setLoop(THREE.LoopRepeat, Infinity); else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } actions[n] = a; }
    const actor: Actor = { obj, mixer, actions, current: null, fid }; mixer.addEventListener("finished", () => { if (actor.current && actor.current !== actions.idle) this.playA(actor, "idle"); });
    this.playA(actor, "idle"); actions.idle && (actions.idle.time = Math.random() * 2); return actor;
  }
  playA(a: Actor, n: string, speed = 1) { const act = a.actions[n] || a.actions.idle; if (!act) return; if (a.current && a.current !== act) a.current.fadeOut(0.1); act.reset(); act.setEffectiveTimeScale(speed); act.fadeIn(0.1); act.play(); a.current = act; }
  play(n: string, speed = 1) { if (this.hero) this.playA(this.hero, n, speed); }
  standAt(a: Actor, x: number, z: number, faceField = true) { a.obj.position.set(x, WALL_TOP + 0.25 - a.obj.userData.minY, z); a.obj.rotation.y = faceField ? Math.PI : 0; }
  async setFaction(fid: string) {
    this.faction = fid; this.view = viewOf(fid); this.reloadTime = (KIT[fid] || KIT.boulder).reload;
    if (this.hero) { this.scene.remove(this.hero.obj); this.hero = null; } this.leap = null; this.handBone = null;
    this.catapult.visible = this.view === "side"; if (!this.intro) this.placeCamera(true); this.fit(); if (this.intro && this.introPath) { this.introPath.points[4] = this.camBase(); this.introLook.points[4] = this.camLook(); }
    if (fid === "boulder") return;
    const a = await this.makeActor(fid); if (this.over || this.faction !== fid) return;
    if (this.view === "pov") this.standAt(a, POV_X, WALL_Z + 0.55); else this.standAt(a, CATAPULT.x - 2.7, WALL_Z + 0.3);
    this.heroHome.copy(a.obj.position); this.scene.add(a.obj); this.hero = a;
    this.handBone = null; a.obj.traverse((o) => { if (!this.handBone && /RightHand$/i.test(o.name)) this.handBone = o; });
  }
  async buildGarrison() {
    const spots: [string, number, number][] = [["ashigaru", -21, WALL_Z + 0.4], ["samurai", 5.5, WALL_Z + 0.4], ["yamabushi", 15.5, WALL_Z + 0.4], ["ashigaru", 26.5, WALL_Z + 0.4], ["kenshi", -26, WALL_Z + 0.4]];
    for (const [fid, x, z] of spots) { const a = await this.makeActor(fid); if (this.over) return; this.standAt(a, x, z); this.scene.add(a.obj); this.garrison.push({ a, cd: 1.5 + Math.random() * 3 }); }
  }

  // ── intro: a slow fly-in over the marching horde, up the wall face, settling into your station
  buildIntro() {
    this.introPath = new THREE.CatmullRomCurve3([new THREE.Vector3(-75, 9, FIELD_Z - 125), new THREE.Vector3(-34, 8, FIELD_Z - 80), new THREE.Vector3(10, 11, FIELD_Z - 42), new THREE.Vector3(26, 17, FIELD_Z - 22), this.camBase()], false, "catmullrom", 0.3);
    this.introLook = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 6, FIELD_Z - 60), new THREE.Vector3(0, 8, FIELD_Z - 20), new THREE.Vector3(0, 10, FIELD_Z), new THREE.Vector3(0, 12, WALL_Z + 6), this.camLook()], false, "catmullrom", 0.3);
    this.introT = 0; this.intro = true; this.marker.visible = false;
    // the horde is already on the field, far out, marching
    for (let i = 0; i < 16; i++) { this.spawnSpider(0.9 + Math.random() * 0.6); const s = this.spiders[this.spiders.length - 1]; s.z = FIELD_Z - 95 - Math.random() * 30; s.x = (Math.random() - 0.5) * 60; s.g.position.set(s.x, 0, s.z); }
  }
  stepIntro(dt: number) {
    this.introT += dt; const u = Math.min(1, this.introT / INTRO_LEN); const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    this.camera.position.copy(this.introPath.getPointAt(e)); this.camKick.copy(this.introLook.getPointAt(e)); this.camera.lookAt(this.camKick);
    for (const s of this.spiders) if (!s.dead) { s.z += s.speed * 0.5 * dt; s.g.position.set(s.x, 0, s.z); const ph = this.t * 6 + s.ph; s.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * 1.3) * 0.5; }); s.g.rotation.set(0, Math.PI, 0); }
    if (u >= 1) this.endIntro();
  }
  endIntro() { if (!this.intro) return; this.intro = false; this.marker.visible = true; this.camera.position.copy(this.camBase()); this.camKick.copy(this.camLook()); this.camera.lookAt(this.camKick); this.pushHud(); }

  // ── input + aim
  bindInput() {
    const cv = this.canvas; const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); this.pointer.x = (e.clientX - r.left) / r.width; this.pointer.y = (e.clientY - r.top) / r.height; };
    cv.addEventListener("pointermove", (e) => pos(e));
    cv.addEventListener("pointerdown", (e) => { pos(e); if (this.intro) { this.endIntro(); return; } if (this.state === "ready") { this.start(); return; } if (this.state !== "play" || this.reload > 0 || this.leap) return; this.charging = true; this.charge = 0; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    const up = (e: PointerEvent) => { if (!this.charging) return; pos(e); this.charging = false; this.fire(Math.min(1, this.charge / 0.7)); this.charge = 0; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  }
  updateAim() {
    const ndc = new THREE.Vector2(this.pointer.x * 2 - 1, -(this.pointer.y * 2 - 1)); const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3(); const wallHit = new THREE.Vector3();
    const onWall = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -FIELD_Z), wallHit) && wallHit.y > 0.5 && wallHit.y < WALL_TOP - 0.4 && rc.ray.direction.z < 0;
    const ok = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    if (onWall) this.aim.lerp(new THREE.Vector3(wallHit.x, wallHit.y, FIELD_Z - 0.6), 0.4);
    else if (ok && hit.z < FIELD_Z - 2) this.aim.lerp(new THREE.Vector3(hit.x, 0, hit.z), 0.35);
    else { const far = rc.ray.at(70, new THREE.Vector3()); this.aim.lerp(new THREE.Vector3(far.x, 0, Math.min(FIELD_Z - 6, far.z)), 0.35); }
    this.aim.z = Math.min(FIELD_Z - 0.6, Math.max(-150, this.aim.z)); this.aim.x = Math.max(-80, Math.min(80, this.aim.x));
    this.marker.position.set(this.aim.x, this.aim.y + 0.06, this.aim.z); this.marker.rotation.x = this.aim.y > 0.2 ? 0 : -Math.PI / 2;
    const d = this.aim.distanceTo(this.camera.position); const ms = (0.6 + d * 0.022) * (this.view === "side" ? 1.4 : 1) + (this.charging ? this.charge * 1.4 : 0); this.marker.scale.set(ms, ms, 1);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(this.charging && this.charge > 0.65 ? 0xff8a4a : 0xffd27a);
  }
  ballistic(from: THREE.Vector3, to: THREE.Vector3, sp: number) {
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y; const dist = Math.max(0.01, Math.hypot(dx, dz)); const disc = sp ** 4 - G * (G * dist * dist + 2 * dy * sp * sp);
    const ang = disc < 0 ? 0.72 : Math.atan((sp * sp - Math.sqrt(disc)) / (G * dist)); const vh = Math.cos(ang) * sp, vy = Math.sin(ang) * sp; return new THREE.Vector3((dx / dist) * vh, vy, (dz / dist) * vh);
  }
  lob(from: THREE.Vector3, to: THREE.Vector3, sp: number) {   // high arc (catapult)
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y; const dist = Math.max(0.01, Math.hypot(dx, dz)); const disc = sp ** 4 - G * (G * dist * dist + 2 * dy * sp * sp);
    const ang = disc < 0 ? 0.9 : Math.atan((sp * sp + Math.sqrt(disc)) / (G * dist)); const vh = Math.cos(ang) * sp, vy = Math.sin(ang) * sp; return new THREE.Vector3((dx / dist) * vh, vy, (dz / dist) * vh);
  }
  handBone: THREE.Object3D | null = null;
  hand() {
    if (this.view === "side") return this.cupPos();
    if (this.handBone) { const p = new THREE.Vector3(); this.handBone.getWorldPosition(p); return p; }
    const h = this.hero ? this.hero.obj.position.clone() : new THREE.Vector3(POV_X, WALL_TOP, WALL_Z); h.y += 1.4; h.z -= 0.4; return h;
  }

  // ── firing: every faction's kit
  fire(k: number) {
    if (this.state !== "play") return; const kit = KIT[this.faction] || KIT.boulder; this.reload = this.reloadTime * (0.85 + k * 0.45); this.play(kit.clip, 1.5); this.cb.onSfx?.("launch"); this.shake = Math.max(this.shake, 0.12 + k * 0.2);
    const f = this.faction; const p = this.hand(); const big = k > 0.65;
    if (this.view === "side") { this.armK = 1; }
    switch (f) {
      case "ronin": this.roninLeap(k); return;
      case "samurai": this.spawnBoulder(p, this.lob(p, this.aim, 30), k, "blade"); this.say(big ? "Samurai: FIRST STRIKE!" : "Samurai: Blade boulder", 0.8); return;
      case "warrior": this.spawnBoulder(p, this.lob(p, this.aim, 27), k, "great"); this.say(big ? "Warrior: BERSERKER RAGE!" : "Warrior: Greatstone", 0.8); return;
      case "buke": this.spawnBoulder(p, this.lob(p, this.aim, 30), k, "shield"); this.say(big ? "Buke: NOBLE GUARD!" : "Buke: Shield boulder", 0.8); return;
      case "shogun": this.spawnStandard(p, this.lob(p, this.aim, 30), k); this.say(big ? "Shogun: RALLY!" : "Shogun: War standard", 0.8); return;
      case "yamabushi": this.spawnOrb(p, this.ballistic(p, this.aim, 28), k, "storm"); this.say(big ? "Yamabushi: STORM CALL!" : "Yamabushi: Storm orb", 0.8); return;
      case "sohei": this.spawnOrb(p, this.ballistic(p, this.aim, 28), k, "ward"); this.say(big ? "Sohei: PRAYER!" : "Sohei: Ward stone", 0.8); return;
      case "kenshi": { const n = big ? 7 : 3; for (let i = 0; i < n; i++) { const tgt = this.aim.clone(); const spread = (i - (n - 1) / 2) * (big ? 1.6 : 2.2); tgt.x += spread; const v = this.ballistic(p, tgt, 48); this.spawnBlade(p.clone(), v, k); } this.say(big ? "Kenshi: IAIJUTSU!" : "Kenshi: Blade fan", 0.7); return; }
      case "bushi": { const n = big ? 3 : 1; for (let i = 0; i < n; i++) { const tgt = this.aim.clone(); if (n > 1) { tgt.x += (i - 1) * 2.6; tgt.z += (Math.random() - 0.5) * 2; } this.spawnStake(p.clone(), this.ballistic(p, tgt, 30), k); } this.say(big ? "Bushi: AMBUSH!" : "Bushi: Trap stake", 0.7); return; }
      case "wokou": this.spawnHook(p, this.ballistic(p, this.aim, 42), k); this.say(big ? "Wokou: BOARDING PARTY!" : "Wokou: Grapple", 0.7); return;
      case "ashigaru": { const n = big ? 5 : 1; for (let i = 0; i < n; i++) { const tgt = this.aim.clone(); if (n > 1) { tgt.x += (i - 2) * 2.2 + (Math.random() - 0.5); tgt.z += (Math.random() - 0.5) * 3; } this.spawnSpear(p.clone().add(new THREE.Vector3((i - (n - 1) / 2) * 0.15, 0, 0)), this.ballistic(p, tgt, 34), k); } this.say(big ? "Ashigaru: SPEAR VOLLEY!" : "Ashigaru: Spear!", 0.7); return; }
      default: this.spawnBoulder(p, this.lob(p, this.aim, 30), k, "rock"); return;
    }
  }
  mkShot(m: THREE.Object3D, p: THREE.Vector3, v: THREE.Vector3, kind: ShotKind, dmg: number, k: number, extra: Partial<Shot> = {}) { m.position.copy(p); this.scene.add(m); const s: Shot = { m, p: p.clone(), v, kind, life: 7, dmg, hit: new Set(), k, ...extra }; this.shots.push(s); return s; }
  spawnSpear(p: THREE.Vector3, v: THREE.Vector3, k: number, ally = false) {
    const m = new THREE.Group(); m.add(new THREE.Mesh(this.spearGeo, new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.7 })), new THREE.Mesh(this.tipGeo, new THREE.MeshStandardMaterial({ color: 0xe6ebdc, roughness: 0.3, metalness: 0.7 }))); if (ally) m.scale.setScalar(0.55);
    this.mkShot(m, p, v, ally ? "arrow" : "spear", ally ? 25 : 90 + k * 40, k, { ally });
  }
  spawnBlade(p: THREE.Vector3, v: THREE.Vector3, k: number) {
    const m = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.28), new THREE.MeshStandardMaterial({ color: 0xdfe6ff, roughness: 0.2, metalness: 0.9, emissive: 0x223050 })); m.add(b); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xbfd0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })); gl.scale.set(1.4, 1.4, 1); m.add(gl);
    this.mkShot(m, p, v, "blade", 70 + k * 30, k);
  }
  spawnOrb(p: THREE.Vector3, v: THREE.Vector3, k: number, sub: "storm" | "ward") {
    const col = sub === "storm" ? 0x9ec7ff : 0xffd27a; const m = new THREE.Group(); m.add(new THREE.Mesh(new THREE.SphereGeometry(0.28 + k * 0.18, 16, 12), new THREE.MeshBasicMaterial({ color: sub === "storm" ? 0xdfe8ff : 0xfff2c0 }))); const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(3.2 + k * 2, 3.2 + k * 2, 1); m.add(halo);
    const light = new THREE.PointLight(col, 30 + k * 30, 30, 1.6); m.add(light); this.mkShot(m, p, v, sub === "storm" ? "orb" : "ward", 80 + k * 50, k, { light });
  }
  spawnStake(p: THREE.Vector3, v: THREE.Vector3, k: number) {
    const m = new THREE.Group(); const st = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x2a2418, roughness: 0.8 })); st.rotation.x = -Math.PI / 2; m.add(st); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xb8ffb0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 })); gl.scale.set(1.2, 1.2, 1); m.add(gl);
    this.mkShot(m, p, v, "stake", 120 + k * 60, k);
  }
  spawnHook(p: THREE.Vector3, v: THREE.Vector3, k: number) {
    const m = new THREE.Group(); for (let i = 0; i < 3; i++) { const pr = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 10, Math.PI), new THREE.MeshStandardMaterial({ color: 0x8a94a8, metalness: 0.8, roughness: 0.3 })); pr.rotation.y = (i / 3) * Math.PI * 2; pr.position.z = -0.2; m.add(pr); }
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone(), p.clone()]), new THREE.LineBasicMaterial({ color: 0xc9b58a })); this.scene.add(rope);
    this.mkShot(m, p, v, "hook", 60, k, { rope });
  }
  spawnBoulder(p: THREE.Vector3, v: THREE.Vector3, k: number, sub: "rock" | "blade" | "great" | "shield") {
    const r = sub === "great" ? 1.25 : 0.85; const m = new THREE.Group(); const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), sub === "shield" ? new THREE.MeshStandardMaterial({ color: 0x6a7fa8, metalness: 0.5, roughness: 0.5, emissive: 0x12203a }) : this.rockMat); rock.castShadow = true; m.add(rock);
    if (sub === "blade") for (let i = 0; i < 4; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.35), new THREE.MeshStandardMaterial({ color: 0xdfe6ff, metalness: 0.9, roughness: 0.2 })); bl.rotation.z = (i / 4) * Math.PI * 2; bl.position.set(Math.cos(bl.rotation.z + Math.PI / 2) * r, Math.sin(bl.rotation.z + Math.PI / 2) * r, 0); m.add(bl); }
    if (sub === "great") { const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffa04a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 })); gl.scale.set(4, 4, 1); m.add(gl); }
    const dmg = sub === "great" ? 160 + k * 80 : sub === "blade" ? 130 + k * 60 : 90 + k * 60;
    this.mkShot(m, p, v, "boulder", dmg, k, { sub }); this.puff(p, "smoke", 4, 0xaaa090, 1, 1, 0.6);
  }
  spawnStandard(p: THREE.Vector3, v: THREE.Vector3, k: number) {
    const m = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), this.woodMat); pole.rotation.x = -Math.PI / 2; m.add(pole); const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ color: 0xe0475b, side: THREE.DoubleSide, emissive: 0x401018 })); flag.position.set(0.7, 0, -1.0); m.add(flag);
    this.mkShot(m, p, v, "standard", 60, k);
  }
  /** Ronin: she leaps to the mark herself, carves everything around her, blinks back to the wall */
  roninLeap(k: number) {
    if (!this.hero || this.leap) return; const from = this.hero.obj.position.clone(); const to = new THREE.Vector3(this.aim.x, 0, Math.min(FIELD_Z - 3, this.aim.z));
    this.leap = { t: 0, from, to, phase: "fly", k }; this.play("special", 1.2); this.puff(from, "smoke", 6, 0x8a8090, 1.2, 1.2, 0.5); this.say(k > 0.65 ? "Ronin: LAST STAND!" : "Ronin: Shadow Step!", 0.9);
  }
  stepLeap(dt: number) {
    const L = this.leap; if (!L || !this.hero) return; L.t += dt; const o = this.hero.obj;
    if (L.phase === "fly") { const T = 0.85; const u = Math.min(1, L.t / T); const p = L.from.clone().lerp(L.to, u); p.y = L.from.y * (1 - u) + Math.sin(u * Math.PI) * 6 - o.userData.minY; o.position.copy(p); o.rotation.y = Math.atan2(L.to.x - L.from.x, L.to.z - L.from.z) + Math.PI; if (u >= 1) { L.phase = "land"; L.t = 0; this.play("attack", 2); const gp = L.to.clone(); this.ringFx(gp, 0xff6b7a, 8 + L.k * 4); this.puff(gp, "dirt", 12, 0xb8a48a, 1.2, 4); this.shake = Math.max(this.shake, 0.7); this.cb.onSfx?.("crash"); const R = 5 + L.k * 2.5; for (const tg of this.targetsNear(gp, R)) { this.hurtTarget(tg, 260 + L.k * 120, "slash"); } } }
    else if (L.phase === "land") { if (L.t > 0.55) { L.phase = "back"; L.t = 0; this.puff(o.position.clone().add(new THREE.Vector3(0, 1, 0)), "smoke", 10, 0x9a8aa8, 1.6, 1.5, 0.7); o.visible = false; } }
    else if (L.t > 0.35) { o.visible = true; o.position.copy(this.heroHome); o.rotation.y = Math.PI; this.play("win", 1.6); this.puff(this.heroHome.clone().add(new THREE.Vector3(0, 1, 0)), "smoke", 8, 0x9a8aa8, 1.4, 1.2, 0.6); this.leap = null; }
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
    g.scale.setScalar(size * 1.7); const x = (Math.random() - 0.5) * 48, z = FIELD_Z - 70 - Math.random() * 25; g.position.set(x, 0, z); this.scene.add(g);
    this.spiders.push({ g, legs, x, y: 0, z, hp: 60 * size * size, size, speed: (4.2 + Math.random() * 1.6) / Math.sqrt(size), ph: Math.random() * 6, stun: 0, dead: false, arrived: false, wob: Math.random() * 6, pinned: 0 }); this.hordeLeft++;
  }
  spawnTower() {
    const g = new THREE.Group(); const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.8, 4.2), this.woodMat); base.position.y = 0.6; base.castShadow = true; g.add(base);
    for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10), this.shellMat); w.rotation.z = Math.PI / 2; w.position.set(dx, 0.5, dz); g.add(w); }
    for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 3.4), j % 2 ? this.silkMat : this.silkMat2); b.position.y = 1.85 + j * 1.75; b.castShadow = true; b.receiveShadow = true; g.add(b); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0x9a6ad0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.25 })); gl.scale.set(4, 4, 1); gl.position.y = b.position.y; g.add(gl); }
    const x = (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 16), z = FIELD_Z - 95; g.position.set(x, 0, z); this.scene.add(g);
    this.engines.push({ kind: "tower", g, x, z, hp: 420, hpMax: 420, speed: 1.5, arrived: false, dead: false, wheels: [], bangT: 0 }); this.hordeLeft++;
  }
  spawnRam() {
    const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 5.2), this.woodMat); body.position.y = 1.5; body.castShadow = true; g.add(body);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), this.shellMat); shell.scale.set(0.85, 0.55, 1.3); shell.position.y = 2.4; shell.castShadow = true; g.add(shell);
    for (const sx of [-0.5, 0.5]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 2.2, 6), this.shellMat); horn.position.set(sx, 2.2, -3.4); horn.rotation.x = -Math.PI / 2 - 0.25; g.add(horn); }
    for (const ex of [-0.45, 0.45]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), this.eyeMat); e.position.set(ex, 2.5, -2.55); g.add(e); }
    const wheels: THREE.Mesh[] = []; for (const [dx, dz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.4, 12), this.shellMat); w.rotation.z = Math.PI / 2; w.position.set(dx, 0.8, dz); g.add(w); wheels.push(w); }
    const x = (Math.random() - 0.5) * 3, z = FIELD_Z - 105; g.position.set(x, 0, z); this.scene.add(g);
    this.engines.push({ kind: "ram", g, x, z, hp: 380, hpMax: 380, speed: 2.6, arrived: false, dead: false, wheels, bangT: 0 }); this.hordeLeft++;
  }
  stepHorde(dt: number) {
    for (const s of this.spiders) {
      if (s.dead) continue; if (s.pinned > 0) { s.pinned -= dt; s.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.t * 30 + i) * 0.15; }); continue; } if (s.stun > 0) { s.stun -= dt; continue; }
      if (!s.arrived) {
        s.x = Math.sign(s.x) * Math.max(0, Math.abs(s.x) - dt * s.speed * 0.25) + Math.sin(this.t * 0.7 + s.wob) * 0.02; s.z += s.speed * dt; s.g.position.set(s.x, 0, s.z); s.g.rotation.set(0, Math.PI, 0);
        const ph = this.t * 9 + s.ph; s.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * 1.3) * 0.5; });
        for (const z of this.zones) if (z.kind === "trap" && z.life > 0 && Math.hypot(s.x - z.pos.x, s.z - z.pos.z) < 1.8 + s.size * 0.6) { z.life = 0; s.pinned = 3; this.hurt(s, 120 + z.k * 60); this.puff(z.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), "spark", 6, 0xb8ffb0, 0.8, 2); this.say("Bushi: pinned!", 0.5); }
        if (s.z >= FIELD_Z - 2.6 * s.size) { s.arrived = true; s.z = FIELD_Z - 2.6 * s.size; }
      } else {
        const top = WALL_TOP - 0.2; const ph = this.t * 8 + s.ph;
        if (s.y < top) { s.y = Math.min(top, s.y + s.speed * 0.28 * dt); s.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * 1.3) * 0.45; }); this.hurtGate(dt * 1.5 * s.size); }
        else { s.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.t * 22 + i) * 0.25; }); this.hurtGate(dt * 9 * s.size); if (Math.random() < dt * 0.8) this.puff(new THREE.Vector3(s.x, top + 0.9, FIELD_Z + 0.2), "spark", 3, 0xffd27a, 0.6, 0.5); }
        s.z = FIELD_Z - 0.55 * s.size; s.g.position.set(s.x, s.y, s.z); s.g.rotation.set(-Math.PI / 2 + 0.15, Math.PI, 0);
      }
    }
    for (const e of this.engines) {
      if (e.dead) continue;
      if (!e.arrived) { e.z += e.speed * dt; e.x += (Math.sign(e.x) * Math.max(0, Math.abs(e.x) - (e.kind === "ram" ? 0 : 8)) - e.x) * dt * 0.08; e.g.position.set(e.x, 0, e.z); for (const w of e.wheels) w.rotation.x += e.speed * dt / 0.8; if (e.kind === "tower") e.g.rotation.z = Math.sin(this.t * 2.2) * 0.02; if (e.z >= FIELD_Z - (e.kind === "ram" ? 3.4 : 3.2)) { e.arrived = true; this.say(e.kind === "ram" ? "Beetle ram at the gate!" : "A siege tower reached the wall!", 1.6); } }
      else { e.bangT += dt; if (e.kind === "ram") { if (e.bangT > 1.4) { e.bangT = 0; this.hurtGate(18); this.shake = Math.max(this.shake, 0.5); this.cb.onSfx?.("gate"); this.puff(new THREE.Vector3(e.x, 2.5, FIELD_Z - 0.4), "dirt", 8, 0xb8a48a, 0.8, 2.5); } e.g.position.z = e.z + Math.max(0, 0.5 - Math.abs(e.bangT - 1.2)) * 1.2 * (e.bangT > 0.7 ? 1 : 0); } else { this.hurtGate(dt * 14); if (Math.random() < dt * 1.2) this.puff(new THREE.Vector3(e.x, WALL_TOP + 0.6, FIELD_Z), "spark", 2, 0xc4b5fd, 0.6, 0.6); } }
    }
  }
  center(s: Spider) { return new THREE.Vector3(s.x, s.y + 0.8 * s.size, s.z); }
  targetsNear(p: THREE.Vector3, r: number): Target[] {
    const out: Target[] = [];
    for (const s of this.spiders) if (!s.dead) { const c = this.center(s); if (c.distanceTo(p) <= r + s.size * 1.1) out.push({ pos: c, r: s.size * 1.1, s }); }
    for (const e of this.engines) if (!e.dead) { const c = new THREE.Vector3(e.x, e.kind === "tower" ? 4 : 2, e.z); const rr = e.kind === "tower" ? 3.2 : 3; if (Math.hypot(c.x - p.x, c.z - p.z) <= r + rr && Math.abs(p.y - c.y) < (e.kind === "tower" ? 5.5 : 3.5) + r) out.push({ pos: c, r: rr, e }); }
    return out;
  }
  hurtTarget(t: Target, d: number, how: "hit" | "slash" | "bolt" = "hit") { if (t.s) { this.hurt(t.s, d); if (how === "slash") this.slashFx(this.center(t.s)); } else if (t.e) this.hurtEngine(t.e, d, t.pos); }
  hurt(s: Spider, d: number) {
    if (s.dead) return; s.hp -= d; s.stun = Math.max(s.stun, 0.25); if (s.hp > 0) { this.puff(this.center(s), "spark", 3, 0xc4b5fd, 0.5, 0.25); return; }
    s.dead = true; this.kills++; this.score += Math.round(10 * s.size); this.hordeLeft--; this.cb.onSfx?.("squish");
    const p = this.center(s); this.puff(p, "dirt", 10, 0x8b5cf6, 1.2 * s.size, 3.5); this.puff(p, "glow", 3, 0xc4b5fd, 2 * s.size, 0.8, 0.5); this.puff(p, "smoke", 4, 0x6a5a7a, 1.6 * s.size, 1.2, 0.9);
    const g = s.g; const t0 = this.t; const y0 = s.y; const tick = () => { if (this.over) return; const k = this.t - t0; g.rotation.x += 0.15; g.position.y = y0 - k * k * 6; if (k < 1.4) requestAnimationFrame(tick); else this.scene.remove(g); }; tick();
  }
  hurtEngine(e: Engine, d: number, at: THREE.Vector3) {
    if (e.dead) return; const low = at.y < 2.2 && e.kind === "tower"; e.hp -= d * (low ? 1.8 : 1); this.puff(at, "spark", 4, e.kind === "tower" ? 0xc4b5fd : 0xffc36a, 0.7, 1.5); if (e.hp > 0) { e.g.position.x += (Math.random() - 0.5) * 0.2; return; }
    e.dead = true; this.hordeLeft--; this.score += e.kind === "tower" ? 120 : 150; this.say(e.kind === "tower" ? "Siege tower toppled! +120" : "Ram destroyed! +150", 1.4); this.cb.onSfx?.("crash"); this.shake = Math.max(this.shake, 0.8);
    const g = e.g; const t0 = this.t; const p0 = g.position.clone(); this.puff(new THREE.Vector3(e.x, 2, e.z), "dirt", 16, 0xb8a48a, 1.4, 4); this.puff(new THREE.Vector3(e.x, 3, e.z), "smoke", 8, 0x6a5a7a, 3, 1.5, 1.2);
    const tick = () => { if (this.over) return; const k = this.t - t0; if (e.kind === "tower") { g.rotation.x = -Math.min(Math.PI / 2, k * k * 3.2); g.position.z = p0.z + Math.min(1.6, k * 1.2); if (k > 1.1) g.position.y = p0.y - (k - 1.1) * 4; } else { g.rotation.z = Math.min(Math.PI, k * 5); g.position.y = p0.y + Math.sin(Math.min(Math.PI, k * 3.5)) * 3 - Math.max(0, k - 0.9) * 5; } if (k < 2.4) requestAnimationFrame(tick); else this.scene.remove(g); }; tick();
  }

  // ── shots + impacts
  stepShots(dt: number) {
    for (const sh of this.shots) {
      sh.life -= dt; if (sh.life <= 0 || sh.stuck) continue; sh.v.y -= G * dt; sh.p.addScaledVector(sh.v, dt); sh.m.position.copy(sh.p);
      if (sh.kind === "orb" || sh.kind === "ward") { sh.m.children[0].rotation.y += dt * 6; if (Math.random() < 0.8) this.puff(sh.p, "spark", 1, sh.kind === "orb" ? 0x9ec7ff : 0xffd27a, 0.5, 0.15, 0.25); }
      else if (sh.kind === "boulder") { sh.m.rotation.x += dt * 5; sh.m.rotation.z += dt * 2; }
      else if (sh.kind === "blade") { sh.m.rotation.y += dt * 30; }
      else { const dir = sh.v.clone().normalize(); sh.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir); }
      if (sh.rope) { const h = this.hand(); (sh.rope.geometry as THREE.BufferGeometry).setFromPoints([h, sh.p]); }
      const R = sh.kind === "orb" || sh.kind === "ward" ? 1.4 : sh.kind === "boulder" ? (sh.sub === "great" ? 1.6 : 1.2) : 1.0;
      for (const tg of this.targetsNear(sh.p, R)) { const key = tg.s || tg.e!; if (sh.hit.has(key)) continue; sh.hit.add(key);
        if (sh.kind === "orb" || sh.kind === "ward" || sh.kind === "boulder" || sh.kind === "standard") { this.impact(sh); sh.life = 0; break; }
        if (sh.kind === "hook") { if (tg.s) this.fling(tg.s, sh.k); else this.hurtTarget(tg, 120); sh.life = 0; break; }
        if (sh.kind === "stake") { this.hurtTarget(tg, sh.dmg); if (tg.s) tg.s.pinned = 2; sh.life = 0; break; }
        this.hurtTarget(tg, sh.dmg); if (sh.kind === "arrow") { sh.life = 0; break; } if (sh.kind === "blade") this.slashFx(tg.pos); sh.v.multiplyScalar(sh.kind === "blade" ? 0.92 : 0.7); }
      if (sh.life <= 0) continue;
      const wallHit = sh.p.z > FIELD_Z - 0.2 && sh.p.y < WALL_TOP + 0.3 && sh.p.y > 0.05;
      if (sh.p.y <= 0.05 || wallHit) {
        if (sh.kind === "orb" || sh.kind === "ward" || sh.kind === "boulder" || sh.kind === "standard") { if (sh.p.y <= 0.05) sh.p.y = 0.05; this.impact(sh); sh.life = 0; continue; }
        if (wallHit) { this.puff(sh.p, "spark", 3, 0xffd27a, 0.5, 1.5); sh.life = 0; continue; }
        sh.p.y = 0.05; sh.m.position.copy(sh.p); sh.stuck = true; sh.v.set(0, 0, 0);
        if (sh.kind === "stake") { this.zones.push({ kind: "trap", pos: sh.p.clone(), r: 1.8, life: 25, life0: 25, m: sh.m, tick: 0, k: sh.k }); this.puff(sh.p, "dirt", 3, 0x9c8a6a, 0.6, 1.5); sh.life = 25.5; continue; }
        this.puff(sh.p, "dirt", sh.kind === "arrow" ? 2 : 5, 0x9c8a6a, 0.7, 2);
        if (sh.kind === "spear") { for (const tg of this.targetsNear(sh.p, 2.2 + sh.k)) { const key = tg.s || tg.e!; if (!sh.hit.has(key)) { sh.hit.add(key); this.hurtTarget(tg, sh.dmg * 0.6); if (tg.s) tg.s.stun = 1.2; } } this.ringFx(sh.p, 0xffd27a, 3 + sh.k * 2); this.shake = Math.max(this.shake, 0.2); this.cb.onSfx?.("impact"); }
        sh.life = Math.min(sh.life, 1.2);
      }
    }
    for (const sh of this.shots) if (sh.life <= 0) { this.scene.remove(sh.m); sh.light?.dispose(); if (sh.rope) this.scene.remove(sh.rope); }
    this.shots = this.shots.filter((sh) => sh.life > 0);
  }
  impact(sh: Shot) {
    const p = sh.p.clone(); p.y = Math.max(p.y, 0.3); const k = sh.k;
    if (sh.kind === "orb") { this.stormBurst(p, k, sh.dmg); return; }
    if (sh.kind === "ward") { const life = 6 + k * 4; const m = new THREE.Group(); const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.2, 48), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; m.add(ring); const disc = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.08; m.add(disc); const pil = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffe08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })); pil.scale.set(8, 14, 1); pil.position.y = 5; m.add(pil); const l = new THREE.PointLight(0xffd27a, 60, 30, 1.6); l.position.y = 3; m.add(l); m.position.set(p.x, 0, p.z); this.scene.add(m);
      this.zones.push({ kind: "ward", pos: new THREE.Vector3(p.x, 0, p.z), r: 5 + k * 1.5, life, life0: life, m, tick: 0, k }); this.ringFx(p, 0xffd27a, 8); this.puff(p, "flare", 1, 0xfff0c0, 8, 0, 0.3); this.cb.onSfx?.("impact"); return; }
    if (sh.kind === "standard") { const life = 8 + k * 4; const m = sh.m; m.position.set(p.x, 0, p.z); m.quaternion.identity(); m.rotation.x = Math.PI / 2; m.position.y = 1.6; this.scene.add(m); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })); gl.scale.set(6, 6, 1); gl.position.y = 2; m.add(gl); const wrap = new THREE.Group(); wrap.add(m); this.scene.add(wrap);
      this.zones.push({ kind: "standard", pos: new THREE.Vector3(p.x, 0, p.z), r: 9 + k * 3, life, life0: life, m: wrap, tick: 0, k }); this.rally = life; this.ringFx(p, 0xffd27a, 10); this.puff(p, "dirt", 6, 0xb8a48a, 0.8, 2); this.cb.onSfx?.("horn"); sh.m = new THREE.Group(); return; }
    // boulders
    const sub = sh.sub || "rock"; const R = sub === "great" ? 5.5 + k * 2 : sub === "blade" ? 4.5 + k * 1.5 : 3.2 + k * 1.2;
    for (const tg of this.targetsNear(p, R)) { this.hurtTarget(tg, sh.dmg, sub === "blade" ? "slash" : "hit"); if (tg.s) tg.s.stun = sub === "great" ? 2 : 1; }
    this.ringFx(p, sub === "blade" ? 0xff8a8a : sub === "shield" ? 0x8fb8ff : 0xffc36a, R * 1.4); this.puff(p, "dirt", 10 + k * 8, 0x9c8a6a, 1 + k, 3 + k * 2); this.puff(p, "smoke", 5, 0x6f6a80, 2 + k, 1.2, 1.1); this.puff(p, "flare", 1, 0xfff2c0, 5 + k * 4, 0, 0.2);
    if (sub === "blade") for (let i = 0; i < 6; i++) this.slashFx(p.clone().add(new THREE.Vector3(Math.cos(i) * 2.2, 0.8, Math.sin(i) * 2.2)));
    if (sub === "shield") { this.gateHp = Math.min(this.gateMax, this.gateHp + 40 + k * 40); this.say("Buke: the gate mends", 0.7); this.ringFx(new THREE.Vector3(0, 0, FIELD_Z - 1), 0x8fb8ff, 5); }
    const flash = new THREE.PointLight(sub === "great" ? 0xffa04a : 0xffc36a, 120 + k * 120, 40, 1.5); flash.position.copy(p).add(new THREE.Vector3(0, 1.5, 0)); this.scene.add(flash); setTimeout(() => this.scene.remove(flash), 110);
    this.shake = Math.max(this.shake, sub === "great" ? 1 : 0.5 + k * 0.4); this.cb.onSfx?.("crash");
    // the boulder stays as a rock on the field for a while
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(sub === "great" ? 1.1 : 0.75, 0), this.rockMat); rock.position.set(p.x, 0.5, p.z); rock.rotation.set(Math.random(), Math.random(), 0); this.scene.add(rock); setTimeout(() => this.scene.remove(rock), 12000);
  }
  stormBurst(p: THREE.Vector3, k: number, dmg: number) {
    const n = 6 + Math.round(k * 6); const r = 9 + k * 6;
    const targets = this.targetsNear(p, r).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p)).slice(0, n);
    let from = p; this.puff(p, "flare", 1, 0xbfd6ff, 8 + k * 6, 0, 0.3); this.ringFx(p, 0x9ec7ff, 6 + k * 6); this.shake = Math.max(this.shake, 0.6 + k * 0.5); this.cb.onSfx?.("crash");
    const flash = new THREE.PointLight(0x9ec7ff, 260, 60, 1.5); flash.position.copy(p); this.scene.add(flash); setTimeout(() => this.scene.remove(flash), 120);
    for (const tg of targets) { this.bolt(from, tg.pos); this.hurtTarget(tg, dmg, "bolt"); if (tg.s) tg.s.stun = 1.4; this.puff(tg.pos, "spark", 4, 0xbfd6ff, 1.2, 1.5); from = tg.pos; }
    if (!targets.length) this.puff(p, "dirt", 8, 0x9c8a6a, 1, 3);
  }
  fling(s: Spider, k: number) {
    if (s.dead) return; s.dead = true; this.hordeLeft--; this.kills++; this.score += Math.round(10 * s.size); s.g.rotation.set(0, Math.PI, 0);
    const toward = new THREE.Vector3(0, 0, FIELD_Z - 8).sub(new THREE.Vector3(s.x, 0, s.z)).normalize().multiplyScalar(8 + k * 6); this.flings.push({ s, v: new THREE.Vector3(toward.x, 12 + k * 6, toward.z), t: 0, k }); this.puff(this.center(s), "spark", 5, 0x7ad7ff, 0.8, 1.5); this.cb.onSfx?.("impact");
  }
  stepFlings(dt: number) {
    for (const f of this.flings) { f.t += dt; const g = f.s.g; f.v.y -= G * 1.4 * dt; g.position.addScaledVector(f.v, dt); g.rotation.x += dt * 9; g.rotation.z += dt * 4;
      if (g.position.y <= 0 && f.t > 0.2) { g.position.y = 0; f.t = 99; const p = g.position.clone().add(new THREE.Vector3(0, 0.5, 0)); this.ringFx(p, 0x7ad7ff, 6 + f.k * 3); this.puff(p, "dirt", 12, 0x8b5cf6, 1.3, 4); this.shake = Math.max(this.shake, 0.6); this.cb.onSfx?.("crash");
        for (const tg of this.targetsNear(p, 3.5 + f.k * 2)) if (tg.s !== f.s) this.hurtTarget(tg, 110 + f.k * 60); this.scene.remove(g); } }
    this.flings = this.flings.filter((f) => f.t < 99);
  }
  stepZones(dt: number) {
    for (const z of this.zones) { z.life -= dt; z.tick += dt; const k = Math.min(1, z.life / 0.8); z.m.scale.setScalar(Math.max(0.01, k)); if (z.kind === "trap" && z.life <= 0) { this.scene.remove(z.m); continue; }
      if (z.kind === "ward") { z.m.rotation.y += dt * 0.6; if (z.tick > 0.5) { z.tick = 0; for (const tg of this.targetsNear(z.pos, z.r)) { this.hurtTarget(tg, 28 + z.k * 14); this.puff(tg.pos, "spark", 2, 0xffe08a, 0.8, 1); } this.gateHp = Math.min(this.gateMax, this.gateHp + 6 + z.k * 4); } }
      if (z.kind === "standard") { z.m.rotation.y = Math.sin(this.t * 3) * 0.06; if (z.tick > 0.35) { z.tick = 0; const tg = this.targetsNear(z.pos, z.r); if (tg.length) { const t = tg[(Math.random() * tg.length) | 0]; const from = new THREE.Vector3((Math.random() - 0.5) * 30, WALL_TOP + 2, WALL_Z); this.spawnSpear(from, this.ballistic(from, t.pos, 40), 0, true); } } }
      if (z.life <= 0) this.scene.remove(z.m); }
    this.zones = this.zones.filter((z) => z.life > 0);
  }
  stepGarrison(dt: number) {
    const rate = this.rally > 0 ? 3 : 1; this.rally = Math.max(0, this.rally - dt);
    for (const g of this.garrison) { g.cd -= dt * rate; if (g.cd > 0) continue; g.cd = 2.4 + Math.random() * 2.2;
      const live = this.spiders.filter((s) => !s.dead && s.z > FIELD_Z - 70 && Math.abs(s.x - g.a.obj.position.x) < 30); if (!live.length) continue; const s = live[(Math.random() * Math.min(4, live.length)) | 0];
      this.playA(g.a, g.a.fid === "yamabushi" ? "magic" : "attack", 1.6); const from = g.a.obj.position.clone().add(new THREE.Vector3(0, 1.8, -0.6)); const to = new THREE.Vector3(s.x, 0.5, s.z + s.speed * 0.9); this.spawnSpear(from, this.ballistic(from, to, 40), 0, true); }
  }

  // ── gate / waves / flow
  hurtGate(d: number) { if (this.state !== "play") return; this.gateHp = Math.max(0, this.gateHp - d); if (this.gateHp <= 0) this.end(false); }
  start() { if (this.state !== "ready") return; this.state = "play"; this.gateHp = this.gateMax; this.wave = 0; this.score = 0; this.kills = 0; this.nextWave(); this.pushHud(); }
  nextWave() {
    if (this.wave >= WAVES.length) { this.end(true); return; }
    const w = WAVES[this.wave]; this.wave++; this.waveDone = false; this.say(this.wave === WAVES.length ? "FINAL WAVE — hold the gate!" : `WAVE ${this.wave}`, 2.2); if (this.wave === 4) this.cb.onSfx?.("horn");
    let t = 1.2; this.spawnQueue = [];
    for (let i = 0; i < w.crawlers; i++) { this.spawnQueue.push({ at: t, fn: () => this.spawnSpider(0.85 + Math.random() * 0.4) }); t += w.gap * (0.6 + Math.random() * 0.8); }
    for (let i = 0; i < w.big; i++) this.spawnQueue.push({ at: 2 + Math.random() * t, fn: () => this.spawnSpider(1.7 + Math.random() * 0.5) });
    for (let i = 0; i < (w.tower || 0); i++) this.spawnQueue.push({ at: 1.5 + i * 9, fn: () => this.spawnTower() });
    for (let i = 0; i < (w.ram || 0); i++) this.spawnQueue.push({ at: 4 + i * 12, fn: () => this.spawnRam() });
    this.spawnQueue.sort((a, b) => a.at - b.at); this.waveT = 0;
  }
  end(won: boolean) { if (this.state !== "play") return; this.state = won ? "won" : "lost"; this.say(won ? "THE HORN SOUNDS — the gate held 👑" : "THE GATE HAS FALLEN", 4); this.cb.onSfx?.(won ? "win" : "lose"); if (!won) { this.shake = 2; this.puff(new THREE.Vector3(0, 3, FIELD_Z), "smoke", 30, 0x6a5a5a, 6, 3, 2.2); } this.pushHud(); setTimeout(() => this.cb.onEnd?.({ won, score: this.score, kills: this.kills, waves: this.wave }), 1500); }
  say(m: string, t = 1.6) { this.msg = m; this.msgT = t; this.pushHud(); }
  pushHud() { this.cb.onHud({ gate: Math.ceil(this.gateHp), gateMax: this.gateMax, wave: this.wave, waves: WAVES.length, horde: Math.max(0, this.hordeLeft), score: this.score, kills: this.kills, reload: this.reloadTime > 0 ? Math.max(0, this.reload / (this.reloadTime * 1.3)) : 0, state: this.state, msg: this.msg, charge: this.charging ? Math.min(1, this.charge / 0.7) : 0, intro: this.intro }); }

  // ── VFX
  puff(p: THREE.Vector3, tex: string, n: number, color: number, size: number, speed: number, life = 0.6) {
    for (let i = 0; i < n; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[tex], color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); const sz = size * (0.6 + Math.random() * 0.8); s.scale.set(sz, sz, 1); s.position.copy(p); s.material.rotation = Math.random() * 6.28; this.scene.add(s);
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI; const v = speed * (0.3 + Math.random()); const lf = life * (0.6 + Math.random() * 0.6);
      this.parts.push({ s, v: new THREE.Vector3(Math.cos(a) * Math.sin(b) * v, Math.abs(Math.cos(b)) * v + v * 0.4, Math.sin(a) * Math.sin(b) * v), life: lf, life0: lf, g: speed > 0 ? 9 : 0, grow: 1 + Math.random() * 0.8, size: sz }); }
  }
  slashFx(p: THREE.Vector3) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.slash, color: 0xff8a8a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(2.4, 2.4, 1); s.position.copy(p); s.material.rotation = Math.random() * 6.28; this.scene.add(s); this.parts.push({ s, v: new THREE.Vector3(0, 1.5, 0), life: 0.3, life0: 0.3, g: 0, grow: 1.7, size: 2.4 }); }
  ringFx(p: THREE.Vector3, color: number, r: number) { const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.08, p.z); this.scene.add(m); const t0 = this.t; const tick = () => { if (this.over) return; const k = (this.t - t0) / 0.45; if (k >= 1) { this.scene.remove(m); return; } m.scale.setScalar(1 + k * r); (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k); requestAnimationFrame(tick); }; tick(); }
  bolt(a: THREE.Vector3, b: THREE.Vector3) {
    const pts: THREE.Vector3[] = []; const n = 9; for (let i = 0; i <= n; i++) { const t = i / n; const q = a.clone().lerp(b, t); if (i > 0 && i < n) q.add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2)); pts.push(q); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.boltMat.clone()); this.scene.add(l); this.bolts.push({ l, life: 0.22 });
    const l2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7c9cff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); this.scene.add(l2); this.bolts.push({ l: l2, life: 0.3 });
  }

  flicker(dt: number) {
    void dt; for (const [i, f] of this.flames.entries()) { if (!f.userData.sy) f.userData.sy = f.scale.y; const k = 0.85 + Math.sin(this.t * 11 + i * 1.7) * 0.12 + Math.random() * 0.08; f.scale.y = f.userData.sy * k; (f.material as THREE.SpriteMaterial).opacity = (i % 2 === 0 ? 0.9 : 0.35) * k; }
    for (const [i, l] of this.torchLights.entries()) l.intensity = 11 * (0.9 + Math.sin(this.t * 9 + i * 2.1) * 0.12 + Math.random() * 0.1) * (l.userData.k || 1);
  }
  // ── loop
  loop = () => { if (this.over) return; requestAnimationFrame(this.loop); const dt = Math.min(0.05, this.clock.getDelta()); this.t += dt; if (this.state === "play") this.step(dt); this.render(dt); };
  step(dt: number) {
    this.waveT += dt; if (this.reload > 0) this.reload -= dt; if (this.charging) this.charge += dt; if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) { this.msg = null; this.pushHud(); } }
    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveT) this.spawnQueue.shift()!.fn();
    this.stepHorde(dt); this.stepShots(dt); this.stepFlings(dt); this.stepZones(dt); this.stepGarrison(dt); this.stepLeap(dt);
    if (!this.waveDone && !this.spawnQueue.length && this.hordeLeft <= 0) { this.waveDone = true; this.score += 50 * this.wave; setTimeout(() => { if (this.state === "play") this.nextWave(); }, 1800); }
    this.hudT += dt; if (this.hudT > 0.12) { this.hudT = 0; this.pushHud(); }
  }
  render(dt: number) {
    this.hero?.mixer.update(dt); for (const g of this.garrison) g.a.mixer.update(dt);
    if (this.intro) { this.stepIntro(dt); this.flicker(dt); this.sky.position.copy(this.camera.position); this.composer.render(); return; }
    this.updateAim();
    if (this.hero && !this.leap) { const o = this.hero.obj; const want = Math.atan2(this.aim.x - o.position.x, -(this.aim.z - o.position.z)); this.heroSpin += (want * (this.view === "pov" ? 0.6 : 0.3) - this.heroSpin) * Math.min(1, dt * 6); o.rotation.y = Math.PI + this.heroSpin; }
    // catapult arm: cocks while charging, snaps on release, resets over the reload
    if (this.catapult.visible) { const want = this.charging ? 1.1 + Math.min(1, this.charge / 0.7) * 0.3 : this.armK > 0 ? -0.7 : 0.95; this.armK = Math.max(0, this.armK - dt * 1.4); this.arm.rotation.x += (want - this.arm.rotation.x) * Math.min(1, dt * (this.armK > 0.9 ? 30 : 6)); }
    this.flicker(dt);
    for (const p of this.parts) { p.life -= dt; p.s.position.addScaledVector(p.v, dt); p.v.y -= p.g * dt; const k = Math.max(0, p.life / p.life0); (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.5); const sz = p.size * (1 + (1 - k) * (p.grow - 1)); p.s.scale.set(sz, sz, 1); }
    for (const p of this.parts) if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); } this.parts = this.parts.filter((p) => p.life > 0);
    for (const b of this.bolts) { b.life -= dt; (b.l.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / 0.25); } for (const b of this.bolts) if (b.life <= 0) { this.scene.remove(b.l); b.l.geometry.dispose(); } this.bolts = this.bolts.filter((b) => b.life > 0);
    // camera
    const cp = this.camBase(), look = this.camLook();
    if (this.view === "pov") { look.x += this.aim.x * 0.12; look.z = Math.min(-8, this.aim.z * 0.35); cp.x += this.aim.x * 0.02 + (this.charging ? -this.charge * 0.25 : 0); }
    else { look.x += (this.aim.x + 6) * 0.05; look.z += (this.aim.z + 18) * 0.07; cp.z += (this.aim.z + 18) * 0.025; if (this.leap && this.hero) { look.lerp(this.hero.obj.position, 0.5); } }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); cp.x += (Math.random() - 0.5) * this.shake * 0.25; cp.y += (Math.random() - 0.5) * this.shake * 0.2; }
    this.camera.position.lerp(cp, Math.min(1, dt * 4)); this.camKick.lerp(look, Math.min(1, dt * 4)); this.camera.lookAt(this.camKick); this.sky.position.copy(this.camera.position);
    this.composer.render();
  }
}
