// components/Siege/world3d.ts — The Siege: one three.js world, two cameras.
//   side  — the Citadel view: a ¾ cinematic shot along the wall; you man a catapult on the wall-walk (Ronin / Samurai / Warrior / Buke / Shogun).
//   pov   — the Battlements view: over the shoulder of your ant; you throw from the parapet (Ashigaru / Yamabushi / Kenshi / Sohei / Bushi / Wokou).
// Both walk the wall-walk (A/D or ◀ ▶, Shift / RUN to run). Catapult crews set their trebuchet down once, anywhere on the rampart, then roam free.
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
import { buildSky, buildCastle, buildField, buildMesas, buildTrebuchet, buildBug, loadBugModels, gait, pbr, mergeByMaterial, Embers, SUN_DIR, type Leg, type Treb, type BugModels } from "./worldArt";

const G = 20; const WALL_TOP = 9, WALL_Z = -1.5, WALL_T = 3; const FIELD_Z = WALL_Z - WALL_T / 2;
const CLIPS = ["idle", "attack", "magic", "special", "win"] as const;
const HERO_Z = WALL_Z + 0.55, TREB_Z = WALL_Z + 5.5, X_MIN = -50, X_MAX = 50, Z_MIN = FIELD_Z + 0.95, Z_MAX = 8.5;   // the walkable deck: parapet (front) → rampart terrace (back); trebuchets stand on the terrace
const TOWERS = [-15.5, 15.5, -42, 42], TOWER_Z = WALL_Z - 4.5, TOWER_R = 4.6, HERO_R = 0.45;
const CATAPULT = new THREE.Vector3(28, WALL_TOP + 0.2, TREB_Z); const POV_X = -27.5; const SIDE_X = 30.6;   // default stations (battlements / catapult)
const WALK = 3.4, RUN = 7.5;
type Rig = { scene: THREE.Object3D; clips: Record<string, THREE.AnimationClip>; k: number; minY: number };
type Actor = { obj: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction>; current: THREE.AnimationAction | null; fid: string };
type SpiderKind = "crawler" | "slinger" | "wasp" | "brute" | "brood";
type Spider = { g: THREE.Group; body: THREE.Group; lod: THREE.Group; legs: Leg[]; mixer?: THREE.AnimationMixer; acts?: Record<string, THREE.AnimationAction>; anim?: string; wings: THREE.Mesh[]; kind: SpiderKind; x: number; y: number; z: number; hp: number; hpMax: number; size: number; speed: number; ph: number; stun: number; dead: boolean; arrived: boolean; wob: number; pinned: number; cd: number; holdZ: number };
type Engine = { kind: "tower" | "ram"; g: THREE.Group; x: number; z: number; hp: number; hpMax: number; speed: number; arrived: boolean; dead: boolean; wheels: THREE.Mesh[]; bangT: number };
type Target = { pos: THREE.Vector3; r: number; s?: Spider; e?: Engine };
type ShotKind = "spear" | "orb" | "arrow" | "boulder" | "blade" | "ward" | "stake" | "hook" | "standard" | "web" | "venom";
type Shot = { m: THREE.Object3D; p: THREE.Vector3; v: THREE.Vector3; kind: ShotKind; life: number; dmg: number; hit: Set<object>; k: number; ally?: boolean; sub?: string; rope?: THREE.Line; stuck?: boolean };
type Part = { s: THREE.Sprite; v: THREE.Vector3; life: number; life0: number; g: number; grow: number; size: number };
type Bolt = { l: THREE.Line; life: number };
type Zone = { kind: "ward" | "trap" | "standard"; pos: THREE.Vector3; r: number; life: number; life0: number; m: THREE.Object3D; tick: number; k: number };
type Fling = { s: Spider; v: THREE.Vector3; t: number; k: number };
const INTRO_LEN = 11;
/** rolling ground: flat near the wall, mounds and craters further out */
export function terrainH(x: number, z: number) {
  const d = FIELD_Z - z; if (d <= 0) return 0; const k = d < 16 ? 0 : d > 60 ? 1 : (() => { const u = (d - 16) / 44; return u * u * (3 - 2 * u); })();
  let h = 1.7 * Math.sin(x * 0.07 + 1.3) * Math.sin(z * 0.05 + 0.4) + 0.9 * Math.sin(x * 0.15 + z * 0.11) + 0.45 * Math.sin(x * 0.31 - z * 0.23 + 2) + 1.2;
  for (const [cx, cz, cr] of CRATERS) { const dd = ((x - cx) ** 2 + (z - cz) ** 2) / (cr * cr); h -= 1.6 * Math.exp(-dd * 2.2); }
  const road = Math.exp(-(x * x) / 40); return Math.max(-1.4, h * k * (1 - road * 0.7));
}
const CRATERS: [number, number, number][] = [[-14, FIELD_Z - 34, 5], [18, FIELD_Z - 52, 6], [-30, FIELD_Z - 70, 5], [6, FIELD_Z - 88, 7], [34, FIELD_Z - 40, 4.5]];

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
    try { const lj = await (await fetch(`/siege/anim/${fid}.json`)).json(); for (const n of ["walk", "run"]) { const L = lj[n]; if (!L) continue; const times = Float32Array.from({ length: L.n }, (_, i) => i / L.fps); clips[n] = new THREE.AnimationClip(n, L.dur, Object.entries(L.tracks as Record<string, number[]>).map(([b, q]) => new THREE.QuaternionKeyframeTrack(`mixamorig_${b}.quaternion`, times, q))); clips[n].userData = { bob: L.bob }; } } catch {}
    return { scene: s, clips, k: 1.85 / h, minY: box.min.y };
  })();
  return rigCache[fid];
}

