// components/fight/finishers.ts — two finishing moves per faction. Stylised, no gore: the loser shatters, turns to
// petals / ash / stone / gold, is launched into the sky, sealed away or pulled under — never anything bloody.
// Times are seconds of fight time (slow-mo stretches them). Poses are partial overrides of the stance (see moves.ts).
import * as THREE from "three";
import type { FinCtx, Fighter } from "./stage";
import { POSES, type Key } from "./moves";
import type { Pose, Vec3 } from "./rig";
import { makeWeapon } from "./weapons";

export interface Finisher { id: string; name: string; faction: string; dur: number; steps: [number, (c: FinCtx) => void][] }
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S = POSES;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export const FINISHERS: Record<string, Finisher[]> = {};
function add(f: Finisher) { (FINISHERS[f.faction] ||= []).push(f); }
export function finishersFor(faction: string): Finisher[] { return FINISHERS[faction] || FINISHERS.samurai; }

// ── reusable weapon poses (right hand leads, left hand on the grip) ───────────
type PP = Partial<Pose>;
const K = {
  guard: { hR: [-0.02, 1.3, 0.38], eR: [-0.6, -1, -0.2], hL: "GRIP", eL: [0.6, -1, -0.2], wR: [0, 0.8, 0.6], uR: [0, -0.6, 0.8] } as PP,
  raise: { hR: [-0.02, 1.95, 0.12], eR: [-0.8, 0.2, 0], hL: "GRIP", eL: [0.8, 0.2, 0], wR: [0, 0.35, -0.94], uR: [0, 0.94, 0.35], spPitch: -0.15, hdPitch: -0.1 } as PP,
  cut: { hR: [0, 1.12, 0.62], hL: "GRIP", eR: [-0.6, -1, 0], eL: [0.6, -1, 0], wR: [0, -0.45, 0.9], uR: [0, -0.9, -0.45], spPitch: 0.3, hipPitch: 0.15 } as PP,
  sideWind: { hR: [-0.5, 1.35, -0.05], eR: [-0.3, -1, -0.6], hL: [0.05, 1.4, 0.2], wR: [-0.85, 0.2, -0.5], uR: [0, 0, 1], hipYaw: -0.9, spYaw: -0.4, hdYaw: 1.0 } as PP,
  sideEnd: { hR: [0.35, 1.38, 0.5], eR: [-0.4, -1, 0], hL: [0.2, 1.3, -0.1], wR: [0.85, 0.05, 0.5], uR: [0, 0, -1], hipYaw: 0.5, spYaw: 0.45, hdYaw: -0.4 } as PP,
  hip: { hR: [0.14, 1.02, 0.18], eR: [-0.5, -1, 0.3], hL: [0.2, 1.0, 0.05], wR: [-0.15, -0.3, -0.94], uR: [0, 1, 0], sh: 1 } as PP,     // hand on the hilt, blade sheathed along the left hip
  down: { hR: [-0.25, 1.05, 0.25], eR: [-0.6, -1, 0], hL: [0.25, 1.2, 0.1], wR: [-0.3, -0.75, 0.6], uR: [0, -1, 0.2] } as PP,    // blade lowered, relaxed
};
const pole = {
  guard: { hR: [-0.26, 1.12, 0.12], eR: [-0.6, -1, -0.2], hL: "GRIP", eL: [0.6, -1, 0], wR: [0.18, 0.2, 1], uR: [0, -1, 0] } as PP,
  thrust: { rx: 0.35, hR: [-0.16, 1.3, 0.38], hL: "GRIP", eL: [0.6, -1, 0], wR: [0.1, 0.03, 1], uR: [0, -1, 0], hipYaw: -0.6, spYaw: -0.3, spPitch: 0.15, fL: [0.17, 0.15, 0.5] } as PP,
  overhead: { hR: [-0.05, 1.85, 0.0], hL: "GRIP", eR: [-0.8, 0.3, 0], eL: [0.8, 0.3, 0], wR: [0, 0.6, -0.8], uR: [0, 0.8, 0.6] } as PP,
};
const k = (t: number, p: PP | string, e?: Key["e"]): Key => ({ t, p: typeof p === "string" ? p : ({ ...S.stance, ...p } as Pose), e });
const mix = (...ps: PP[]): PP => Object.assign({}, ...ps);
const dizzyHit = (c: FinCtx, power: 1 | 2 | 3 = 1) => { c.act(c.D, [k(0.05, { ...S.dizzyA, ...{ spPitch: -0.2, hdPitch: -0.4, rx: -0.18 } }, "snap"), k(0.35, "dizzyB", "io"), k(1.15, "dizzyA", "io"), k(1.95, "dizzyB", "io")], undefined, false); void power; };
const back = (c: FinCtx) => c.act(c.D, [k(0, "dizzyA"), k(0.8, "dizzyB", "io"), k(1.6, "dizzyA", "io")], undefined, true);
function lift(F: Fighter, c: FinCtx, life: number, height: number, spin = 0) { c.fx.animate(new THREE.Object3D(), life, (_o, t, u) => { F.rig.offset.y = height * Math.sin(Math.min(1, u * 1.3) * Math.PI / 2); F.rig.offsetSpin = spin * u; void t; }); }

// ── KENSHI (ninja) ────────────────────────────────────────────────────────────
add({
  id: "kenshi-stars", name: "Shadow Star Storm", faction: "kenshi", dur: 4.4,
  steps: [
    [0, (c) => { c.cam("wide", 3); c.act(c.A, [k(0.25, { ...S.crouch, rx: -0.35 }, "out"), k(0.5, { ...S.throwWind, rx: -0.4, ry: 0.5 }, "out"), k(0.62, { ...S.throwRel, rx: -0.3, ry: 0.55 }, "snap"), k(0.78, { ...S.throwWind, rx: -0.3, ry: 0.4 }, "io"), k(0.9, { ...S.throwRel, rx: -0.25, ry: 0.3 }, "snap"), k(1.05, { ...S.throwWind, rx: -0.2, ry: 0.1 }), k(1.17, { ...S.throwRel, rx: -0.2 }, "snap"), k(1.6, { ...S.stance, rx: -0.2 }, "io")]); }],
    ...[0.62, 0.9, 1.17].map((t, kk) => [t, (c: FinCtx) => {
      for (let i = 0; i < 4; i++) {
        const from = c.A.gripAt(c.A.mirrored ? "L" : "R");
        const parts = ["HEAD", "CHEST", "BELLY", "LEGS"] as const; const part = parts[(i + kk) % 4];
        const off = V(0, (i - 1.5) * 0.07, 0.14 + i * 0.02); let stuck: THREE.Vector3 | null = null;
        const target = () => stuck || c.D.rig.part(part).add(off);
        const star = makeWeapon("shuriken");
        c.fx.projectile(star, from, target, 0.2 + i * 0.03, { spin: V(0, 0, 45), trail: "#bfefff", keep: Math.max(0.1, 2.7 - t), arrive: () => { stuck = target().clone(); c.fx.sparks(stuck, "#d8f6ff", 6, 2, 0.2); c.shake(0.3); dizzyHit(c); } });
      }
    }] as [number, (c: FinCtx) => void]),
    [1.5, (c) => { c.cam("closeD", 3); c.slow(0.5, 1.1); back(c); }],
    [2.15, (c) => { c.look(c.D, "glow", 0.45, c.A.color); c.fx.seal(c.D.center(), c.A.color, 1.7, 0.95, { ch: "爆", normal: V(0, 0, 1), spin: 3 }); }],
    [2.85, (c) => { c.flash(c.A.color, 0.9); c.shake(2.2); c.end("shatter"); c.cam("wide", 2); c.fx.ring(c.D.center(), c.A.color, 2.5, 0.5); }],
    [3.3, (c) => c.title("SHADOW STAR STORM")],
  ],
});
add({
  id: "kenshi-vanish", name: "Vanishing Blade", faction: "kenshi", dur: 4.6,
  steps: [
    [0, (c) => { c.cam("closeA", 4); c.act(c.A, [k(0.2, { ...S.crouch, rx: 0 }, "out"), k(0.3, { ...S.crouch, rx: 0 })]); }],
    [0.3, (c) => { c.sfx("vanish"); c.fx.smoke(c.A.center(), "#2a2e3a", 22, 0.8, true); c.fx.smoke(c.at(c.A, 0, 0.3), "#555c6e", 10, 0.6, true); }],
    [0.42, (c) => { c.A.rig.model.visible = false; c.A.rig.visible = false; c.cam("closeD", 3); }],
    [0.9, (c) => { // reappear behind the opponent, blade drawn
      c.weapon(c.A, "katana"); c.A.rig.model.visible = true; c.A.rig.visible = true; c.fx.smoke(c.at(c.D, -0.85, 1.1), "#2a2e3a", 14, 0.6, true); c.sfx("vanish", 0.8); c.sfx("draw", 0.7);
      c.act(c.A, [k(0, mix({ rx: 2.55, spin: Math.PI }, K.guard)), k(0.25, mix({ rx: 2.5, spin: Math.PI }, K.sideWind), "out"), k(0.36, mix({ rx: 2.48, spin: Math.PI }, K.sideEnd), "snap"), k(1.3, mix({ rx: 2.48, spin: Math.PI }, K.sideEnd)), k(1.7, mix({ rx: 2.48, spin: Math.PI }, K.down), "io"), k(2.1, mix({ rx: 2.48, spin: Math.PI }, K.hip), "io")]);
    }],
    [1.1, (c) => { const tr = c.trail(c.A, "#e6fbff"); c.S.later(0.35, () => tr.stop()); }],
    [1.26, (c) => { c.flash("#ffffff", 1); c.stop(0.22); c.slow(0.3, 1.0); c.hit(3, undefined, "CHEST", "#bff3ff"); c.fx.beam(c.at(c.D, 0.6, 1.25), c.at(c.D, -0.6, 1.35), "#dff8ff", 0.012, 0.3); c.look(c.D, "glow", 0.3, "#bff3ff"); }],
    [2.9, (c) => { c.fx.sparks(c.A.gripAt(c.A.mirrored ? "L" : "R"), "#ffffff", 6, 1.5, 0.2); c.shake(0.6); c.sfx("star_hit", 0.5); }],
    [3.05, (c) => { c.end("dissolve", "#9be8ff"); c.fx.smoke(c.D.center(), "#1e2230", 20, 0.8); c.cam("wide", 2); }],
    [3.5, (c) => c.title("VANISHING BLADE")],
  ],
});

