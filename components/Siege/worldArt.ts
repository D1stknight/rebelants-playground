// components/Siege/worldArt.ts — the look of The Siege: PBR materials, golden-hour sky, the citadel, the field, the trebuchet and the horde models.
// Everything is procedural (textures from tools/siege-art/pbr.py) so it stays light enough for phones. Units: metres; the wall runs along x, the field is -z.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skClone } from "three/examples/jsm/utils/SkeletonUtils.js";

export const WT = 9, WZ = -1.5, WTH = 3, FZ = WZ - WTH / 2;       // wall top, wall centre z, thickness, field face z
export const SUN_DIR = new THREE.Vector3(-0.45, 0.32, -0.83).normalize();
export type Ctx = { S: THREE.Scene; tex: Record<string, THREE.Texture>; torch: (x: number, y: number, z: number, k: number, light?: boolean) => void; terrainH: (x: number, z: number) => number };
/** merge a parent's direct Mesh children into one mesh per material (keeps transforms relative to the parent) — cuts draw calls hard */
export function mergeByMaterial(parent: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false) {
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>(); const drop: THREE.Mesh[] = []; let shadow = false;
  for (const ch of parent.children) { const m = ch as THREE.Mesh; if (!m.isMesh || (m as any).isInstancedMesh || keep(m) || Array.isArray(m.material)) continue; m.updateMatrix();
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(m.matrix); const arr = groups.get(m.material as THREE.Material) || []; arr.push(g); groups.set(m.material as THREE.Material, arr); drop.push(m); shadow = shadow || m.castShadow; }
  for (const m of drop) parent.remove(m);
  for (const [mat, gs] of groups) { const merged = mergeGeometries(gs); if (!merged) continue; const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); }
  return parent;
}
const R = (a: number, b: number) => a + Math.random() * (b - a);

/** world-aligned UVs: each face projects onto the two axes it is not facing — boxes, extrusions and merged ruins tile seamlessly */
export function worldUV(geo: THREE.BufferGeometry, scale = 0.25, off = new THREE.Vector3()) {
  geo = geo.index ? geo.toNonIndexed() : geo; geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal; const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + off.x, y = pos.getY(i) + off.y, z = pos.getZ(i) + off.z; const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u: number, v: number; if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); return geo;
}
export function pbr(tex: Record<string, THREE.Texture>, set: string, o: { color?: number; repeat?: [number, number]; ns?: number; rough?: number; metal?: number } = {}) {
  const prep = (t?: THREE.Texture) => { if (!t) return null; const c = o.repeat ? t.clone() : t; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.anisotropy = 8; if (o.repeat) c.repeat.set(o.repeat[0], o.repeat[1]); c.needsUpdate = true; return c; };
  return new THREE.MeshStandardMaterial({ color: o.color ?? 0xffffff, map: prep(tex[set + "_a"]), normalMap: prep(tex[set + "_n"]), roughnessMap: prep(tex[set + "_r"]), normalScale: new THREE.Vector2(o.ns ?? 1, o.ns ?? 1), roughness: o.rough ?? 1, metalness: o.metal ?? 0 });
}
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d")!; draw(g); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** crimson banner with a gold ant crest */
export function bannerTex() {
  return canvasTex(256, 512, (g) => {
    const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, "#5a0f14"); gr.addColorStop(0.5, "#9c1c24"); gr.addColorStop(1, "#5a0f14"); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = "#d9a441"; g.lineWidth = 10; g.strokeRect(14, 14, 228, 440);
    g.fillStyle = "#5a0f14"; g.beginPath(); g.moveTo(0, 470); g.lineTo(128, 420); g.lineTo(256, 470); g.lineTo(256, 512); g.lineTo(0, 512); g.fill();   // swallow-tail
    g.clearRect(0, 470, 256, 42); g.fillStyle = "#9c1c24"; g.beginPath(); g.moveTo(0, 440); g.lineTo(128, 505); g.lineTo(256, 440); g.lineTo(256, 470); g.lineTo(128, 512); g.lineTo(0, 470); g.fill();
    g.save(); g.translate(128, 210); g.fillStyle = "#e0b04c"; g.strokeStyle = "#e0b04c"; g.lineWidth = 7; g.lineCap = "round";
    g.beginPath(); g.arc(0, 0, 70, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(0, -22, 18, 16, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(0, 6, 13, 14, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(0, 40, 20, 26, 0, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 10, -34); g.quadraticCurveTo(s * 26, -64, s * 40, -58); g.stroke(); for (const [y, a] of [[0, -0.5], [8, 0], [16, 0.5]]) { g.beginPath(); g.moveTo(s * 10, y); g.lineTo(s * 42, y - 18 + a * 40); g.lineTo(s * 54, y + 6 + a * 40); g.stroke(); } }
    g.restore(); g.fillStyle = "rgba(0,0,0,0.18)"; for (let i = 0; i < 40; i++) g.fillRect(0, i * 13, 256, 2);
  });
}
function roofTex() {
  return canvasTex(256, 256, (g) => { g.fillStyle = "#4a2418"; g.fillRect(0, 0, 256, 256); for (let r = 0; r < 16; r++) for (let c = 0; c < 9; c++) { const x = c * 32 - (r % 2) * 16, y = r * 16; const k = 0.7 + Math.random() * 0.4; g.fillStyle = `rgb(${120 * k | 0},${52 * k | 0},${34 * k | 0})`; g.beginPath(); g.ellipse(x + 16, y + 12, 15, 12, 0, 0, Math.PI); g.fill(); g.strokeStyle = "rgba(20,8,4,0.7)"; g.lineWidth = 2; g.stroke(); } });
}
/** chitin with venom markings, used on abdomens */
function chitinTex(base: string, mark: string) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6; i++) { g.fillStyle = mark; g.globalAlpha = 0.85; const y = 30 + i * 36; g.beginPath(); g.moveTo(128, y - 10); g.lineTo(128 - 34 + i * 4, y + 12); g.lineTo(128, y + 4); g.lineTo(128 + 34 - i * 4, y + 12); g.closePath(); g.fill(); }
    g.globalAlpha = 0.25; for (let i = 0; i < 400; i++) { g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } g.globalAlpha = 1;
  });
}
function stripeTex() { return canvasTex(64, 256, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#141008" : "#e2b43a"; g.fillRect(0, i * 32, 64, 32); } }); }
function wingTex() { return canvasTex(128, 64, (g) => { g.fillStyle = "rgba(220,235,255,0.35)"; g.beginPath(); g.ellipse(64, 32, 62, 26, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = "rgba(60,50,40,0.8)"; g.lineWidth = 1.5; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(4, 32); g.quadraticCurveTo(60, 8 + i * 10, 124, 14 + i * 8); g.stroke(); } }); }

// ── sky: warm late-afternoon gradient, sun disc + glow, drifting fbm clouds lit from below
export function buildSky(S: THREE.Scene) {
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uSun: { value: SUN_DIR.clone() }, uT: { value: 0 } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `varying vec3 vP; uniform vec3 uSun; uniform float uT;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
      void main(){ vec3 d = normalize(vP); float h = d.y; float sd = max(dot(d, uSun), 0.);
        vec3 zen = vec3(.30,.45,.66), mid = vec3(.72,.70,.68), hor = vec3(.98,.76,.52), low = vec3(.78,.58,.42);
        vec3 c = h > 0. ? mix(hor, mix(mid, zen, smoothstep(.15,.7,h)), smoothstep(0.,.18,h)) : mix(hor, low, smoothstep(0.,-.15,h));
        c += vec3(1.,.66,.32) * pow(sd, 8.) * .38 + vec3(1.,.8,.55) * pow(sd, 90.) * .55;
        c = mix(c, vec3(1.,.95,.85)*1.9, smoothstep(.9995,.9998,sd));
        if (h > 0.) { vec2 uv = d.xz / (h + .18) * 1.6 + vec2(uT*.004, uT*.002); float cl = smoothstep(.48,.8, fbm(uv*1.3)); float lit = pow(sd, 3.)*.8 + .35;
          vec3 cc = mix(vec3(.62,.55,.55), vec3(1.,.82,.62), lit); c = mix(c, cc, cl * smoothstep(0.,.12,h) * .85); }
        gl_FragColor = vec4(c, 1.); }` });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 32, 20), mat); sky.renderOrder = -10; S.add(sky); return sky;
}