export class SiegeWorld {
  canvas: HTMLCanvasElement; cb: Callbacks; faction = "ronin"; view: View = "side"; over = false; ready = false;
  renderer!: THREE.WebGLRenderer; scene!: THREE.Scene; camera!: THREE.PerspectiveCamera; composer!: EffectComposer; clock = new THREE.Clock();
  tex: Record<string, THREE.Texture> = {}; hero: Actor | null = null; heroHome = new THREE.Vector3(); heroSpin = 0; heroX = SIDE_X; heroZ = HERO_Z; wallView = false; threat = 0; threatWarned = false; airLock: Spider | null = null; waspHint = false; heroV = 0; heroVX = 0; heroVZ = 0; heroYaw = Math.PI; loco: "idle" | "walk" | "run" = "idle"; keys = { l: false, r: false, f: false, b: false, run: false }; moveIn = 0; moveInZ = 0; runIn = false; trebSet = false; lights: { l: THREE.PointLight; until: number; follow: THREE.Object3D | null; i0: number; t0: number }[] = []; warmed = false; perf = { acc: 0, n: 0, level: 0 }; bloom!: UnrealBloomPass; garrison: { a: Actor; cd: number }[] = []; catapult!: THREE.Group; arm!: THREE.Group; armK = 0; treb!: Treb; armMode: "ready" | "swing" | "return" = "ready"; armT = 0; armA = 2.15; pendingFire: number | null = null; embers!: Embers; menu = true; paused = false; boss: Spider | null = null; banner = false;
  spiders: Spider[] = []; engines: Engine[] = []; shots: Shot[] = []; parts: Part[] = []; bolts: Bolt[] = []; zones: Zone[] = []; flings: Fling[] = []; flames: THREE.Sprite[] = []; torchLights: THREE.PointLight[] = [];
  marker!: THREE.Mesh; aim = new THREE.Vector3(0, 0, -30); pointer = { x: 0.5, y: 0.6 }; charge = 0; charging = false; reload = 0; reloadTime = 1.2;
  state: Hud["state"] = "ready"; gateHp = 1000; gateMax = 1000; wave = 0; score = 0; kills = 0; msg: string | null = null; msgT = 0; hordeLeft = 0; spawnQueue: { at: number; fn: () => void }[] = []; waveT = 0; waveDone = false; hudT = 0; t = 0; shake = 0; rally = 0;
  leap: { t: number; from: THREE.Vector3; to: THREE.Vector3; phase: "fly" | "land" | "back"; k: number } | null = null; camKick = new THREE.Vector3();
  sky!: THREE.Mesh; intro = false; introT = 0; introPath!: THREE.CatmullRomCurve3; introLook!: THREE.CatmullRomCurve3;
  spiderMat = new THREE.MeshStandardMaterial({ color: 0x2a1d3a, roughness: 0.55, metalness: 0.1 }); spiderMat2 = new THREE.MeshStandardMaterial({ color: 0x4b2a6b, roughness: 0.45, metalness: 0.15, emissive: 0x160a24 }); eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b }); legMat = new THREE.MeshStandardMaterial({ color: 0x1d1626, roughness: 0.7 });
  silkMat = new THREE.MeshStandardMaterial({ color: 0x5a3f80, roughness: 0.6, emissive: 0x1a0f2a }); silkMat2 = new THREE.MeshStandardMaterial({ color: 0x7c5cb0, roughness: 0.55, emissive: 0x24143a }); woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 }); shellMat = new THREE.MeshStandardMaterial({ color: 0x2a1f18, roughness: 0.4, metalness: 0.2 }); rockMat = new THREE.MeshStandardMaterial({ color: 0x6b6470, roughness: 0.95 });
  spearGeo!: THREE.BufferGeometry; tipGeo!: THREE.BufferGeometry; boltMat = new THREE.LineBasicMaterial({ color: 0xcfe1ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(canvas: HTMLCanvasElement, cb: Callbacks) { this.canvas = canvas; this.cb = cb; }

  async init() {
    this.view = viewOf(this.faction);
    // React strict mode mounts twice: the first instance is destroyed before its assets finish loading — never touch the canvas from it
    await Promise.resolve(); if (this.over) return;
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" }); this.renderer = r;
    r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xe8c49a); this.scene.fog = new THREE.FogExp2(0xd8b48e, 0.0036);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1500);
    const tl = new THREE.TextureLoader(); const load = (n: string, p: string, srgb = true) => new Promise<void>((res) => tl.load(p, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; this.tex[n] = t; res(); }, undefined, () => res()));
    await Promise.all([...["ashlar", "ashlar2", "flag", "dirt", "wood", "rock"].flatMap((n) => [load(n + "_a", `/siege/tex/${n}_a.jpg`), load(n + "_n", `/siege/tex/${n}_n.jpg`, false), load(n + "_r", `/siege/tex/${n}_r.jpg`, false)]), ...["glow", "flare", "spark", "smoke", "dirt", "ring", "flame", "bolt2", "star", "slash", "scorch", "smoke2"].map((n) => load(n, `/siege/fx/${n}.png`))]);
    if (this.over) { r.dispose(); return; }
    this.buildWorld(); this.buildCatapult();
    const rp = new RenderPass(this.scene, this.camera); const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.5, 0.92); this.bloom = bloom; this.composer = new EffectComposer(r); this.composer.addPass(rp); this.composer.addPass(bloom);
    this.placeCamera(true); this.fit(); window.addEventListener("resize", this.fitBound); requestAnimationFrame(this.fitBound); setTimeout(this.fitBound, 300);
    this.bindInput(); await Promise.all([this.buildGarrison().catch(() => {}), this.setFaction(this.faction), loadBugModels().then((m) => { this.bugModels = m; })]); if (this.over) return;
    this.buildIntro(); this.embers = new Embers(this.scene, this.tex.glow); this.warm();
    this.ready = true; (window as any).__siege = this; (window as any).__THREE = THREE; this.pushHud(); this.loop();
  }
  /** compile every shader the fight will need (each bug kind, every shot, the fx sprites, their shadow passes) up front — no first-use hitches mid-wave */
  warm() {
    const g = new THREE.Group(); g.position.set(0, 2, FIELD_Z - 24); this.scene.add(g);
    for (const k of ["crawler", "slinger", "wasp", "brute", "brood"] as SpiderKind[]) { const b = buildBug(k, this.bugModels); b.g.position.x = (g.children.length - 2) * 4; b.lod.visible = true; g.add(b.g); }
    const nShots = this.shots.length, nParts = this.parts.length; const p = new THREE.Vector3(0, 4, FIELD_Z - 20), v = new THREE.Vector3();
    this.spawnSpear(p, v, 0); this.spawnBlade(p, v, 0); this.spawnOrb(p, v, 0, "storm"); this.spawnStake(p, v, 0); this.spawnHook(p, v, 0); this.spawnBoulder(p, v, 0, "blade"); this.spawnBoulder(p, v, 0, "shield"); this.spawnBoulder(p, v, 0, "great"); this.spawnStandard(p, v, 0);
    for (const n of ["smoke", "dirt", "flare", "spark"] as const) this.puff(p, n as any, 1, 0xffffff, 1, 1); this.ringFx(p, 0xffffff, 3); this.slashFx(p);
    const cam = this.camera.position.clone(), q = this.camera.quaternion.clone(); this.camera.position.set(0, 8, FIELD_Z - 8); this.camera.lookAt(0, 2, FIELD_Z - 24);
    try { this.renderer.compile(this.scene, this.camera); this.composer.render(); } catch {}
    this.camera.position.copy(cam); this.camera.quaternion.copy(q);
    for (const sh of this.shots.splice(nShots)) { this.scene.remove(sh.m); if (sh.rope) this.scene.remove(sh.rope); } for (const pt of this.parts.splice(nParts)) this.scene.remove(pt.s); for (const b of this.bolts) this.scene.remove(b.l); this.bolts = [];
    for (const l of this.lights) { l.l.intensity = 0; l.follow = null; } this.scene.remove(g); this.drop(g); this.warmed = true;
  }
  /** adaptive quality: if frames run long for a couple of seconds, step down (pixel ratio → bloom → shadow res) */
  perfStep(raw: number) {
    if (raw > 0.25 || this.menu) return; const P = this.perf; P.acc += raw; P.n++; if (P.n < 120) return; const avg = P.acc / P.n; P.acc = 0; P.n = 0;
    if (avg < 1 / 40 || P.level >= 3) return; P.level++;
    if (P.level === 1) { this.renderer.setPixelRatio(1); this.fit(); }
    else if (P.level === 2) { this.bloom.enabled = false; }
    else { this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null; }
  }
  fitBound = () => this.fit();
  fit() { const el = this.canvas.parentElement || this.canvas; const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight); this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.fov = this.wallView ? (w / h < 1.2 ? 76 : 60) : this.view === "pov" ? (w / h < 1.2 ? 72 : 58) : (w / h < 1.2 ? 70 : 54); this.camera.updateProjectionMatrix(); }
  destroy() { this.over = true; window.removeEventListener("resize", this.fitBound); window.removeEventListener("keydown", this.onKD); window.removeEventListener("keyup", this.onKU); window.removeEventListener("blur", this.onBlur); try { this.renderer?.dispose(); this.renderer?.forceContextLoss?.(); } catch {} }

  // ── cameras
  camBase() { if (this.wallView) { let cx = this.heroX; for (const tx of TOWERS) if (Math.abs(cx - tx) < 7) cx = tx + (this.heroX >= tx ? 7 : -7); return new THREE.Vector3(cx, WALL_TOP + 4.5, FIELD_Z - 21); } return this.view === "pov" ? new THREE.Vector3(this.heroX + 1.4, WALL_TOP + 6.4, this.heroZ + 6.3) : new THREE.Vector3(this.heroX + 2.6, WALL_TOP + 9.2, this.heroZ + 8.6); }
  camLook() { if (this.wallView) return new THREE.Vector3(this.heroX, 4.6, FIELD_Z); return this.view === "pov" ? new THREE.Vector3(this.heroX + 1.4, 0.5, this.heroZ - 26) : new THREE.Vector3(this.heroX - 4, 0, this.heroZ - 28); }
  placeCamera(snap = false) { const cp = this.camBase(), lk = this.camLook(); if (snap) { this.camera.position.copy(cp); this.camera.lookAt(lk); } }

  // ── the world (art lives in worldArt.ts)
  buildWorld() {
    const S = this.scene; const ctx = { S, tex: this.tex, torch: (x: number, y: number, z: number, k: number, light?: boolean) => this.torch(x, y, z, k, light), terrainH };
    this.woodMat = pbr(this.tex, "wood", { ns: 1 }); this.rockMat = pbr(this.tex, "rock", { color: 0xcfc2b0, ns: 1.2 });
    const gg = new THREE.PlaneGeometry(500, 500, 180, 180); gg.rotateX(-Math.PI / 2); { const pos = gg.attributes.position as THREE.BufferAttribute; for (let i = 0; i < pos.count; i++) pos.setY(i, terrainH(pos.getX(i), pos.getZ(i))); gg.computeVertexNormals(); }
    const ground = new THREE.Mesh(gg, pbr(this.tex, "dirt", { repeat: [62, 62], ns: 1.4, color: 0xf0e2cc })); ground.receiveShadow = true; S.add(ground);
    buildCastle(ctx, CATAPULT.x); buildField(ctx, CRATERS); buildMesas(ctx);
    for (const tx of [-36.5, -30, -23.5, 11.5, 18, 33.5]) this.torch(tx, WALL_TOP + 1.9, FIELD_Z + 0.55, 1.05);
    for (const tx of [-27, 27]) this.torch(tx, 6.2, FIELD_Z - 0.6, 1.2);
    this.sky = buildSky(S);
    // golden-hour sun (shadows) + sky/ground fill
    const sun = new THREE.DirectionalLight(0xffd6a0, 3.4); sun.position.copy(SUN_DIR).multiplyScalar(150); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 20; sc.far = 400; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; sun.target.position.set(0, 0, -20); S.add(sun); S.add(sun.target); this.sun = sun;
    S.add(new THREE.HemisphereLight(0xbcd2ff, 0x8a6a4a, 1.1));
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 20, 1.6); l.position.set(0, -50, 0); S.add(l); this.lights.push({ l, until: 0, follow: null, i0: 0, t0: 0 }); }
    this.marker = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 40), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })); this.marker.rotation.x = -Math.PI / 2; this.marker.position.set(0, 0.06, -30); S.add(this.marker);
    const shaft = new THREE.CylinderGeometry(0.035, 0.05, 2.4, 6); shaft.rotateX(-Math.PI / 2); const tip = new THREE.ConeGeometry(0.09, 0.45, 6); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, -1.4); this.spearGeo = shaft; this.tipGeo = tip; shaft.userData.keep = tip.userData.keep = true;
  }
  sun!: THREE.DirectionalLight; bugModels: BugModels = {}; ringGeo = new THREE.RingGeometry(0.6, 1, 40);
  /** free the GPU buffers of a one-off object (shared geometry is tagged keep) */
  drop(o: THREE.Object3D) { o.traverse((c: any) => { if (c.isSkinnedMesh) c.skeleton?.dispose?.(); if (c.geometry && !c.geometry.userData.keep && !c.isSkinnedMesh) c.geometry.dispose(); if (c.isSprite || c.isLine) c.material?.dispose?.(); }); }
  /** borrow a pooled point light: a short flash (dur < 1 s fades out), or one that follows an object until it leaves the scene */
  flash(p: THREE.Vector3, col: number, intensity: number, dist: number, dur: number, follow: THREE.Object3D | null = null) {
    let slot = this.lights.find((x) => x.l.intensity === 0) || this.lights.slice().sort((a, b) => (a.follow ? 1 : 0) - (b.follow ? 1 : 0) || a.until - b.until)[0];
    slot.l.color.setHex(col); slot.l.distance = dist; slot.l.intensity = intensity; slot.l.position.copy(p); slot.i0 = intensity; slot.t0 = this.t; slot.until = this.t + dur; slot.follow = follow;
  }
  stepLights() {
    for (const x of this.lights) { if (x.l.intensity === 0) continue; if (x.follow) { if (!x.follow.parent) { x.l.intensity = 0; x.follow = null; continue; } x.follow.getWorldPosition(x.l.position); }
      if (this.t >= x.until) { x.l.intensity = 0; x.follow = null; continue; } const d = x.until - x.t0; if (d < 1) x.l.intensity = x.i0 * Math.max(0, (x.until - this.t) / d); }
  }
  torch(x: number, y: number, z: number, k: number, light = false) {
    if (light) { const l = new THREE.PointLight(0xff9a3a, 6 * k, 16, 1.8); l.position.set(x, y, z); l.userData.k = k; this.scene.add(l); this.torchLights.push(l); }
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flame, color: 0xffc36a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); f.scale.set(0.6 * k, 1.0 * k, 1); f.position.set(x, y + 0.2, z); this.scene.add(f); this.flames.push(f);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xff9a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })); g.scale.set(2.2 * k, 2.2 * k, 1); g.position.set(x, y, z); this.scene.add(g); this.flames.push(g);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x5a4030, emissive: 0x2a1a10 })); post.position.set(x, y - 0.8, z); this.scene.add(post);
  }
  buildCatapult() {
    this.treb = buildTrebuchet({ S: this.scene, tex: this.tex, torch: () => {}, terrainH }, CATAPULT); this.treb.g.rotation.y = 0; this.catapult = this.treb.g; this.arm = this.treb.arm; this.arm.rotation.x = this.armA;
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 48), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); ring.rotation.x = -Math.PI / 2; ring.visible = false; this.scene.add(ring); this.trebRing = ring;
  }
  cupPos() { const p = this.treb.tipLocal.clone(); this.arm.localToWorld(p); return p; }
  /** trebuchet: cocked (arm back, sling on the deck) → swing on release (projectile leaves near vertical) → winch back down over the reload */
  stepTreb(dt: number) {
    if (!this.catapult.visible) return; const COCK = 2.15, FIRE = -0.4;
    if (this.armMode === "ready") { const want = COCK + (this.charging ? Math.min(1, this.charge / 0.7) * 0.1 : 0); this.armA += (want - this.armA) * Math.min(1, dt * 6); }
    else if (this.armMode === "swing") { this.armT += dt; const u = Math.min(1, this.armT / 0.34); this.armA = COCK + (FIRE - COCK) * (u * u * (3 - 2 * u)) ; if (this.pendingFire != null && this.armA < 0.35) { const k = this.pendingFire; this.pendingFire = null; this.fireNow(k); } if (u >= 1) { this.armMode = "return"; this.armT = 0; this.shake = Math.max(this.shake, 0.35); } }
    else { this.armT += dt; const T = Math.max(0.6, this.reloadTime * 0.85); const u = Math.min(1, this.armT / T); this.armA = FIRE + (COCK - FIRE) * (1 - Math.pow(1 - u, 2)) + Math.sin(this.armT * 18) * 0.06 * Math.max(0, 1 - this.armT * 3); if (u >= 1) this.armMode = "ready"; }
    this.arm.rotation.x = this.armA; this.treb.cw.rotation.x = -this.armA;
    const tip = this.cupPos(); const loaded = this.armMode === "ready" || (this.armMode === "swing" && this.pendingFire != null);
    const pouch = loaded ? (this.armMode === "ready" ? new THREE.Vector3(tip.x, Math.max(WALL_TOP + 0.65, tip.y - 1.3), tip.z - 0.6) : tip.clone().add(new THREE.Vector3(0, -0.8, 0.4))) : tip.clone().add(new THREE.Vector3(0, -1.2, 0));
    this.treb.ammo.visible = loaded; this.treb.g.worldToLocal(pouch); this.treb.ammo.position.copy(pouch); this.treb.ammo.scale.setScalar(this.faction === "warrior" ? 1.4 : 1);
    const tipL = this.treb.tipLocal.clone(); this.arm.localToWorld(tipL); this.treb.g.worldToLocal(tipL); (this.treb.sling.geometry as THREE.BufferGeometry).setFromPoints([tipL, pouch]);
  }
  // ── actors (rigged FW ants)
  async makeActor(fid: string, scale = 1): Promise<Actor> {
    const rig = await loadRig(fid); const obj = skClone(rig.scene) as THREE.Object3D; obj.scale.setScalar(rig.k * scale); obj.userData.minY = rig.minY * rig.k * scale;
    const mixer = new THREE.AnimationMixer(obj); const actions: Record<string, THREE.AnimationAction> = {};
    for (const [n, clip] of Object.entries(rig.clips)) { const a = mixer.clipAction(clip); if (n === "idle" || n === "walk" || n === "run") a.setLoop(THREE.LoopRepeat, Infinity); else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } actions[n] = a; }
    const actor: Actor = { obj, mixer, actions, current: null, fid }; mixer.addEventListener("finished", () => { if (actor.current && actor.current !== actions.idle) this.playA(actor, actor === this.hero ? this.loco : "idle"); });
    this.playA(actor, "idle"); actions.idle && (actions.idle.time = Math.random() * 2); return actor;
  }
  playA(a: Actor, n: string, speed = 1, fade = 0.1) { const act = a.actions[n] || a.actions.idle; if (!act) return; if (a.current && a.current !== act) a.current.fadeOut(fade); act.reset(); act.setEffectiveTimeScale(speed); act.fadeIn(fade); act.play(); a.current = act; }
  play(n: string, speed = 1) { if (this.hero) this.playA(this.hero, n, speed); }
  standAt(a: Actor, x: number, z: number, faceField = true) { a.obj.position.set(x, WALL_TOP + 0.25 - a.obj.userData.minY, z); a.obj.rotation.y = faceField ? Math.PI : 0; }
  async setFaction(fid: string) {
    const was = this.view; this.faction = fid; this.view = viewOf(fid); this.reloadTime = (KIT[fid] || KIT.boulder).reload; if (this.state !== "play" || was !== this.view) { this.heroX = this.view === "pov" ? POV_X : SIDE_X; this.heroZ = HERO_Z; } if (!this.trebSet) this.trebFollow();
    if (this.hero) { this.scene.remove(this.hero.obj); this.hero = null; } this.leap = null; this.handBone = null;
    this.catapult.visible = true; if (!this.intro && !this.menu) this.placeCamera(true); this.fit(); if ((this.intro || this.menu) && this.introPath) { this.introPath.points[4] = this.camBase(); this.introLook.points[4] = this.camLook(); }
    if (fid === "boulder") return;
    const a = await this.makeActor(fid); if (this.over || this.faction !== fid) return;
    this.standAt(a, this.heroX, this.heroZ); a.obj.rotation.y = this.heroYaw; this.loco = "idle";
    this.heroHome.copy(a.obj.position); this.scene.add(a.obj); this.hero = a;
    this.handBone = null; a.obj.traverse((o) => { if (!this.handBone && /RightHand$/i.test(o.name)) this.handBone = o; });
  }
  async buildGarrison() {
    const spots: [string, number, number][] = [["ashigaru", -21, FIELD_Z + 0.95], ["samurai", 8.4, FIELD_Z + 0.95], ["yamabushi", 21, FIELD_Z + 0.95], ["ashigaru", 36, FIELD_Z + 0.95], ["kenshi", -34, FIELD_Z + 0.95]];
    for (const [fid, x, z] of spots) { const a = await this.makeActor(fid); if (this.over) return; this.standAt(a, x, z); this.scene.add(a.obj); this.garrison.push({ a, cd: 1.5 + Math.random() * 3 }); }
  }

  // ── intro: a slow fly-in over the marching horde, up the wall face, settling into your station
  /** menu: slow orbit around the citadel behind the selection screen */
  stepMenu(dt: number) {
    const a = Math.sin(this.t * 0.04) * 1.1; const cp = new THREE.Vector3(Math.sin(a) * 50, 15 + Math.sin(this.t * 0.2) * 2, FIELD_Z - 34 - Math.cos(a) * 14); const lk = new THREE.Vector3(0, 8, WALL_Z + 2); const k = this.menuSnap ? 1 : Math.min(1, dt * 2); this.menuSnap = false; this.camera.position.lerp(cp, k); this.camKick.lerp(lk, k); this.camera.lookAt(this.camKick);
    for (const s of this.spiders) if (!s.dead) { s.z += s.speed * 0.25 * dt; if (s.z > FIELD_Z - 40) s.z = FIELD_Z - 130; s.g.position.set(s.x, terrainH(s.x, s.z), s.z); this.gait(s, this.t * 5 + s.ph, 0.8); s.g.rotation.set(0, Math.PI, 0); }
  }
  menuSnap = true;
  startIntro() { if (!this.menu) return; this.menu = false; this.paused = false; this.introT = 0; this.intro = true; this.introPath.points[4] = this.camBase(); this.introLook.points[4] = this.camLook(); this.fit(); for (const s of this.spiders) { s.z = FIELD_Z - 95 - Math.random() * 30; } this.pushHud(); }
  setPaused(p: boolean) { this.paused = p; this.pushHud(); }
  buildIntro() {
    this.introPath = new THREE.CatmullRomCurve3([new THREE.Vector3(-75, 9, FIELD_Z - 125), new THREE.Vector3(-34, 8, FIELD_Z - 80), new THREE.Vector3(10, 11, FIELD_Z - 42), new THREE.Vector3(26, 17, FIELD_Z - 22), this.camBase()], false, "catmullrom", 0.3);
    this.introLook = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 6, FIELD_Z - 60), new THREE.Vector3(0, 8, FIELD_Z - 20), new THREE.Vector3(0, 10, FIELD_Z), new THREE.Vector3(0, 12, WALL_Z + 6), this.camLook()], false, "catmullrom", 0.3);
    this.introT = 0; this.marker.visible = false;
    // the horde is already on the field, far out, marching
    for (let i = 0; i < 16; i++) { this.spawnSpider(0.9 + Math.random() * 0.6); const s = this.spiders[this.spiders.length - 1]; s.z = FIELD_Z - 95 - Math.random() * 30; s.x = (Math.random() - 0.5) * 60; s.g.position.set(s.x, terrainH(s.x, s.z), s.z); }
  }
  stepIntro(dt: number) {
    this.introT += dt; const u = Math.min(1, this.introT / INTRO_LEN); const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    this.camera.position.copy(this.introPath.getPointAt(e)); this.camKick.copy(this.introLook.getPointAt(e)); this.camera.lookAt(this.camKick);
    for (const s of this.spiders) if (!s.dead) { s.z += s.speed * 0.5 * dt; s.g.position.set(s.x, terrainH(s.x, s.z), s.z); const ph = this.t * 6 + s.ph; this.gait(s, ph, 0.5 * 1.6); s.g.rotation.set(0, Math.PI, 0); }
    if (u >= 1) this.endIntro();
  }
  endIntro() { if (!this.intro) return; this.intro = false; this.marker.visible = true; this.camera.position.copy(this.camBase()); this.camKick.copy(this.camLook()); this.camera.lookAt(this.camKick); for (const s of this.spiders) if (!s.dead) { s.dead = true; this.scene.remove(s.g); this.drop(s.g); } this.spiders = this.spiders.filter((x) => !x.dead); this.hordeLeft = 0; this.start(); }

  // ── input + aim
  bindInput() {
    const cv = this.canvas; const pos = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); this.pointer.x = (e.clientX - r.left) / r.width; this.pointer.y = (e.clientY - r.top) / r.height; };
    cv.addEventListener("pointermove", (e) => pos(e));
    cv.addEventListener("pointerdown", (e) => { pos(e); if (this.menu || this.paused) return; if (this.intro) { this.endIntro(); return; } if (this.state === "ready") { this.start(); return; } if (this.state !== "play" || this.reload > 0 || this.leap) return; if (this.needTreb()) { this.say("Walk to a spot and SET TREBUCHET (E) — it stays there", 2.2); this.pushHud(); return; } this.charging = true; this.charge = 0; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    const up = (e: PointerEvent) => { if (!this.charging) return; pos(e); this.charging = false; this.fire(Math.min(1, this.charge / 0.7)); this.charge = 0; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    const kd = (e: KeyboardEvent, v: boolean) => { const k = e.key.toLowerCase(); if (k === "a" || k === "arrowleft") this.keys.l = v; else if (k === "d" || k === "arrowright") this.keys.r = v; else if (k === "w" || k === "arrowup") this.keys.f = v; else if (k === "s" || k === "arrowdown") this.keys.b = v; else if (k === "shift") this.keys.run = v; else if (v && k === "e") this.placeTreb(); else if (v && (k === "v" || k === "q")) this.toggleWallView(); else return; e.preventDefault(); };
    this.onKD = (e) => kd(e, true); this.onKU = (e) => kd(e, false); this.onBlur = () => { this.keys = { l: false, r: false, f: false, b: false, run: false }; };
    window.addEventListener("keydown", this.onKD); window.addEventListener("keyup", this.onKU); window.addEventListener("blur", this.onBlur);
  }
  onKD: (e: KeyboardEvent) => void = () => {}; onKU: (e: KeyboardEvent) => void = () => {}; onBlur = () => {};
  /** touch joystick from the HUD: x (right +), z (back +), each -1…1; a full push runs */
  setMove(dx: number, dz = 0, run?: boolean) { this.moveIn = dx; this.moveInZ = dz; if (run !== undefined) this.runIn = run; }
  /** WALL VIEW: swing the camera out in front of the wall, looking back at its face — see (and hit) whatever is climbing it or battering the gate */
  toggleWallView(on?: boolean) { if (this.menu || this.intro) return; this.wallView = on ?? !this.wallView; this.fit(); this.pushHud(); }
  /** anything at the wall right now (climbers, brutes at the gate, engines that arrived) */
  wallThreat() { let n = 0; for (const s of this.spiders) if (!s.dead && s.kind !== "wasp" && (s.arrived || s.z > FIELD_Z - 7)) n++; for (const e of this.engines) if (!e.dead && e.arrived) n++; return n; }
  needTreb() { return this.view === "side" && this.faction !== "ronin" && !this.trebSet; }
  trebFollow() { const own = this.view === "side" && this.faction !== "ronin"; const x = own ? Math.max(X_MIN + 2, Math.min(X_MAX - 2, this.heroX - 2.4)) : CATAPULT.x; this.treb.g.position.set(x, CATAPULT.y, TREB_Z); if (this.trebRing) { this.trebRing.visible = own && !this.trebSet && !this.menu && !this.intro; this.trebRing.position.set(x, WALL_TOP + 0.24, TREB_Z); } }
  placeTreb() {
    if (!this.needTreb() || this.menu || this.intro || this.paused || !this.treb) return; this.trebFollow(); this.trebSet = true; if (this.trebRing) this.trebRing.visible = false;
    const p = this.treb.g.position.clone(); this.puff(p.clone().add(new THREE.Vector3(0, 0.4, 0)), "dirt", 14, 0xb8a48a, 1.2, 2.2); this.puff(p.clone().add(new THREE.Vector3(0, 0.6, 0)), "smoke", 6, 0xaaa090, 1.6, 1, 0.8); this.shake = Math.max(this.shake, 0.5); this.cb.onSfx?.("crash");
    this.say("Trebuchet set — it stays here. Walk the wall to see your shots.", 2.4); this.pushHud();
  }
  trebRing: THREE.Mesh | null = null;
  /** keep the hero on the deck: parapet, towers, gatehouse, trebuchet, the garrison, torches, the crew's stores */
  collide(x: number, z: number) {
    const R = HERO_R; x = Math.max(X_MIN, Math.min(X_MAX, x)); z = Math.max(Z_MIN, Math.min(Z_MAX, z));
    const circ = (cx: number, cz: number, r: number) => { const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz), m = r + R; if (d < m) { const k = d > 1e-4 ? m / d : 1; x = cx + dx * k; z = cz + (d > 1e-4 ? dz * k : m); } };
    const box = (x0: number, x1: number, z0: number, z1: number) => { if (x < x0 - R || x > x1 + R || z < z0 - R || z > z1 + R) return; const pl = x - (x0 - R), pr = x1 + R - x, pf = z - (z0 - R), pb = z1 + R - z; const m = Math.min(pl, pr, pf, pb); if (m === pl) x = x0 - R; else if (m === pr) x = x1 + R; else if (m === pf) z = z0 - R; else z = z1 + R; };
    for (const tx of TOWERS) circ(tx, TOWER_Z, TOWER_R);
    box(-5, 5, FIELD_Z - 1, FIELD_Z + 1.4); circ(-5.2, FIELD_Z - 0.9, 1.6); circ(5.2, FIELD_Z - 0.9, 1.6);
    if (this.trebSet) { const t = this.treb.g.position; box(t.x - 1.4, t.x + 1.4, t.z - 3.2, t.z + 3.2); }
    for (const g of this.garrison) circ(g.a.obj.position.x, g.a.obj.position.z, 0.35);
    for (const tx of [-36.5, -30, -23.5, 11.5, 18, 33.5]) circ(tx, FIELD_Z + 0.55, 0.1);
    box(CATAPULT.x - 4.4, CATAPULT.x - 1.6, 7.7, 9.2); box(CATAPULT.x + 3.5, CATAPULT.x + 5.6, 7.8, 9.2);
    return [Math.max(X_MIN, Math.min(X_MAX, x)), Math.max(Z_MIN, Math.min(Z_MAX, z))];
  }
  /** move freely on the wall-walk and the terrace behind it (camera-relative: forward = toward the field) */
  stepHero(dt: number) {
    if (!this.hero || this.leap) return;
    let ix = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0) + this.moveIn, iz = (this.keys.b ? 1 : 0) - (this.keys.f ? 1 : 0) + this.moveInZ; if (this.wallView) { ix = -ix; iz = -iz; } /* wall view looks back at the wall: screen-right is -x, 'up' is toward the keep */ const mag = Math.min(1, Math.hypot(ix, iz)); if (mag > 0) { const n = Math.hypot(ix, iz); ix /= n; iz /= n; }
    const run = this.keys.run || this.runIn || Math.hypot(this.moveIn, this.moveInZ) > 0.92; const spd = (run ? RUN : WALK) * (this.keys.l || this.keys.r || this.keys.f || this.keys.b ? 1 : Math.max(0.35, mag));
    const k = Math.min(1, dt * 8); this.heroVX += (ix * spd * (mag > 0 ? 1 : 0) - this.heroVX) * k; this.heroVZ += (iz * spd * (mag > 0 ? 1 : 0) - this.heroVZ) * k; if (!mag && Math.hypot(this.heroVX, this.heroVZ) < 0.08) { this.heroVX = 0; this.heroVZ = 0; }
    const [nx, nz] = this.collide(this.heroX + this.heroVX * dt, this.heroZ + this.heroVZ * dt); void 0; if (dt > 0) { this.heroVX = (nx - this.heroX) / dt * 0.5 + this.heroVX * 0.5; this.heroVZ = (nz - this.heroZ) / dt * 0.5 + this.heroVZ * 0.5; } this.heroX = nx; this.heroZ = nz;
    this.heroV = Math.hypot(this.heroVX, this.heroVZ);
    const o = this.hero.obj; o.position.x = this.heroX; o.position.z = this.heroZ; const sp = this.heroV; const loco = sp > 5.2 ? "run" : sp > 0.35 ? "walk" : "idle";
    const A = this.hero.actions; const cur = this.hero.current; const busy = !!cur && cur !== A.idle && cur !== A.walk && cur !== A.run;
    if (loco !== this.loco) { this.loco = loco; if (!busy) this.playA(this.hero, loco, 1, 0.22); }
    const act = A[this.loco]; let bob = 0;
    if (this.loco !== "idle" && act && cur === act) { act.setEffectiveTimeScale(Math.max(0.6, Math.min(1.3, sp / (this.loco === "run" ? RUN : WALK)))); const b = (act.getClip().userData as any)?.bob as number[] | undefined; if (b?.length) bob = b[Math.floor(act.time * 30) % b.length] * 1.0; }
    o.position.y = WALL_TOP + 0.25 - o.userData.minY + bob;
    if (!this.trebSet) this.trebFollow();
  }
  updateAim() {
    const ndc = new THREE.Vector2(this.pointer.x * 2 - 1, -(this.pointer.y * 2 - 1)); const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3(); const wallHit = new THREE.Vector3();
    const onWall = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -FIELD_Z), wallHit) && wallHit.y > 0.5 && wallHit.y < WALL_TOP - 0.4 && (rc.ray.direction.z < 0 || this.wallView);
    const ok = rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    if (onWall) this.aim.lerp(new THREE.Vector3(wallHit.x, wallHit.y, FIELD_Z - 0.6), 0.4);
    else if (ok && hit.z < FIELD_Z - 2) { const h2 = new THREE.Vector3(); const th = terrainH(hit.x, hit.z); if (rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -th), h2) && h2.z < FIELD_Z - 2) hit.copy(h2); this.aim.lerp(new THREE.Vector3(hit.x, 0, hit.z), 0.35); }
    else { const far = rc.ray.at(70, new THREE.Vector3()); this.aim.lerp(new THREE.Vector3(far.x, 0, Math.min(FIELD_Z - 6, far.z)), 0.35); }
    this.aim.z = Math.min(FIELD_Z - 0.6, Math.max(-150, this.aim.z)); this.aim.x = Math.max(-80, Math.min(80, this.aim.x));
    const gy = this.aim.y > 0.2 ? this.aim.y : terrainH(this.aim.x, this.aim.z); this.marker.position.set(this.aim.x, gy + 0.08, this.aim.z); this.marker.rotation.set(this.aim.y > 0.2 ? 0 : -Math.PI / 2, 0, 0);
    const d = this.aim.distanceTo(this.camera.position); const ms = (0.6 + d * 0.022) * (this.view === "side" ? 1.4 : 1) + (this.charging ? this.charge * 1.4 : 0); this.marker.scale.set(ms, ms, 1);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(this.charging && this.charge > 0.65 ? 0xff8a4a : 0xffd27a);
    this.lockAir();
  }
  /** aim assist for fliers: point near a wasp on screen and the aim locks onto it (with lead), so you can shoot UP */
  lockAir() {
    this.airLock = null; const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1; const px = this.pointer.x * W, py = this.pointer.y * H; let best: Spider | null = null, bd = Math.max(48, W * 0.05);
    for (const s of this.spiders) { if (s.dead || s.kind !== "wasp") continue; const v = this.center(s).project(this.camera); if (v.z > 1 || v.z < -1) continue; const d = Math.hypot((v.x + 1) / 2 * W - px, (1 - v.y) / 2 * H - py); if (d < bd) { bd = d; best = s; } }
    if (!best) return; this.airLock = best; const c = this.center(best); const tz = FIELD_Z - 1.5;
    if (best.z < tz) { const t = c.distanceTo(this.hand()) / 36; c.z = Math.min(tz, c.z + best.speed * t); }
    this.aim.copy(c); const m = this.marker; m.position.copy(c); m.quaternion.copy(this.camera.quaternion); const d = c.distanceTo(this.camera.position); const ms = 0.5 + d * 0.03 + (this.charging ? this.charge * 0.8 : 0); m.scale.set(ms, ms, 1);
    (m.material as THREE.MeshBasicMaterial).color.setHex(0xff5a4a);
  }
  /** catapult arc: a high lob at the ground, a hard flat throw at something in the air */
  arc(p: THREE.Vector3, sp: number) { return this.airLock ? this.ballistic(p, this.aim, 44) : this.lob(p, this.aim, sp); }
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
    const h = this.hero ? this.hero.obj.position.clone() : new THREE.Vector3(this.heroX, WALL_TOP, this.heroZ); h.y += 1.4; h.z -= 0.4; return h;
  }

  // ── firing: every faction's kit
  fire(k: number) {
    if (this.state !== "play") return; const kit = KIT[this.faction] || KIT.boulder; this.reload = this.reloadTime * (0.85 + k * 0.45); this.play(kit.clip, 1.5); this.cb.onSfx?.("launch"); this.shake = Math.max(this.shake, 0.12 + k * 0.2);
    if (this.view === "side" && this.faction !== "ronin") { this.pendingFire = k; this.armMode = "swing"; this.armT = 0; return; }
    this.fireNow(k);
  }
  fireNow(k: number) {
    const f = this.faction; const p = this.hand(); const big = k > 0.65;
    switch (f) {
      case "ronin": this.roninLeap(k); return;
      case "samurai": this.spawnBoulder(p, this.arc(p, 30), k, "blade"); this.say(big ? "Samurai: FIRST STRIKE!" : "Samurai: Blade boulder", 0.8); return;
      case "warrior": this.spawnBoulder(p, this.arc(p, 27), k, "great"); this.say(big ? "Warrior: BERSERKER RAGE!" : "Warrior: Greatstone", 0.8); return;
      case "buke": this.spawnBoulder(p, this.arc(p, 30), k, "shield"); this.say(big ? "Buke: NOBLE GUARD!" : "Buke: Shield boulder", 0.8); return;
      case "shogun": this.spawnStandard(p, this.arc(p, 30), k); this.say(big ? "Shogun: RALLY!" : "Shogun: War standard", 0.8); return;
      case "yamabushi": this.spawnOrb(p, this.ballistic(p, this.aim, 28), k, "storm"); this.say(big ? "Yamabushi: STORM CALL!" : "Yamabushi: Storm orb", 0.8); return;
      case "sohei": this.spawnOrb(p, this.ballistic(p, this.aim, 28), k, "ward"); this.say(big ? "Sohei: PRAYER!" : "Sohei: Ward stone", 0.8); return;
      case "kenshi": { const n = big ? 7 : 3; for (let i = 0; i < n; i++) { const tgt = this.aim.clone(); const spread = (i - (n - 1) / 2) * (big ? 1.6 : 2.2); tgt.x += spread; const v = this.ballistic(p, tgt, 48); this.spawnBlade(p.clone(), v, k); } this.say(big ? "Kenshi: IAIJUTSU!" : "Kenshi: Blade fan", 0.7); return; }
      case "bushi": { const n = big ? 3 : 1; for (let i = 0; i < n; i++) { const tgt = this.aim.clone(); if (n > 1) { tgt.x += (i - 1) * 2.6; tgt.z += (Math.random() - 0.5) * 2; } this.spawnStake(p.clone(), this.ballistic(p, tgt, 30), k); } this.say(big ? "Bushi: AMBUSH!" : "Bushi: Trap stake", 0.7); return; }
      case "wokou": this.spawnHook(p, this.ballistic(p, this.aim, 42), k); this.say(big ? "Wokou: BOARDING PARTY!" : "Wokou: Grapple", 0.7); return;
      case "ashigaru": { const n = big ? 5 : 1; for (let i = 0; i < n; i++) { const tgt = this.aim.clone(); if (n > 1) { tgt.x += (i - 2) * 2.2 + (Math.random() - 0.5); tgt.z += (Math.random() - 0.5) * 3; } this.spawnSpear(p.clone().add(new THREE.Vector3((i - (n - 1) / 2) * 0.15, 0, 0)), this.ballistic(p, tgt, 34), k); } this.say(big ? "Ashigaru: SPEAR VOLLEY!" : "Ashigaru: Spear!", 0.7); return; }
      default: this.spawnBoulder(p, this.arc(p, 30), k, "rock"); return;
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
    this.flash(p, col, 8 + k * 10, 18, 7, m); this.mkShot(m, p, v, sub === "storm" ? "orb" : "ward", 80 + k * 50, k);
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
    if (!this.hero || this.leap) return; const from = this.hero.obj.position.clone(); const to = new THREE.Vector3(this.aim.x, terrainH(this.aim.x, Math.min(FIELD_Z - 3, this.aim.z)), Math.min(FIELD_Z - 3, this.aim.z));
    this.leap = { t: 0, from, to, phase: "fly", k }; this.play("special", 1.2); this.puff(from, "smoke", 6, 0x8a8090, 1.2, 1.2, 0.5); this.say(k > 0.65 ? "Ronin: LAST STAND!" : "Ronin: Shadow Step!", 0.9);
  }
  stepLeap(dt: number) {
    const L = this.leap; if (!L || !this.hero) return; L.t += dt; const o = this.hero.obj;
    if (L.phase === "fly") { const T = 0.85; const u = Math.min(1, L.t / T); const p = L.from.clone().lerp(L.to, u); p.y = L.from.y * (1 - u) + L.to.y * u + Math.sin(u * Math.PI) * 6 - o.userData.minY; o.position.copy(p); o.rotation.y = Math.atan2(L.to.x - L.from.x, L.to.z - L.from.z) + Math.PI; if (u >= 1) { L.phase = "land"; L.t = 0; this.play("attack", 2); const gp = L.to.clone(); this.ringFx(gp, 0xff6b7a, 8 + L.k * 4); this.puff(gp, "dirt", 12, 0xb8a48a, 1.2, 4); this.shake = Math.max(this.shake, 0.7); this.cb.onSfx?.("crash"); const R = 5 + L.k * 2.5; for (const tg of this.targetsNear(gp, R)) { this.hurtTarget(tg, 260 + L.k * 120, "slash"); } } }
    else if (L.phase === "land") { if (L.t > 0.55) { L.phase = "back"; L.t = 0; this.puff(o.position.clone().add(new THREE.Vector3(0, 1, 0)), "smoke", 10, 0x9a8aa8, 1.6, 1.5, 0.7); o.visible = false; } }
    else if (L.t > 0.35) { o.visible = true; o.position.copy(L.from); o.rotation.y = this.heroYaw = Math.PI; this.play("win", 1.6); this.puff(L.from.clone().add(new THREE.Vector3(0, 1, 0)), "smoke", 8, 0x9a8aa8, 1.4, 1.2, 0.6); this.leap = null; }
  }

  // ── the horde
  spawnSpider(size = 1, kind: SpiderKind = "crawler") {
    const bug = buildBug(kind, this.bugModels); const g = bug.g;
    const scale = size * (kind === "brood" ? 2.4 : kind === "brute" ? 2.1 : kind === "wasp" ? 1.5 : 1.7); g.scale.setScalar(scale);
    const x = kind === "brood" ? 0 : (Math.random() - 0.5) * 48, z = FIELD_Z - 70 - Math.random() * 25; g.position.set(x, terrainH(x, z), z); g.rotation.y = Math.PI; this.scene.add(g);
    const hp = kind === "brood" ? 3200 : kind === "brute" ? 520 : kind === "wasp" ? 45 : kind === "slinger" ? 90 : 60 * size * size;
    const speed = kind === "brood" ? 1.3 : kind === "brute" ? 1.9 : kind === "wasp" ? 7 : (4.2 + Math.random() * 1.6) / Math.sqrt(size);
    const sp: Spider = { g, body: bug.body, lod: bug.lod, legs: bug.legs, mixer: bug.mixer, acts: bug.acts, anim: bug.acts?.Walk ? "Walk" : "Flying", wings: bug.wings, kind, x, y: kind === "wasp" ? 6 : 0, z, hp, hpMax: hp, size: size * (kind === "brood" ? 1.6 : kind === "brute" ? 1.3 : 1), speed, ph: Math.random() * 6, stun: 0, dead: false, arrived: false, wob: Math.random() * 6, pinned: 0, cd: 2 + Math.random() * 2, holdZ: kind === "slinger" ? FIELD_Z - 26 - Math.random() * 6 : kind === "brood" ? FIELD_Z - 34 : 0 };
    this.spiders.push(sp); this.hordeLeft++;
    if (kind === "wasp" && !this.waspHint && !this.intro && !this.menu) { this.waspHint = true; this.say("Wasps! Point at one — your aim locks on (red ring) so you can shoot them down", 2.8); }
    if (kind === "brood") { this.boss = sp; this.say("THE BROOD MOTHER", 3.2, true); this.cb.onSfx?.("horn"); }
  }
  gait(s: Spider, phase: number, amp: number) { if (s.mixer) return; gait(s, phase, amp); }
  /** crossfade a rigged enemy to a clip (Walk / Idle / Attack / Flying / Jump / Death) */
  setAnim(s: Spider, name: string, speed = 1) { if (!s.acts || s.anim === name) { if (s.acts?.[name]) s.acts[name].timeScale = speed; return; } const next = s.acts[name]; if (!next) return; const cur = s.anim ? s.acts[s.anim] : null; next.reset(); next.timeScale = speed; next.play(); if (cur) cur.crossFadeTo(next, 0.2, false); s.anim = name; }
  animFor(s: Spider) {
    if (!s.acts) return; if (s.pinned > 0 || s.stun > 0) return this.setAnim(s, s.kind === "wasp" ? "Flying" : "Idle");
    if (s.kind === "wasp") return this.setAnim(s, s.z >= FIELD_Z - 1.6 ? "Attack" : "Flying");
    if ((s.kind === "slinger" || s.kind === "brood") && s.z >= s.holdZ) return this.setAnim(s, s.cd < 0.6 ? "Attack" : "Idle");
    if (s.arrived) return this.setAnim(s, s.y >= WALL_TOP - 0.2 ? "Attack" : "Walk", s.y >= WALL_TOP - 0.2 ? 1 : 1.4);
    this.setAnim(s, "Walk", Math.min(2, 0.6 + s.speed * 0.22));
  }
  spawnTower() {
    const g = new THREE.Group(); const w = this.woodMat; const silk = new THREE.MeshStandardMaterial({ color: 0xece4f4, roughness: 0.75, transparent: true, opacity: 0.88, side: THREE.DoubleSide, emissive: 0x3a1a5a, emissiveIntensity: 0.25 });
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material = w, rx = 0, rz = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); b.rotation.set(rx, 0, rz); b.castShadow = true; g.add(b); return b; };
    box(4.4, 0.6, 4.4, 0, 0.9, 0);
    for (const [dx, dz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) { box(0.36, 9.6, 0.36, dx * 0.92, 5.6, dz * 0.92); const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 14), w); wh.rotation.z = Math.PI / 2; wh.position.set(dx * 1.12, 0.62, dz); wh.castShadow = true; g.add(wh); }
    for (const y of [3.4, 6.2, 9.0]) box(4.0, 0.22, 4.0, 0, y, 0);
    for (const y of [2.2, 4.8, 7.6]) { box(3.6, 0.14, 0.14, 0, y, -1.75, w, 0, 0.55); box(3.6, 0.14, 0.14, 0, y, 1.75, w, 0, -0.55); }
    for (let lv = 0; lv < 3; lv++) { const y = 2.1 + lv * 2.8; for (const [px, pz, ry] of [[0, -1.95, 0], [-1.95, 0, Math.PI / 2], [1.95, 0, Math.PI / 2]] as [number, number, number][]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.5, 4, 3), silk); const pp = pl.geometry.attributes.position; for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin(pp.getX(i) * 1.7 + lv) * 0.12 + Math.sin(pp.getY(i) * 2.3) * 0.08); pl.geometry.computeVertexNormals(); pl.position.set(px, y, pz); pl.rotation.y = ry; g.add(pl); } }
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.1, 6), w); sp.position.set(-1.6 + (i % 3) * 1.6, 9.7, i < 3 ? -1.6 : 1.6); g.add(sp); }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0x9a6ad0, transparent: true, depthWrite: false, opacity: 0.35 })); glow.scale.set(7, 9, 1); glow.position.y = 5; g.add(glow);
    mergeByMaterial(g, (o) => o === glow as any);
    const x = (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 16), z = FIELD_Z - 95; g.position.set(x, terrainH(x, z), z); this.scene.add(g);
    this.engines.push({ kind: "tower", g, x, z, hp: 420, hpMax: 420, speed: 1.5, arrived: false, dead: false, wheels: [], bangT: 0 }); this.hordeLeft++;
  }
  spawnRam() {
    const g = new THREE.Group(); const w = this.woodMat; const M = { shell: new THREE.MeshPhysicalMaterial({ color: 0x1c2a22, metalness: 0.5, roughness: 0.3, clearcoat: 1 }), bronze: new THREE.MeshStandardMaterial({ color: 0x9a6a2a, metalness: 0.85, roughness: 0.35 }) };
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material = w, rx = 0, rz = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); b.rotation.set(rx, 0, rz); b.castShadow = true; g.add(b); return b; };
    box(3.4, 0.4, 5.8, 0, 1.2, 0);
    for (const [dx, dz] of [[-1.5, -2.4], [1.5, -2.4], [-1.5, 2.4], [1.5, 2.4]]) box(0.25, 2.4, 0.25, dx, 2.5, dz);
    box(2.1, 0.14, 6.2, -0.95, 3.9, 0, M.shell, 0, 0.62); box(2.1, 0.14, 6.2, 0.95, 3.9, 0, M.shell, 0, -0.62);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(2.1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.shell); shell.scale.set(0.95, 0.5, 1.6); shell.position.y = 4.2; shell.castShadow = true; g.add(shell);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 6.4, 12), w); log.rotation.x = Math.PI / 2; log.position.set(0, 2.2, -0.6); log.castShadow = true; g.add(log);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), M.bronze); head.scale.set(1, 1, 1.4); head.position.set(0, 2.2, -3.9); g.add(head);
    for (const sx of [-0.35, 0.35]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.1, 8), M.bronze); h.rotation.x = -Math.PI / 2 - 0.3; h.position.set(sx, 2.5, -4.6); g.add(h); }
    for (const ex of [-0.45, 0.45]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), this.eyeMat); e.position.set(ex, 4.4, -3.1); g.add(e); }
    mergeByMaterial(g);
    const wheels: THREE.Mesh[] = []; for (const [dx, dz] of [[-1.85, -1.9], [1.85, -1.9], [-1.85, 1.9], [1.85, 1.9]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.35, 14), w); wh.rotation.z = Math.PI / 2; wh.position.set(dx, 0.85, dz); wh.castShadow = true; g.add(wh); wheels.push(wh); }
    const x = (Math.random() - 0.5) * 3, z = FIELD_Z - 105; g.position.set(x, terrainH(x, z), z); this.scene.add(g);
    this.engines.push({ kind: "ram", g, x, z, hp: 380, hpMax: 380, speed: 2.6, arrived: false, dead: false, wheels, bangT: 0 }); this.hordeLeft++;
  }
  stepHorde(dt: number) {
    for (const s of this.spiders) {
      if (s.dead) continue; this.animFor(s); if (s.pinned > 0) { s.pinned -= dt; this.gait(s, this.t * 30, 0.15 * 1.6); continue; } if (s.stun > 0) { s.stun -= dt; continue; }
      const ph = this.t * 9 + s.ph;
      if (s.kind === "wasp") {   // flies in over the field, hovers over the parapet and stings the defenders
        for (const w of s.wings) w.rotation.y = -Math.sign(w.position.x) * (0.25 + Math.sin(this.t * 42 + s.ph) * 0.6);
        const tz = FIELD_Z - 1.5; if (s.z < tz) { s.z += s.speed * dt; s.x += Math.sin(this.t * 1.3 + s.wob) * dt * 2; s.y = 6 + Math.sin(this.t * 2 + s.ph) * 1.2 + Math.max(0, (s.z - (FIELD_Z - 30)) / 30) * (WALL_TOP - 3); } else { s.z = tz; s.y = WALL_TOP + 2.2 + Math.sin(this.t * 3 + s.ph) * 0.5; s.cd -= dt; if (s.cd <= 0) { s.cd = 1.6; this.hurtGate(9); this.puff(new THREE.Vector3(s.x, WALL_TOP + 1.2, FIELD_Z + 0.3), "spark", 3, 0xffd27a, 0.5, 1); s.g.position.y -= 0.6; } }
        s.g.position.set(s.x, s.y, s.z); s.g.rotation.set(-0.25, Math.PI, Math.sin(this.t * 1.3 + s.wob) * 0.25); continue;
      }
      if (s.kind === "slinger" && s.z >= s.holdZ) {   // stops short and lobs web globs at the wall
        s.cd -= dt; this.gait(s, this.t * 3, 0.1 * 1.6);
        if (s.cd <= 0) { s.cd = 3.5 + Math.random(); const from = this.center(s); const to = new THREE.Vector3(s.x * 0.4 + (Math.random() - 0.5) * 12, WALL_TOP + 0.6, WALL_Z); const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf4f0ff, roughness: 0.3, emissive: 0x504870 })); this.mkShot(m, from, this.ballistic(from, to, 22), "web", 14, 0); this.puff(from, "smoke", 2, 0xe8e0ff, 0.8, 0.5); }
        s.g.position.set(s.x, terrainH(s.x, s.z), s.z); continue;
      }
      if (s.kind === "brood") {   // the boss: crawls to a vantage, births crawlers, spits venom
        if (s.z < s.holdZ) { s.z += s.speed * dt; this.gait(s, ph * 0.5, 0.4 * 1.6); }
        else { s.cd -= dt; this.gait(s, this.t * 2, 0.12 * 1.6); if (s.cd <= 0) { s.cd = 5.5; if (Math.random() < 0.5) { for (let i = 0; i < 3; i++) { this.spawnSpider(0.8 + Math.random() * 0.3); const c = this.spiders[this.spiders.length - 1]; c.x = s.x + (Math.random() - 0.5) * 6; c.z = s.z + 2; c.g.position.set(c.x, terrainH(c.x, c.z), c.z); } this.puff(this.center(s), "smoke", 8, 0x8b5cf6, 2, 1.5, 0.8); this.say("The Brood Mother births more crawlers!", 1.4); } else { const from = this.center(s); const to = new THREE.Vector3((Math.random() - 0.5) * 8, 3, FIELD_Z - 0.5); const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9dff6a })); this.flash(from, 0x9dff6a, 40, 20, 7, m); this.mkShot(m, from, this.ballistic(from, to, 26), "venom", 45, 0); this.say("Venom!", 0.8); } } }
        s.g.position.set(s.x, terrainH(s.x, s.z), s.z); s.g.rotation.set(0, Math.PI, 0); continue;
      }
      if (!s.arrived) {
        s.x = Math.sign(s.x) * Math.max(0, Math.abs(s.x) - dt * s.speed * 0.25) + Math.sin(this.t * 0.7 + s.wob) * 0.02; s.z += s.speed * dt; s.g.position.set(s.x, terrainH(s.x, s.z), s.z); s.g.rotation.set(0, Math.PI, 0);
        this.gait(s, ph, 0.5 * 1.6);
        for (const z of this.zones) if (z.kind === "trap" && z.life > 0 && Math.hypot(s.x - z.pos.x, s.z - z.pos.z) < 1.8 + s.size * 0.6) { z.life = 0; s.pinned = 3; this.hurt(s, 120 + z.k * 60); this.puff(z.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), "spark", 6, 0xb8ffb0, 0.8, 2); this.say("Bushi: pinned!", 0.5); }
        if (s.z >= FIELD_Z - 2.6 * s.size) { s.arrived = true; s.z = FIELD_Z - 2.6 * s.size; if (s.kind !== "brute") for (const tx of TOWERS) if (Math.abs(s.x - tx) < 4.2) s.x = tx + (s.x >= tx ? 4.2 : -4.2); if (s.kind === "brute") this.say("A beetle brute is at the gate!", 1.4); }
      } else if (s.kind === "brute") {   // too heavy to climb: batters the gate
        s.cd -= dt; this.gait(s, this.t * 6, 0.2 * 1.6); const k = Math.max(0, 0.5 - Math.abs(s.cd - 0.3)); s.g.position.set(s.x, terrainH(s.x, s.z), s.z + k * 3); if (s.cd <= 0) { s.cd = 2.2; this.hurtGate(26); this.shake = Math.max(this.shake, 0.5); this.cb.onSfx?.("gate"); this.puff(new THREE.Vector3(s.x, 2.5, FIELD_Z - 0.4), "dirt", 8, 0xb8a48a, 0.8, 2.5); }
      } else {
        const top = WALL_TOP - 0.2; const ph2 = this.t * 8 + s.ph;
        if (s.y < top) { s.y = Math.min(top, s.y + s.speed * 0.28 * dt); this.gait(s, ph2, 0.45 * 1.6); this.hurtGate(dt * 1.5 * s.size); }
        else { this.gait(s, this.t * 22, 0.25 * 1.6); this.hurtGate(dt * 9 * s.size); if (Math.random() < dt * 0.8) this.puff(new THREE.Vector3(s.x, top + 0.9, FIELD_Z + 0.2), "spark", 3, 0xffd27a, 0.6, 0.5); }
        s.z = (Math.abs(s.x) < 5.6 ? FIELD_Z - 1.3 : FIELD_Z) - 0.55 * s.size; s.g.position.set(s.x, s.y, s.z); s.g.rotation.set(-Math.PI / 2 + 0.15, Math.PI, 0);
      }
    }
    for (const e of this.engines) {
      if (e.dead) continue;
      if (!e.arrived) { e.z += e.speed * dt; e.x += (Math.sign(e.x) * Math.max(0, Math.abs(e.x) - (e.kind === "ram" ? 0 : 8)) - e.x) * dt * 0.08; e.g.position.set(e.x, terrainH(e.x, e.z), e.z); for (const w of e.wheels) w.rotation.x += e.speed * dt / 0.8; if (e.kind === "tower") e.g.rotation.z = Math.sin(this.t * 2.2) * 0.02; if (e.z >= FIELD_Z - (e.kind === "ram" ? 3.4 : 3.2)) { e.arrived = true; this.say(e.kind === "ram" ? "Beetle ram at the gate!" : "A siege tower reached the wall!", 1.6); } }
      else { e.bangT += dt; if (e.kind === "ram") { if (e.bangT > 1.4) { e.bangT = 0; this.hurtGate(18); this.shake = Math.max(this.shake, 0.5); this.cb.onSfx?.("gate"); this.puff(new THREE.Vector3(e.x, 2.5, FIELD_Z - 0.4), "dirt", 8, 0xb8a48a, 0.8, 2.5); } e.g.position.z = e.z + Math.max(0, 0.5 - Math.abs(e.bangT - 1.2)) * 1.2 * (e.bangT > 0.7 ? 1 : 0); } else { this.hurtGate(dt * 14); if (Math.random() < dt * 1.2) this.puff(new THREE.Vector3(e.x, WALL_TOP + 0.6, FIELD_Z), "spark", 2, 0xc4b5fd, 0.6, 0.6); } }
    }
  }
  center(s: Spider) { return new THREE.Vector3(s.x, (s.kind === "wasp" ? s.y : s.arrived && s.kind !== "brute" ? s.y : terrainH(s.x, s.z)) + 0.8 * s.size, s.z); }
  targetsNear(p: THREE.Vector3, r: number): Target[] {
    const out: Target[] = [];
    for (const s of this.spiders) if (!s.dead) { const c = this.center(s); if (c.distanceTo(p) <= r + s.size * 1.1) out.push({ pos: c, r: s.size * 1.1, s }); }
    for (const e of this.engines) if (!e.dead) { const c = new THREE.Vector3(e.x, e.kind === "tower" ? 4 : 2, e.z); const rr = e.kind === "tower" ? 3.2 : 3; if (Math.hypot(c.x - p.x, c.z - p.z) <= r + rr && Math.abs(p.y - c.y) < (e.kind === "tower" ? 5.5 : 3.5) + r) out.push({ pos: c, r: rr, e }); }
    return out;
  }
  hurtTarget(t: Target, d: number, how: "hit" | "slash" | "bolt" = "hit") { if (t.s) { this.hurt(t.s, d); if (how === "slash") this.slashFx(this.center(t.s)); } else if (t.e) this.hurtEngine(t.e, d, t.pos); }
  hurt(s: Spider, d: number) {
    if (s.dead) return; s.hp -= d; s.stun = Math.max(s.stun, 0.25); if (s.hp > 0) { this.puff(this.center(s), "spark", 3, 0xc4b5fd, 0.5, 0.25); return; }
    if (s.kind === "brood" && s.hp <= 0) { this.say("THE BROOD MOTHER FALLS", 3.4, true); this.score += 1000; this.shake = 2; this.boss = null; }
    s.dead = true; this.kills++; this.score += Math.round(10 * s.size * (s.kind === "brute" ? 4 : s.kind === "wasp" ? 2 : 1)); this.hordeLeft--; this.cb.onSfx?.("squish");
    const p = this.center(s); this.puff(p, "dirt", 10, 0x8b5cf6, 1.2 * s.size, 3.5); this.puff(p, "glow", 3, 0xc4b5fd, 2 * s.size, 0.8, 0.5); this.puff(p, "smoke", 4, 0x6a5a7a, 1.6 * s.size, 1.2, 0.9);
    const g = s.g; const t0 = this.t; const y0 = g.position.y; const falls = s.kind === "wasp" || (s.arrived && s.y > 0.5); if (s.acts?.Death) { const d = s.acts.Death; d.reset(); d.play(); if (s.anim && s.acts[s.anim]) s.acts[s.anim].crossFadeTo(d, 0.12, false); s.anim = "Death"; }
    const tick = () => { if (this.over) return; const k = this.t - t0; if (s.mixer) { g.position.y = falls ? y0 - k * k * 6 : y0 - Math.max(0, k - 1.3) * 1.6; } else { g.rotation.x += 0.15; g.position.y = y0 - k * k * 6; } if (k < (s.mixer ? 2.4 : 1.4)) requestAnimationFrame(tick); else { this.scene.remove(g); s.mixer?.stopAllAction(); s.mixer = undefined; this.drop(g); } }; tick();
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
      if (sh.kind === "web" || sh.kind === "venom") { sh.hit.clear(); if (sh.p.z >= WALL_Z - 1.6 || sh.p.y <= terrainH(sh.p.x, sh.p.z) + 0.05) { this.hurtGate(sh.dmg); this.shake = Math.max(this.shake, 0.3); if (sh.kind === "web") { this.puff(sh.p, "smoke", 6, 0xe8e0ff, 1.2, 1, 0.9); const near = this.garrison.reduce((b, g) => (!b || g.a.obj.position.distanceTo(sh.p) < b.a.obj.position.distanceTo(sh.p) ? g : b), null as any); if (near) near.cd = Math.max(near.cd, 4); this.say("Webbed!", 0.6); } else { this.puff(sh.p, "dirt", 8, 0x9dff6a, 1, 2.5); this.puff(sh.p, "glow", 2, 0x9dff6a, 3, 0.3, 0.5); } sh.life = 0; } continue; }
      const R = (sh.kind === "orb" || sh.kind === "ward" ? 1.4 : sh.kind === "boulder" ? (sh.sub === "great" ? 1.6 : 1.2) : 1.0) + (sh.p.z > FIELD_Z - 3 && sh.p.y > 0.8 ? 0.6 : 0) + (sh.p.y > 3 ? 1.0 : 0);   // a little more forgiving on climbers
      for (const tg of this.targetsNear(sh.p, R)) { const key = tg.s || tg.e!; if (sh.hit.has(key)) continue; sh.hit.add(key);
        if (sh.kind === "orb" || sh.kind === "ward" || sh.kind === "boulder" || sh.kind === "standard") { this.impact(sh); sh.life = 0; break; }
        if (sh.kind === "hook") { if (tg.s) this.fling(tg.s, sh.k); else this.hurtTarget(tg, 120); sh.life = 0; break; }
        if (sh.kind === "stake") { this.hurtTarget(tg, sh.dmg); if (tg.s) tg.s.pinned = 2; sh.life = 0; break; }
        this.hurtTarget(tg, sh.dmg); if (sh.kind === "arrow") { sh.life = 0; break; } if (sh.kind === "blade") this.slashFx(tg.pos); sh.v.multiplyScalar(sh.kind === "blade" ? 0.92 : 0.7); }
      if (sh.life <= 0) continue;
      const gy = terrainH(sh.p.x, sh.p.z) + 0.05; const wallHit = sh.v.z > 0 && sh.p.z > FIELD_Z - 0.2 && sh.p.y < WALL_TOP + 0.3 && sh.p.y > 0.05;   // only shots coming in from the field hit the face; ours leave from the top
      if (sh.p.y <= gy || wallHit) {
        if (sh.kind === "orb" || sh.kind === "ward" || sh.kind === "boulder" || sh.kind === "standard") { if (sh.p.y <= gy) sh.p.y = gy; this.impact(sh); sh.life = 0; continue; }
        if (wallHit) { this.puff(sh.p, "spark", 3, 0xffd27a, 0.5, 1.5); sh.life = 0; continue; }
        sh.p.y = gy; sh.m.position.copy(sh.p); sh.stuck = true; sh.v.set(0, 0, 0);
        if (sh.kind === "stake") { this.zones.push({ kind: "trap", pos: sh.p.clone(), r: 1.8, life: 25, life0: 25, m: sh.m, tick: 0, k: sh.k }); this.puff(sh.p, "dirt", 3, 0x9c8a6a, 0.6, 1.5); sh.life = 25.5; continue; }
        this.puff(sh.p, "dirt", sh.kind === "arrow" ? 2 : 5, 0x9c8a6a, 0.7, 2);
        if (sh.kind === "spear") { for (const tg of this.targetsNear(sh.p, 2.2 + sh.k)) { const key = tg.s || tg.e!; if (!sh.hit.has(key)) { sh.hit.add(key); this.hurtTarget(tg, sh.dmg * 0.6); if (tg.s) tg.s.stun = 1.2; } } this.ringFx(sh.p, 0xffd27a, 3 + sh.k * 2); this.shake = Math.max(this.shake, 0.2); this.cb.onSfx?.("impact"); }
        sh.life = Math.min(sh.life, 1.2);
      }
    }
    for (const sh of this.shots) if (sh.life <= 0) { this.scene.remove(sh.m); this.drop(sh.m); if (sh.rope) { this.scene.remove(sh.rope); this.drop(sh.rope); } }
    this.shots = this.shots.filter((sh) => sh.life > 0);
  }
  impact(sh: Shot) {
    const p = sh.p.clone(); p.y = Math.max(p.y, 0.3); const k = sh.k;
    if (sh.kind === "orb") { this.stormBurst(p, k, sh.dmg); return; }
    if (sh.kind === "ward") { const life = 6 + k * 4; const m = new THREE.Group(); const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.2, 48), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; m.add(ring); const disc = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.08; m.add(disc); const pil = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffe08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })); pil.scale.set(8, 14, 1); pil.position.y = 5; m.add(pil); m.position.set(p.x, terrainH(p.x, p.z), p.z); this.scene.add(m); this.flash(new THREE.Vector3(p.x, terrainH(p.x, p.z) + 3, p.z), 0xffd27a, 60, 30, life);
      this.zones.push({ kind: "ward", pos: new THREE.Vector3(p.x, 0, p.z), r: 5 + k * 1.5, life, life0: life, m, tick: 0, k }); this.ringFx(p, 0xffd27a, 8); this.puff(p, "flare", 1, 0xfff0c0, 8, 0, 0.3); this.cb.onSfx?.("impact"); return; }
    if (sh.kind === "standard") { const life = 8 + k * 4; const m = sh.m; m.position.set(p.x, 0, p.z); m.quaternion.identity(); m.rotation.x = Math.PI / 2; m.position.y = terrainH(p.x, p.z) + 1.6; this.scene.add(m); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.glow, color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })); gl.scale.set(6, 6, 1); gl.position.y = 2; m.add(gl); const wrap = new THREE.Group(); wrap.add(m); this.scene.add(wrap);
      this.zones.push({ kind: "standard", pos: new THREE.Vector3(p.x, 0, p.z), r: 9 + k * 3, life, life0: life, m: wrap, tick: 0, k }); this.rally = life; this.ringFx(p, 0xffd27a, 10); this.puff(p, "dirt", 6, 0xb8a48a, 0.8, 2); this.cb.onSfx?.("horn"); sh.m = new THREE.Group(); return; }
    // boulders
    const sub = sh.sub || "rock"; const R = sub === "great" ? 5.5 + k * 2 : sub === "blade" ? 4.5 + k * 1.5 : 3.2 + k * 1.2;
    for (const tg of this.targetsNear(p, R)) { this.hurtTarget(tg, sh.dmg, sub === "blade" ? "slash" : "hit"); if (tg.s) tg.s.stun = sub === "great" ? 2 : 1; }
    this.ringFx(p, sub === "blade" ? 0xff8a8a : sub === "shield" ? 0x8fb8ff : 0xffc36a, R * 1.4); this.puff(p, "dirt", 10 + k * 8, 0x9c8a6a, 1 + k, 3 + k * 2); this.puff(p, "smoke", 5, 0x6f6a80, 2 + k, 1.2, 1.1); this.puff(p, "flare", 1, 0xfff2c0, 5 + k * 4, 0, 0.2);
    if (sub === "blade") for (let i = 0; i < 6; i++) this.slashFx(p.clone().add(new THREE.Vector3(Math.cos(i) * 2.2, 0.8, Math.sin(i) * 2.2)));
    if (sub === "shield") { this.gateHp = Math.min(this.gateMax, this.gateHp + 40 + k * 40); this.say("Buke: the gate mends", 0.7); this.ringFx(new THREE.Vector3(0, 0, FIELD_Z - 1), 0x8fb8ff, 5); }
    this.flash(p.clone().add(new THREE.Vector3(0, 1.5, 0)), sub === "great" ? 0xffa04a : 0xffc36a, 120 + k * 120, 40, 0.12);
    this.shake = Math.max(this.shake, sub === "great" ? 1 : 0.5 + k * 0.4); this.cb.onSfx?.("crash");
    // the boulder stays as a rock on the field for a while
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(sub === "great" ? 1.1 : 0.75, 0), this.rockMat); rock.position.set(p.x, terrainH(p.x, p.z) + 0.5, p.z); rock.rotation.set(Math.random(), Math.random(), 0); this.scene.add(rock); setTimeout(() => { this.scene.remove(rock); rock.geometry.dispose(); }, 12000);
  }
  stormBurst(p: THREE.Vector3, k: number, dmg: number) {
    const n = 6 + Math.round(k * 6); const r = 9 + k * 6;
    const targets = this.targetsNear(p, r).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p)).slice(0, n);
    let from = p; this.puff(p, "flare", 1, 0xbfd6ff, 8 + k * 6, 0, 0.3); this.ringFx(p, 0x9ec7ff, 6 + k * 6); this.shake = Math.max(this.shake, 0.6 + k * 0.5); this.cb.onSfx?.("crash");
    this.flash(p, 0x9ec7ff, 90, 45, 0.13);
    for (const tg of targets) { this.bolt(from, tg.pos); this.hurtTarget(tg, dmg, "bolt"); if (tg.s) tg.s.stun = 1.4; this.puff(tg.pos, "spark", 4, 0xbfd6ff, 1.2, 1.5); from = tg.pos; }
    if (!targets.length) this.puff(p, "dirt", 8, 0x9c8a6a, 1, 3);
  }
  fling(s: Spider, k: number) {
    if (s.dead) return; s.dead = true; this.hordeLeft--; this.kills++; this.score += Math.round(10 * s.size); s.g.rotation.set(0, Math.PI, 0);
    const toward = new THREE.Vector3(0, 0, FIELD_Z - 8).sub(new THREE.Vector3(s.x, 0, s.z)).normalize().multiplyScalar(8 + k * 6); this.flings.push({ s, v: new THREE.Vector3(toward.x, 12 + k * 6, toward.z), t: 0, k }); this.puff(this.center(s), "spark", 5, 0x7ad7ff, 0.8, 1.5); this.cb.onSfx?.("impact");
  }
  stepFlings(dt: number) {
    for (const f of this.flings) { f.t += dt; const g = f.s.g; f.v.y -= G * 1.4 * dt; g.position.addScaledVector(f.v, dt); g.rotation.x += dt * 9; g.rotation.z += dt * 4;
      if (g.position.y <= terrainH(g.position.x, g.position.z) && f.t > 0.2) { g.position.y = terrainH(g.position.x, g.position.z); f.t = 99; const p = g.position.clone().add(new THREE.Vector3(0, 0.5, 0)); this.ringFx(p, 0x7ad7ff, 6 + f.k * 3); this.puff(p, "dirt", 12, 0x8b5cf6, 1.3, 4); this.shake = Math.max(this.shake, 0.6); this.cb.onSfx?.("crash");
        for (const tg of this.targetsNear(p, 3.5 + f.k * 2)) if (tg.s !== f.s) this.hurtTarget(tg, 110 + f.k * 60); this.scene.remove(g); } }
    this.flings = this.flings.filter((f) => f.t < 99);
  }
  stepZones(dt: number) {
    for (const z of this.zones) { z.life -= dt; z.tick += dt; const k = Math.min(1, z.life / 0.8); z.m.scale.setScalar(Math.max(0.01, k)); if (z.kind === "trap" && z.life <= 0) { this.scene.remove(z.m); this.drop(z.m); continue; }
      if (z.kind === "ward") { z.m.rotation.y += dt * 0.6; if (z.tick > 0.5) { z.tick = 0; for (const tg of this.targetsNear(z.pos, z.r)) { this.hurtTarget(tg, 28 + z.k * 14); this.puff(tg.pos, "spark", 2, 0xffe08a, 0.8, 1); } this.gateHp = Math.min(this.gateMax, this.gateHp + 6 + z.k * 4); } }
      if (z.kind === "standard") { z.m.rotation.y = Math.sin(this.t * 3) * 0.06; if (z.tick > 0.35) { z.tick = 0; const tg = this.targetsNear(z.pos, z.r); if (tg.length) { const t = tg[(Math.random() * tg.length) | 0]; const from = new THREE.Vector3((Math.random() - 0.5) * 30, WALL_TOP + 2, WALL_Z); this.spawnSpear(from, this.ballistic(from, t.pos, 40), 0, true); } } }
      if (z.life <= 0) { this.scene.remove(z.m); this.drop(z.m); } }
    this.zones = this.zones.filter((z) => z.life > 0);
  }
  stepGarrison(dt: number) {
    const rate = this.rally > 0 ? 3 : 1; this.rally = Math.max(0, this.rally - dt);
    for (const g of this.garrison) { g.cd -= dt * rate; if (g.cd > 0) continue; g.cd = 2.4 + Math.random() * 2.2;
      const live = this.spiders.filter((s) => !s.dead && s.z > FIELD_Z - 70 && Math.abs(s.x - g.a.obj.position.x) < 30); if (!live.length) continue; const s = live[(Math.random() * Math.min(4, live.length)) | 0];
      this.playA(g.a, g.a.fid === "yamabushi" ? "magic" : "attack", 1.6); const from = g.a.obj.position.clone().add(new THREE.Vector3(0, 1.8, -0.6)); const to = s.kind === "wasp" ? this.center(s) : s.arrived && s.kind !== "brute" ? new THREE.Vector3(s.x, s.y + 0.4, FIELD_Z - 0.9) : new THREE.Vector3(s.x, 0.5, s.z + s.speed * 0.9); this.spawnSpear(from, this.ballistic(from, to, 40), 0, true); }
  }

  // ── gate / waves / flow
  hurtGate(d: number) { if (this.state !== "play") return; this.gateHp = Math.max(0, this.gateHp - d); if (this.gateHp <= 0) this.end(false); }
  start() { if (this.state !== "ready") return; this.state = "play"; this.gateHp = this.gateMax; this.wave = 0; this.score = 0; this.kills = 0; this.nextWave(); this.pushHud(); }
  nextWave() {
    if (this.wave >= WAVES.length) { this.end(true); return; }
    const w = WAVES[this.wave]; this.wave++; this.waveDone = false; this.say(w.name ? w.name : this.wave === WAVES.length ? "FINAL WAVE — hold the gate!" : `WAVE ${this.wave}`, 2.8, true); if (this.wave === 4 || w.brood) this.cb.onSfx?.("horn");
    let t = 1.2; this.spawnQueue = [];
    for (let i = 0; i < w.crawlers; i++) { this.spawnQueue.push({ at: t, fn: () => this.spawnSpider(0.85 + Math.random() * 0.4) }); t += w.gap * (0.6 + Math.random() * 0.8); }
    for (let i = 0; i < w.big; i++) this.spawnQueue.push({ at: 2 + Math.random() * t, fn: () => this.spawnSpider(1.7 + Math.random() * 0.5) });
    for (let i = 0; i < (w.slingers || 0); i++) this.spawnQueue.push({ at: 3 + i * 4, fn: () => this.spawnSpider(1, "slinger") });
    for (let i = 0; i < (w.wasps || 0); i++) this.spawnQueue.push({ at: 5 + i * 2.5 + Math.random() * 2, fn: () => this.spawnSpider(0.8, "wasp") });
    for (let i = 0; i < (w.brutes || 0); i++) this.spawnQueue.push({ at: 6 + i * 10, fn: () => this.spawnSpider(1, "brute") });
    if (w.brood) this.spawnQueue.push({ at: 8, fn: () => this.spawnSpider(1, "brood") });
    for (let i = 0; i < (w.tower || 0); i++) this.spawnQueue.push({ at: 1.5 + i * 9, fn: () => this.spawnTower() });
    for (let i = 0; i < (w.ram || 0); i++) this.spawnQueue.push({ at: 4 + i * 12, fn: () => this.spawnRam() });
    this.spawnQueue.sort((a, b) => a.at - b.at); this.waveT = 0;
  }
  end(won: boolean) { if (this.state !== "play") return; this.state = won ? "won" : "lost"; this.say(won ? "THE GATE HOLDS" : "THE GATE HAS FALLEN", 4, true); this.cb.onSfx?.(won ? "win" : "lose"); if (!won) { this.shake = 2; this.puff(new THREE.Vector3(0, 3, FIELD_Z), "smoke", 30, 0x6a5a5a, 6, 3, 2.2); } this.pushHud(); setTimeout(() => this.cb.onEnd?.({ won, score: this.score, kills: this.kills, waves: this.wave }), 1500); }
  say(m: string, t = 1.6, banner = false) { this.msg = m; this.msgT = t; this.banner = banner; this.pushHud(); }
  pushHud() { this.cb.onHud({ gate: Math.ceil(this.gateHp), gateMax: this.gateMax, wave: this.wave, waves: WAVES.length, horde: Math.max(0, this.hordeLeft), score: this.score, kills: this.kills, reload: this.reloadTime > 0 ? Math.max(0, this.reload / (this.reloadTime * 1.3)) : 0, state: this.state, msg: this.msg, charge: this.charging ? Math.min(1, this.charge / 0.7) : 0, intro: this.intro, menu: this.menu, banner: this.banner, paused: this.paused, boss: this.boss && !this.boss.dead ? { name: "THE BROOD MOTHER", hp: Math.max(0, this.boss.hp), max: this.boss.hpMax } : null , treb: this.needTreb(), wallView: this.wallView, threat: this.threat }); }

  // ── VFX
  puff(p: THREE.Vector3, tex: string, n: number, color: number, size: number, speed: number, life = 0.6) {
    const soft = tex === "smoke" || tex === "smoke2" || tex === "dirt"; for (let i = 0; i < n; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[tex], color, transparent: true, blending: soft ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, opacity: soft ? 0.8 : 1 })); const sz = size * (0.6 + Math.random() * 0.8); s.scale.set(sz, sz, 1); s.position.copy(p); s.material.rotation = Math.random() * 6.28; this.scene.add(s);
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI; const v = speed * (0.3 + Math.random()); const lf = life * (0.6 + Math.random() * 0.6);
      this.parts.push({ s, v: new THREE.Vector3(Math.cos(a) * Math.sin(b) * v, Math.abs(Math.cos(b)) * v + v * 0.4, Math.sin(a) * Math.sin(b) * v), life: lf, life0: lf, g: speed > 0 ? 9 : 0, grow: 1 + Math.random() * 0.8, size: sz }); }
  }
  slashFx(p: THREE.Vector3) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.slash, color: 0xff8a8a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(2.4, 2.4, 1); s.position.copy(p); s.material.rotation = Math.random() * 6.28; this.scene.add(s); this.parts.push({ s, v: new THREE.Vector3(0, 1.5, 0), life: 0.3, life0: 0.3, g: 0, grow: 1.7, size: 2.4 }); }
  ringFx(p: THREE.Vector3, color: number, r: number) { const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(p.x, Math.max(p.y - 0.4, terrainH(p.x, p.z)) + 0.1, p.z); this.scene.add(m); const t0 = this.t; const tick = () => { if (this.over) return; const k = (this.t - t0) / 0.45; if (k >= 1) { this.scene.remove(m); (m.material as THREE.Material).dispose(); return; } m.scale.setScalar(1 + k * r); (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k); requestAnimationFrame(tick); }; tick(); }
  bolt(a: THREE.Vector3, b: THREE.Vector3) {
    const pts: THREE.Vector3[] = []; const n = 9; for (let i = 0; i <= n; i++) { const t = i / n; const q = a.clone().lerp(b, t); if (i > 0 && i < n) q.add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2)); pts.push(q); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.boltMat.clone()); this.scene.add(l); this.bolts.push({ l, life: 0.22 });
    const l2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7c9cff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); this.scene.add(l2); this.bolts.push({ l: l2, life: 0.3 });
  }

  flicker(dt: number) {
    void dt; for (const [i, f] of this.flames.entries()) { if (!f.userData.sy) f.userData.sy = f.scale.y; const k = 0.85 + Math.sin(this.t * 11 + i * 1.7) * 0.12 + Math.random() * 0.08; f.scale.y = f.userData.sy * k; (f.material as THREE.SpriteMaterial).opacity = (i % 2 === 0 ? 0.9 : 0.35) * k; }
    for (const [i, l] of this.torchLights.entries()) l.intensity = 6 * (0.9 + Math.sin(this.t * 9 + i * 2.1) * 0.12 + Math.random() * 0.1) * (l.userData.k || 1);
  }
  // ── loop
  loop = () => { if (this.over) return; requestAnimationFrame(this.loop); const raw = this.clock.getDelta(); this.perfStep(raw); const dt = Math.min(0.05, raw); this.t += dt; if (this.state === "play" && !this.menu && !this.paused && !this.intro) this.step(dt); this.render(dt); };
  step(dt: number) {
    this.waveT += dt; if (this.reload > 0) this.reload -= dt; if (this.charging) this.charge += dt; if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) { this.msg = null; this.pushHud(); } }
    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveT) this.spawnQueue.shift()!.fn();
    this.stepHorde(dt); this.stepShots(dt); this.stepFlings(dt); this.stepZones(dt); this.stepGarrison(dt); this.stepLeap(dt); this.stepHero(dt);
    if (!this.waveDone && !this.spawnQueue.length && this.hordeLeft <= 0) { this.waveDone = true; this.score += 50 * this.wave; setTimeout(() => { if (this.state === "play") this.nextWave(); }, 1800); }
    this.hudT += dt; if (this.hudT > 0.12) { this.hudT = 0; this.threat = this.wallThreat(); if (this.threat && !this.threatWarned && !this.wallView) { this.threatWarned = true; this.say("They are climbing the wall! Press V or WALL VIEW to see them", 2.6); } this.pushHud(); }
  }
  render(dt: number) {
    this.hero?.mixer.update(dt); for (const g of this.garrison) g.a.mixer.update(dt); for (const s of this.spiders) s.mixer?.update(dt); for (const f of this.flings) f.s.mixer?.update(dt);
    (this.sky.material as THREE.ShaderMaterial).uniforms.uT.value = this.t; this.embers?.update(dt, this.camera.position, this.t);
    if (this.menu || this.intro) { if (this.menu) this.stepMenu(dt); else this.stepIntro(dt); this.flicker(dt); this.sky.position.copy(this.camera.position); this.composer.render(); return; }
    this.updateAim();
    if (this.hero && !this.leap) { const o = this.hero.obj; const want = Math.atan2(this.aim.x - o.position.x, -(this.aim.z - o.position.z)); this.heroSpin += (want * (this.view === "pov" ? 0.6 : 0.3) - this.heroSpin) * Math.min(1, dt * 6); const face = this.heroV > 0.35 && !this.charging ? Math.atan2(this.heroVX, this.heroVZ) : Math.PI - this.heroSpin; let d = face - this.heroYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.heroYaw += d * Math.min(1, dt * 9); o.rotation.y = this.heroYaw; }
    // catapult arm: cocks while charging, snaps on release, resets over the reload
    this.stepTreb(dt);
    { const cp = this.camera.position; for (const s of this.spiders) { if (s.mixer) continue; if (s.dead) continue; const near = s.g.position.distanceTo(cp) < 42 + s.size * 8; s.body.visible = near; s.lod.visible = !near; } }
    this.flicker(dt); this.stepLights();
    for (const p of this.parts) { p.life -= dt; p.s.position.addScaledVector(p.v, dt); p.v.y -= p.g * dt; const k = Math.max(0, p.life / p.life0); (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.5); const sz = p.size * (1 + (1 - k) * (p.grow - 1)); p.s.scale.set(sz, sz, 1); }
    for (const p of this.parts) if (p.life <= 0) { this.scene.remove(p.s); p.s.material.dispose(); } this.parts = this.parts.filter((p) => p.life > 0);
    for (const b of this.bolts) { b.life -= dt; (b.l.material as THREE.LineBasicMaterial).opacity = Math.max(0, b.life / 0.25); } for (const b of this.bolts) if (b.life <= 0) { this.scene.remove(b.l); b.l.geometry.dispose(); (b.l.material as THREE.Material).dispose(); } this.bolts = this.bolts.filter((b) => b.life > 0);
    // camera
    const cp = this.camBase(), look = this.camLook();
    if (this.wallView) { look.x += (this.aim.x - this.heroX) * 0.1; cp.x += (this.aim.x - this.heroX) * 0.04; }
    else if (this.view === "pov") { look.x += (this.aim.x - this.heroX) * 0.12; look.z += (this.aim.z - (this.heroZ - 26)) * 0.12; cp.x += (this.aim.x - this.heroX) * 0.02 + (this.charging ? -this.charge * 0.25 : 0); }
    else { look.x += (this.aim.x - (this.heroX - 4)) * 0.14; look.z += (this.aim.z - (this.heroZ - 28)) * 0.08; cp.x += (this.aim.x - (this.heroX - 4)) * 0.02; if (this.leap && this.hero) { look.lerp(this.hero.obj.position, 0.5); } }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); cp.x += (Math.random() - 0.5) * this.shake * 0.25; cp.y += (Math.random() - 0.5) * this.shake * 0.2; }
    this.camera.position.lerp(cp, Math.min(1, dt * 4)); this.camKick.lerp(look, Math.min(1, dt * 4)); this.camera.lookAt(this.camKick); this.sky.position.copy(this.camera.position);
    this.composer.render();
  }
}