// ── SAMURAI ───────────────────────────────────────────────────────────────────
add({
  id: "samurai-iai", name: "Iaijutsu", faction: "samurai", dur: 4.7,
  steps: [
    [0, (c) => { c.weapon(c.A, "katana"); c.cam("closeA", 4); c.act(c.A, [k(0.5, mix(S.crouch, { rx: 0, hipYaw: -0.6, spYaw: -0.2, hdYaw: 0.7 }, K.hip), "io"), k(1.1, mix(S.crouch, { rx: 0, hip: [0, -0.32, -0.04], hipYaw: -0.65, spYaw: -0.2, hdYaw: 0.75 }, K.hip), "io")]); }],
    [1.1, (c) => { c.cam("side", 7); c.act(c.A, [k(0.06, mix({ rx: 2.7, hip: [0, -0.2, 0.05], spPitch: 0.25, fL: [0.17, 0.15, 0.55], fR: [-0.15, 0.15, -0.45] }, K.sideEnd), "snap"), k(1.3, mix({ rx: 2.7, hip: [0, -0.2, 0.05], spPitch: 0.25, fL: [0.17, 0.15, 0.55], fR: [-0.15, 0.15, -0.45] }, K.sideEnd)), k(2.0, mix({ rx: 2.7 }, K.down), "io"), k(2.5, mix({ rx: 2.7 }, K.hip), "io")]); }],
    [1.1, (c) => c.sfx("draw", 0.9)],
    [1.14, (c) => { c.sfx("slash_hit"); c.sfx("punch_heavy", 0.5); c.flash("#ffffff", 1); c.stop(0.3); c.fx.beam(c.at(c.A, -2.1, 1.2), c.at(c.A, 0.15, 1.2), "#ffffff", 0.01, 0.3); c.fx.sparks(c.D.center(), "#ffffff", 20, 4, 0.4); c.look(c.D, "glow", 0.25, "#ffdddd"); }],
    [1.5, (c) => { c.cam("wide", 2); c.slow(0.45, 1.6); }],
    [3.55, (c) => { c.sfx("star_hit", 0.55); c.fx.sparks(c.A.gripAt(c.A.mirrored ? "L" : "R"), "#ffffff", 6, 1.5, 0.2); c.shake(0.8); c.end("petals"); }],
    [3.8, (c) => c.title("IAIJUTSU")],
  ],
});
add({
  id: "samurai-twin", name: "Twin Fang", faction: "samurai", dur: 4.4,
  steps: [
    [0, (c) => { c.weapon(c.A, "katana", "wakizashi"); c.sfx("draw"); c.cam("side", 4);
      const L = (p: PP): PP => ({ ...p, wL: [0.2, 0.8, 0.5], uL: [0, -0.5, 0.8] });
      c.act(c.A, [
        k(0.2, L(mix({ rx: 0.35 }, K.raise, { hL: [0.3, 1.5, 0.25] })), "out"),
        k(0.34, L(mix({ rx: 0.5 }, K.cut, { hL: [0.25, 1.3, 0.2] })), "snap"),
        k(0.5, mix({ rx: 0.5, hR: [-0.2, 1.2, 0.4], wR: [0, -0.4, 0.9], hL: [0.4, 1.7, 0.0], wL: [-0.2, 0.6, -0.8], uL: [0, 0.8, 0.6], hipYaw: 0.3, spYaw: 0.3 }), "out"),
        k(0.62, mix({ rx: 0.55, hR: [-0.25, 1.2, 0.35], wR: [0, -0.4, 0.9], hL: [-0.15, 1.15, 0.6], wL: [-0.3, -0.5, 0.8], uL: [0, -0.8, -0.5], hipYaw: -0.4, spYaw: -0.3 }), "snap"),
        k(0.78, mix({ rx: 0.55, spin: -1.2 }, K.sideWind), "out"),
        k(1.0, mix({ rx: 0.6, spin: -Math.PI * 2 }, K.sideEnd), "snap"),
        k(1.2, mix({ rx: 0.6 }, K.sideEnd)),
        k(1.35, mix({ rx: 0.55, hip: [0, -0.25, 0] }, K.cut), "io"),
        k(1.55, mix({ rx: 0.65, ry: 0.15, hR: [0.0, 2.1, 0.3], hL: [0.3, 1.5, 0.2], wR: [0, 0.95, 0.3], uR: [0, -0.3, 1] }), "snap"),
        k(2.6, mix({ rx: 0.5 }, K.down), "io"),
      ]);
    }],
    [0.25, (c) => { const a = c.trail(c.A, "#ffd2c8", "R"), b = c.trail(c.A, "#ffd2c8", "L"); c.S.later(1.4, () => { a.stop(); b.stop(); }); }],
    [0.34, (c) => { c.hit(2, undefined, "CHEST"); dizzyHit(c); }],
    [0.62, (c) => { c.hit(2, undefined, "CHEST"); dizzyHit(c); }],
    [1.0, (c) => { c.hit(2, undefined, "BELLY"); dizzyHit(c); c.cam("closeD", 4); }],
    [1.55, (c) => { c.hit(3, undefined, "HEAD"); c.stop(0.15); c.flash(c.A.color, 0.8); c.act(c.D, [k(0.08, "launch", "snap")]); c.end("sky"); c.cam("sky", 2.5); }],
    [3.0, (c) => c.cam("wide", 2)],
    [3.1, (c) => c.title("TWIN FANG")],
  ],
});