/** far mesas and rock spires ringing the field */
export function buildMesas(c: Ctx) {
  const mat = pbr(c.tex, "rock", { color: 0xe0c4a0, ns: 1.4 });
  const make = (r: number, h: number, seed: number) => {
    const g = new THREE.CylinderGeometry(r * 0.75, r, h, 28, 10, false); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const a = Math.atan2(z, x); const k = 1 + 0.18 * Math.sin(a * 5 + seed) + 0.12 * Math.sin(a * 11 + seed * 2) + 0.06 * Math.sin(y * 0.4 + a * 3); const ledge = 1 + 0.05 * Math.round(Math.sin(y * 0.25 + seed) * 2); p.setX(i, x * k * ledge); p.setZ(i, z * k * ledge); }
    g.computeVertexNormals(); const m = new THREE.Mesh(worldUV(g, 0.06), mat); m.castShadow = false; m.receiveShadow = true; return m;
  };
  const spots: [number, number, number, number][] = [[-160, -230, 34, 70], [-60, -300, 50, 90], [70, -270, 40, 60], [170, -210, 30, 95], [240, -120, 36, 55], [-250, -120, 42, 65], [20, -360, 60, 110], [-120, -150, 12, 38], [110, -160, 9, 46]];
  spots.forEach(([x, z, r, h], i) => { const m = make(r, h, i * 1.7); m.position.set(x, h / 2 - 4, z); c.S.add(m); });
}

type Mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, uvScale?: number) => THREE.Mesh;

