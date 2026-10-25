// offline preview harness for components/fight — deterministic frame stepping
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FightStage, type Side, type StageEvent } from "../../components/fight/stage";
import { finishersFor } from "../../components/fight/finishers";

const Q = new URLSearchParams(location.search);
const W = +(Q.get("w") || 960), H = +(Q.get("h") || 540);
const COLORS: Record<string, string> = { ashigaru: "#4ade80", ronin: "#ef4444", samurai: "#dc2626", bushi: "#eab308", warrior: "#b45309", shogun: "#a855f7", buke: "#84cc16", kenshi: "#06b6d4", wokou: "#f97316", sohei: "#f59e0b", yamabushi: "#14b8a6" };
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color("#140d16"); scene.fog = new THREE.Fog("#140d16", 5, 16);
const camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 60);
scene.add(new THREE.AmbientLight("#ffe9d6", 1.0)); scene.add(new THREE.HemisphereLight("#ffd9c0", "#05060a", 0.6));
const key = new THREE.DirectionalLight("#fff2e0", 1.9); key.position.set(2.5, 4, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
const rim = new THREE.DirectionalLight("#ffffff", 0.9); rim.position.set(-3, 2.5, 2); scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3.8, 48), new THREE.MeshStandardMaterial({ color: "#0b0c12", roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.8, 64), new THREE.MeshBasicMaterial({ color: "#a855f7", transparent: true, opacity: 0.35 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; scene.add(ring);

const stage = new FightStage(); scene.add(stage.group); stage.fx.camera = camera;
let seed = 7; stage.rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const log: string[] = [];
stage.on((e: StageEvent) => { log.push(JSON.stringify(e)); if (e.type === "shake") shake = Math.max(shake, e.amount); if (e.type === "screenFlash") flashA = e.strength; if (e.type === "title") { titleEl.textContent = e.text; titleEl.style.color = e.color; titleT = 0; } });
let shake = 0, flashA = 0, titleT = -1;
const titleEl = document.createElement("div"); titleEl.style.cssText = `position:fixed;left:0;right:0;top:62%;text-align:center;font:900 ${Math.round(H * 0.075)}px Impact,Arial Black,sans-serif;letter-spacing:4px;-webkit-text-stroke:2px #000;text-shadow:0 0 20px currentColor;opacity:0`; document.body.appendChild(titleEl);
const flashEl = document.createElement("div"); flashEl.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none"; document.body.appendChild(flashEl);
const cur = { pos: new THREE.Vector3(0, 1.1, 4.15), look: new THREE.Vector3(0, 0.98, 0), fov: 36 };
const loader = new GLTFLoader();
async function load(f: string) { const g = await loader.loadAsync(`./models/${f}.glb`); g.scene.scale.setScalar(0.011); return g.scene; }
(window as any).setup = async (pf: string, ef: string) => {
  stage.setFighter("player", await load(pf), pf, COLORS[pf]); stage.setFighter("enemy", await load(ef), ef, COLORS[ef]);
  return true;
};
(window as any).cmd = (side: Side, anim: any) => stage.play(side, anim);
(window as any).ko = (side: Side) => stage.ko(side);
(window as any).fin = (side: Side, idx: number) => { const F = stage.f[side]!; const list = finishersFor(F.faction); return stage.runFinisher(side, list[idx % list.length]); };
(window as any).fins = (f: string) => finishersFor(f).map((x) => x.name);
(window as any).log = () => log.splice(0);
(window as any).dbg = () => ({ props: stage.props.children.map((c: any) => c.type + ":" + c.children.length), wP: Object.keys(stage.f.player!.weapons) });
(window as any).step = (dt = 1 / 30) => {
  stage.update(dt);
  const want = stage.cam ? stage.cam : { pos: new THREE.Vector3(0, 1.1, 4.15), look: new THREE.Vector3(0, 0.98, 0), fov: 36, ease: 6 };
  const a = Math.min(1, dt * (want.ease || 6));
  cur.pos.lerp(want.pos, a); cur.look.lerp(want.look, a); cur.fov += ((want.fov || 36) - cur.fov) * a;
  camera.position.copy(cur.pos); if (shake > 0.01) { camera.position.x += (Math.random() - 0.5) * shake * 0.09; camera.position.y += (Math.random() - 0.5) * shake * 0.06; shake *= Math.exp(-dt * 7); }
  camera.fov = cur.fov; camera.updateProjectionMatrix(); camera.lookAt(cur.look);
  flashEl.style.opacity = String(flashA * 0.8); flashA *= Math.exp(-dt * 8);
  if (titleT >= 0) { titleT += dt; titleEl.style.opacity = String(Math.min(1, titleT * 4)); }
  renderer.render(scene, camera);
};
(window as any).ready = true;