// ── RONIN ─────────────────────────────────────────────────────────────────────
add({
  id: "ronin-storm", name: "Wandering Storm", faction: "ronin", dur: 4.8,
  steps: [
    [0, (c) => { c.weapon(c.A, "katana"); c.sfx("draw"); c.cam("high", 3);
      const spots: [number, number, number][] = [[0.8, 0.6, 0.6], [2.4, 0.5, Math.PI], [0.8, -0.65, -0.7], [2.42, -0.5, Math.PI + 0.6], [0.78, 0.0, 0]];   // a sword-length from the target, so the cut ends past the body
      const keys: Key[] = [k(0.2, mix({ rx: 0 }, K.guard), "out")];
      spots.forEach(([rx, rz, spin], i) => { const t0 = 0.3 + i * 0.32; keys.push(k(t0, mix({ rx, rz, spin }, K.sideWind)), k(t0 + 0.1, mix({ rx, rz, spin }, K.sideEnd), "snap"), k(t0 + 0.3, mix({ rx, rz, spin }, K.sideEnd))); });
      keys.push(k(1.9, mix({ rx: 0.78, spin: 0 }, K.sideEnd)), k(1.93, mix({ rx: 2.4, spin: 0 }, K.sideEnd), "snap"), k(2.2, mix({ rx: 2.4, spin: 0 }, K.sideEnd)),   // a flash-step through the target (never walks through the body)
         k(2.9, mix({ rx: 2.4 }, K.down), "io"), k(3.3, mix({ rx: 2.4 }, K.hip), "io"));
      c.act(c.A, keys);
    }],
    ...[0, 1, 2, 3, 4].map((i) => [0.3 + i * 0.32, (c: FinCtx) => { c.fx.smoke(c.A.center(), "#3a2a2a", 6, 0.45, true); c.sfx("smoke", 0.45); const tr = c.trail(c.A, "#ff9a8a"); c.S.later(0.28, () => tr.stop()); }] as [number, (c: FinCtx) => void]),
    ...[0, 1, 2, 3, 4].map((i) => [0.41 + i * 0.32, (c: FinCtx) => { c.hit(i === 4 ? 3 : 2, undefined, i % 2 ? "CHEST" : "BELLY"); dizzyHit(c); if (i === 4) { c.slow(0.35, 1.2); c.flash("#ffffff", 0.7); } }] as [number, (c: FinCtx) => void]),
    [1.9, (c) => { c.fx.smoke(c.A.center(), "#3a2a2a", 8, 0.5, true); c.sfx("vanish", 0.5); }],
    [2.0, (c) => c.cam("wide", 2)],
    [3.35, (c) => { c.shake(0.8); c.look(c.D, "char", 1); c.end("ash"); }],
    [3.7, (c) => c.title("WANDERING STORM")],
  ],
});
add({
  id: "ronin-sake", name: "Last Sake", faction: "ronin", dur: 4.8,
  steps: [
    [0, (c) => { c.weapon(c.A, "katana", "gourd"); c.sfx("draw", 0.6); c.cam("closeA", 3);
      c.act(c.A, [k(0.35, mix(K.down, { hL: [0.08, 1.62, 0.18], eL: [1, -0.3, 0], wL: [0, 0.6, -0.8], hdPitch: -0.45, spPitch: -0.15 }), "io"), k(0.95, mix(K.down, { hL: [0.08, 1.66, 0.14], eL: [1, -0.3, 0], wL: [0, 0.3, -0.95], hdPitch: -0.55, spPitch: -0.2 })),
        k(1.2, mix(K.down, { hL: [0.35, 1.2, 0.1], hdPitch: 0.05 }), "io"), k(1.45, mix(K.guard, { rx: 0.1 }), "io"), k(1.75, mix(K.raise, { rx: 0.25 }), "out"), k(2.25, mix(K.raise, { rx: 0.3 })), k(2.42, mix(K.cut, { rx: 0.55 }), "snap"), k(3.6, mix(K.cut, { rx: 0.55 })), k(4.2, mix(K.down, { rx: 0.4 }), "io")]);
    }],
    [1.25, (c) => { c.weapon(c.A, undefined, null); }],
    [1.5, (c) => { c.sfx("fire"); // spits fire over the raised blade
      for (let i = 0; i < 26; i++) c.S.later(i * 0.02, () => { const from = c.A.rig.part("HEAD").add(c.A.rig.forward().multiplyScalar(0.15)); c.fx.sprite(from, i % 2 ? "#ff7a1a" : "#ffd04a", rnd(0.07, 0.13), 0.4, { vel: c.A.rig.forward().multiplyScalar(2.8).add(V(rnd(-0.3, 0.3), 1.4, rnd(-0.3, 0.3))), grow: 1.8 }); });
    }],
    [1.8, (c) => { c.sfx("fire", 0.6); const tr = c.trail(c.A, "#ff6a1a"); c.S.later(2.0, () => tr.stop()); for (let i = 0; i < 60; i++) c.S.later(i * 0.035, () => c.fx.sprite(c.A.gripAt(c.A.mirrored ? "L" : "R").lerp(c.A.tip("R"), rnd(0.3, 1)), i % 2 ? "#ff5a10" : "#ffc040", rnd(0.05, 0.1), 0.35, { vel: V(0, 0.9, 0), grow: 1.4 })); c.cam("side", 3); }],
    [2.42, (c) => { c.hit(3, undefined, "HEAD"); c.stop(0.12); c.explode(c.D.center(), "#ff6a1a", 0.8); c.look(c.D, "char", 0.6); c.slow(0.4, 1.2); }],
    [3.3, (c) => { c.look(c.D, "char", 1); }],
    [3.6, (c) => { c.end("ash"); c.cam("wide", 2); }],
    [3.8, (c) => c.title("LAST SAKE")],
  ],
});