/** the citadel: curtain wall with batter, corbelled parapet and chunky merlons; a gatehouse with a pointed arch, doors and portcullis; round towers; the keep; the trebuchet bastion */
export function buildCastle(c: Ctx, trebX: number) {
  const { S, tex } = c;
  const stone = pbr(tex, "ashlar", { ns: 1.3 }), stone2 = pbr(tex, "ashlar2", { ns: 1.3 }), flag = pbr(tex, "flag", { ns: 0.9 }), wood = pbr(tex, "wood", { ns: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.45, metalness: 0.8 }); const dark = new THREE.MeshStandardMaterial({ color: 0x0c0906, roughness: 1 });
  const roof = new THREE.MeshStandardMaterial({ map: roofTex(), roughness: 0.8 }); (roof.map as THREE.Texture).wrapS = (roof.map as THREE.Texture).wrapT = THREE.RepeatWrapping; (roof.map as THREE.Texture).repeat.set(6, 3);
  const mk: Mk = (geo, mat, x, y, z, uvScale = 0.25) => { const g = worldUV(geo, uvScale, new THREE.Vector3(x, y, z)); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; S.add(m); return m; };
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, pts: [number, number, number, number?][]) => { const g = worldUV(geo, 0.25); const im = new THREE.InstancedMesh(g, mat, pts.length); const o = new THREE.Object3D(); pts.forEach(([x, y, z, ry], i) => { o.position.set(x, y, z); o.rotation.set(0, ry || 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.castShadow = true; im.receiveShadow = true; S.add(im); return im; };
  const L = 120; const skip = (x: number) => Math.abs(x) < 5.2 || Math.abs(Math.abs(x) - 15.5) < 4.9 || Math.abs(Math.abs(x) - 42) < 4.9;

  // curtain wall
  mk(new THREE.BoxGeometry(L, WT, WTH), stone, 0, WT / 2, WZ);
  mk(new THREE.BoxGeometry(L, 1.8, WTH + 1.4), stone2, 0, 0.9, WZ - 0.7);                                   // battered plinth
  mk(new THREE.BoxGeometry(L, 0.32, 0.3), stone2, 0, 3.4, FZ - 0.15); mk(new THREE.BoxGeometry(L, 0.32, 0.3), stone2, 0, WT - 1.1, FZ - 0.15);   // string courses
  const corb: [number, number, number][] = []; for (let x = -L / 2 + 1; x < L / 2; x += 1.9) if (!skip(x)) corb.push([x, WT - 0.35, FZ - 0.18]);
  inst(new THREE.BoxGeometry(0.42, 0.55, 0.5), stone2, corb);
  mk(new THREE.BoxGeometry(L, 1.0, 0.8), stone, 0, WT + 0.5, FZ + 0.12);                                     // parapet, overhanging the corbels
  const mer: [number, number, number][] = [], cap: [number, number, number][] = []; for (let x = -L / 2 + 1; x < L / 2; x += 1.9) if (!skip(x)) { mer.push([x, WT + 1.62, FZ + 0.12]); cap.push([x, WT + 2.3, FZ + 0.12]); }
  inst(new THREE.BoxGeometry(1.15, 1.25, 0.8), stone, mer); inst(new THREE.BoxGeometry(1.32, 0.16, 0.96), stone2, cap);
  mk(new THREE.BoxGeometry(L, 0.2, WTH - 0.7), flag, 0, WT + 0.1, WZ + 0.3);                                 // wall-walk flagstones
  mk(new THREE.BoxGeometry(L, 0.9, 0.45), stone, 0, WT + 0.45, WZ + WTH / 2 - 0.2);                          // inner parapet
  for (let x = -55; x <= 55; x += 11) { if (skip(x) || Math.abs(x - trebX) < 6) continue; mk(new THREE.BoxGeometry(1.8, WT - 2, 1.4), stone2, x, (WT - 2) / 2, FZ - 0.7); const t = mk(new THREE.CylinderGeometry(0.01, 1.28, 1.3, 4, 1), stone2, x, WT - 1.35, FZ - 0.7); t.rotation.y = Math.PI / 4; t.scale.set(1, 1, 0.78); }
  // crimson banners on the wall face
  const bmat = new THREE.MeshStandardMaterial({ map: bannerTex(), side: THREE.DoubleSide, roughness: 0.9 });
  for (const x of [-28, -9.5, 9.5, 28, -48, 48]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 4.2, 1, 8), bmat); b.position.set(x, WT - 2.6, FZ - 0.26); b.rotation.y = Math.PI; b.castShadow = true; S.add(b); const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), iron); rod.rotation.z = Math.PI / 2; rod.position.set(x, WT - 0.5, FZ - 0.3); S.add(rod); }

  // ── gatehouse
  const GW = 10, GH = WT + 4.5;
  const archPath = (p: THREE.Path | THREE.Shape, w: number, sh: number, ah: number) => { const r = w; p.moveTo(-w / 2, 0); p.lineTo(-w / 2, sh); p.absarc(w / 2, sh, r, Math.PI, Math.PI - Math.acos(0.5), true); p.absarc(-w / 2, sh, r, Math.acos(0.5), 0, true); p.lineTo(w / 2, 0); p.lineTo(-w / 2, 0); void ah; };
  const facade = new THREE.Shape(); facade.moveTo(-GW / 2, 0); facade.lineTo(GW / 2, 0); facade.lineTo(GW / 2, GH); facade.lineTo(-GW / 2, GH); facade.lineTo(-GW / 2, 0);
  const hole = new THREE.Path(); archPath(hole, 4.6, 4.4, 0); facade.holes.push(hole);
  const fg = new THREE.ExtrudeGeometry(facade, { depth: 1.4, bevelEnabled: false }); mk(fg, stone, 0, 0, FZ - 0.9);
  const ring = new THREE.Shape(); archPath(ring, 5.8, 4.4, 0); const ringHole = new THREE.Path(); archPath(ringHole, 4.6, 4.4, 0); ring.holes.push(ringHole);
  const rg = new THREE.ExtrudeGeometry(ring, { depth: 0.3, bevelEnabled: false }); const rm = mk(rg, stone2, 0, 0, FZ - 1.1); rm.scale.set(1, 1, 1);
  mk(new THREE.BoxGeometry(GW, GH, WTH + 1.2), stone, 0, GH / 2, WZ + 0.9);                                   // gatehouse body behind the facade
  mk(new THREE.BoxGeometry(4.8, 6.6, 1.6), dark, 0, 3.3, FZ + 1.0);                                          // passage darkness
  // doors: two leaves filling the arch, timber with iron straps and studs
  const doorS = new THREE.Shape(); archPath(doorS, 4.5, 4.4, 0); const dg = new THREE.ExtrudeGeometry(doorS, { depth: 0.25, bevelEnabled: false }); mk(dg, wood, 0, 0, FZ + 0.2, 0.5);
  for (const y of [1.1, 2.6, 4.1]) mk(new THREE.BoxGeometry(4.4, 0.2, 0.06), iron, 0, y, FZ + 0.17);
  { const studs: [number, number, number][] = []; for (const y of [1.1, 2.6, 4.1]) for (let x = -2; x <= 2; x += 0.5) studs.push([x, y, FZ + 0.12]); const g = new THREE.SphereGeometry(0.07, 6, 4); const im = new THREE.InstancedMesh(g, iron, studs.length); const o = new THREE.Object3D(); studs.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); S.add(im); }
  mk(new THREE.BoxGeometry(0.1, 5.8, 0.1), iron, 0, 2.9, FZ + 0.14);
  // raised portcullis teeth
  { const pg = new THREE.Group(); for (let x = -2.0; x <= 2.01; x += 0.5) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), iron); b.position.set(x, 6.0, FZ - 0.2); pg.add(b); const t = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 4), iron); t.rotation.x = Math.PI; t.position.set(x, 4.75, FZ - 0.2); pg.add(t); } S.add(mergeByMaterial(pg)); }
  mk(new THREE.BoxGeometry(4.3, 0.12, 0.12), iron, 0, 5.4, FZ - 0.2);
  // gatehouse top: corbels, parapet, merlons, corner turrets
  const gc: [number, number, number][] = []; for (let x = -GW / 2 + 0.5; x <= GW / 2 - 0.4; x += 1.1) gc.push([x, GH - 0.3, FZ - 1.1]); inst(new THREE.BoxGeometry(0.42, 0.6, 0.5), stone2, gc);
  mk(new THREE.BoxGeometry(GW + 0.4, 1.0, 0.8), stone, 0, GH + 0.5, FZ - 0.9);
  const gm: [number, number, number][] = []; for (let x = -GW / 2 + 0.8; x <= GW / 2 - 0.7; x += 1.9) gm.push([x, GH + 1.62, FZ - 0.9]); inst(new THREE.BoxGeometry(1.15, 1.25, 0.8), stone, gm);
  mk(new THREE.BoxGeometry(GW, 0.2, WTH + 2), flag, 0, GH + 0.1, WZ + 0.4);
  for (const sx of [-1, 1]) {
    const tx = sx * (GW / 2 + 0.2), tz = FZ - 0.9; const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 20, 1, true), stone2); cone.rotation.x = Math.PI; cone.position.set(tx, GH - 3.8, tz); S.add(cone);
    const cy = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 6.6, 20), pbr(tex, "ashlar", { repeat: [2.5, 1.7], ns: 1.3 })); cy.position.set(tx, GH + 0.7, tz); cy.castShadow = true; S.add(cy);
    const tm: [number, number, number, number][] = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; tm.push([tx + Math.cos(a) * 1.45, GH + 4.5, tz + Math.sin(a) * 1.45, -a]); } inst(new THREE.BoxGeometry(0.7, 0.9, 0.5), stone, tm);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(1.9, 3.4, 20), roof); rf.position.set(tx, GH + 6.6, tz); rf.castShadow = true; S.add(rf);
    c.torch(sx * 3.3, 4.8, FZ - 1.25, 1.2, true);
  }
  { const b = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.2, 1, 8), bmat); b.position.set(0, GH - 3.6, FZ - 0.95); b.rotation.y = Math.PI; b.castShadow = true; S.add(b); }

  // ── round towers
  for (const tx of [-15.5, 15.5, -42, 42]) {
    const tz = WZ - 1.2, H = 19, r0 = 4.2; const circ = 2 * Math.PI * r0;
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0 + 0.6, H, 32, 1), pbr(tex, "ashlar", { repeat: [circ / 4, H / 4], ns: 1.3 })); tw.position.set(tx, H / 2, tz); tw.castShadow = true; tw.receiveShadow = true; S.add(tw);
    const rc: [number, number, number, number][] = []; for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; rc.push([tx + Math.cos(a) * (r0 + 0.15), H - 0.4, tz + Math.sin(a) * (r0 + 0.15), -a + Math.PI / 2]); } inst(new THREE.BoxGeometry(0.45, 0.6, 0.5), stone2, rc);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 0.5, r0 + 0.5, 1.2, 32), pbr(tex, "ashlar", { repeat: [circ / 4, 0.3], ns: 1.3 })); crown.position.set(tx, H + 0.5, tz); crown.castShadow = true; S.add(crown);
    const tm: [number, number, number, number][] = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; tm.push([tx + Math.cos(a) * (r0 + 0.3), H + 1.7, tz + Math.sin(a) * (r0 + 0.3), -a + Math.PI / 2]); } inst(new THREE.BoxGeometry(1.2, 1.3, 0.7), stone, tm);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(r0 + 0.9, 7, 32), roof); rf.position.set(tx, H + 5.4, tz); rf.castShadow = true; S.add(rf);
    for (const y of [5.5, 10, 14.5]) { const rr = r0 + 0.6 * (1 - y / H); const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.4), dark); sl.position.set(tx, y, tz - rr - 0.02); sl.rotation.y = Math.PI; S.add(sl); }
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.0), new THREE.MeshBasicMaterial({ color: 0xffb35a })); w.position.set(tx + 1.8, 12, tz - Math.sqrt(r0 * r0 - 1.8 * 1.8) - 0.3); w.lookAt(tx + 3.6, 12, tz - 20); S.add(w);
  }
  // ── the keep behind the wall
  { const kx = -8, kz = WZ + 17, KW = 24, KH = 28, KD = 14;
    mk(new THREE.BoxGeometry(KW, KH, KD), stone, kx, KH / 2, kz);
    for (const bx of [-KW / 2, -KW / 6, KW / 6, KW / 2]) mk(new THREE.BoxGeometry(1.6, KH - 4, 1.4), stone2, kx + bx, (KH - 4) / 2, kz - KD / 2 - 0.6);
    const km: [number, number, number][] = []; for (let x = -KW / 2 + 0.7; x <= KW / 2; x += 1.9) km.push([kx + x, KH + 0.7, kz - KD / 2 + 0.3]); inst(new THREE.BoxGeometry(1.15, 1.4, 0.7), stone, km);
    const wm = new THREE.MeshBasicMaterial({ color: 0xffb35a });
    for (const [wx, wy] of [[-7, 12], [0, 12], [7, 12], [-7, 20], [0, 20], [7, 20]]) { const s = new THREE.Shape(); archPath(s, 1.2, 1.6, 0); const g = new THREE.ShapeGeometry(s); const m = new THREE.Mesh(g, wy > 15 ? wm : dark); m.position.set(kx + wx, wy, kz - KD / 2 - 0.02); m.rotation.y = Math.PI; S.add(m); }
    for (const [cx, cz] of [[-KW / 2, -KD / 2], [KW / 2, -KD / 2]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 8, 20), pbr(tex, "ashlar", { repeat: [3.5, 2], ns: 1.3 })); t.position.set(kx + cx, KH + 2, kz + cz); t.castShadow = true; S.add(t); const rf = new THREE.Mesh(new THREE.ConeGeometry(2.7, 4.5, 20), roof); rf.position.set(kx + cx, KH + 8.2, kz + cz); S.add(rf); }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 16, 24), pbr(tex, "ashlar", { repeat: [5, 4], ns: 1.3 })); spire.position.set(kx + 5, KH + 8, kz + 2); spire.castShadow = true; S.add(spire);
    const sr = new THREE.Mesh(new THREE.ConeGeometry(3.8, 8, 24), roof); sr.position.set(kx + 5, KH + 20, kz + 2); S.add(sr);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 6), iron); pole.position.set(kx + 5, KH + 26, kz + 2); S.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6, 8, 1), new THREE.MeshStandardMaterial({ color: 0xb01e28, side: THREE.DoubleSide })); fl.position.set(kx + 6.5, KH + 27.6, kz + 2); fl.name = "flag"; S.add(fl);
  }
  // ── trebuchet bastion: a platform behind the wall at trebX
  { const bz0 = WZ + WTH / 2, BD = 9, BW = 11; mk(new THREE.BoxGeometry(BW, WT, BD), stone, trebX, WT / 2, bz0 + BD / 2); mk(new THREE.BoxGeometry(BW, 0.2, BD), flag, trebX, WT + 0.1, bz0 + BD / 2);
    for (const sx of [-1, 1]) mk(new THREE.BoxGeometry(0.5, 1.0, BD), stone, trebX + sx * (BW / 2 - 0.25), WT + 0.5, bz0 + BD / 2);
    mk(new THREE.BoxGeometry(BW, 1.0, 0.5), stone, trebX, WT + 0.5, bz0 + BD - 0.25);
    for (const [x, z] of [[trebX - BW / 2 + 0.6, bz0 + BD - 0.6], [trebX + BW / 2 - 0.6, bz0 + BD - 0.6]]) c.torch(x, WT + 1.9, z, 1.1, true);
    // stacked ammunition + barrels
    const rockM = pbr(tex, "rock", { color: 0xcfc2b0, ns: 1.2 }); for (let i = 0; i < 7; i++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 1), rockM); r.position.set(trebX - 4 + (i % 3) * 0.8 + (i > 2 ? 0.4 : 0), WT + 0.6 + (i > 2 ? 0.55 : 0) + (i > 5 ? 0.55 : 0), bz0 + 6 + (i % 2) * 0.5); r.castShadow = true; S.add(r); }
    for (const [x, z] of [[trebX + 4, bz0 + 6.5], [trebX + 4.2, bz0 + 7.6]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12), wood); b.position.set(x, WT + 0.75, z); b.castShadow = true; S.add(b); }
  }
}

