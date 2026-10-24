// components/RebelGP/render3d.ts
// Real 3-D view of a Rebel Grand Prix race (three.js). The simulation stays in engine.ts (2-D world, 1024² units); this file
// turns it into a circuit: lofted asphalt + kerbs + white lines + gravel over a mown-grass ground (the HD map as macro
// texture), barriers, grandstands full of animated fans, trees and biome props, a start gantry whose lights follow the
// sequence, a sky with sun and fog, the 3-D cars (car3d.ts) with spinning / steering wheels and suspension, items and
// hazards as models, tyre smoke and sparks, and a chase camera. Sized for phones: instancing everywhere, no post FX,
// shadows only on desktop, adaptive pixel ratio.
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildCar, animateCar, mergeColored, type Car3D } from "./car3d";
/** merge textured pieces (position / normal / uv) into one geometry */
function mergeUV(gs: THREE.BufferGeometry[]) { const pos: number[] = [], nor: number[] = [], uv: number[] = []; for (const g0 of gs) { const g = g0.index ? g0.toNonIndexed() : g0; const P = g.getAttribute("position"), N = g.getAttribute("normal"), U = g.getAttribute("uv"); for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0); } } const m = new THREE.BufferGeometry(); m.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); m.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); return m; }
import { FACTION_PAINT } from "../../lib/rgpConfig";
import type { Race } from "./engine";