// ── ASHIGARU (foot soldiers: yari, teppo) ─────────────────────────────────────
add({
  id: "ashigaru-wall", name: "Spear Wall", faction: "ashigaru", dur: 4.6,
  steps: [
    [0, (c) => { c.weapon(c.A, "yari"); c.cam("wide", 3); c.act(c.A, [k(0.3, mix(pole.guard), "io"), k(0.55, mix(pole.overhead, { ry: 0.25 }), "out"), k(0.75, mix(pole.guard, { hR: [-0.05, 1.05, 0.25], hL: [0.05, 1.05, 0.55], wR: [0, -0.9, 0.35], uR: [0, 0.35, 0.9], hip: [0, -0.3, 0], spPitch: 0.35 }), "snap"), k(2.1, mix(pole.guard, { hR: [-0.05, 1.05, 0.25], hL: [0.05, 1.05, 0.55], wR: [0, -0.9, 0.35], uR: [0, 0.35, 0.9], hip: [0, -0.3, 0], spPitch: 0.35 })), k(2.4, mix(pole.guard), "io"), k(2.75, mix(pole.thrust, { rx: 0.45 }), "snap"), k(3.6, mix(pole.guard), "io")]); }],
    [0.75, (c) => { c.sfx("staff_hit"); c.sfx("punch_heavy", 0.5); c.shake(1.2); c.fx.groundRing(c.at(c.A, 0.6, 0), c.A.color, 1.2, 0.5); c.fx.seal(c.at(c.D, 0, 0.04), c.A.color, 1.8, 2.4, { ch: "槍", spin: 0.8 }); }],
    [1.0, (c) => { c.fx.spikes(c.at(c.D, 0, 0), c.A.color, 10, 0.55, 2.6, 1.15, 0.45); c.shake(1.5); lift(c.D, c, 0.8, 0.35); c.act(c.D, [k(0.1, mix(S.launch, { rx: 0, ry: 0, tumble: 0 }), "snap")]); c.cam("side", 3); }],
    [1.6, (c) => { c.fx.spikes(c.at(c.D, 0, 0), "#b6ffcf", 6, 0.35, 2.0, 1.35, 0.25); c.look(c.D, "glow", 0.35, c.A.color); }],
    [2.75, (c) => { c.hit(3, undefined, "CHEST", c.A.color); c.stop(0.15); c.flash(c.A.color, 0.8); c.cam("wide", 3); }],
    [2.95, (c) => { c.end("shatter"); c.shake(1.8); }],
    [3.5, (c) => c.title("SPEAR WALL")],
  ],
});
add({
  id: "ashigaru-volley", name: "Teppo Volley", faction: "ashigaru", dur: 4.4,
  steps: [
    [0, (c) => { c.weapon(c.A, "teppo"); c.cam("side", 3);
      const aim = { hR: [-0.1, 1.42, 0.3], eR: [-0.8, -0.6, -0.2], hL: "GRIP", eL: [0.6, -1, 0], wR: [0, 0.04, 1], uR: [0, 1, 0], hipYaw: -0.7, spYaw: -0.25, hdYaw: 0.55, hdPitch: 0.05 } as PP;
      const kick = { ...aim, hR: [-0.1, 1.5, 0.2], wR: [0, 0.3, 0.95], spPitch: -0.1 } as PP;
      c.act(c.A, [k(0.4, aim, "io"), k(0.9, aim), k(0.95, kick, "snap"), k(1.2, aim, "io"), k(1.55, aim), k(1.6, kick, "snap"), k(1.9, aim, "io"), k(2.3, aim), k(2.36, kick, "snap"), k(3.2, aim, "io")]);
    }],
    ...[0.95, 1.6, 2.36].map((t, i) => [t, (c: FinCtx) => {
      const muzzle = c.A.tip("R"); const tgt = c.D.rig.part(i === 2 ? "HEAD" : "CHEST");
      c.sfx("gunshot"); c.fx.flash(muzzle, "#ffd27a", 0.35, 0.08); c.fx.sprite(muzzle, "#fff1b0", 0.22, 0.06, { tex: "star", grow: 0.6 }); c.fx.smoke(muzzle, "#cfcfd6", 8, 0.35, true); c.fx.beam(muzzle, tgt, "#fff1b0", 0.012, 0.12);
      c.hit(i === 2 ? 3 : 2, tgt, i === 2 ? "HEAD" : "CHEST", undefined, "bullet"); c.shake(0.9 + i * 0.5);
      if (i < 2) dizzyHit(c); else { c.stop(0.12); c.slow(0.4, 1); c.act(c.D, [k(0.06, "launch", "snap"), k(0.4, "fall", "lin"), k(0.56, "down", "in"), k(0.7, "bounce", "out"), k(0.86, "down", "io")]); c.cam("wide", 2.5); }
    }] as [number, (c: FinCtx) => void]),
    [3.1, (c) => { c.end("dissolve", "#b6ffcf"); }],
    [3.3, (c) => c.title("TEPPO VOLLEY")],
  ],
});

// ── BUSHI (naginata) ──────────────────────────────────────────────────────────
const spinNag = (t0: number, n: number, rx: number): Key[] => { const out: Key[] = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 4; out.push(k(t0 + i * 0.07, { rx, hR: [-0.05, 1.45, 0.32], hL: "GRIP", wR: [Math.sin(a), Math.cos(a), 0.15], uR: [Math.cos(a), -Math.sin(a), 0], eR: [-1, -0.3, 0], eL: [1, -0.3, 0], hipYaw: -0.2, hdYaw: 0.2 }, "lin")); } return out; };
add({
  id: "bushi-crescent", name: "Crescent Moon", faction: "bushi", dur: 4.6,
  steps: [
    [0, (c) => { c.weapon(c.A, "naginata"); c.cam("wide", 3); c.act(c.A, [k(0.25, mix(pole.guard), "io"), ...spinNag(0.35, 14, 0.05), k(1.5, mix(pole.overhead, { rx: 0.1 }), "out"), k(1.68, mix(pole.guard, { rx: 0.35, hR: [-0.05, 1.1, 0.3], hL: [0.05, 1.15, 0.65], wR: [0, -0.3, 0.95], hip: [0, -0.22, 0], spPitch: 0.3 }), "snap"), k(3.2, mix(pole.guard, { rx: 0.35, hR: [-0.05, 1.1, 0.3], hL: [0.05, 1.15, 0.65], wR: [0, -0.3, 0.95], hip: [0, -0.22, 0], spPitch: 0.3 })), k(3.7, mix(pole.guard), "io")]); }],
    [0.35, (c) => { const tr = c.trail(c.A, "#ffe08a"); c.S.later(1.4, () => tr.stop()); }],
    [1.68, (c) => { c.sfx("wave"); // golden crescent wave
      const from = c.at(c.A, 0.7, 1.2), to = c.at(c.D, 0, 1.2); const dir = to.clone().sub(from);
      c.fx.ribbonCurve((u, t) => { const p = from.clone().addScaledVector(dir, Math.min(1, t / 0.35)); const a = (u - 0.5) * 2.6; return p.add(V(-Math.sign(dir.x) * Math.cos(a) * 0.35 + Math.sign(dir.x) * 0.35, Math.sin(a) * 0.7, 0)); }, "#ffd24a", 0.6, 60, 0.26);
      c.shake(1);
    }],
    [2.03, (c) => { c.hit(3, undefined, "CHEST", "#ffd24a"); c.stop(0.15); c.flash("#ffe7a0", 0.8); c.cam("closeD", 3); c.slow(0.5, 1.3); }],
    [2.1, (c) => { c.fx.animate(new THREE.Object3D(), 1.0, (_o, _t, u) => c.look(c.D, "gold", u)); c.act(c.D, [k(0.3, mix(S.dizzyA, { hdPitch: -0.2, spPitch: -0.1 }), "out")]); }],
    [3.3, (c) => { c.end("gold"); c.shake(1.4); c.cam("wide", 2); }],
    [3.6, (c) => c.title("CRESCENT MOON")],
  ],
});
add({
  id: "bushi-honor", name: "Code of Honor", faction: "bushi", dur: 4.4,
  steps: [
    [0, (c) => { c.weapon(c.A, "naginata"); c.cam("closeA", 3); c.act(c.A, [k(0.4, mix(S.tall, { hR: [-0.36, 1.15, 0.2], wR: [0, 1, 0.05], uR: [0, 0, 1] }), "io"), k(0.9, mix(S.bow, { hR: [-0.38, 1.1, 0.32], wR: [0, 1, 0.1] }), "io"), k(1.5, mix(S.bow, { hR: [-0.38, 1.1, 0.32], wR: [0, 1, 0.1] })), k(1.85, mix(pole.guard), "io"), k(2.1, mix(pole.guard, { rx: -0.1, hR: [-0.1, 1.25, -0.15], hL: [0.05, 1.3, 0.25] }), "out"), k(2.22, mix(pole.thrust, { rx: 0.55 }), "snap"), k(3.4, mix(pole.thrust, { rx: 0.55 })), k(3.9, mix(pole.guard), "io")]); }],
    [1.9, (c) => { c.cam("side", 4); c.fx.seal(c.at(c.A, 0, 0.04), "#ffd24a", 1.4, 1.2, { ch: "誠" }); }],
    [2.22, (c) => { c.sfx("zap", 0.8); const from = c.A.tip("R"); const to = from.clone().add(c.A.rig.forward().setY(0).normalize().multiplyScalar(8)); c.fx.beam(from, to, "#ffd24a", 0.03, 0.35); c.hit(3, undefined, "CHEST", "#ffd24a"); c.stop(0.12); c.flash("#fff1b0", 0.9); c.end("sky"); c.cam("sky", 2.5); }],
    [3.3, (c) => c.cam("wide", 2)],
    [3.3, (c) => c.title("CODE OF HONOR")],
  ],
});