/** the field: flagstone plaza + road before the gate, ruined arches, broken columns, ruined walls, rubble, dead trees, bones, palisades, fire pits */
export function buildField(c: Ctx, craters: [number, number, number][]) {
  const { S, tex, terrainH } = c;
  const stone2 = pbr(tex, "ashlar2", { ns: 1.3 }), flag = pbr(tex, "flag", { ns: 0.9 }), rockM = pbr(tex, "rock", { color: 0xd8c4a8, ns: 1.3 }), wood = pbr(tex, "wood", { color: 0x8a7a6a, ns: 1 });
  const boneM = new THREE.MeshStandardMaterial({ color: 0xe0d6c2, roughness: 0.7 });
  const put = (m: THREE.Object3D, x: number, z: number, dy = 0) => { m.position.set(x, terrainH(x, z) + dy, z); S.add(m); return m; };
  const clear = (x: number, z: number) => Math.abs(x) < 7 || z > FZ - 6;
  // plaza + road
  { const g = new THREE.PlaneGeometry(40, 20, 1, 1); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(worldUV(g, 0.25, new THREE.Vector3(0, 0.03, FZ - 10)), flag); m.position.set(0, 0.03, FZ - 10); m.receiveShadow = true; (m.material as THREE.Material).polygonOffset = true; (m.material as THREE.Material).polygonOffsetFactor = -2; S.add(m); }
  { const len = 60; const g = new THREE.PlaneGeometry(7, len, 6, 60); g.rotateX(-Math.PI / 2); g.translate(0, 0, FZ - 20 - len / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, terrainH(p.getX(i), p.getZ(i)) + 0.05); g.computeVertexNormals(); const m = new THREE.Mesh(worldUV(g, 0.25), flag); m.receiveShadow = true; S.add(m); }
  { const tg = new THREE.Group(); for (let i = 0; i < 40; i++) { const z = FZ - R(18, 85), x = (Math.random() < 0.5 ? -1 : 1) * R(3.4, 5.5); const g = new THREE.BoxGeometry(R(0.6, 1.2), 0.12, R(0.5, 1)); const m = new THREE.Mesh(worldUV(g, 0.25, new THREE.Vector3(x, 0, z)), flag); m.rotation.set(R(-0.1, 0.1), R(0, 3), R(-0.1, 0.1)); m.position.set(x, terrainH(x, z) + 0.04, z); tg.add(m); } S.add(mergeByMaterial(tg)); }
  // ruined arches, like the old outer ward
  const archMesh = (span: number, broken: number) => {
    const grp = new THREE.Group(); const ph = R(4.5, 6.5), pw = 1.3;
    for (const sx of [-1, 1]) { if (broken > 0.6 && sx > 0 && Math.random() < 0.5) continue; const h = sx > 0 && broken > 0.3 ? ph * R(0.4, 1) : ph; const g = worldUV(new THREE.BoxGeometry(pw, h, pw), 0.25); const m = new THREE.Mesh(g, stone2); m.position.set(sx * span / 2, h / 2, 0); m.castShadow = true; m.receiveShadow = true; grp.add(m); const cap = new THREE.Mesh(worldUV(new THREE.BoxGeometry(pw + 0.3, 0.3, pw + 0.3), 0.25), stone2); cap.position.set(sx * span / 2, h + 0.15, 0); cap.castShadow = true; if (h === ph) grp.add(cap); }
    const outer = span / 2 + pw / 2, inner = span / 2 - pw / 2; const a1 = Math.PI * (1 - broken * R(0.4, 0.9));
    const sh = new THREE.Shape(); sh.absarc(0, 0, outer, 0, a1, false); sh.absarc(0, 0, inner, a1, 0, true); const g = worldUV(new THREE.ExtrudeGeometry(sh, { depth: pw, bevelEnabled: false, curveSegments: 20 }), 0.25);
    const arc = new THREE.Mesh(g, stone2); arc.rotation.y = 0; arc.position.set(0, ph + 0.3, -pw / 2); arc.scale.x = -1; arc.castShadow = true; arc.receiveShadow = true; grp.add(arc);
    return mergeByMaterial(grp);
  };
  for (const [x, z, ry, br] of [[-24, FZ - 30, 0.2, 0.2], [-34, FZ - 33, 0.2, 0.7], [22, FZ - 44, -0.3, 0.1], [32, FZ - 47, -0.3, 0.8], [-16, FZ - 62, 0.1, 0.5], [18, FZ - 80, 0.4, 0.3], [-40, FZ - 88, -0.2, 0.9], [44, FZ - 70, 0.6, 0.4]] as [number, number, number, number][]) { const a = archMesh(R(4.5, 6), br); a.rotation.y = ry; put(a, x, z, -0.2); }
  // broken columns + fallen drums
  for (let i = 0; i < 18; i++) { const x = R(-60, 60), z = FZ - R(14, 110); if (clear(x, z)) continue; const h = R(1.2, 6.5); const col = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.52, h, 14), pbr(tex, "ashlar2", { repeat: [0.8, h / 4], ns: 1.2 })); col.position.y = h / 2 + 0.35; col.castShadow = true; col.receiveShadow = true; const g = new THREE.Group(); g.add(col); const base = new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.4, 0.4, 1.4), 0.25), stone2); base.position.y = 0.2; base.castShadow = true; g.add(base); put(mergeByMaterial(g), x, z);
    if (Math.random() < 0.6) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, R(1, 2.2), 14), col.material); d.rotation.set(0, R(0, 3), Math.PI / 2); d.castShadow = true; put(d, x + R(-3, 3), z + R(-3, 3), 0.45); } }
  // ruined wall runs with jagged tops (merged blocks)
  const ruin = (len: number) => { const gs: THREE.BufferGeometry[] = []; const cols = Math.round(len / 1.1); for (let i = 0; i < cols; i++) { const h = Math.max(1, Math.round((Math.sin(i * 0.7) * 0.5 + 0.5) * 6 * R(0.4, 1.1))); for (let j = 0; j < h; j++) { if (j === h - 1 && Math.random() < 0.3) continue; const g = new THREE.BoxGeometry(1.1 * R(0.9, 1.05), 0.55, 1.2 * R(0.92, 1.05)); g.translate(i * 1.1 - len / 2 + R(-0.04, 0.04), 0.28 + j * 0.56, R(-0.05, 0.05)); gs.push(g.index ? g.toNonIndexed() : g); } } return worldUV(mergeGeometries(gs), 0.25); };
  for (const [x, z, ry, len] of [[-44, FZ - 58, 0.05, 16], [40, FZ - 60, -0.1, 18], [-12, FZ - 98, 0.2, 12], [58, FZ - 100, 0.4, 14], [-62, FZ - 40, 1.2, 12]] as [number, number, number, number][]) { const m = new THREE.Mesh(ruin(len), stone2); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; put(m, x, z, -0.25); }
  // rubble and boulders (instanced)
  { const pts: THREE.Matrix4[] = []; const o = new THREE.Object3D(); for (let i = 0; i < 220; i++) { const x = R(-100, 100), z = FZ - R(4, 150); if (Math.abs(x) < 4) continue; const s = Math.random() < 0.85 ? R(0.2, 0.6) : R(0.8, 2.2); o.position.set(x, terrainH(x, z) + s * 0.3, z); o.rotation.set(R(0, 3), R(0, 3), R(0, 3)); o.scale.set(s, s * R(0.6, 1), s); o.updateMatrix(); pts.push(o.matrix.clone()); }
    const im = new THREE.InstancedMesh(worldUV(new THREE.DodecahedronGeometry(1, 1), 0.5), rockM, pts.length); pts.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; S.add(im); }
  // dead trees
  for (let i = 0; i < 20; i++) { const x = R(-90, 90), z = FZ - R(18, 140); if (clear(x, z) || Math.abs(x) < 10) continue; const tr = new THREE.Group(); const h = R(5, 9); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.55, h, 7), wood); trunk.position.y = h / 2; tr.add(trunk); for (let b = 0; b < 6; b++) { const L = R(1.6, 3.4); const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.15, L, 5), wood); br.geometry.translate(0, L / 2, 0); br.position.set(0, h * R(0.45, 0.95), 0); br.rotation.set(R(-0.5, 0.5), b * 1.3 + R(0, 1), R(0.5, 1.2)); tr.add(br); } tr.rotation.set(0, R(0, 6), R(-0.14, 0.14)); tr.traverse((o) => { (o as THREE.Mesh).castShadow = true; }); put(mergeByMaterial(tr), x, z); }
  // bone piles
  for (let i = 0; i < 16; i++) { const x = R(-70, 70), z = FZ - R(10, 120); if (clear(x, z)) continue; const g = new THREE.Group(); for (let j = 0; j < 7; j++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, R(0.8, 1.6), 5), boneM); b.rotation.set(R(0, 3), R(0, 3), Math.PI / 2 + R(-0.4, 0.4)); b.position.set(R(-0.8, 0.8), 0.1 + j * 0.05, R(-0.8, 0.8)); g.add(b); } const sk = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), boneM); sk.scale.set(1, 0.85, 1.2); sk.position.set(R(-0.5, 0.5), 0.28, R(-0.5, 0.5)); g.add(sk); put(mergeByMaterial(g), x, z); }
  // palisades ahead of the wall
  { const pg = new THREE.Group(); for (const [zr, n] of [[FZ - 30, 16], [FZ - 50, 12]] as [number, number][]) for (let i = 0; i < n; i++) { const x = -44 + (88 / n) * i + R(-1.5, 1.5); if (Math.abs(x) < 7) continue; const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.2, R(2.6, 3.6), 6), wood); st.rotation.set(-0.6 + R(-0.15, 0.15), 0, R(-0.15, 0.15)); st.castShadow = true; const z = zr + R(-1, 1); st.position.set(x, terrainH(x, z) + 0.8, z); pg.add(st); } S.add(mergeByMaterial(pg)); }
  // scorched craters + camp fires
  for (const [cx, cz, cr] of craters) { const sc = new THREE.Mesh(new THREE.CircleGeometry(cr * 1.5, 24), new THREE.MeshBasicMaterial({ map: c.tex.scorch || null, color: 0x2a1e16, transparent: true, opacity: 0.6, depthWrite: false })); sc.rotation.x = -Math.PI / 2; sc.position.set(cx, terrainH(cx, cz) + 0.08, cz); S.add(sc); }
  for (const z of [FZ - 72, FZ - 104]) for (const x of [-10, 10]) { c.torch(x, terrainH(x, z) + 1.2, z, 1.4, false); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.24, 6, 12), rockM); ring.rotation.x = Math.PI / 2; put(ring, x, z, 0.15); }
}