const NUMS: Record<string, string> = { ashigaru: "4", ronin: "13", samurai: "7", bushi: "11", warrior: "33", shogun: "1", buke: "23", kenshi: "16", wokou: "77", sohei: "55", yamabushi: "44" };
type Biome = { sky: "day" | "dusk" | "night" | "under"; sun: [number, number]; fog: number; fogNear: number; fogFar: number; grassTint: number; hills: number; trees: boolean; prop: string[]; amb: number; sunI: number; kerb: [number, number] };
const BIOMES: Record<string, Biome> = {
  jungle:   { sky: "day", sun: [38, 140], fog: 0xbfd8e6, fogNear: 420, fogFar: 1500, grassTint: 0x3f8a3e, hills: 0x2f5f38, trees: true, prop: ["tree", "rock", "mushroom"], amb: 0.65, sunI: 2.6, kerb: [0xd62a2a, 0xf2f2f2] },
  garden:   { sky: "day", sun: [50, 210], fog: 0xcfe6f4, fogNear: 450, fogFar: 1600, grassTint: 0x4a9a44, hills: 0x3b7a3c, trees: true, prop: ["tree", "flower", "fence"], amb: 0.7, sunI: 2.8, kerb: [0xd62a2a, 0xf4f4f4] },
  fortress: { sky: "dusk", sun: [7, 250], fog: 0xd9906a, fogNear: 300, fogFar: 1300, grassTint: 0x8a6a4a, hills: 0x4a2c26, trees: false, prop: ["torch", "pillar", "rock"], amb: 0.55, sunI: 2.2, kerb: [0xd62a2a, 0xf4f4f4] },
  sewers:   { sky: "under", sun: [60, 120], fog: 0x16201f, fogNear: 160, fogFar: 900, grassTint: 0x3a4640, hills: 0x141b1a, trees: false, prop: ["pipe", "barrel", "rock"], amb: 0.5, sunI: 1.4, kerb: [0xd62a2a, 0xeeeeee] },
  throne:   { sky: "night", sun: [55, 300], fog: 0x2a0f3a, fogNear: 220, fogFar: 1100, grassTint: 0x4a2860, hills: 0x1c0828, trees: false, prop: ["crystal", "pillar", "egg"], amb: 0.55, sunI: 1.6, kerb: [0xe23cbe, 0xf6f0fa] },
};

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true, repeat = true) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function noiseTex(size: number, base: [number, number, number], amp: number, speck: number, seed: number) {
  const r = rng(seed);
  return canvasTex(size, size, (c) => {
    const im = c.createImageData(size, size); const d = im.data;
    // two octaves of value noise + specks: reads as aggregate / grass / gravel depending on the palette
    const g1 = Array.from({ length: 17 * 17 }, () => r()), at = (x: number, y: number) => { const X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y; const s = (i: number, j: number) => g1[((j & 15) * 17) + (i & 15)]; return (s(X, Y) * (1 - fx) + s(X + 1, Y) * fx) * (1 - fy) + (s(X, Y + 1) * (1 - fx) + s(X + 1, Y + 1) * fx) * fy; };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const n = at((x / size) * 16, (y / size) * 16) * 0.6 + r() * 0.4; const sp = r() < speck ? (r() - 0.5) * 2.4 : 0;
      const k = 1 + (n - 0.5) * amp + sp * amp; const i = (y * size + x) * 4; d[i] = base[0] * k; d[i + 1] = base[1] * k; d[i + 2] = base[2] * k; d[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
  });
}

type Sample = { p: THREE.Vector2; t: THREE.Vector2; n: THREE.Vector2; s: number; curv: number };

export class Renderer3D {
  race: Race; renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  cars: Car3D[] = []; samples: Sample[] = []; biome: Biome; mobile: boolean;
  sun!: THREE.DirectionalLight; uTime = { value: 0 }; uExcite = { value: 0.3 };
  boxIM: THREE.InstancedMesh | null = null; t = 0;
  pool: Record<string, THREE.Object3D[]> = {}; used: Record<string, number> = {};
  parts!: THREE.Points; partData: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; r: number; g: number; b: number; grow: number }[] = [];
  camPos = new THREE.Vector3(); camLook = new THREE.Vector3(); camInit = false; fov = 62; shake = 0;
  pr = 1; frameMs: number[] = []; w = 0; h = 0; lastShake = 0; lastFx = 0;
  constructor(canvas: HTMLCanvasElement, race: Race, macro: HTMLImageElement | null) {
    this.race = race; this.mobile = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || (typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 600);
    this.biome = BIOMES[race.track.biome] || BIOMES.jungle;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = !this.mobile; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2); this.renderer.setPixelRatio(this.pr);
    this.camera = new THREE.PerspectiveCamera(this.fov, 16 / 9, 0.5, 2600);
    this.buildSamples(); this.buildSky(); this.buildGround(macro); this.buildTrack(); this.buildBarriers(); this.buildStands(); this.buildScenery(); this.buildGantry(); this.buildItems(); this.buildCars(); this.buildParticles();
  }

  // ── track centre line, smoothed and resampled every ~4 units, with curvature
  buildSamples() {
    const C = this.race.track.center; const N = C.length; const pts: THREE.Vector2[] = [];
    for (let i = 0; i < N; i++) {
      const p0 = C[(i - 1 + N) % N], p1 = C[i], p2 = C[(i + 1) % N], p3 = C[(i + 2) % N];
      const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); const m = Math.max(1, Math.round(seg / 4));
      for (let k = 0; k < m; k++) { const u = k / m, u2 = u * u, u3 = u2 * u; const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3); pts.push(new THREE.Vector2(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]))); }
    }
    const M = pts.length; let s = 0;
    for (let i = 0; i < M; i++) {
      const a = pts[(i - 1 + M) % M], b = pts[(i + 1) % M]; const t = b.clone().sub(a).normalize(); const n = new THREE.Vector2(-t.y, t.x);
      if (i > 0) s += pts[i].distanceTo(pts[i - 1]); this.samples.push({ p: pts[i], t, n, s, curv: 0 });
    }
    for (let i = 0; i < M; i++) { const a = this.samples[(i - 3 + M) % M].t, b = this.samples[(i + 3) % M].t; this.samples[i].curv = (a.x * b.y - a.y * b.x) / 24; }
    // smooth curvature
    const c = this.samples.map((x) => x.curv); for (let i = 0; i < M; i++) { let acc = 0; for (let k = -6; k <= 6; k++) acc += c[(i + k + M) % M]; this.samples[i].curv = acc / 13; }
  }

  buildSky() {
    const B = this.biome; const sc = this.scene;
    sc.fog = new THREE.Fog(B.fog, B.fogNear, B.fogFar);
    const pm = new THREE.PMREMGenerator(this.renderer); sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - B.sun[0]), THREE.MathUtils.degToRad(B.sun[1]));
    if (B.sky === "day" || B.sky === "dusk") {
      const sky = new Sky(); sky.scale.setScalar(4000); sky.position.set(512, 0, 512); const u = sky.material.uniforms;
      u.turbidity.value = B.sky === "dusk" ? 6 : 2.2; u.rayleigh.value = B.sky === "dusk" ? 2.2 : 2.6; u.mieCoefficient.value = 0.0035; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(sunDir);
      (sky.material as THREE.ShaderMaterial).fog = false; sc.add(sky);
      // clouds: a few big soft sprites high up
      const ct = canvasTex(256, 128, (c) => { for (let i = 0; i < 14; i++) { const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, r = 22 + Math.random() * 30; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(255,255,255,0.85)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 256, 128); } }, true, false);
      const r = rng(9);
      for (let i = 0; i < (this.mobile ? 6 : 10); i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: B.sky === "dusk" ? 0.55 : 0.8, color: B.sky === "dusk" ? 0xffc7a0 : 0xffffff })); const a = r() * Math.PI * 2, d = 1300 + r() * 600; sp.position.set(512 + Math.cos(a) * d, 260 + r() * 260, 512 + Math.sin(a) * d); sp.scale.set(700 + r() * 500, 220 + r() * 140, 1); sc.add(sp); }
    } else {
      // underground / night: a dark gradient dome, stars for the throne, glowing vents for the sewers
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: new THREE.Color(B.sky === "night" ? 0x07021a : 0x05080a) }, bot: { value: new THREE.Color(B.fog) } }, vertexShader: "varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }", fragmentShader: "uniform vec3 top; uniform vec3 bot; varying vec3 vp; void main(){ float h = clamp(normalize(vp).y*2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, h), 1.0); }" }));
      dome.position.set(512, 0, 512); sc.add(dome);
      if (B.sky === "night") { const g = new THREE.BufferGeometry(); const p: number[] = []; const r = rng(3); for (let i = 0; i < 900; i++) { const a = r() * Math.PI * 2, e = 0.12 + r() * 1.3; p.push(512 + Math.cos(a) * Math.cos(e) * 2500, Math.sin(e) * 2500, 512 + Math.sin(a) * Math.cos(e) * 2500); } g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); sc.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd6ff, size: 2.2, sizeAttenuation: false, fog: false }))); }
    }
    sc.add(new THREE.HemisphereLight(B.sky === "day" ? 0xcfe6ff : B.sky === "dusk" ? 0xffc9a0 : 0x8a7ab0, B.grassTint, B.amb));
    const sun = new THREE.DirectionalLight(B.sky === "dusk" ? 0xffb27a : 0xfff4e0, B.sunI); this.sun = sun;
    sun.position.copy(sunDir.clone().multiplyScalar(400)); sun.castShadow = !this.mobile;
    sun.shadow.mapSize.set(2048, 2048); const sc2 = sun.shadow.camera as THREE.OrthographicCamera; sc2.left = -160; sc2.right = 160; sc2.top = 160; sc2.bottom = -160; sc2.near = 10; sc2.far = 1200; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4;
    sc.add(sun); sc.add(sun.target);
    if (B.sky === "under" || B.sky === "night") { const fill = new THREE.DirectionalLight(B.sky === "night" ? 0xff7ae0 : 0x7affc0, 0.6); fill.position.set(-300, 200, 100); sc.add(fill); }
  }

  surfTex!: THREE.DataTexture;
  buildGround(macro: HTMLImageElement | null) {
    const B = this.biome; const surf = this.race.surf;
    // surface ids as a texture so the ground shader can turn liquid into animated water
    const data = new Uint8Array(1024 * 1024); for (let i = 0; i < data.length; i++) data[i] = surf[i] === 5 ? 255 : 0;
    this.surfTex = new THREE.DataTexture(data, 1024, 1024, THREE.RedFormat); this.surfTex.magFilter = THREE.LinearFilter; this.surfTex.minFilter = THREE.LinearFilter; this.surfTex.needsUpdate = true;
    const mtex = macro ? new THREE.Texture(macro) : null; if (mtex) { mtex.colorSpace = THREE.SRGBColorSpace; mtex.anisotropy = 8; mtex.needsUpdate = true; }
    const detail = noiseTex(256, [140, 140, 140], 0.5, 0.18, 77);
    const mat = new THREE.MeshStandardMaterial({ color: mtex ? 0xffffff : B.grassTint, map: mtex, roughness: 0.95, metalness: 0 });
    const uT = this.uTime; const uS = { value: this.surfTex }; const uD = { value: detail };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uT; sh.uniforms.uSurf = uS; sh.uniforms.uDetail = uD;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vW; uniform float uTime; uniform sampler2D uSurf; uniform sampler2D uDetail;")
        .replace("#include <map_fragment>", `#include <map_fragment>
          vec2 wuv = vW.xz / 1024.0;
          float det = texture2D(uDetail, vW.xz / 9.0).r * 0.6 + texture2D(uDetail, vW.xz / 41.0).r * 0.4;
          diffuseColor.rgb *= 0.72 + det * 0.6;
          float liq = texture2D(uSurf, wuv).r;
          if (liq > 0.02) { float w = sin(vW.x * 0.35 + uTime * 1.7) * sin(vW.z * 0.31 - uTime * 1.3) * 0.5 + 0.5; vec3 water = mix(diffuseColor.rgb * 0.8, vec3(0.75, 0.9, 1.0), pow(w, 6.0) * 0.6); diffuseColor.rgb = mix(diffuseColor.rgb, water, smoothstep(0.02, 0.5, liq)); }`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, smoothstep(0.02, 0.5, texture2D(uSurf, vW.xz / 1024.0).r));");
    };
    const g = new THREE.PlaneGeometry(1024, 1024, 1, 1); g.rotateX(-Math.PI / 2);
    // UVs so the macro map lines up with world x/z (image row 0 = world y 0)
    const uv = g.getAttribute("uv"); const pos = g.getAttribute("position"); for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 512) / 1024, 1 - (pos.getZ(i) + 512) / 1024);
    const ground = new THREE.Mesh(g, mat); ground.position.set(512, 0, 512); ground.receiveShadow = true; this.scene.add(ground);
    // the world beyond the map: same grass, fading into the fog, and a ring of hills
    const outer = new THREE.Mesh(new THREE.RingGeometry(700, 3000, 64, 1), new THREE.MeshStandardMaterial({ color: B.grassTint, roughness: 1 })); outer.rotation.x = -Math.PI / 2; outer.position.set(512, -0.2, 512); this.scene.add(outer);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.MeshStandardMaterial({ color: B.grassTint, roughness: 1 })); fill.rotation.x = -Math.PI / 2; fill.position.set(512, -0.4, 512); this.scene.add(fill);
    const r = rng(this.race.track.diff * 7 + 1); const hg = new THREE.CylinderGeometry(1700, 1800, 1, 128, 6, true); const hp = hg.getAttribute("position");
    const harm = Array.from({ length: 7 }, (_, i) => ({ k: i + 2 + Math.floor(r() * 4), a: (0.6 + r()) / (i + 1), p: r() * 6.28 }));
    for (let i = 0; i < hp.count; i++) { const x = hp.getX(i), z = hp.getZ(i), y = hp.getY(i); const a = Math.atan2(z, x); let h = 0; for (const H of harm) h += Math.sin(a * H.k + H.p) * H.a; const top = y > 0; hp.setY(i, top ? 90 + h * 70 + (B.sky === "under" ? 260 : 0) : -5); }
    hg.computeVertexNormals(); const hills = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: B.hills, roughness: 1, side: THREE.DoubleSide })); hills.position.set(512, 0, 512); this.scene.add(hills);
  }

  /** a strip along the track between two lateral offsets; `on(i)` picks which samples it covers */
  ribbon(a: number, b: number, y: number, vScale: number, mat: THREE.Material, on: (i: number) => boolean = () => true, yb = y) {
    const S = this.samples; const M = S.length; const pos: number[] = [], uv: number[] = [], idx: number[] = []; let vc = 0;
    let run: number[] = [];
    const flush = () => { if (run.length < 2) { run = []; return; } const base = vc; for (const i of run) { const s = S[i]; pos.push(s.p.x + s.n.x * a, y, s.p.y + s.n.y * a, s.p.x + s.n.x * b, yb, s.p.y + s.n.y * b); uv.push(0, s.s / vScale, 1, s.s / vScale); vc += 2; } for (let k = 0; k < run.length - 1; k++) { const i0 = base + k * 2; idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2); } run = []; };
    for (let i = 0; i <= M; i++) { const j = i % M; if (on(j)) run.push(j); else flush(); if (i === M) { if (run.length && on(0)) run.push(0); flush(); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.scene.add(m); return m;
  }

  buildTrack() {
    const W = this.race.track.width; const B = this.biome; const S = this.samples;
    const asphalt = noiseTex(512, [88, 88, 93], 0.16, 0.22, 5); asphalt.repeat.set(1, 1);
    // racing line: rubbered darker band, baked into a second texture across the width
    const roadTex = canvasTex(256, 512, (c) => { c.drawImage(asphalt.image as HTMLCanvasElement, 0, 0, 256, 512); const g = c.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, "rgba(0,0,0,0.12)"); g.addColorStop(0.42, "rgba(0,0,0,0.0)"); g.addColorStop(0.5, "rgba(0,0,0,0.22)"); g.addColorStop(0.58, "rgba(0,0,0,0.0)"); g.addColorStop(1, "rgba(0,0,0,0.12)"); c.fillStyle = g; c.fillRect(0, 0, 256, 512); });
    const road = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -1 });
    this.ribbon(-W / 2, W / 2, 0.05, 40, road);
    const gravel = new THREE.MeshStandardMaterial({ map: noiseTex(256, [176, 152, 112], 0.5, 0.3, 11), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
    (gravel.map as THREE.Texture).repeat.set(3, 1);
    this.ribbon(W / 2, W / 2 + 13, 0.03, 14, gravel); this.ribbon(-W / 2 - 13, -W / 2, 0.03, 14, gravel);
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    this.ribbon(W / 2 - 2.6, W / 2 - 0.8, 0.07, 10, white); this.ribbon(-W / 2 + 0.8, -W / 2 + 2.6, 0.07, 10, white);
    // kerbs: raised red/white blocks on corners (outer edge wider), sloped up from the road
    const kt = canvasTex(64, 128, (c) => { const a = "#" + B.kerb[0].toString(16).padStart(6, "0"), b = "#" + B.kerb[1].toString(16).padStart(6, "0"); c.fillStyle = a; c.fillRect(0, 0, 64, 64); c.fillStyle = b; c.fillRect(0, 64, 64, 64); c.fillStyle = "rgba(0,0,0,0.18)"; c.fillRect(0, 62, 64, 4); c.fillRect(0, 126, 64, 2); });
    const kerb = new THREE.MeshStandardMaterial({ map: kt, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3 });
    const thr = Math.max(0.0035, [...S.map((s) => Math.abs(s.curv))].sort((a, b) => a - b)[Math.floor(S.length * 0.62)]);
    const corner = S.map((s) => Math.abs(s.curv) > thr); const cw = corner.map((_, i) => { for (let k = -5; k <= 5; k++) if (corner[(i + k + S.length) % S.length]) return true; return false; });
    for (const side of [1, -1]) {
      const on = (i: number) => cw[i];
      const outer = (i: number) => cw[i] && Math.sign(S[i].curv) !== side;
      this.ribbon(side * (W / 2 - 6.5), side * (W / 2 + 1), 0.09, 12, kerb, on, 0.32);
      this.ribbon(side * (W / 2 + 1), side * (W / 2 + 5), 0.32, 12, kerb, outer, 0.1);
    }
    // start / finish: chequered band and grid boxes; boost pads with scrolling chevrons
    const s0 = S[0]; const chk = canvasTex(256, 32, (c) => { for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { c.fillStyle = (x + y) % 2 ? "#141414" : "#f4f4f4"; c.fillRect(x * 8, y * 8, 8, 8); } }, true, false);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 8), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 })); line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(s0.n.y, s0.n.x) * -1 + 0; line.position.set(s0.p.x, 0.1, s0.p.y);
    line.rotation.set(-Math.PI / 2, 0, -Math.atan2(s0.n.y, s0.n.x)); this.scene.add(line);
    const gridMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 });
    const bars: THREE.BufferGeometry[] = []; for (const [gx, gy] of this.race.track.grid) { const s = this.nearest(gx, gy); bars.push(new THREE.PlaneGeometry(18, 1.6).rotateZ(-Math.atan2(s.n.y, s.n.x)).rotateX(-Math.PI / 2).translate(gx + s.t.x * 9, 0.1, gy + s.t.y * 9)); }
    this.scene.add(new THREE.Mesh(mergeUV(bars), gridMat));
    const chev = canvasTex(64, 64, (c) => { c.fillStyle = "#0b63d8"; c.fillRect(0, 0, 64, 64); c.strokeStyle = "#e8f6ff"; c.lineWidth = 9; c.beginPath(); c.moveTo(8, 46); c.lineTo(32, 18); c.lineTo(56, 46); c.stroke(); });
    const boostMat = new THREE.MeshBasicMaterial({ map: chev, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }); (boostMat.map as THREE.Texture).repeat.set(1, 2); this.boostTex = boostMat.map as THREE.Texture;
    const pads: THREE.BufferGeometry[] = []; for (const [bx, by] of this.race.track.boosts) { const s = this.nearest(bx, by); const g = new THREE.PlaneGeometry(22, 26); g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(-s.t.x, -s.t.y)); g.translate(bx, 0.1, by); pads.push(g); } if (pads.length) this.scene.add(new THREE.Mesh(mergeUV(pads), boostMat));
  }
  boostTex: THREE.Texture | null = null;
  nearest(x: number, y: number) { let best = this.samples[0], bd = 1e12; for (const s of this.samples) { const d = (s.p.x - x) ** 2 + (s.p.y - y) ** 2; if (d < bd) { bd = d; best = s; } } return best; }

  buildBarriers() {
    const W = this.race.track.width; const S = this.samples; const M = S.length; const race = this.race;
    const wallAt = (i: number, side: number) => { const s = S[i]; for (const d of [W / 2 + 13, W / 2 + 15, W / 2 + 17]) if (race.surfAt(s.p.x + s.n.x * side * d, s.p.y + s.n.y * side * d) === 4) return true; return false; };
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.85 });
    const stripeTex = canvasTex(64, 16, (c) => { c.fillStyle = "#d42020"; c.fillRect(0, 0, 32, 16); c.fillStyle = "#f2f2f2"; c.fillRect(32, 0, 32, 16); });
    const wallTop = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 });
    const armco = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.8, roughness: 0.35 });
    let anyWall = false;
    for (const side of [1, -1]) {
      const has = S.map((_, i) => wallAt(i, side)); if (has.some(Boolean)) anyWall = true;
      // concrete wall: inner face, top, outer face (3 ribbons) where the sim has a wall; armco elsewhere on walled tracks
      const d = W / 2 + 15;
      const face = (off: number, y0: number, y1: number, on: (i: number) => boolean, mat: THREE.Material) => {
        const pos: number[] = [], uv: number[] = [], idx: number[] = []; let vc = 0; let run: number[] = [];
        const flush = () => { if (run.length < 2) { run = []; return; } const b = vc; for (const i of run) { const s = S[i]; const x = s.p.x + s.n.x * side * off, z = s.p.y + s.n.y * side * off; pos.push(x, y0, z, x, y1, z); uv.push(s.s / 6, 0, s.s / 6, 1); vc += 2; } for (let k = 0; k < run.length - 1; k++) { const i0 = b + k * 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); } run = []; };
        for (let i = 0; i <= M; i++) { const j = i % M; if (on(j)) run.push(j); else flush(); } flush();
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat); (m.material as THREE.Material).side = THREE.DoubleSide; m.castShadow = !this.mobile; m.receiveShadow = true; this.scene.add(m);
      };
      face(d - 2, 0, 4.2, (i) => has[i], wallMat); face(d - 2, 4.2, 5.4, (i) => has[i], wallTop);
      if (!has.every(Boolean)) {
        // armco rails on posts (open stretches)
        const off = has.some(Boolean) ? d : W / 2 + 22;
        face(off, 1.2, 2.1, (i) => !has[i], armco); face(off, 2.5, 3.4, (i) => !has[i], armco);
      }
    }
    // armco posts + tyre stacks on the outside of tight corners (instanced)
    const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 3.6, 0.5), armco, 700); let pc = 0; const m4 = new THREE.Matrix4();
    const tyreG = new THREE.TorusGeometry(1.1, 0.55, 6, 12); tyreG.rotateX(Math.PI / 2);
    const tyres = new THREE.InstancedMesh(tyreG, new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.95 }), 1600); let tc = 0;
    for (let i = 0; i < M; i += 3) for (const side of [1, -1]) {
      const s = S[i]; if (wallAt(i, side)) continue; const off = anyWall ? W / 2 + 15 : W / 2 + 22;
      if (pc < 700) { m4.makeTranslation(s.p.x + s.n.x * side * off, 1.8, s.p.y + s.n.y * side * off); post.setMatrixAt(pc++, m4); }
      if (Math.abs(s.curv) > 0.006 && Math.sign(s.curv) !== side && i % 2 === 0) for (let k = 0; k < 3 && tc < 1600; k++) { const o2 = off + 2.6; m4.makeTranslation(s.p.x + s.n.x * side * o2, 0.55 + k * 1.1, s.p.y + s.n.y * side * o2); tyres.setMatrixAt(tc++, m4); }
    }
    post.count = pc; tyres.count = tc; post.castShadow = tyres.castShadow = !this.mobile; this.scene.add(post); this.scene.add(tyres);
  }

  /** grandstands with roofs along the start straight and at the tightest corners, full of animated fans */
  buildStands() {
    const W = this.race.track.width; const S = this.samples; const M = S.length; const r = rng(this.race.track.diff * 31);
    const spots: { i: number; side: number; len: number }[] = [];
    const clearAt = (x: number, y: number) => { for (const dx of [-12, 0, 12]) for (const dy of [-12, 0, 12]) { const v = this.race.surfAt(x + dx, y + dy); if (v !== 0 && v !== 6) return false; } return true; };
    const tryStand = (i: number, side: number, len: number) => { const s = S[(i + M) % M]; const d = W / 2 + 40; if (!clearAt(s.p.x + s.n.x * side * d, s.p.y + s.n.y * side * d)) return; if (spots.some((p) => Math.min(Math.abs(p.i - i), M - Math.abs(p.i - i)) < 30 && p.side === side)) return; spots.push({ i: (i + M) % M, side, len }); };
    for (const side of [1, -1]) { tryStand(-14, side, 130); tryStand(18, side, 110); }
    const order = S.map((s, i) => [Math.abs(s.curv), i]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) { if (spots.length >= 7) break; tryStand(i, Math.sign(S[i].curv) > 0 ? -1 : 1, 90); }
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e36, metalness: 0.6, roughness: 0.4 });
    const pieces: { g: THREE.BufferGeometry; c: number }[] = []; const bannerG: THREE.BufferGeometry[] = [];
    const put = (g: THREE.BufferGeometry, grp: THREE.Object3D, x: number, y: number, z: number, c: number, rx = 0, ry = 0) => { g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); grp.updateMatrixWorld(true); g.applyMatrix4(grp.matrixWorld); if (c < 0) bannerG.push(g); else pieces.push({ g, c }); };
    const banner = canvasTex(512, 64, (c) => { c.fillStyle = "#e10600"; c.fillRect(0, 0, 512, 64); c.fillStyle = "#fff"; c.font = "900 italic 44px 'Titillium Web', Arial, sans-serif"; c.textBaseline = "middle"; for (let x = 10; x < 512; x += 256) c.fillText("REBEL ANTS", x, 34); }); banner.repeat.set(1, 1);
    const bannerMat = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.6 });
    // fans: body + head + two arms, per-instance colour and phase; the vertex shader makes them bounce and wave
    const fan = (() => {
      const parts: { g: THREE.BufferGeometry; arm: number }[] = [];
      const body = new THREE.CylinderGeometry(0.5, 0.72, 2.2, 4, 1, true); body.rotateY(Math.PI / 4); body.translate(0, 1.1, 0); parts.push({ g: body, arm: 0 });
      const head = new THREE.OctahedronGeometry(0.52, 0); head.translate(0, 2.65, 0); parts.push({ g: head, arm: 0 });
      for (const sx of [1, -1]) { const a = new THREE.CylinderGeometry(0.16, 0.16, 1.5, 3, 1, true); a.translate(sx * 0.75, 1.55, 0); parts.push({ g: a, arm: sx }); }
      const pos: number[] = [], nor: number[] = [], arm: number[] = [], idx: number[] = []; let vc = 0;
      for (const p of parts) { const g = p.g.toNonIndexed(); g.computeVertexNormals(); const P = g.getAttribute("position"), N = g.getAttribute("normal"); for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); arm.push(p.arm); idx.push(vc + i); } vc += P.count; }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("aArm", new THREE.Float32BufferAttribute(arm, 1)); g.setIndex(idx); return g;
    })();
    const fanMax = this.mobile ? 1500 : 3600; const fans = new THREE.InstancedMesh(fan, new THREE.MeshStandardMaterial({ roughness: 0.8 }), fanMax);
    const phase = new Float32Array(fanMax); let fc = 0;
    const uT = this.uTime, uE = this.uExcite;
    (fans.material as THREE.MeshStandardMaterial).onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uT; sh.uniforms.uExcite = uE;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aArm; attribute float aPhase; uniform float uTime; uniform float uExcite;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float ph = aPhase * 6.2831; float hype = clamp(uExcite + 0.25 * sin(uTime * 0.7 + ph), 0.0, 1.0);
          float jump = max(0.0, sin(uTime * (5.0 + fract(aPhase * 7.0) * 3.0) + ph)) * 0.55 * hype;
          if (aArm != 0.0) { float up = (0.4 + 0.6 * hype) * (1.2 + 0.5 * sin(uTime * 8.0 + ph)); vec3 sh0 = vec3(aArm * 0.75, 2.25, 0.0); vec3 q = transformed - sh0; float c = cos(up * aArm), s = sin(up * aArm); transformed = sh0 + vec3(q.x * c - q.y * s, q.x * s + q.y * c, q.z); }
          transformed.y += jump; transformed.x += sin(uTime * 1.3 + ph) * 0.12;`);
    };
    const shirts = [0xe74c3c, 0xf1c40f, 0xecf0f1, 0x3498db, 0x2ecc71, 0xe67e22, 0x9b59b6, 0x1abc9c, 0xffffff, 0xe10600, 0x15151e, 0xff66cc];
    const col = new THREE.Color(); const q = new THREE.Quaternion(); const m4 = new THREE.Matrix4(); const sc = new THREE.Vector3(1, 1, 1);
    for (const sp of spots) {
      const s = S[sp.i]; const ang = Math.atan2(s.t.y, s.t.x); const nx = s.n.x * sp.side, nz = s.n.y * sp.side; const d0 = W / 2 + 30;
      const cx = s.p.x + nx * (d0 + 18), cz = s.p.y + nz * (d0 + 18);
      const grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.rotation.y = -ang;
      const L = sp.len; const rows = 9; const depth = 34; const rise = 2.4;
      // local frame: x along the track, z away from it (toward +z = outward when side=+1 mapped below)
      const outward = sp.side; // the stand faces the track: rows step up going outward
      for (let k = 0; k < rows; k++) put(new THREE.BoxGeometry(L, rise * (k + 1), depth / rows), grp, 0, (rise * (k + 1)) / 2, outward * (-depth / 2 + (k + 0.5) * (depth / rows)), k % 2 ? 0x4f5462 : 0x454a56);
      // front wall banner, back wall, roof on columns
      put(new THREE.PlaneGeometry(L, 3.2), grp, 0, 1.6, outward * (-depth / 2 - 0.05), -1, 0, outward > 0 ? Math.PI : 0);
      const roofY = rise * rows + 12; put(new THREE.BoxGeometry(L + 6, 1.2, depth + 8), grp, 0, roofY, 0, 0xc80500, outward * -0.08);
      for (let x = -L / 2; x <= L / 2 + 0.1; x += L / 4) put(new THREE.BoxGeometry(1, roofY, 1), grp, x, roofY / 2, outward * (depth / 2 + 1), 0x2b2e36);
      // fans on each tier
      for (let k = 0; k < rows; k++) for (let x = -L / 2 + 1.4; x < L / 2 - 1; x += 2.1) {
        if (fc >= fanMax) break; if (r() < 0.08) continue;
        grp.updateMatrixWorld(true); const lp = new THREE.Vector3(x + (r() - 0.5) * 0.5, rise * (k + 1), outward * (-depth / 2 + (k + 0.5) * (depth / rows))); const wp = grp.localToWorld(lp.clone());
        q.setFromEuler(new THREE.Euler(0, -ang + (outward > 0 ? Math.PI : 0) + (r() - 0.5) * 0.4, 0)); const s2 = 0.85 + r() * 0.3; sc.set(s2, s2, s2);
        m4.compose(wp, q, sc); fans.setMatrixAt(fc, m4); fans.setColorAt(fc, col.setHex(shirts[(r() * shirts.length) | 0])); phase[fc] = r(); fc++;
      }
    }
    if (pieces.length) { const sm = new THREE.Mesh(mergeColored(pieces), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 })); sm.castShadow = sm.receiveShadow = !this.mobile; this.scene.add(sm); }
    if (bannerG.length) this.scene.add(new THREE.Mesh(mergeUV(bannerG), bannerMat));
    fans.count = fc; fan.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1)); fans.castShadow = false; this.scene.add(fans);
    // flags on the start straight
    const flagTex = canvasTex(64, 40, (c) => { for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? "#111" : "#f5f5f5"; c.fillRect(x * 8, y * 8, 8, 8); } }, true, false);
    const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 });
    flagMat.onBeforeCompile = (sh) => { sh.uniforms.uTime = uT; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat u = (position.x + 4.0) / 8.0; transformed.z += sin(position.x * 0.9 - uTime * 6.0) * 0.9 * u; transformed.y += sin(position.x * 0.6 - uTime * 4.0) * 0.3 * u;"); };
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.2, 16, 6), steel, 8), flags = new THREE.InstancedMesh(new THREE.PlaneGeometry(8, 5, 12, 1), flagMat, 8); let nf = 0; const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    for (const k of [-6, -2, 2, 6]) for (const side of [1, -1]) { const s = S[(k + M) % M]; const d = W / 2 + 24; const x = s.p.x + s.n.x * side * d, z = s.p.y + s.n.y * side * d; if (this.race.surfAt(x, z) === 4) continue; fm.makeTranslation(x, 8, z); poles.setMatrixAt(nf, fm); fq.setFromEuler(new THREE.Euler(0, -Math.atan2(s.t.y, s.t.x), 0)); fm.compose(new THREE.Vector3(x + 4 * s.t.x, 13.5, z + 4 * s.t.y), fq, one); flags.setMatrixAt(nf, fm); nf++; }
    poles.count = flags.count = nf; this.scene.add(poles); this.scene.add(flags);
  }

  /** trees / biome props: the track's decor spots plus a scatter over the grass, all instanced */
  buildScenery() {
    const B = this.biome; const r = rng(this.race.track.diff * 101 + 3); const W = this.race.track.width; const race = this.race;
    const spots: { x: number; y: number; kind: string; s: number }[] = this.race.track.decor.map(([x, y, kind]) => ({ x, y, kind, s: 0.8 + r() * 0.5 }));
    const farFromTrack = (x: number, y: number, min: number) => { for (const s of this.samples) { if ((s.p.x - x) ** 2 + (s.p.y - y) ** 2 < min * min) return false; } return true; };
    let tries = 0; const want = this.mobile ? 160 : 320;
    while (spots.length < want && tries++ < 4000) { const x = -200 + r() * 1424, y = -200 + r() * 1424; if (race.surfAt(x, y) !== 0) continue; if (!farFromTrack(x, y, W / 2 + 70)) continue; spots.push({ x, y, kind: B.prop[(r() * B.prop.length) | 0], s: 0.8 + r() * 0.7 }); }
    const byKind: Record<string, { x: number; y: number; s: number }[]> = {}; for (const s of spots) (byKind[s.kind] ||= []).push(s);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { x: number; y: number; s: number }[], scale: number, yoff = 0, shadow = true) => {
      if (!list?.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length); const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion();
      list.forEach((p, i) => { q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0)); const k = p.s * scale; m4.compose(new THREE.Vector3(p.x, yoff, p.y), q, new THREE.Vector3(k, k, k)); im.setMatrixAt(i, m4); });
      im.castShadow = shadow && !this.mobile; im.receiveShadow = true; this.scene.add(im);
    };
    const mergeGeo = (gs: { g: THREE.BufferGeometry; c: number }[]) => { const pos: number[] = [], nor: number[] = [], col: number[] = []; const cc = new THREE.Color(); for (const { g, c } of gs) { const n = g.toNonIndexed(); n.computeVertexNormals(); const P = n.getAttribute("position"), N = n.getAttribute("normal"); cc.setHex(c); for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); const v = 0.85 + Math.random() * 0.3; col.push(cc.r * v, cc.g * v, cc.b * v); } } const m = new THREE.BufferGeometry(); m.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); m.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); return m; };
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const jag = (g: THREE.BufferGeometry, amt: number, seed: number) => { const rr = rng(seed); const p = g.getAttribute("position"); for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + (rr() - 0.5) * amt), p.getY(i) * (1 + (rr() - 0.5) * amt), p.getZ(i) * (1 + (rr() - 0.5) * amt)); return g; };
    // tree: trunk + three leafy blobs
    const tree = mergeGeo([{ g: new THREE.CylinderGeometry(0.9, 1.4, 12, 6).translate(0, 6, 0), c: 0x5a3d26 }, { g: jag(new THREE.IcosahedronGeometry(7.5, 0), 0.3, 1).translate(0, 16, 0), c: B.trees ? 0x2f6f32 : 0x445533 }, { g: jag(new THREE.IcosahedronGeometry(6, 0), 0.3, 2).translate(3.5, 21, 1), c: 0x3a8038 }, { g: jag(new THREE.IcosahedronGeometry(5.5, 0), 0.3, 3).translate(-3, 20, -2), c: 0x2a6230 }]);
    const pine = mergeGeo([{ g: new THREE.CylinderGeometry(0.7, 1.1, 8, 6).translate(0, 4, 0), c: 0x4a3322 }, { g: new THREE.ConeGeometry(7, 12, 7).translate(0, 12, 0), c: 0x24552c }, { g: new THREE.ConeGeometry(5.5, 10, 7).translate(0, 18, 0), c: 0x2b6633 }, { g: new THREE.ConeGeometry(3.8, 8, 7).translate(0, 23, 0), c: 0x337a3a }]);
    const rock = mergeGeo([{ g: jag(new THREE.DodecahedronGeometry(4, 0), 0.5, 4).translate(0, 2, 0), c: 0x7a7570 }]);
    const mush = mergeGeo([{ g: new THREE.CylinderGeometry(0.9, 1.1, 4, 8).translate(0, 2, 0), c: 0xf2e6d2 }, { g: new THREE.SphereGeometry(3.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 3.8, 0), c: 0xd8332b }]);
    const flower = mergeGeo([{ g: new THREE.CylinderGeometry(0.2, 0.2, 3, 4).translate(0, 1.5, 0), c: 0x3a8a3a }, { g: new THREE.SphereGeometry(1.2, 6, 4).scale(1, 0.5, 1).translate(0, 3.1, 0), c: 0xff6fb5 }]);
    const fence = mergeGeo([{ g: new THREE.BoxGeometry(10, 0.6, 0.4).translate(0, 2.4, 0), c: 0xf2efe8 }, { g: new THREE.BoxGeometry(10, 0.6, 0.4).translate(0, 1.2, 0), c: 0xf2efe8 }, ...[-4.5, 0, 4.5].map((x) => ({ g: new THREE.BoxGeometry(0.6, 3.4, 0.6).translate(x, 1.7, 0), c: 0xe8e4dc }))]);
    const pipe = mergeGeo([{ g: new THREE.CylinderGeometry(3, 3, 26, 12).translate(0, 13, 0), c: 0x5c6670 }, { g: new THREE.TorusGeometry(3.1, 0.5, 6, 16).rotateX(Math.PI / 2).translate(0, 22, 0), c: 0x3a4248 }]);
    const barrel = mergeGeo([{ g: new THREE.CylinderGeometry(2, 2, 4.6, 10).translate(0, 2.3, 0), c: 0x2f7a3a }, { g: new THREE.TorusGeometry(2.05, 0.2, 4, 12).rotateX(Math.PI / 2).translate(0, 3.6, 0), c: 0x222 }]);
    const pillar = mergeGeo([{ g: new THREE.CylinderGeometry(2.2, 2.6, 30, 10).translate(0, 15, 0), c: 0xb0a898 }, { g: new THREE.BoxGeometry(6.5, 2, 6.5).translate(0, 31, 0), c: 0x9a9284 }, { g: new THREE.BoxGeometry(6.5, 2, 6.5).translate(0, 1, 0), c: 0x9a9284 }]);
    const torch = mergeGeo([{ g: new THREE.CylinderGeometry(0.4, 0.6, 10, 6).translate(0, 5, 0), c: 0x3a2a20 }, { g: new THREE.CylinderGeometry(1.2, 0.6, 1.6, 8).translate(0, 10.5, 0), c: 0x2a2a2a }]);
    const egg = mergeGeo([{ g: new THREE.SphereGeometry(3, 12, 10).scale(1, 1.35, 1).translate(0, 4, 0), c: 0xf0e2c8 }]);
    const crystal = new THREE.OctahedronGeometry(4, 0); crystal.scale(0.7, 2.2, 0.7); crystal.translate(0, 8, 0);
    if (B.trees) { const all = [...(byKind.tree || [])]; inst(tree, vc, all.filter((_, i) => i % 3 !== 0), 1); inst(pine, vc, all.filter((_, i) => i % 3 === 0), 1.1); }
    inst(rock, vc, byKind.rock, 1); inst(mush, vc, byKind.mushroom, 1); inst(flower, vc, byKind.flower, 1.2, 0, false); inst(fence, vc, byKind.fence, 1); inst(pipe, vc, byKind.pipe, 1); inst(barrel, vc, byKind.barrel, 1); inst(pillar, vc, byKind.pillar, 1); inst(torch, vc, byKind.torch, 1); inst(egg, vc, byKind.egg, 1);
    inst(crystal, new THREE.MeshStandardMaterial({ color: 0xd070ff, emissive: 0x9020c0, emissiveIntensity: 1.2, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.9 }), byKind.crystal, 1);
    // torch flames: additive glows that flicker in the update loop
    if (byKind.torch?.length) { const ft = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,240,180,1)"); g.addColorStop(0.35, "rgba(255,140,40,0.8)"); g.addColorStop(1, "rgba(255,60,0,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }, true, false); for (const p of byKind.torch) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ft, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.position.set(p.x, 12.5 * p.s, p.y); sp.scale.set(6, 8, 1); sp.userData.flicker = r() * 10; this.scene.add(sp); this.flames.push(sp); } }
  }
  flames: THREE.Sprite[] = [];

  buildGantry() {
    const S = this.samples; const s = S[0]; const W = this.race.track.width; const g = new THREE.Group(); g.position.set(s.p.x, 0, s.p.y); g.rotation.y = -Math.atan2(s.n.y, s.n.x); this.scene.add(g);
    const steel: { g: THREE.BufferGeometry; c: number }[] = [];
    for (const side of [1, -1]) steel.push({ g: new THREE.BoxGeometry(2, 30, 2).translate(side * (W / 2 + 6), 15, 0), c: 0x30333b });
    steel.push({ g: new THREE.BoxGeometry(W + 14, 5, 2.4).translate(0, 28, 0), c: 0x30333b });
    for (let i = 0; i < 5; i++) steel.push({ g: new THREE.BoxGeometry(2.6, 6, 2.6).translate((i - 2) * 4.2, 22.5, 0), c: 0x0b0b0e });
    const frame = new THREE.Mesh(mergeColored(steel), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.4 })); frame.castShadow = !this.mobile; g.add(frame);
    const sign = canvasTex(1024, 96, (c) => { c.fillStyle = "#15151e"; c.fillRect(0, 0, 1024, 96); c.fillStyle = "#e10600"; c.fillRect(0, 0, 1024, 10); c.fillStyle = "#fff"; c.font = "900 italic 64px 'Titillium Web', Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("REBEL GRAND PRIX", 512, 54); }, true, false);
    g.add(new THREE.Mesh(mergeUV([new THREE.PlaneGeometry(W + 12, 4.4).translate(0, 28, 1.25), new THREE.PlaneGeometry(W + 12, 4.4).rotateY(Math.PI).translate(0, 28, -1.25)]), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false })));
    // 5 pairs of red lights per face, one instanced mesh; colour per light is switched by the start sequence
    const lights = new THREE.InstancedMesh(new THREE.CircleGeometry(0.85, 14), new THREE.MeshBasicMaterial({ toneMapped: false }), 20); let n = 0; const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 5; i++) for (const z of [1.35, -1.35]) for (const yy of [24, 21]) { q.setFromEuler(new THREE.Euler(0, z < 0 ? Math.PI : 0, 0)); m4.compose(new THREE.Vector3((i - 2) * 4.2, yy, z), q, one); lights.setMatrixAt(n, m4); lights.setColorAt(n, new THREE.Color(0x2a0606)); n++; }
    g.add(lights); this.gantry = lights;
  }
  gantry: THREE.InstancedMesh | null = null; litNow = -1;

  buildItems() {
    const q = canvasTex(128, 128, (c) => { const g = c.createLinearGradient(0, 0, 128, 128); g.addColorStop(0, "#ff5ec8"); g.addColorStop(0.5, "#ffd400"); g.addColorStop(1, "#3ad6ff"); c.fillStyle = g; c.fillRect(0, 0, 128, 128); c.fillStyle = "rgba(255,255,255,0.85)"; c.font = "900 96px Arial"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("?", 64, 70); c.strokeStyle = "#fff"; c.lineWidth = 8; c.strokeRect(4, 4, 120, 120); }, true, false);
    const mat = new THREE.MeshPhysicalMaterial({ map: q, transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.1, clearcoat: 1, emissive: 0xffffff, emissiveMap: q, emissiveIntensity: 0.35 });
    this.boxIM = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 6, 6), mat, Math.max(1, this.race.boxes.length)); this.boxIM.castShadow = !this.mobile; this.scene.add(this.boxIM);
  }

  buildCars() {
    for (const k of this.race.karts) {
      const fp = FACTION_PAINT[k.faction] || { paint: "#888888", accent: "#ffffff" };
      const car = buildCar(k.chassis, fp.paint, fp.accent, NUMS[k.faction] || String(k.id + 1), !this.mobile || k === this.race.me);
      this.scene.add(car.root); this.cars.push(car);
    }
  }

  buildParticles() {
    const max = 600; const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(max * 3), 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(max * 3), 3)); g.setAttribute("size", new THREE.Float32BufferAttribute(new Float32Array(max), 1)); g.setAttribute("alpha", new THREE.Float32BufferAttribute(new Float32Array(max), 1));
    const tex = canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.5)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); }, false, false);
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: "attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale; void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }" });
    this.parts = new THREE.Points(g, m); this.parts.frustumCulled = false; this.scene.add(this.parts);
  }
  emit(x: number, y: number, z: number, n: number, o: { spread?: number; up?: number; life?: number; size?: number; color?: [number, number, number]; grow?: number; vx?: number; vz?: number }) {
    for (let i = 0; i < n && this.partData.length < 600; i++) { const sp = o.spread ?? 3; const life = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6); const c = o.color || [0.85, 0.85, 0.85];
      this.partData.push({ x: x + (Math.random() - 0.5) * 2, y, z: z + (Math.random() - 0.5) * 2, vx: (o.vx || 0) + (Math.random() - 0.5) * sp, vy: (o.up ?? 2) * (0.5 + Math.random()), vz: (o.vz || 0) + (Math.random() - 0.5) * sp, life, max: life, size: o.size ?? 4, r: c[0], g: c[1], b: c[2], grow: o.grow ?? 2 }); }
  }

  /** pooled meshes for items / hazards (created on first use) */
  get(kind: string, make: () => THREE.Object3D) { const list = (this.pool[kind] ||= []); const u = this.used[kind] || 0; if (!list[u]) { const o = make(); list[u] = o; this.scene.add(o); } this.used[kind] = u + 1; const o = list[u]; o.visible = true; return o; }

  makeShell = () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0x2ecc40, roughness: 0.2, clearcoat: 1 })); s.scale.set(1, 0.8, 1); g.add(s); const r = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.6, 6, 16), new THREE.MeshStandardMaterial({ color: 0xffffff })); r.rotation.x = Math.PI / 2; g.add(r); return g; };
  makeWasp = () => { const g = new THREE.Group(); const stripes = canvasTex(64, 16, (c) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#111" : "#ffcc00"; c.fillRect(i * 8, 0, 8, 16); } }, true, false); const b = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.4 })); b.scale.set(1.8, 1, 1); g.add(b); const wm = new THREE.MeshStandardMaterial({ color: 0xddeeff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }); for (const s of [1, -1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), wm); w.position.set(0, 1.5, s * 1.5); w.userData.wing = s; g.add(w); } return g; };
  makeWrath = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), new THREE.MeshStandardMaterial({ color: 0x8a2be2, emissive: 0xc04dff, emissiveIntensity: 2 }))); const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xd080ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(22, 22, 1); g.add(glow); return g; };
  makeSlick = () => { const m = new THREE.Mesh(new THREE.CircleGeometry(8, 20), new THREE.MeshPhysicalMaterial({ color: 0x3a2608, roughness: 0.05, clearcoat: 1, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -5 })); m.rotation.x = -Math.PI / 2; m.scale.set(1, 0.7, 1); return m; };
  makeSpider = () => { const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.6 }); const body = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 10), mat); body.position.y = 5; body.scale.set(1.2, 0.9, 1); g.add(body); const head = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), mat); head.position.set(5, 4.5, 0); g.add(head); const eye = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 2 }); for (const s of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), eye); e.position.set(7.2, 5.4, s * 0.9); g.add(e); } for (let i = 0; i < 8; i++) { const side = i < 4 ? 1 : -1; const k = i % 4; const leg = new THREE.Group(); leg.position.set(-2.5 + k * 1.8, 5, side * 2.5); const up = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 6, 5), mat); up.position.y = 3; up.rotation.z = 0; const pivotA = new THREE.Group(); pivotA.rotation.x = side * -1.0; pivotA.add(up); const low = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 7, 5), mat); low.position.set(0, 6 + 2.5, 0); low.rotation.x = side * 1.9; pivotA.add(low); leg.add(pivotA); leg.userData.leg = i; g.add(leg); } return g; };
  makeBoulder = () => { const geo = new THREE.IcosahedronGeometry(9, 1); const p = geo.getAttribute("position"); const r = rng(5); for (let i = 0; i < p.count; i++) { const k = 1 + (r() - 0.5) * 0.25; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } geo.computeVertexNormals(); const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.95, flatShading: true })); m.castShadow = !this.mobile; return m; };
  makeCrusher = () => { const g = new THREE.Group(); const metal = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.8, roughness: 0.35 }); const head = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 6, 20), metal); head.userData.head = 1; g.add(head); const rod = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 60, 10), metal); rod.position.y = 33; head.add(rod); const haz = canvasTex(128, 16, (c) => { for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? "#111" : "#f2c21e"; c.beginPath(); c.moveTo(i * 8, 0); c.lineTo(i * 8 + 8, 0); c.lineTo(i * 8, 16); c.lineTo(i * 8 - 8, 16); c.fill(); } }); const band = new THREE.Mesh(new THREE.CylinderGeometry(13.2, 13.2, 2, 20, 1, true), new THREE.MeshStandardMaterial({ map: haz })); band.position.y = -2; head.add(band); return g; };
  makeGeyser = () => { const g = new THREE.Group(); const col = new THREE.Mesh(new THREE.CylinderGeometry(4, 7, 40, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); col.position.y = 20; g.add(col); return g; };
  makeShield = () => new THREE.Mesh(new THREE.SphereGeometry(16, 20, 14), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));

  resize(cssW: number, cssH: number) { if (cssW === this.w && cssH === this.h) return; this.w = cssW; this.h = cssH; this.renderer.setSize(cssW, cssH, false); this.camera.aspect = cssW / cssH; this.camera.updateProjectionMatrix(); }

  render(dt: number) {
    const R = this.race; this.t += dt; this.uTime.value = this.t;
    for (const k in this.used) this.used[k] = 0;
    // fans get louder when the race is on and when the leader passes; lights follow the start sequence
    this.uExcite.value += ((R.state === "countdown" ? 0.9 : R.state === "race" ? 0.55 : R.state === "finished" ? 1 : 0.3) - this.uExcite.value) * Math.min(1, dt * 2);
    { const lit = R.state === "countdown" ? R.lightsOn : 0; if (this.gantry && lit !== this.litNow) { this.litNow = lit; const c = new THREE.Color(); for (let i = 0; i < 20; i++) { const pod = Math.floor(i / 4), lower = i % 2 === 1; this.gantry.setColorAt(i, c.setHex(lower && pod < lit ? 0xff2a10 : 0x2a0606).multiplyScalar(lower && pod < lit ? 3 : 1)); } this.gantry.instanceColor!.needsUpdate = true; } }
    if (this.boostTex) this.boostTex.offset.y = -this.t * 1.5;
    for (const f of this.flames) { const k = 0.8 + Math.sin(this.t * 13 + f.userData.flicker) * 0.12 + Math.random() * 0.1; f.scale.set(6 * k, 8 * k, 1); }
    // cars
    R.karts.forEach((k, i) => {
      const car = this.cars[i]; const hide = k.respawn > 0 && k.respawn < 1.0; car.root.visible = !hide;
      const braking = (k === R.me && R.input.brake) || (k.speed < car.lastSpeed - 2);
      animateCar(car, k as any, braking, dt, this.t);
      // tyre smoke while drifting, dust on the grass, sparks off walls handled via shake
      const surf = R.surfAt(k.x, k.y);
      if (!hide && k.drift !== 0 && k.speed > 60 && Math.random() < 0.7) this.emit(k.x - Math.cos(k.h) * 9, 1, k.y - Math.sin(k.h) * 9, 1, { spread: 6, up: 3, life: 0.9, size: 7, grow: 3, color: [0.82, 0.82, 0.84] });
      if (!hide && (surf === 0 || surf === 6 || surf === 2) && k.speed > 50 && Math.random() < 0.5) this.emit(k.x - Math.cos(k.h) * 9, 0.8, k.y - Math.sin(k.h) * 9, 1, { spread: 4, up: 4, life: 0.7, size: 5, grow: 2, color: surf === 0 ? [0.45, 0.4, 0.28] : [0.75, 0.66, 0.5] });
      if (!hide && k.shield > 0) { const sh = this.get("shield", this.makeShield); sh.position.set(k.x, 6, k.y); }
      if (!hide && k.spin > 0 && Math.random() < 0.4) this.emit(k.x, 6, k.y, 1, { spread: 10, up: 6, life: 0.5, size: 3, color: [1, 0.9, 0.3], grow: 0 });
    });
    // item boxes
    if (this.boxIM) { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); R.boxes.forEach((b, i) => { q.setFromEuler(new THREE.Euler(this.t * 0.9 + i, this.t * 1.3, 0)); const sc = b.t <= 0 ? 1 : 0.0001; m4.compose(new THREE.Vector3(b.x, 6 + Math.sin(this.t * 3 + i) * 1.2, b.y), q, new THREE.Vector3(sc, sc, sc)); this.boxIM!.setMatrixAt(i, m4); }); this.boxIM.instanceMatrix.needsUpdate = true; }
    // projectiles, drops, hazards
    for (const p of R.projs) {
      const o = this.get(p.kind, p.kind === "shell" ? this.makeShell : p.kind === "wasp" ? this.makeWasp : this.makeWrath);
      o.position.set(p.x, p.kind === "shell" ? 3 : 7 + Math.sin(this.t * 8) * 1.5, p.y); o.rotation.y = -p.h; if (p.kind === "shell") o.rotation.x += dt * 12;
      if (p.kind === "wasp") o.children.forEach((c) => { if (c.userData.wing) c.rotation.x = c.userData.wing * (0.5 + Math.sin(this.t * 60) * 0.5); });
      if (Math.random() < 0.5) this.emit(p.x, 4, p.y, 1, { spread: 1, up: 1, life: 0.4, size: 3, color: p.kind === "wrath" ? [0.8, 0.4, 1] : [1, 1, 1], grow: 1 });
    }
    for (const d of R.drops) { const o = this.get("slick", this.makeSlick); o.position.set(d.x, 0.12, d.y); }
    for (const h of R.hazards) {
      if (h.kind === "spider") { const o = this.get("spider", this.makeSpider); o.position.set(h.x, 0, h.y); const dx = (h.b[0] - h.a[0]), dy = (h.b[1] - h.a[1]); o.rotation.y = -Math.atan2(dy, dx) + Math.PI / 2 * Math.sign(Math.cos((this.t / h.period) * Math.PI * 2 + (h.phase || 0))); o.children.forEach((c) => { if (c.userData.leg !== undefined) c.rotation.z = Math.sin(this.t * 14 + c.userData.leg * 1.3) * 0.35; }); }
      else if (h.kind === "boulder") { const o = this.get("boulder", this.makeBoulder); o.position.set(h.x, 9, h.y); o.rotation.x = this.t * 2.5; o.rotation.z = this.t * 1.1; }
      else if (h.kind === "crusher") { const o = this.get("crusher", this.makeCrusher); o.position.set(h.x, 0, h.y); const head = o.children[0]; head.position.y = 3 + (h.lift ?? 1) * 30; if (h.active && Math.random() < 0.3) { this.emit(h.x, 2, h.y, 4, { spread: 26, up: 4, life: 0.6, size: 8, grow: 3, color: [0.7, 0.68, 0.62] }); this.shake = Math.max(this.shake, 0.15); } }
      else if (h.kind === "geyser") { const o = this.get("geyser", this.makeGeyser); o.position.set(h.x, 0, h.y); o.scale.set(1, h.active ? 1 : 0.02, 1); if (h.active) this.emit(h.x, 4, h.y, 3, { spread: 8, up: 40, life: 0.9, size: 9, grow: 3, color: [1, 0.6, 0.25] }); else if (Math.random() < 0.2) this.emit(h.x, 1, h.y, 1, { spread: 3, up: 6, life: 1.2, size: 6, grow: 3, color: [0.8, 0.8, 0.8] }); }
    }
    for (const f of R.fx) if (f.life > (f.kind === "star" ? 0.38 : 0.35) && f.life < 2) { /* new bursts */ }
    if (R.fx.length) for (const f of R.fx) { if ((f as any)._seen) continue; (f as any)._seen = 1; if (f.kind === "star") this.emit(f.x, 8, f.y, 14, { spread: 30, up: 14, life: 0.6, size: 4, grow: 0, color: [1, 0.85, 0.3] }); else this.emit(f.x, 3, f.y, 10, { spread: 18, up: 6, life: 0.8, size: 9, grow: 4, color: [0.9, 0.9, 0.92] }); }
    for (const kind in this.pool) { const u = this.used[kind] || 0; this.pool[kind].forEach((o, i) => { if (i >= u) o.visible = false; }); }
    // particles
    const P = this.partData; for (const p of P) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 4 * dt; p.size += p.grow * dt; } this.partData = P.filter((p) => p.life > 0 && p.y > -1);
    { const g = this.parts.geometry; const pa = g.getAttribute("position") as THREE.BufferAttribute, ca = g.getAttribute("color") as THREE.BufferAttribute, sa = g.getAttribute("size") as THREE.BufferAttribute, aa = g.getAttribute("alpha") as THREE.BufferAttribute;
      this.partData.forEach((p, i) => { pa.setXYZ(i, p.x, p.y, p.z); ca.setXYZ(i, p.r, p.g, p.b); sa.setX(i, p.size); aa.setX(i, Math.min(1, p.life / p.max * 1.4) * 0.7); });
      for (let i = this.partData.length; i < Math.min(600, this.partData.length + 40); i++) aa.setX(i, 0);
      g.setDrawRange(0, this.partData.length); pa.needsUpdate = ca.needsUpdate = sa.needsUpdate = aa.needsUpdate = true; (this.parts.material as THREE.ShaderMaterial).uniforms.scale.value = this.h * this.pr * 0.6; }
    // chase camera: low and close behind, looking a little ahead; springs on position, FOV opens on boost, shakes on hits
    const me = R.me; const car = this.cars[R.karts.indexOf(me)]; const hd = -car.root.rotation.y - 0 + car.slip * 0.6;
    const fx = Math.cos(R.camH), fz = Math.sin(R.camH);
    const want = new THREE.Vector3(me.x - fx * 27, 8.6, me.y - fz * 27); const look = new THREE.Vector3(me.x + fx * 30, 3.2, me.y + fz * 30);
    if (!this.camInit) { this.camPos.copy(want); this.camLook.copy(look); this.camInit = true; }
    this.camPos.lerp(want, Math.min(1, dt * 10)); this.camLook.lerp(look, Math.min(1, dt * 14));
    if (R.shake > this.lastShake + 0.2) this.shake = Math.max(this.shake, R.shake * 0.6); this.lastShake = R.shake; this.shake = Math.max(0, this.shake - dt * 2);
    const sx = (Math.random() - 0.5) * this.shake * 2.2, sy = (Math.random() - 0.5) * this.shake * 1.6;
    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z); this.camera.lookAt(this.camLook);
    const fovT = 58 + (me.boost > 0 ? 12 : 0) + Math.min(6, Math.max(0, me.speed - 100) * 0.06); this.fov += (fovT - this.fov) * Math.min(1, dt * 4); this.camera.fov = this.fov; this.camera.updateProjectionMatrix();
    void hd;
    // sun + shadow box follow the player
    if (this.sun.castShadow) { this.sun.target.position.set(me.x, 0, me.y); const d = this.sun.position.clone().sub(this.sun.target.position).normalize(); this.sun.position.set(me.x + d.x * 400, d.y * 400, me.y + d.z * 400); this.sun.target.updateMatrixWorld(); }
    this.renderer.render(this.scene, this.camera);
    this.adapt(dt);
  }
  /** if frames come slower than ~45 fps, drop the pixel ratio (down to 0.75) — phones stay smooth */
  adapt(dt: number) {
    if (this.race.state !== "race") return; this.frameMs.push(dt * 1000); if (this.frameMs.length < 90) return;
    const avg = this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length; this.frameMs = [];
    if (avg > 22 && this.pr > 0.75) { this.pr = Math.max(0.75, this.pr - 0.25); this.renderer.setPixelRatio(this.pr); const w = this.w, h = this.h; this.w = 0; this.resize(w, h); if (this.pr <= 1 && this.renderer.shadowMap.enabled) { this.renderer.shadowMap.enabled = false; this.sun.castShadow = false; } }
  }
  dispose() { this.renderer.dispose(); this.scene.traverse((o: any) => { o.geometry?.dispose?.(); }); }
}