// ── WARRIORS (kanabo, ono) ────────────────────────────────────────────────────
add({
  id: "warrior-earth", name: "Earthbreaker", faction: "warrior", dur: 4.6,
  steps: [
    [0, (c) => { c.weapon(c.A, "kanabo"); c.cam("low", 3); c.act(c.A, [k(0.35, mix(K.guard, { hip: [0, -0.2, 0] }), "io"), k(0.6, mix(K.raise, { hip: [0, -0.3, 0], spPitch: 0.1 }), "out"), k(1.0, mix(K.raise, { rx: 0.25, ry: 0.9, fL: [0.17, 0.6, 0.25], fR: [-0.16, 0.55, -0.1], kL: [0, 0.5, 1], kR: [0, 0.5, 1] }), "out"), k(1.25, mix(K.cut, { rx: 0.45, ry: 0, hip: [0, -0.35, 0.05], hR: [0, 0.55, 0.8], wR: [0, -0.9, 0.4] }), "in"), k(2.8, mix(K.cut, { rx: 0.45, hip: [0, -0.35, 0.05], hR: [0, 0.55, 0.8], wR: [0, -0.9, 0.4] })), k(3.3, mix(K.down, { rx: 0.4 }), "io")]); }],
    [1.25, (c) => { c.sfx("punch_heavy"); const p = c.A.tip("R").setY(0.05); c.explode(p, "#c9a27a", 0.8); c.fx.dust(p, 2.2); c.fx.rocks(c.at(c.D, 0, 0), 12, 0.6, 2.6); c.act(c.D, [k(0.06, mix(S.launch, { rx: -0.2, ry: 0.5, tumble: -0.3 }), "snap"), k(0.5, mix(S.dizzyA, { rx: -0.25, ry: 0 }), "in")]); c.cam("wide", 3); }],
    [1.6, (c) => c.fx.rocks(c.at(c.D, 0, 0), 9, 0.35, 2.2, "#5a4d42")],
    [2.4, (c) => { c.end("sink"); c.shake(1); }],
    [3.3, (c) => c.title("EARTHBREAKER")],
  ],
});
add({
  id: "warrior-whirl", name: "Whirlwind", faction: "warrior", dur: 4.4,
  steps: [
    [0, (c) => { c.weapon(c.A, "ono"); c.cam("wide", 3);
      const keys: Key[] = [k(0.3, mix(K.sideWind, { hL: [0.3, 1.4, 0.2] }), "out")];
      for (let i = 0; i <= 12; i++) keys.push(k(0.4 + i * 0.1, mix(K.sideEnd, { spin: -(i + 1) * Math.PI * 0.5, rx: 0.1 + i * 0.05, hR: [0.1, 1.4, 0.75], wR: [1, 0.15, 0.2], hL: [-0.3, 1.5, -0.1] }), "lin"));
      keys.push(k(1.9, mix(K.sideEnd, { spin: -7 * Math.PI, rx: 0.75 }), "out"), k(2.6, mix(K.down, { rx: 0.6 }), "io"));
      c.act(c.A, keys);
    }],
    [0.4, (c) => { c.fx.tornado(() => c.A.rig.root.position.clone(), c.A.color, 1.7, 2.4); const tr = c.trail(c.A, "#ffc28a"); c.S.later(1.5, () => tr.stop()); }],
    ...[0.9, 1.1, 1.3, 1.5].map((t) => [t, (c: FinCtx) => { c.hit(2, undefined, "CHEST"); dizzyHit(c); }] as [number, (c: FinCtx) => void]),
    [1.85, (c) => { c.hit(3, undefined, "HEAD"); c.stop(0.12); c.flash(c.A.color, 0.7); c.end("sky"); c.cam("sky", 2.5); }],
    [3.0, (c) => c.cam("wide", 2)],
    [3.1, (c) => c.title("WHIRLWIND")],
  ],
});

// ── SHOGUN (command, war fan) ─────────────────────────────────────────────────
add({
  id: "shogun-decree", name: "Imperial Decree", faction: "shogun", dur: 4.6,
  steps: [
    [0, (c) => { c.weapon(c.A, null, "scroll"); c.sfx("fan", 0.6); c.cam("closeA", 3); c.act(c.A, [k(0.45, mix(S.tall, { hL: [0.42, 1.48, 0.5], eL: [1, -0.6, 0], wL: [0, 1, 0], uL: [0, 0, 1], hdPitch: 0.1 }), "io"), k(1.3, mix(S.tall, { hL: [0.42, 1.48, 0.5], eL: [1, -0.6, 0], wL: [0, 1, 0], uL: [0, 0, 1] })), k(1.55, mix(S.tall, { hL: [0.3, 1.3, 0.1], wL: [0, 1, 0], hR: [-0.05, 2.3, 0.35], eR: [-1, 0, 0.3], hdPitch: -0.25 }), "snap"), k(3.6, mix(S.tall, { hL: [0.3, 1.3, 0.1], wL: [0, 1, 0], hR: [-0.05, 2.3, 0.35], eR: [-1, 0, 0.3], hdPitch: -0.25 }))]); }],
    [1.55, (c) => { c.cam("wide", 3); c.fx.seal(c.at(c.D, 0, 2.35), c.A.color, 1.6, 2.4, { ch: "勅", normal: V(0, -0.55, 0.85).normalize(), spin: 1.5 }); c.flash(c.A.color, 0.4); }],
    ...[1.9, 2.15, 2.35, 2.5, 2.62].map((t, i) => [t, (c: FinCtx) => { const tgt = c.D.rig.part(i % 2 ? "CHEST" : "HEAD"); c.fx.lightning(c.at(c.D, rnd(-0.3, 0.3), 2.35), tgt, i % 2 ? "#e9d5ff" : c.A.color, 0.25); c.fx.flash(tgt, c.A.color, 0.45, 0.12); c.hit(2, tgt, "CHEST", c.A.color, "none"); c.sfx("zap", 0.7); c.flash(c.A.color, 0.35); dizzyHit(c); c.look(c.D, "glow", 0.2 + i * 0.15, c.A.color); }] as [number, (c: FinCtx) => void]),
    [2.6, (c) => { c.cam("closeD", 3); c.slow(0.5, 0.8); }],
    [3.1, (c) => { c.fx.lightning(c.at(c.D, 0, 4), c.at(c.D, 0, 0), "#ffffff", 0.35); c.explode(c.D.center(), c.A.color, 0.8); c.end("dissolve"); c.cam("wide", 2); }],
    [3.5, (c) => c.title("IMPERIAL DECREE")],
  ],
});
add({
  id: "shogun-dragon", name: "Dragon Fan", faction: "shogun", dur: 4.6,
  steps: [
    [0, (c) => { c.weapon(c.A, "tessen"); c.cam("wide", 3); c.act(c.A, [k(0.35, mix(K.sideWind, { wR: [-0.2, 1, 0.1], uR: [0, 0, 1], hL: [0.25, 1.3, 0.1] }), "out"), k(0.62, mix(K.sideEnd, { wR: [0.3, 1, 0.3], uR: [-1, 0, 0], hR: [0.25, 1.6, 0.55] }), "snap"), k(1.2, mix(S.tall, { hR: [-0.1, 2.25, 0.3], wR: [0, 1, 0.1], uR: [0, 0, 1], eR: [-1, 0, 0.3], hdPitch: -0.25 }), "out"), k(3.4, mix(S.tall, { hR: [-0.1, 2.25, 0.3], wR: [0, 1, 0.1], uR: [0, 0, 1], eR: [-1, 0, 0.3], hdPitch: -0.25 }))]); }],
    [0.62, (c) => { c.sfx("fan"); c.sfx("dragon"); const D = c.D; const c0 = () => D.rig.root.position.clone();
      c.fx.ribbonCurve((u, t) => { const head = Math.min(1, t / 1.4); const s = head - u * 0.55; const a = s * Math.PI * 5; const r = 0.9 - Math.max(0, s) * 0.35; const p = c0(); return V(p.x + Math.cos(a) * r, 0.2 + Math.max(0, s) * 2.8, p.z + Math.sin(a) * r); }, c.A.color, 2.6, 90, 0.34);
      c.shake(0.8); c.cam("low", 2.5);
    }],
    [1.3, (c) => { lift(c.D, c, 1.4, 0.7, 0.8); c.act(c.D, [k(0.2, mix(S.launch, { rx: 0, ry: 0, tumble: -0.2 }), "out")]); c.look(c.D, "glow", 0.4, c.A.color); }],
    [2.8, (c) => { c.explode(c.D.center(), c.A.color, 0.9); c.end("dissolve"); }],
    [3.0, (c) => c.cam("wide", 2)],
    [3.4, (c) => c.title("DRAGON FAN")],
  ],
});