/** drifting embers + sun-lit dust around the camera */
export class Embers {
  pts: THREE.Points; vel: Float32Array; N = 520;
  constructor(S: THREE.Scene, glow?: THREE.Texture) {
    const g = new THREE.BufferGeometry(); const p = new Float32Array(this.N * 3); const col = new Float32Array(this.N * 3); this.vel = new Float32Array(this.N * 3);
    for (let i = 0; i < this.N; i++) { p.set([R(-40, 40), R(0, 30), R(-60, 20)], i * 3); const ember = i % 3 === 0; col.set(ember ? [1, 0.55, 0.2] : [1, 0.9, 0.75], i * 3); this.vel.set([R(-0.4, 0.8), R(0.2, 1.2) * (ember ? 1.5 : 0.3), R(-0.4, 0.4)], i * 3); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, map: glow || null, vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); this.pts.frustumCulled = false; S.add(this.pts);
  }
  update(dt: number, cam: THREE.Vector3, t: number) {
    const p = this.pts.geometry.attributes.position as THREE.BufferAttribute; const a = p.array as Float32Array;
    for (let i = 0; i < this.N; i++) { const k = i * 3; a[k] += (this.vel[k] + Math.sin(t * 0.7 + i) * 0.3) * dt; a[k + 1] += this.vel[k + 1] * dt; a[k + 2] += this.vel[k + 2] * dt;
      for (let j = 0; j < 3; j++) { const half = j === 1 ? 16 : 40; const c = j === 1 ? cam.y : j === 0 ? cam.x : cam.z - 25; if (a[k + j] > c + half) a[k + j] -= half * 2; else if (a[k + j] < c - half) a[k + j] += half * 2; } }
    p.needsUpdate = true;
  }
}

