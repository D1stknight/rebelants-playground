// components/fight/fx.ts — effects for the fight engine (all procedural): impact flashes, spark streaks, shock rings,
// weapon trails, projectiles, smoke, dust, shards, petals/ash/embers, lightning, beams, seals, tornado, rocks…
import * as THREE from "three";

type Item = { update: (dt: number) => boolean; dispose?: () => void };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

let TEX: Record<string, THREE.Texture> | null = null;
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function tex() {
  if (TEX) return TEX;
  const glow = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.75)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  const smoke = canvasTex(128, 128, (g) => { for (let i = 0; i < 26; i++) { const a = rnd(0, 6.3), d = rnd(0, 26); const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rr = rnd(18, 40); const r = g.createRadialGradient(x, y, 0, x, y, rr); r.addColorStop(0, "rgba(255,255,255,0.2)"); r.addColorStop(0.6, "rgba(255,255,255,0.08)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); } });
  const petal = canvasTex(64, 64, (g) => { g.fillStyle = "#fff"; g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(60, 20, 52, 54, 32, 60); g.bezierCurveTo(12, 54, 4, 20, 32, 4); g.fill(); g.fillStyle = "rgba(255,180,200,0.6)"; g.beginPath(); g.moveTo(32, 12); g.lineTo(32, 52); g.lineWidth = 2; g.strokeStyle = "rgba(255,150,180,0.7)"; g.stroke(); });
  const star = canvasTex(64, 64, (g) => { g.translate(32, 32); g.fillStyle = "#fff"; g.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 11 : 30; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); });
  TEX = { glow, smoke, petal, star };
  return TEX;
}
const sealTexCache = new Map<string, THREE.Texture>();
function sealTex(ch: string) {
  if (sealTexCache.has(ch)) return sealTexCache.get(ch)!;
  const t = canvasTex(512, 512, (g) => {
    g.translate(256, 256); g.strokeStyle = "#fff"; g.fillStyle = "#fff";
    g.lineWidth = 10; g.beginPath(); g.arc(0, 0, 236, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 200, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 2; i++) { g.beginPath(); for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + i * Math.PI / 4; g.lineTo(Math.cos(a) * 196, Math.sin(a) * 196); } g.closePath(); g.lineWidth = 4; g.stroke(); }
    g.font = "bold 28px serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const ring = "臨兵闘者皆陣列在前臨兵闘者皆陣列在前";
    for (let i = 0; i < ring.length; i++) { const a = (i / ring.length) * Math.PI * 2; g.save(); g.rotate(a); g.fillText(ring[i], 0, -218); g.restore(); }
    g.font = "bold 190px serif"; g.fillText(ch, 0, 10);
  });
  sealTexCache.set(ch, t); return t;
}

export class FxSystem {
  group = new THREE.Group();
  items: Item[] = [];
  camera: THREE.Camera | null = null;
  /** sound hook: the stage turns these into "sfx" events on the same frame */
  snd: (name: string, vol?: number) => void = () => {};
  /** brightness headroom for glowing effects: 1 = plain; above 1 when the arena renders with bloom, so sparks, slashes and magic glow */
  hdr = 1;
  private hot(color: string | THREE.Color, k = 1) { return new THREE.Color(color).multiplyScalar(1 + (this.hdr - 1) * k); }
  constructor() { this.group.name = "fight-fx"; }
  add(it: Item) { this.items.push(it); return it; }
  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) { const it = this.items[i]; if (!it.update(dt)) { it.dispose?.(); this.items.splice(i, 1); } }
  }
  clear() { for (const it of this.items) it.dispose?.(); this.items = []; this.group.clear(); }
  private obj<T extends THREE.Object3D>(o: T) { this.group.add(o); return o; }
  private kill(o: THREE.Object3D) { this.group.remove(o); o.traverse((c: any) => { c.geometry?.dispose?.(); if (c.material && !c.material.userData?.shared) c.material.dispose?.(); }); }

  sprite(pos: THREE.Vector3, color: string, size: number, life: number, opts: { tex?: "glow" | "smoke" | "star"; grow?: number; vel?: THREE.Vector3; add?: boolean; fade?: number; rot?: number } = {}) {
    const T = tex();
    const m = new THREE.SpriteMaterial({ map: T[opts.tex || "glow"], color: opts.add === false ? new THREE.Color(color) : this.hot(color, opts.tex === "smoke" ? 0 : opts.tex === "star" ? 0.7 : 0.15), transparent: true, depthWrite: false, blending: opts.add === false ? THREE.NormalBlending : THREE.AdditiveBlending, rotation: opts.rot || 0 });
    const s = this.obj(new THREE.Sprite(m)); s.position.copy(pos); s.scale.setScalar(size);
    let t = 0; const v = opts.vel?.clone();
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false; const sc = size * (1 + (opts.grow ?? 0.6) * u); s.scale.setScalar(sc); m.opacity = (opts.fade ?? 1) * (1 - u) * (u < 0.1 ? u / 0.1 : 1); if (v) { s.position.addScaledVector(v, dt); v.multiplyScalar(Math.exp(-dt * 2.2)); } return true; }, dispose: () => this.kill(s) });
  }
  /** a bare glow sprite the caller positions itself */
  glowSprite(color: string, size: number) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex().glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(size); return s; }
  flash(pos: THREE.Vector3, color = "#fff2c0", size = 0.9, life = 0.2) { return this.sprite(pos, color, size, life, { grow: 0.9 }); }
  ring(pos: THREE.Vector3, color: string, size: number, life: number, normal?: THREE.Vector3) {
    const m = new THREE.MeshBasicMaterial({ color: this.hot(color, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const r = this.obj(new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), m)); r.position.copy(pos);
    if (normal) r.lookAt(pos.clone().add(normal)); else if (this.camera) r.lookAt(this.camera.position);
    let t = 0;
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false; r.scale.setScalar(size * (0.15 + u)); m.opacity = 0.9 * (1 - u); return true; }, dispose: () => this.kill(r) });
  }
  groundRing(pos: THREE.Vector3, color: string, size: number, life: number, add = true) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide });
    const r = this.obj(new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48), m)); r.rotation.x = -Math.PI / 2; r.position.set(pos.x, 0.03, pos.z);
    let t = 0;
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false; r.scale.setScalar(size * (0.2 + u)); m.opacity = 0.6 * (1 - u); return true; }, dispose: () => this.kill(r) });
  }
  sparks(pos: THREE.Vector3, color: string, n = 16, speed = 4, life = 0.32) {
    const g = new THREE.BufferGeometry(); const pts = new Float32Array(n * 6); g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: this.hot(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const L = this.obj(new THREE.LineSegments(g, m)); const vel: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) vel.push(V(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.5, 1.2)));
    let t = 0; const a = g.attributes.position as THREE.BufferAttribute;
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false;
      for (let i = 0; i < n; i++) { const v = vel[i]; const h = pos.clone().addScaledVector(v, t * 0.6 + 0.02); h.y -= 2 * t * t; const tl = h.clone().addScaledVector(v, -Math.min(0.03, 0.5 / v.length()) * (1 - u * 0.6)); a.setXYZ(i * 2, h.x, h.y, h.z); a.setXYZ(i * 2 + 1, tl.x, tl.y, tl.z); }
      a.needsUpdate = true; m.opacity = 1 - u; return true; }, dispose: () => this.kill(L) });
  }
  /** a hit: flash + streaks + shock ring */
  impact(pos: THREE.Vector3, color: string, power: number, blocked = false, magic = false) {
    // tight and quick: a hot core, a star, short streaks; a thin shock ring only on strong blows
    if (blocked) { this.flash(pos, "#d8efff", 0.28, 0.08); this.sparks(pos, "#cfeaff", 8, 2.6, 0.14); return; }
    this.flash(pos, "#fff6dc", 0.2 + power * 0.1, 0.06 + power * 0.02);
    this.sprite(pos, magic ? color : "#ffe8b0", 0.22 + power * 0.1, 0.07 + power * 0.02, { tex: "star", grow: 0.5, rot: Math.random() * 6 });
    if (magic) this.sprite(pos, color, 0.5 + power * 0.18, 0.22, { grow: 0.8, fade: 0.8 });
    this.sparks(pos, magic ? color : "#ffe1a0", 8 + power * 6, 3 + power * 1.4, 0.12 + power * 0.04);
    if (power >= 2) this.ring(pos, color, 0.13 + power * 0.06, 0.09 + power * 0.025);
  }
  dust(pos: THREE.Vector3, size = 1.4) {
    this.groundRing(pos, "#b89a78", size, 0.7, false);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.sprite(V(pos.x + Math.cos(a) * 0.2, 0.12, pos.z + Math.sin(a) * 0.2), "#a08670", rnd(0.35, 0.6), rnd(0.6, 1.0), { tex: "smoke", add: false, vel: V(Math.cos(a) * 1.4, rnd(0.2, 0.6), Math.sin(a) * 1.4), fade: 0.6, grow: 1.4 }); }
  }
  smoke(pos: THREE.Vector3, color = "#8d93a3", n = 14, size = 0.5, silent = false) {
    if (!silent) this.snd("smoke", Math.min(1, 0.3 + n * 0.03));
    for (let i = 0; i < n; i++) this.sprite(pos.clone().add(V(rnd(-0.25, 0.25), rnd(-0.6, 0.6), rnd(-0.25, 0.25))), color, rnd(size * 0.6, size), rnd(0.45, 0.8), { tex: "smoke", add: false, vel: V(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)), grow: 1.4, fade: 0.75, rot: rnd(0, 6) });
  }
  /** ribbon behind a moving point pair (sword trail) — call trail.stop() to let it fade */
  trail(get: () => [THREE.Vector3, THREE.Vector3], color: string, len = 14) {
    const n = len; const pos = new Float32Array(n * 2 * 3); const alpha = new Float32Array(n * 2);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("a", new THREE.BufferAttribute(alpha, 1));
    const idx: number[] = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { c: { value: this.hot(color, 0.8) }, k: { value: 1 } },
      vertexShader: "attribute float a; varying float va; void main(){ va = a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: "uniform vec3 c; uniform float k; varying float va; void main(){ gl_FragColor = vec4(mix(c, vec3(1.), va*0.5), va*k); }" });
    const mesh = this.obj(new THREE.Mesh(g, m)); mesh.frustumCulled = false;
    // each sample remembers how fast the tip was moving: a slow or still blade leaves no ribbon, only a real swing does
    const hist: [THREE.Vector3, THREE.Vector3, number][] = []; let live = true, fade = 1;
    const it = this.add({ update: (dt) => {
      if (live) { const [a, b] = get(); const p = hist[0]; const sp = p && dt > 0 ? b.distanceTo(p[1]) / dt : 0; const jump = p ? b.distanceTo(p[1]) > 0.45 || a.distanceTo(p[0]) > 0.45 : false; const w = jump ? 0 : Math.max(0, Math.min(1, (sp - 2) / 4)); if (jump) for (const q of hist) q[2] = 0; hist.unshift([a.clone(), b.clone(), w]); if (hist.length > n) hist.pop(); } else { fade -= dt * 6; if (fade <= 0) return false; hist.pop(); if (hist.length < 2) return false; }
      for (let i = 0; i < n; i++) { const h = hist[Math.min(i, hist.length - 1)]; if (!h) continue; pos.set([h[0].x, h[0].y, h[0].z, h[1].x, h[1].y, h[1].z], i * 6); const r = hist.length > 1 ? 1 - i / (hist.length - 1) : 0; const al = r * r * 0.6 * h[2]; alpha[i * 2] = 0; alpha[i * 2 + 1] = al; }
      (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.a as THREE.BufferAttribute).needsUpdate = true; m.uniforms.k.value = fade; return true; }, dispose: () => this.kill(mesh) });
    return { stop: () => { live = false; }, it };
  }
  /** fly an object from → to (optional arc), spinning, then call arrive() */
  projectile(o: THREE.Object3D, from: THREE.Vector3, to: () => THREE.Vector3, dur: number, opts: { arc?: number; spin?: THREE.Vector3; face?: boolean; trail?: string; arrive?: () => void; keep?: number; silentHit?: boolean; quiet?: number } = {}) {
    this.group.add(o); o.position.copy(from); let t = 0, done = false; const prev = from.clone();
    // launch / landing sounds by what flies
    const id = o.userData.id as string | undefined; const qv = opts.quiet ?? 1;
    const launch: Record<string, string> = { shuriken: "star_throw", kunai: "star_throw", arrow: "arrow_whiz", orb: "magic_launch", bomb: "swing_heavy" };
    const land: Record<string, string> = { shuriken: "star_hit", kunai: "star_hit", arrow: "arrow_hit", orb: "magic_hit" };
    if (id && launch[id]) this.snd(launch[id], qv);
    const arriveUser = opts.arrive; opts = { ...opts, arrive: () => { if (!opts.silentHit && id && land[id]) this.snd(land[id], qv); arriveUser?.(); } };
    const tr = opts.trail ? this.trail(() => { const d = o.position.clone().sub(prev).normalize().multiplyScalar(0.02); return [o.position.clone().sub(d), o.position.clone().add(V(0, 0.03, 0))]; }, opts.trail, 10) : null;
    let keep = opts.keep ?? 0;
    return this.add({ update: (dt) => {
      if (!done) { t += dt; const u = Math.min(1, t / dur); const end = to(); prev.copy(o.position); o.position.lerpVectors(from, end, u); o.position.y += (opts.arc || 0) * 4 * u * (1 - u);
        if (opts.spin) { o.rotation.x += opts.spin.x * dt; o.rotation.y += opts.spin.y * dt; o.rotation.z += opts.spin.z * dt; }
        if (opts.face) { const d = o.position.clone().sub(prev); if (d.lengthSq() > 1e-8) o.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); }
        if (u >= 1) { done = true; tr?.stop(); opts.arrive?.(); if (keep <= 0) return false; } return true; }
      keep -= dt; return keep > 0; }, dispose: () => { this.kill(o); } });
  }
  /** pieces of the body flying apart (crystal shards, rocks, gold flakes…) */
  shards(points: THREE.Vector3[], color: string, opts: { n?: number; speed?: number; life?: number; size?: number; gravity?: number; emissive?: number; from?: THREE.Vector3; metal?: number } = {}) {
    const n = opts.n ?? 60; const geo = new THREE.TetrahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color, metalness: opts.metal ?? 0.3, roughness: 0.35, emissive: new THREE.Color(color), emissiveIntensity: opts.emissive ?? 0.6, transparent: true });
    const im = this.obj(new THREE.InstancedMesh(geo, mat, n)); im.frustumCulled = false; im.castShadow = true;
    const P: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number }[] = [];
    for (let i = 0; i < n; i++) { const p = points[i % points.length].clone().add(V(rnd(-0.12, 0.12), rnd(-0.12, 0.12), rnd(-0.12, 0.12)));
      const out = opts.from ? p.clone().sub(opts.from).normalize() : V(rnd(-1, 1), rnd(0, 1), rnd(-1, 1)).normalize();
      P.push({ p, v: out.multiplyScalar((opts.speed ?? 3) * rnd(0.4, 1.2)).add(V(0, rnd(0.5, 2), 0)), r: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)), w: V(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)), s: (opts.size ?? 0.06) * rnd(0.5, 1.4) }); }
    const life = opts.life ?? 1.6, gr = opts.gravity ?? 6; let t = 0; const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V();
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false;
      for (let i = 0; i < n; i++) { const s = P[i]; s.v.y -= gr * dt; s.p.addScaledVector(s.v, dt); if (s.p.y < s.s) { s.p.y = s.s; s.v.y *= -0.3; s.v.x *= 0.7; s.v.z *= 0.7; }
        s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt; q.setFromEuler(s.r); const k = s.s * (u > 0.7 ? (1 - u) / 0.3 : 1); sc.set(k, k, k); M.compose(s.p, q, sc); im.setMatrixAt(i, M); }
      im.instanceMatrix.needsUpdate = true; return true; }, dispose: () => this.kill(im) });
  }
  /** soft particles leaving the body: petals swirl, embers/ash rise, spirit motes */
  motes(points: THREE.Vector3[], color: string, mode: "petals" | "embers" | "ash" | "spirit", n = 80, life = 2.2) {
    const T = tex();
    for (let i = 0; i < n; i++) {
      const p = points[i % points.length].clone().add(V(rnd(-0.15, 0.15), rnd(-0.15, 0.15), rnd(-0.15, 0.15)));
      const m = new THREE.SpriteMaterial({ map: mode === "petals" ? T.petal : mode === "ash" ? T.smoke : T.glow, color: mode === "ash" ? (Math.random() < 0.5 ? "#2a2522" : "#ff7a30") : color, transparent: true, depthWrite: false, blending: mode === "ash" || mode === "petals" ? THREE.NormalBlending : THREE.AdditiveBlending, rotation: rnd(0, 6) });
      const s = this.obj(new THREE.Sprite(m)); s.position.copy(p); const size = mode === "petals" ? rnd(0.05, 0.09) : mode === "ash" ? rnd(0.06, 0.12) : rnd(0.04, 0.1); s.scale.setScalar(size);
      const v = mode === "petals" ? V(rnd(-0.6, 0.6), rnd(0.2, 1.2), rnd(-0.6, 0.6)) : V(rnd(-0.3, 0.3), rnd(0.6, 1.6), rnd(-0.3, 0.3)); const delay = rnd(0, 0.5); const ph = rnd(0, 6); let t = -delay; const L = life * rnd(0.7, 1.1);
      this.add({ update: (dt) => { t += dt; if (t < 0) { m.opacity = 0; return true; } const u = t / L; if (u >= 1) return false;
        s.position.addScaledVector(v, dt); if (mode === "petals") { s.position.x += Math.sin(t * 3 + ph) * dt * 0.6; m.rotation += dt * 2; v.y -= dt * 0.6; }
        m.opacity = (u < 0.1 ? u / 0.1 : 1) * (1 - u); return true; }, dispose: () => this.kill(s) });
    }
  }
  lightning(from: THREE.Vector3, to: THREE.Vector3, color: string, life = 0.25, width = 3) {
    this.snd("thunder", Math.min(1, 0.6 + life));
    const segs = 14; const pts: THREE.Vector3[] = [];
    const build = () => { pts.length = 0; for (let i = 0; i <= segs; i++) { const u = i / segs; const p = from.clone().lerp(to, u); if (i && i < segs) p.add(V(rnd(-0.18, 0.18), rnd(-0.1, 0.1), rnd(-0.18, 0.18))); pts.push(p); } };
    build(); const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, linewidth: width });
    const L = this.obj(new THREE.Line(g, m));
    const glowM = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const len = from.distanceTo(to); const tube = this.obj(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6, 1, true), glowM)); tube.position.copy(from).lerp(to, 0.5); tube.quaternion.setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize());
    let t = 0, k = 0;
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false; if ((k += dt) > 0.04) { k = 0; build(); g.setFromPoints(pts); } m.opacity = 1 - u * u; glowM.opacity = 0.35 * (1 - u); return true; }, dispose: () => { this.kill(L); this.kill(tube); } });
  }
  beam(from: THREE.Vector3, to: THREE.Vector3, color: string, width = 0.12, life = 0.5) {
    const len = from.distanceTo(to);
    const mk = (r: number, o: number) => { const m = new THREE.MeshBasicMaterial({ color: this.hot(color), transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false }); const b = this.obj(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12, 1, true), m)); b.position.copy(from).lerp(to, 0.5); b.quaternion.setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize()); return { b, m, o }; };
    const parts = [mk(width, 0.9), mk(width * 2.4, 0.35)]; let t = 0;
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false; const f = (1 - u) * (1 - u); for (const p of parts) { p.m.opacity = p.o * f; p.b.scale.set(1 - u * 0.7, 1, 1 - u * 0.7); } return true; }, dispose: () => parts.forEach((p) => this.kill(p.b)) });
  }
  /** a glowing seal disc (kanji ring) — flat on the ground or facing a direction */
  seal(pos: THREE.Vector3, color: string, size: number, life: number, opts: { ch?: string; normal?: THREE.Vector3; spin?: number; grow?: [number, number] } = {}) {
    this.snd("seal", Math.min(1, 0.55 + size * 0.15));
    const m = new THREE.MeshBasicMaterial({ map: sealTex(opts.ch || "封"), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const s = this.obj(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m)); s.position.copy(pos);
    const n = opts.normal || V(0, 1, 0); s.lookAt(pos.clone().add(n)); let t = 0; const [g0, g1] = opts.grow || [0.6, 1];
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false; s.rotateZ((opts.spin ?? 1) * dt); const k = size * (g0 + (g1 - g0) * Math.min(1, u * 3)); s.scale.setScalar(k); m.opacity = (u < 0.12 ? u / 0.12 : 1) * (u > 0.8 ? (1 - u) / 0.2 : 1); return true; }, dispose: () => this.kill(s) });
  }
  tornado(pos: () => THREE.Vector3, color: string, life: number, h = 2.6) {
    this.snd(life > 2 ? "wind" : "wind_short");
    const n = 170; const T = tex(); const sprites: { s: THREE.Sprite; a: number; y: number; r: number; m: THREE.SpriteMaterial }[] = [];
    for (let i = 0; i < n; i++) { const m = new THREE.SpriteMaterial({ map: i % 3 ? T.smoke : T.glow, color: i % 3 ? "#d9dde6" : color, transparent: true, depthWrite: false, blending: i % 3 ? THREE.NormalBlending : THREE.AdditiveBlending });
      const s = this.obj(new THREE.Sprite(m)); s.scale.setScalar(rnd(0.07, 0.22)); sprites.push({ s, a: rnd(0, 6.28), y: rnd(0, h), r: 0, m }); }
    let t = 0;
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false; const c = pos();
      for (const p of sprites) { p.a += dt * (7 - p.y); p.y = (p.y + dt * 0.9) % h; p.r = 0.15 + p.y * 0.32; p.s.position.set(c.x + Math.cos(p.a) * p.r, p.y, c.z + Math.sin(p.a) * p.r); p.m.opacity = 0.55 * Math.min(1, u * 5) * Math.min(1, (1 - u) * 4); }
      return true; }, dispose: () => sprites.forEach((p) => this.kill(p.s)) });
  }
  rocks(center: THREE.Vector3, n = 10, radius = 0.6, life = 2.2, color = "#6b5d50") {
    this.snd("rocks", Math.min(1, 0.5 + n * 0.04));
    const geo = new THREE.DodecahedronGeometry(1, 0); const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
    const im = this.obj(new THREE.InstancedMesh(geo, mat, n)); im.castShadow = true; im.frustumCulled = false;
    const R = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2); const r = radius * rnd(0.6, 1.1); return { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, s: rnd(0.12, 0.28), tilt: new THREE.Euler(rnd(-0.6, 0.6), rnd(0, 6), rnd(-0.6, 0.6)), d: rnd(0, 0.15) }; });
    let t = 0; const M = new THREE.Matrix4(), q = new THREE.Quaternion();
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false;
      R.forEach((r, i) => { const k = Math.min(1, Math.max(0, (t - r.d) / 0.18)); const sink = u > 0.75 ? (u - 0.75) / 0.25 : 0; const y = r.s * (k * 1.6 - 0.6) - sink * r.s * 2; q.setFromEuler(r.tilt); M.compose(V(r.x, y, r.z), q, V(r.s, r.s * 1.5, r.s)); im.setMatrixAt(i, M); });
      im.instanceMatrix.needsUpdate = true; return true; }, dispose: () => this.kill(im) });
  }
  /** spectral spikes erupting from the ground (spears, ice) */
  spikes(center: THREE.Vector3, color: string, n = 8, radius = 0.55, life = 1.8, height = 1.3, inward = 0.5) {
    this.snd("spikes", Math.min(1, 0.6 + n * 0.03));
    const g = new THREE.ConeGeometry(0.045, 1, 8); g.translate(0, 0.5, 0);
    const m = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.55, transparent: true, opacity: 0.9, metalness: 0.4, roughness: 0.3 });
    const im = this.obj(new THREE.InstancedMesh(g, m, n)); im.frustumCulled = false;
    const S = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return { x: center.x + Math.cos(a) * radius, z: center.z + Math.sin(a) * radius, a, d: i * 0.04 }; });
    let t = 0; const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    return this.add({ update: (dt) => { t += dt; const u = t / life; if (u >= 1) return false;
      S.forEach((s, i) => { const k = Math.min(1, Math.max(0, (t - s.d) / 0.12)); e.set(Math.sin(s.a) * inward, 0, -Math.cos(s.a) * inward); q.setFromEuler(e); const sc = height * k * (u > 0.8 ? (1 - u) / 0.2 : 1); M.compose(V(s.x, 0, s.z), q, V(1.2, sc, 1.2)); im.setMatrixAt(i, M); });
      im.instanceMatrix.needsUpdate = true; m.opacity = 0.9 * (u > 0.8 ? (1 - u) / 0.2 : 1); return true; }, dispose: () => this.kill(im) });
  }
  /** a big object descending/rising (bell, keg…) driven by a function of time */
  animate(o: THREE.Object3D, life: number, fn: (o: THREE.Object3D, t: number, u: number) => void) {
    this.group.add(o); let t = 0;
    return this.add({ update: (dt) => { t += dt; const u = Math.min(1, t / life); fn(o, t, u); return u < 1; }, dispose: () => this.kill(o) });
  }
  /** a shape of glowing points drawn along a curve (dragon, wave) */
  ribbonCurve(curve: (u: number, t: number) => THREE.Vector3, color: string, life: number, n = 70, size = 0.22) {
    const T = tex(); const S: { s: THREE.Sprite; m: THREE.SpriteMaterial; u: number }[] = [];
    for (let i = 0; i < n; i++) { const m = new THREE.SpriteMaterial({ map: T.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); const s = this.obj(new THREE.Sprite(m)); S.push({ s, m, u: i / (n - 1) }); }
    let t = 0;
    return this.add({ update: (dt) => { t += dt; const k = t / life; if (k >= 1) return false;
      for (const p of S) { p.s.position.copy(curve(p.u, t)); const sc = size * (1 - p.u * 0.7) * (0.8 + 0.2 * Math.sin(t * 20 + p.u * 30)); p.s.scale.setScalar(sc); p.m.opacity = Math.min(1, k * 6) * Math.min(1, (1 - k) * 5); }
      return true; }, dispose: () => S.forEach((p) => this.kill(p.s)) });
  }
}