// ── BUKE (archers) ────────────────────────────────────────────────────────────
const BOW = { hL: [0.12, 1.58, 0.62], eL: [1, -0.3, 0], wL: [0, 1, 0.05], uL: [0, 0, 1], hipYaw: -0.85, spYaw: -0.35, hdYaw: 0.9, fL: [0.2, 0.15, 0.32], fR: [-0.16, 0.15, -0.32] } as PP;
const DRAW = { ...BOW, hR: [0.06, 1.62, -0.02], eR: [-1, 0.2, -0.6], wR: [0.04, 0.0, 1], uR: [0, 1, 0] } as PP;
add({
  id: "buke-arrow", name: "Piercing Arrow", faction: "buke", dur: 4.4,
  steps: [
    [0, (c) => { c.weapon(c.A, "arrow", "yumi"); c.cam("overA", 3); const B = { rx: -0.55 }; c.act(c.A, [k(0.35, mix(BOW, B, { hR: [0.08, 1.58, 0.5], wR: [0.04, 0, 1], uR: [0, 1, 0] }), "io"), k(1.0, mix(DRAW, B), "io"), k(1.6, mix(DRAW, B)), k(1.66, mix(BOW, B, { hR: [-0.15, 1.65, -0.15], eR: [-1, 0.2, -0.6] }), "snap"), k(3.2, mix(BOW, B, { hR: [-0.15, 1.65, -0.15] }))]); }],
    [0.4, (c) => c.sfx("bow_draw")],
    [0.9, (c) => { c.S.follow(c.fx.glowSprite(c.A.color, 0.28), () => c.A.tip("R"), 0.8); c.fx.seal(c.at(c.A, 0, 0.04), c.A.color, 1.2, 1.0, { ch: "射" }); }],
    [1.66, (c) => { c.sfx("bow_release"); c.weapon(c.A, null); const from = c.A.gripAt(c.A.mirrored ? "L" : "R"); const ar = makeWeapon("arrow", c.A.color); const tgt = () => c.D.rig.part("CHEST"); c.slow(0.25, 0.9);
      c.fx.projectile(ar, from, tgt, 0.45, { face: true, trail: c.A.color, keep: 0.6, arrive: () => { c.hit(3, tgt(), "CHEST", c.A.color, "arrow"); c.sfx("punch_heavy", 0.5); c.stop(0.15); c.flash(c.A.color, 0.8); c.fx.beam(tgt(), tgt().add(c.A.rig.forward().setY(0).normalize().multiplyScalar(6)), c.A.color, 0.016, 0.3); } });
      const mid = from.clone().lerp(c.D.rig.part("CHEST"), 0.5); c.cam({ pos: mid.clone().add(V(0, 0.25, 1.3)), look: c.D.rig.part("CHEST"), fov: 40 }, 3);
    }],
    [2.3, (c) => { c.end("shatter"); c.shake(1.6); c.cam("wide", 2); }],
    [3.0, (c) => c.title("PIERCING ARROW")],
  ],
});
add({
  id: "buke-rain", name: "Rain of a Hundred", faction: "buke", dur: 4.7,
  steps: [
    [0, (c) => { c.weapon(c.A, "arrow", "yumi"); c.cam("wide", 3); const up = { wL: [0, 0.6, 0.8], hL: [0.1, 2.05, 0.4], uL: [0, -0.8, 0.6], hdPitch: -0.5, spPitch: -0.25 } as PP;
      c.sfx("bow_draw", 0.8); const B = { rx: -0.45 }; c.act(c.A, [k(0.35, mix(BOW, up, B, { hR: [0.06, 1.9, 0.3], wR: [0.02, 0.6, 0.8] }), "io"), k(0.95, mix(DRAW, up, B, { hR: [0.04, 1.7, 0.0], wR: [0.02, 0.6, 0.8] }), "io"), k(1.0, mix(BOW, up, B, { hR: [-0.4, 1.62, 0.0] }), "snap"), k(3.6, mix(BOW, up, B, { hR: [-0.42, 1.6, 0.02] }))]); }],
    [1.0, (c) => { c.sfx("bow_release"); c.weapon(c.A, null); const ar = makeWeapon("arrow", c.A.color); const from = c.A.gripAt(c.A.mirrored ? "L" : "R"); c.fx.projectile(ar, from, () => c.at(c.A, 0.6, 7), 0.5, { face: true, trail: c.A.color }); c.cam("sky", 2); }],
    [1.6, (c) => { c.cam("high", 3); c.fx.seal(c.at(c.D, 0, 0.04), c.A.color, 2.2, 2.6, { ch: "雨" });
      for (let i = 0; i < 34; i++) c.S.later(i * 0.035, () => { const a = rnd(0, Math.PI * 2), r = i % 3 === 0 ? rnd(0, 0.18) : rnd(0.15, 0.9); const land = c.at(c.D, Math.cos(a) * r, i % 3 === 0 ? rnd(0.4, 1.6) : 0.02, Math.sin(a) * r * 0.6);
        const ar = makeWeapon("arrow", c.A.color); c.fx.projectile(ar, land.clone().add(V(rnd(-0.6, 0.6), 6, rnd(-0.4, 0.4))), () => land, 0.35, { face: true, trail: i % 4 ? undefined : c.A.color, keep: 2.6 - i * 0.03, quiet: 0.45, arrive: () => { c.fx.sparks(land, "#e6ffd0", 4, 1.2, 0.15); if (i % 3 === 0) { c.hit(1, land, "CHEST", c.A.color, "arrow"); dizzyHit(c); } } }); });
    }],
    [2.9, (c) => { c.act(c.D, [k(0.4, "kneel", "in")]); c.cam("closeD", 3); }],
    [3.5, (c) => { c.end("dissolve"); c.cam("wide", 2); }],
    [3.6, (c) => c.title("RAIN OF A HUNDRED")],
  ],
});