// ── the trebuchet
export type Treb = { g: THREE.Group; arm: THREE.Group; cw: THREE.Group; tipLocal: THREE.Vector3; ammo: THREE.Mesh; sling: THREE.Line };
export function buildTrebuchet(c: Ctx, pos: THREE.Vector3): Treb {
  const wood = pbr(c.tex, "wood", { ns: 1.2 }); const iron = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.5, metalness: 0.75 }); const rope = new THREE.MeshStandardMaterial({ color: 0x9c8058, roughness: 0.9 });
  const g = new THREE.Group(); g.position.copy(pos); const beam = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, m: THREE.Material = wood) => { const b = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), 0.5), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
  const PY = 4.3, ARM_L = 6.8, ARM_S = 1.9;
  for (const sx of [-1.05, 1.05]) {
    beam(0.32, 0.32, 6.2, sx, 0.35, 0);                                   // base rail
    beam(0.28, PY + 0.2, 0.28, sx, PY / 2, -1.25, -0.42);                   // front leg
    beam(0.28, PY + 0.2, 0.28, sx, PY / 2, 1.25, 0.42);                     // rear leg
    beam(0.2, 0.2, 3.2, sx, 1.7, 0);                                        // mid brace
    beam(0.18, 2.7, 0.18, sx, 1.2, -0.3, 0.9);                              // diagonal
    for (const z of [-2.6, 2.6]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 16), wood); w.rotation.z = Math.PI / 2; w.position.set(sx * 1.15, 0.55, z); w.castShadow = true; g.add(w); const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), iron); hub.rotation.z = Math.PI / 2; hub.position.copy(w.position); g.add(hub); for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.08), wood); sp.position.copy(w.position); sp.position.x += sx * 0.05; sp.rotation.x = (k / 4) * Math.PI; g.add(sp); } }
  }
  for (const z of [-2.8, 0, 2.8]) beam(2.4, 0.26, 0.26, 0, 0.35, z);
  beam(2.2, 0.22, 0.22, 0, 1.7, -0.3);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.6, 12), iron); axle.rotation.z = Math.PI / 2; axle.position.set(0, PY, 0); g.add(axle);
  // winch at the back
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 12), wood); drum.rotation.z = Math.PI / 2; drum.position.set(0, 0.9, 2.6); g.add(drum); for (const sx of [-0.9, 0.9]) beam(0.5, 0.08, 0.08, sx, 0.9, 2.6, 0, 0, 0, iron);
  // arm: long end +y (sling), short end -y (counterweight)
  const arm = new THREE.Group(); arm.position.set(0, PY, 0); g.add(arm);
  const armB = new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.34, ARM_L + ARM_S, 0.34), 0.5), wood); armB.geometry.translate(0, (ARM_L - ARM_S) / 2, 0); armB.castShadow = true; arm.add(armB);
  for (const y of [-1.2, 0.6, 2.4, 4.4]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), iron); band.position.y = y; arm.add(band); }
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), iron); tip.position.y = ARM_L; arm.add(tip);
  const cw = new THREE.Group(); cw.position.y = -ARM_S; arm.add(cw);
  for (const sx of [-0.35, 0.35]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), iron); s.position.set(sx, -0.5, 0); cw.add(s); }
  const box = new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.25, 1.1, 1.25), 0.5), wood); box.position.y = -1.4; box.castShadow = true; cw.add(box);
  for (const y of [-1.0, -1.8]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.1, 1.32), iron); b.position.y = y; cw.add(b); }
  const stones = pbr(c.tex, "rock", { ns: 1 }); for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), stones); r.position.set(R(-0.4, 0.4), -0.78, R(-0.4, 0.4)); cw.add(r); }
  // sling pouch + ammo stone, and a rope from the tip
  const ammo = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 1), stones); ammo.castShadow = true; g.add(ammo);
  const sling = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x9c8058 })); g.add(sling); void rope;
  mergeByMaterial(g, (o) => o === ammo); mergeByMaterial(arm); mergeByMaterial(cw); c.S.add(g); return { g, arm, cw, tipLocal: new THREE.Vector3(0, ARM_L, 0), ammo, sling };
}

// ── the horde
export type Leg = { hip: THREE.Group; knee: THREE.Group; side: number; base: number; grp: number };
export type Bug = { g: THREE.Group; body: THREE.Group; legs: Leg[]; wings: THREE.Mesh[]; lod: THREE.Group; mixer?: THREE.AnimationMixer; acts?: Record<string, THREE.AnimationAction> };
// ── Quaternius "Animated Enemies" (CC0, via poly.pizza): rigged Spider (Walk/Idle/Attack/Jump/Death) and Wasp (Flying/Attack/Death)
export type BugModel = { scene: THREE.Object3D; clips: Record<string, THREE.AnimationClip>; k: number; minY: number };
export type BugModels = { spider?: BugModel; wasp?: BugModel };
export async function loadBugModels(): Promise<BugModels> {
  const gl = new GLTFLoader(); const out: BugModels = {};
  const one = async (url: string, extent: number): Promise<BugModel | undefined> => { try {
    const g = await gl.loadAsync(url); const sc = g.scene; sc.updateMatrixWorld(true); const box = new THREE.Box3(); sc.traverse((o: any) => { if (o.isMesh) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); if (isFinite(bb.min.x)) box.union(bb); } }); const sz = box.getSize(new THREE.Vector3());
    const clips: Record<string, THREE.AnimationClip> = {}; for (const a of g.animations) clips[a.name.split("_").pop() || a.name] = a;
    sc.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    const k = extent / Math.max(sz.x, sz.z, 1e-6); return { scene: sc, clips, k, minY: box.min.y }; } catch { return undefined; } };
  [out.spider, out.wasp] = await Promise.all([one("/siege/models/Spider.glb", 2.7), one("/siege/models/Wasp.glb", 1.75)]);
  return out;
}
const tintCache: Record<string, Map<THREE.Material, THREE.Material>> = {};
function tinted(m: THREE.Material, kind: string) {
  if (kind === "crawler" || kind === "wasp") return m; const cache = (tintCache[kind] ||= new Map()); const hit = cache.get(m); if (hit) return hit;
  const c = (m as THREE.MeshStandardMaterial).clone(); const base = c.color.clone(); const dark = base.r + base.g + base.b < 0.3;
  if (kind === "slinger") { if (dark) c.color.setHex(0xcfc6dc); c.roughness = 0.5; }
  if (kind === "brood") { if (dark) { c.color.setHex(0x2a1030); c.emissive = new THREE.Color(0x3a0a40); c.emissiveIntensity = 0.5; } else { c.emissive = new THREE.Color(0xff2a6a); c.emissiveIntensity = 0.6; } }
  cache.set(m, c); return c;
}
function buildSkinnedBug(kind: "crawler" | "slinger" | "wasp" | "brood", src: BugModel): Bug {
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const m = skClone(src.scene) as THREE.Object3D; m.scale.multiplyScalar(src.k); m.position.y = -src.minY * src.k; m.rotation.y = Math.PI;   // model faces +z → flip so the head leads (-z in bug space)
  m.traverse((o: any) => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map((x: THREE.Material) => tinted(x, kind)) : tinted(o.material, kind); o.frustumCulled = false; o.castShadow = true; } });
  body.add(m);
  if (kind === "slinger") { const sac = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), mats().silk); sac.position.set(0, 0.95, 0.55); body.add(sac); }
  if (kind === "brood") for (let i = 0; i < 9; i++) { const a = R(0, Math.PI * 2), b = R(0.3, 1.2); const e = new THREE.Mesh(new THREE.SphereGeometry(R(0.07, 0.11), 10, 8), mats().egg); e.position.set(Math.cos(a) * Math.sin(b) * 0.4, 0.75 + Math.cos(b) * 0.3, 0.5 + Math.sin(a) * Math.sin(b) * 0.45); body.add(e); }
  const mixer = new THREE.AnimationMixer(m); const acts: Record<string, THREE.AnimationAction> = {};
  for (const [n, c] of Object.entries(src.clips)) { const a = mixer.clipAction(c); if (n === "Death") { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } acts[n] = a; }
  const first = acts.Walk || acts.Flying || Object.values(acts)[0]; if (first) { first.play(); first.time = Math.random() * first.getClip().duration; }
  return { g, body, legs: [], wings: [], lod: new THREE.Group(), mixer, acts };
}
let bugMats: Record<string, THREE.Material> | null = null;
function mats() {
  if (bugMats) return bugMats;
  const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.35, ...o });
  bugMats = {
    chitin: phys({ color: 0x1c1418 }), leg: phys({ color: 0x241a1c, roughness: 0.5, clearcoat: 0.4 }),
    abd: phys({ map: chitinTex("#20161c", "#7a2fb8"), color: 0xffffff }), abdSling: phys({ map: chitinTex("#d8d0e6", "#5a3a8a"), color: 0xffffff }),
    abdBrood: phys({ map: chitinTex("#241020", "#b0306a"), color: 0xffffff, emissive: 0x200818 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xff3326 }), fang: phys({ color: 0xd8cbb0, roughness: 0.3 }),
    wasp: phys({ map: stripeTex(), color: 0xffffff }), waspHead: phys({ color: 0x2a1c0a }), wing: new THREE.MeshBasicMaterial({ map: wingTex(), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    beetle: phys({ color: 0x1a2a22, metalness: 0.5, roughness: 0.28, clearcoat: 1 }), egg: new THREE.MeshStandardMaterial({ color: 0xffd0e8, emissive: 0xff5aa8, emissiveIntensity: 0.9, roughness: 0.4 }),
    silk: new THREE.MeshStandardMaterial({ color: 0xe8e2f2, roughness: 0.7 }),
  };
  return bugMats;
}
function leg(body: THREE.Group, side: number, x: number, z: number, base: number, grp: number, L1: number, L2: number, th: number, m: THREE.Material): Leg {
  const hip = new THREE.Group(); hip.position.set(side * x, 0.55, z); hip.rotation.y = base; body.add(hip);
  const fem = new THREE.Mesh(new THREE.CylinderGeometry(th * 0.75, th, L1, 6), m); fem.geometry.translate(0, L1 / 2, 0); fem.rotation.z = -side * 0.95; fem.castShadow = true; hip.add(fem);
  const knee = new THREE.Group(); knee.position.set(side * Math.sin(0.95) * L1, Math.cos(0.95) * L1, 0); hip.add(knee);
  const j = new THREE.Mesh(new THREE.SphereGeometry(th * 0.95, 6, 5), m); knee.add(j);
  const tib = new THREE.Mesh(new THREE.CylinderGeometry(th * 0.25, th * 0.72, L2, 6), m); tib.geometry.translate(0, -L2 / 2, 0); tib.rotation.z = side * 0.42; tib.castShadow = true; knee.add(tib);
  return { hip, knee, side, base, grp };
}
export function buildBug(kind: "crawler" | "slinger" | "wasp" | "brute" | "brood", models?: BugModels): Bug {
  if (kind !== "brute") { const src = kind === "wasp" ? models?.wasp : models?.spider; if (src) return buildSkinnedBug(kind, src); }
  const M = mats(); const g = new THREE.Group(); const body = new THREE.Group(); g.add(body); const legs: Leg[] = []; const wings: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; body.add(o); return o; };
  if (kind === "wasp") {
    add(new THREE.SphereGeometry(0.28, 14, 10), M.waspHead, 0, 0.62, -0.62, 1, 0.9, 1);
    for (const ex of [-0.16, 0.16]) add(new THREE.SphereGeometry(0.12, 10, 8), M.eye, ex, 0.68, -0.72, 0.8, 1.2, 0.8);
    add(new THREE.SphereGeometry(0.3, 14, 10), M.waspHead, 0, 0.6, -0.2, 1, 0.95, 1.2);
    add(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6), M.leg, 0, 0.58, 0.12).rotation.x = Math.PI / 2;
    const ab = add(new THREE.SphereGeometry(0.36, 16, 12), M.wasp, 0, 0.52, 0.62, 0.9, 0.85, 1.55); ab.rotation.x = 0.25;
    const st = add(new THREE.ConeGeometry(0.06, 0.45, 6), M.leg, 0, 0.36, 1.18); st.rotation.x = -Math.PI / 2 - 0.3;
    for (const [side, z, len] of [[-1, -0.22, 1.9], [1, -0.22, 1.9], [-1, -0.05, 1.5], [1, -0.05, 1.5]] as [number, number, number][]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(len, len * 0.42), M.wing); w.geometry.translate(len / 2, 0, 0); w.position.set(side * 0.18, 0.86, z); w.rotation.set(-Math.PI / 2, 0, 0); w.scale.x = side; body.add(w); wings.push(w); }
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) legs.push(leg(body, side, 0.18, -0.3 + i * 0.16, side * (0.5 - i * 0.5), (i + (side > 0 ? 1 : 0)) % 2, 0.55, 0.75, 0.04, M.leg));
  } else if (kind === "brute") {
    const shell = add(new THREE.SphereGeometry(0.75, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.beetle, 0, 0.55, 0.25, 0.95, 0.9, 1.35);
    add(new THREE.SphereGeometry(0.72, 18, 10), M.chitin, 0, 0.52, 0.25, 0.92, 0.35, 1.3); void shell;
    add(new THREE.SphereGeometry(0.42, 16, 12), M.beetle, 0, 0.72, -0.72, 1.1, 0.8, 0.9);
    const horn = add(new THREE.ConeGeometry(0.13, 1.1, 8), M.beetle, 0, 1.05, -1.2); horn.rotation.x = -1.0;
    for (const sx of [-0.28, 0.28]) { const h2 = add(new THREE.ConeGeometry(0.06, 0.4, 6), M.beetle, sx, 0.95, -0.9); h2.rotation.x = -0.6; }
    for (const ex of [-0.22, 0.22]) add(new THREE.SphereGeometry(0.06, 6, 6), M.eye, ex, 0.72, -1.0);
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) legs.push(leg(body, side, 0.55, -0.45 + i * 0.45, side * (0.55 - i * 0.55), (i + (side > 0 ? 1 : 0)) % 2, 0.7, 0.8, 0.09, M.chitin));
  } else {
    const brood = kind === "brood";
    const ceph = add(new THREE.SphereGeometry(0.38, 18, 12), M.chitin, 0, 0.6, -0.3, 0.95, 0.62, 1.05); void ceph;
    const abd = add(new THREE.SphereGeometry(0.6, 22, 16), brood ? M.abdBrood : kind === "slinger" ? M.abdSling : M.abd, 0, 0.78, 0.62, 1, 0.86, 1.28); abd.rotation.x = -0.25;
    add(new THREE.CylinderGeometry(0.08, 0.1, 0.25, 6), M.chitin, 0, 0.64, 0.12).rotation.x = Math.PI / 2;
    const eyes: [number, number, number, number][] = [[-0.1, 0.78, -0.66, 0.07], [0.1, 0.78, -0.66, 0.07], [-0.2, 0.74, -0.6, 0.045], [0.2, 0.74, -0.6, 0.045], [-0.07, 0.86, -0.58, 0.04], [0.07, 0.86, -0.58, 0.04], [-0.26, 0.8, -0.5, 0.035], [0.26, 0.8, -0.5, 0.035]];
    for (const [x, y, z, r] of eyes) add(new THREE.SphereGeometry(r, 8, 6), M.eye, x, y, z);
    for (const sx of [-0.09, 0.09]) { const f = add(new THREE.ConeGeometry(0.06, 0.34, 6), M.fang, sx, 0.46, -0.7); f.rotation.set(Math.PI - 0.5, 0, sx * -2); const ch = add(new THREE.SphereGeometry(0.09, 8, 6), M.chitin, sx, 0.55, -0.68, 1, 1.4, 1); void ch; }
    for (const sx of [-1, 1]) { const pp = add(new THREE.CylinderGeometry(0.03, 0.045, 0.45, 6), M.leg, sx * 0.18, 0.55, -0.72); pp.rotation.set(-1.1, 0, sx * 0.3); }
    if (kind === "slinger") { add(new THREE.SphereGeometry(0.32, 14, 10), M.silk, 0, 1.2, 0.85, 1, 0.9, 1); for (const sx of [-0.12, 0.12]) add(new THREE.ConeGeometry(0.05, 0.2, 6), M.silk, sx, 0.62, 1.38).rotation.x = Math.PI / 2; }
    if (brood) { for (let i = 0; i < 9; i++) { const a = R(0, Math.PI * 2), b = R(0.3, 1.3); add(new THREE.SphereGeometry(R(0.1, 0.16), 10, 8), M.egg, Math.cos(a) * Math.sin(b) * 0.58, 0.78 + Math.cos(b) * 0.5, 0.62 + Math.sin(a) * Math.sin(b) * 0.75); } for (let i = 0; i < 6; i++) { const sp = add(new THREE.ConeGeometry(0.05, 0.4, 6), M.chitin, R(-0.2, 0.2), 1.05 + (i % 2) * 0.1, 0.1 + i * 0.18); sp.rotation.x = -0.4; } }
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) legs.push(leg(body, side, 0.26, -0.48 + i * 0.16, side * (0.75 - i * 0.48), (i + (side > 0 ? 1 : 0)) % 2, brood ? 1.1 : 0.95, brood ? 1.3 : 1.15, brood ? 0.08 : 0.055, M.leg));
  }
  gait({ legs }, 0.6, 0.6);
  // far LOD: the whole creature flattened into one mesh per material
  const lod = new THREE.Group(); g.updateMatrixWorld(true); const flat = new THREE.Group();
  body.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const c = new THREE.Mesh(m.geometry, m.material); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.castShadow = true; flat.add(c); });
  for (const c of flat.children as THREE.Mesh[]) { c.matrix.decompose(c.position, c.quaternion, c.scale); c.matrixAutoUpdate = true; } mergeByMaterial(flat); for (const c of flat.children as THREE.Mesh[]) c.castShadow = false; lod.add(...flat.children); lod.visible = false; g.add(lod);
  mergeByMaterial(body, (o) => wings.includes(o as THREE.Mesh)); for (const L of legs) mergeByMaterial(L.knee); for (const L of legs) L.hip.traverse((o) => { (o as THREE.Mesh).castShadow = kind === "brood" || kind === "brute"; });
  return { g, body, legs, wings, lod };
}
/** tetrapod gait: alternating leg groups swing forward/back and lift; the body bobs */
export function gait(b: { legs: Leg[]; body?: THREE.Group }, phase: number, amp: number) {
  for (const L of b.legs) { const p = phase + (L.grp ? Math.PI : 0); L.hip.rotation.y = L.base + Math.sin(p) * amp * 0.5 * L.side; L.hip.rotation.z = L.side * Math.max(0, Math.cos(p)) * amp * 0.45; L.knee.rotation.z = -L.side * Math.max(0, Math.cos(p)) * amp * 0.3; }
  if (b.body) b.body.position.y = Math.abs(Math.sin(phase * 2)) * amp * 0.06;
}