// ── WOKOU (pirates) ───────────────────────────────────────────────────────────
add({
  id: "wokou-keg", name: "Powder Keg", faction: "wokou", dur: 4.7,
  steps: [
    [0, (c) => { c.weapon(c.A, "keg"); c.cam("wide", 3); c.act(c.A, [k(0.35, mix(S.throwWind, { hR: [-0.3, 1.2, -0.3], hip: [0, -0.2, 0] }), "out"), k(0.62, mix(S.throwRel, { hR: [0.0, 0.9, 0.65], hip: [0, -0.3, 0.05], spPitch: 0.4 }), "snap"), k(1.2, mix(S.tall, { rx: -0.35, hR: [-0.25, 1.5, 0.2], hL: [0.25, 1.55, 0.2] }), "io"), k(2.0, mix(S.tall, { rx: -0.5, hR: [-0.12, 1.75, 0.0], hL: [0.12, 1.75, 0.0], hdPitch: 0.2, spPitch: 0.15 }), "io"), k(3.2, mix(S.tall, { rx: -0.5, hR: [-0.12, 1.75, 0.0], hL: [0.12, 1.75, 0.0] }))]); }],
    [0.62, (c) => { c.weapon(c.A, null); const b = makeWeapon("keg"); const from = c.A.gripAt(c.A.mirrored ? "L" : "R"); const land = c.at(c.D, 0.42, 0.0, 0.18);
      c.fx.projectile(b, from, () => land, 0.55, { arc: 0.35, spin: V(0, 0, -9), keep: 1.6, arrive: () => { b.rotation.set(0, 0, 0); c.sfx("staff_hit", 0.5); c.cam({ pos: c.at(c.D, 1.6, 0.55, 2.1), look: c.at(c.D, 0.2, 0.45), fov: 42 }, 3); } });
      for (let i = 0; i < 40; i++) c.S.later(0.55 + i * 0.04, () => c.fx.sprite(b.localToWorld(V(0.035, 0.42, 0)), i % 2 ? "#ffd04a" : "#ff8a3a", 0.05, 0.22, { vel: V(rnd(-0.4, 0.4), 0.8, rnd(-0.4, 0.4)), grow: 0.5 }));
    }],
    [1.15, (c) => c.sfx("fuse")],
    [1.3, (c) => c.act(c.D, [k(0.3, mix(S.dizzyA, { hdPitch: 0.7, spPitch: 0.4, hdYaw: 0 }), "io"), k(1.0, mix(S.dizzyA, { hdPitch: 0.75, spPitch: 0.45, hdYaw: 0.05 }))])],
    [2.25, (c) => { c.act(c.D, [k(0.2, mix(S.dizzyA, { hdPitch: -0.2, spPitch: -0.1, hL: [0.3, 1.7, 0.4], hR: [-0.3, 1.7, 0.4] }), "snap")]); }],
    [2.6, (c) => { c.explode(c.at(c.D, 0.3, 0.4), "#ff7a1a", 1.4); c.end("sky"); c.cam("sky", 2.5); }],
    [3.6, (c) => c.cam("wide", 2)],
    [3.6, (c) => c.title("POWDER KEG")],
  ],
});
function tentacle(c: FinCtx, base: THREE.Vector3, phase: number, life: number, color: string) {
  const n = 40; const geo = new THREE.SphereGeometry(1, 10, 8); const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(color), emissiveIntensity: 0.15 });
  const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; im.castShadow = true; const M = new THREE.Matrix4(), q = new THREE.Quaternion();
  const ctr = () => c.D.rig.root.position.clone();
  c.fx.animate(im, life, (_o, t, u) => {
    const grow = Math.min(1, t / 0.6), pull = u > 0.62 ? (u - 0.62) / 0.38 : 0;
    for (let i = 0; i < n; i++) { const s = i / (n - 1); const reach = s * grow;
      const ce = ctr(); const a = phase + reach * 5 + t * 2; const r = 0.42 * (1 - reach * 0.4);
      const p = V(base.x + (ce.x - base.x) * reach, reach * 2.0 - pull * 2.2, base.z + (ce.z - base.z) * reach).add(V(Math.cos(a) * r * reach, 0, Math.sin(a) * r * reach));
      const rad = 0.13 * (1 - s * 0.8) * Math.min(1, grow * 1.5); M.compose(p, q, V(rad, rad, rad)); im.setMatrixAt(i, M); }
    im.instanceMatrix.needsUpdate = true;
  });
}
add({
  id: "wokou-kraken", name: "Kraken's Grip", faction: "wokou", dur: 4.7,
  steps: [
    [0, (c) => { c.weapon(c.A, "cutlass"); c.sfx("draw", 0.8); c.cam("wide", 3); c.act(c.A, [k(0.4, mix(K.down, { wR: [0, 1, 0.2], hR: [-0.15, 2.25, 0.25], eR: [-1, 0, 0.3], hdPitch: -0.2 }), "out"), k(1.0, mix(K.down, { wR: [0, 1, 0.2], hR: [-0.15, 2.3, 0.25], eR: [-1, 0, 0.3], hdPitch: -0.2 })), k(1.2, mix(K.down, { wR: [0, -0.6, 0.8], hR: [-0.05, 1.0, 0.5], spPitch: 0.3 }), "snap"), k(3.6, mix(K.down, { wR: [0, -0.6, 0.8], hR: [-0.05, 1.0, 0.5], spPitch: 0.3 }))]); }],
    [1.2, (c) => { c.sfx("splash"); c.shake(1); c.fx.seal(c.at(c.D, 0, 0.04), "#2aa8ff", 2.2, 3.2, { ch: "海", spin: -1 }); c.fx.groundRing(c.at(c.D, 0, 0), "#2aa8ff", 2.2, 1.2); for (let i = 0; i < 24; i++) c.fx.sprite(c.at(c.D, rnd(-0.6, 0.6), 0.1, rnd(-0.4, 0.4)), "#7fd0ff", rnd(0.15, 0.3), 0.8, { vel: V(rnd(-0.6, 0.6), rnd(2, 3.5), rnd(-0.4, 0.4)), grow: 0.6 }); c.cam("low", 3); }],
    [1.35, (c) => { c.sfx("tentacle"); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; tentacle(c, c.at(c.D, Math.cos(a) * 0.75, 0, Math.sin(a) * 0.5), a, 3.0, i % 2 ? "#6b2d7a" : "#8a3a8f"); } }],
    [1.9, (c) => { c.act(c.D, [k(0.3, mix(S.launch, { rx: 0, ry: 0.15, tumble: 0.0, hL: [0.5, 2.0, 0.2], hR: [-0.5, 2.0, 0.1] }), "out")]); lift(c.D, c, 0.6, 0.3); }],
    [3.0, (c) => { c.end("sink"); c.sfx("splash", 0.9); for (let i = 0; i < 30; i++) c.fx.sprite(c.at(c.D, rnd(-0.5, 0.5), 0.1, rnd(-0.3, 0.3)), "#9fe0ff", rnd(0.15, 0.35), 1.0, { vel: V(rnd(-1, 1), rnd(2.5, 4.5), rnd(-0.6, 0.6)), grow: 0.8 }); c.cam("wide", 2); }],
    [3.6, (c) => c.title("KRAKEN'S GRIP")],
  ],
});

// ── SOHEI (warrior monks: bo staff, temple bell) ──────────────────────────────
add({
  id: "sohei-strikes", name: "Thousand Strikes", faction: "sohei", dur: 4.4,
  steps: [
    [0, (c) => { c.weapon(c.A, "bo"); c.cam("side", 3);
      const keys: Key[] = [k(0.3, mix(pole.guard, { rx: 0.2 }), "io")];
      for (let i = 0; i < 9; i++) { const t0 = 0.4 + i * 0.12; const hi = i % 3; const y = [1.65, 1.3, 1.05][hi];
        keys.push(k(t0, mix(pole.guard, { rx: 0.25, hR: [-0.1, 1.2, 0.0], hipYaw: -0.4 })), k(t0 + 0.06, mix(pole.thrust, { rx: 0.3, hR: [-0.02, y - 0.04, 0.5], wR: [0, (y - 1.3) * 0.25, 1], tipW: 1, tipAt: (["HEAD", "CHEST", "BELLY"] as const)[hi] }), "snap"), k(t0 + 0.1, mix(pole.thrust, { rx: 0.27, hR: [-0.02, y - 0.04, 0.45], wR: [0, (y - 1.3) * 0.25, 1], tipW: 1, tipAt: (["HEAD", "CHEST", "BELLY"] as const)[hi] }))); }
      keys.push(k(1.65, mix(pole.overhead, { rx: 0.3 }), "out"), k(1.85, mix(pole.guard, { rx: 0.55, spin: -Math.PI * 2, hR: [-0.3, 1.4, 0.4], wR: [1, 0.1, 0.2], uR: [0, 0, -1] }), "snap"), k(3.2, mix(pole.guard, { rx: 0.4 }), "io"));
      c.act(c.A, keys);
    }],
    ...Array.from({ length: 9 }, (_, i) => [0.46 + i * 0.12, (c: FinCtx) => { c.hit(i % 3 === 0 ? 2 : 1, c.A.tip("R"), ["HEAD", "CHEST", "BELLY"][i % 3] as any); dizzyHit(c); }] as [number, (c: FinCtx) => void]),
    [1.85, (c) => { c.hit(3, undefined, "HEAD"); c.stop(0.14); c.flash("#ffe6b0", 0.8); c.slow(0.45, 1.2); c.act(c.D, [k(0.06, "launch", "snap"), k(0.4, "fall", "lin"), k(0.56, "down", "in"), k(0.7, "bounce", "out"), k(0.86, "down", "io")]); c.cam("wide", 2.5); }],
    [3.2, (c) => { c.end("dissolve", "#ffe6b0"); }],
    [3.3, (c) => c.title("THOUSAND STRIKES")],
  ],
});
function bell(): THREE.Group {
  const pts: THREE.Vector2[] = []; for (let i = 0; i <= 20; i++) { const u = i / 20; pts.push(new THREE.Vector2(0.45 + 0.28 * Math.pow(u, 3) - 0.08 * Math.sin(u * Math.PI), 1.7 * (1 - u))); }
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: "#8a5a2b", metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), m); body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 20), m); top.position.y = 1.82; g.add(top);
  for (let r = 0; r < 4; r++) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), m); knob.position.set(Math.cos(a) * (0.46 + r * 0.005), 1.45 - r * 0.12, Math.sin(a) * 0.46); g.add(knob); }
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 40), m); band.rotation.x = Math.PI / 2; band.position.y = 0.35; g.add(band);
  return g;
}
add({
  id: "sohei-bell", name: "Temple Bell", faction: "sohei", dur: 4.3,
  steps: [
    [0, (c) => { c.cam("wide", 3); c.act(c.A, [k(0.5, mix(S.tall, { hL: [0.03, 1.55, 0.25], hR: [-0.03, 1.55, 0.25], eL: [1, -0.4, 0], eR: [-1, -0.4, 0], fist: 0, hdPitch: 0.25 }), "io"), k(1.6, mix(S.tall, { hL: [0.03, 1.57, 0.25], hR: [-0.03, 1.57, 0.25], eL: [1, -0.4, 0], eR: [-1, -0.4, 0], fist: 0, hdPitch: 0.3 })), k(1.8, mix(S.tall, { hR: [-0.1, 2.3, 0.35], eR: [-1, 0, 0.3], hL: [0.03, 1.55, 0.25], fist: 0, hdPitch: -0.3 }), "snap"), k(3.8, mix(S.tall, { hR: [-0.1, 2.3, 0.35], eR: [-1, 0, 0.3], hL: [0.03, 1.55, 0.25], fist: 0 }))]); c.fx.seal(c.at(c.A, 0, 0.04), "#ffd27a", 1.3, 1.6, { ch: "鐘" }); }],
    [1.3, (c) => { c.sfx("bell_fall"); const b = bell(); const x = c.D.rig.root.position.clone(); b.scale.setScalar(1.15); c.cam("low", 2.5);
      c.fx.animate(b, 2.6, (o, t) => { const drop = Math.min(1, t / 0.45); o.position.set(x.x, 7 * (1 - drop * drop), x.z); if (t > 1.6) o.position.y = (t - 1.6) * (t - 1.6) * 8; if (t > 2.3) o.scale.setScalar(1.15 * (1 - (t - 2.3) / 0.3)); });
    }],
    [1.75, (c) => { c.sfx("bell"); c.D.rig.model.visible = false; c.shake(3); c.flash("#ffe6b0", 0.6); for (let i = 0; i < 3; i++) c.S.later(i * 0.18, () => { c.fx.groundRing(c.at(c.D, 0, 0), "#ffd27a", 3.5 + i, 0.9); c.fx.ring(c.at(c.D, 0, 1.0), "#ffd27a", 2.2 + i * 0.6, 0.6); }); c.fx.dust(c.at(c.D, 0, 0), 2.4); }],
    [2.9, (c) => { c.end("dissolve", "#ffe6b0"); c.cam("wide", 2); }],
    [3.1, (c) => c.title("TEMPLE BELL")],
  ],
});

// ── YAMABUSHI (mountain mystics: shakujo, conch) ──────────────────────────────
add({
  id: "yamabushi-seal", name: "Mountain Seal", faction: "yamabushi", dur: 4.8,
  steps: [
    [0, (c) => { c.weapon(c.A, "shakujo"); c.cam("wide", 3); c.act(c.A, [k(0.4, mix(S.tall, { hR: [-0.25, 1.6, 0.25], wR: [0, 1, 0.05], uR: [0, 0, 1], hL: [0.05, 1.5, 0.3], fist: 0 }), "io"), k(0.7, mix(S.tall, { ry: 0.12, hR: [-0.25, 1.85, 0.25], wR: [0, 1, 0.05], uR: [0, 0, 1], hL: [0.05, 1.5, 0.3], fist: 0 }), "out"), k(0.85, mix(S.tall, { hip: [0, -0.15, 0], hR: [-0.25, 1.3, 0.3], wR: [0, 1, 0.05], uR: [0, 0, 1], hL: [0.05, 1.5, 0.3], fist: 0 }), "snap"), k(3.6, mix(S.tall, { hip: [0, -0.15, 0], hR: [-0.25, 1.3, 0.3], wR: [0, 1, 0.05], uR: [0, 0, 1], hL: [0.05, 1.55, 0.3], fist: 0, hdPitch: 0.15 }))]); }],
    [0.85, (c) => { c.sfx("staff_hit"); c.sfx("star_hit", 0.6); c.shake(1); c.fx.groundRing(c.at(c.A, 0, 0), c.A.color, 1.5, 0.6); c.fx.seal(c.at(c.D, 0, 0.04), c.A.color, 2.2, 3.4, { ch: "封", spin: 1 }); c.cam("closeD", 2.5); }],
    [1.3, (c) => { c.fx.seal(c.at(c.D, -0.15, 1.75, 0.45), c.A.color, 0.65, 2.6, { ch: "山", normal: V(0, 0, 1), spin: -2 }); c.fx.seal(c.at(c.D, 0.15, 0.7, 0.45), c.A.color, 0.55, 2.4, { ch: "岩", normal: V(0, 0, 1), spin: 2 }); c.act(c.D, [k(0.3, mix(S.dizzyA, { hdPitch: -0.3, spPitch: -0.2, hL: [0.45, 1.6, 0.3], hR: [-0.45, 1.6, 0.3] }), "out")]); }],
    [1.6, (c) => { c.sfx("stone", 0.55); c.fx.animate(new THREE.Object3D(), 1.3, (_o, _t, u) => c.look(c.D, "stone", u)); c.slow(0.6, 1.4); }],
    [3.2, (c) => { c.flash(c.A.color, 0.6); c.shake(1.6); c.end("stone"); c.cam("wide", 2); }],
    [3.6, (c) => c.title("MOUNTAIN SEAL")],
  ],
});
add({
  id: "yamabushi-tengu", name: "Tengu Gale", faction: "yamabushi", dur: 4.8,
  steps: [
    [0, (c) => { c.weapon(c.A, "conch"); c.cam("closeA", 3); c.act(c.A, [k(0.45, mix(S.tall, { hR: [-0.02, 1.7, 0.18], eR: [-1, -0.4, 0], wR: [0, 0.15, 1], uR: [0, 1, 0], hL: [0.06, 1.65, 0.3], hdPitch: -0.1, spPitch: -0.1 }), "io"), k(3.5, mix(S.tall, { hR: [-0.02, 1.72, 0.18], eR: [-1, -0.4, 0], wR: [0, 0.2, 1], uR: [0, 1, 0], hL: [0.06, 1.67, 0.3], hdPitch: -0.15, spPitch: -0.15 }))]); }],
    [0.45, (c) => c.sfx("conch")],
    [0.6, (c) => { for (let i = 0; i < 4; i++) c.S.later(i * 0.15, () => c.fx.ring(c.A.tip("R"), "#e8fff8", 0.35 + i * 0.2, 0.45, c.A.rig.forward())); c.shake(0.6); }],
    [1.0, (c) => { c.fx.tornado(() => c.D.rig.root.position.clone(), c.A.color, 2.6, 3.2); c.cam("low", 2.5); }],
    [1.4, (c) => { lift(c.D, c, 1.6, 1.6, 2.5); c.act(c.D, [k(0.3, mix(S.launch, { rx: 0, ry: 0, tumble: -0.3 }), "out")]); }],
    [3.0, (c) => { c.end("sky"); c.cam("sky", 2.5); }],
    [3.8, (c) => c.cam("wide", 2)],
    [3.8, (c) => c.title("TENGU GALE")],
  ],
});

/** a stable pick for non-interactive matches (PvP replays, the AI) */
export function pickFinisher(faction: string, seed: number): Finisher { const l = finishersFor(faction); return l[Math.abs(Math.floor(seed)) % l.length]; }
export type { Vec3 };
