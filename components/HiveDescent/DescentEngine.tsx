// components/HiveDescent/DescentEngine.tsx
// Phase B engine: r3f scene, third-person ant, scout beetle AI, click-to-attack.
// All entity state lives in refs; React state is only used for HUD-visible numbers.

import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import HUD from "./HUD";
import MobileControls, { type DescentInput } from "./MobileControls";
import FactionCharacter from "./FactionCharacter";
import type { Biome } from "./biomes";
import { ENEMIES, spawnCountForFloor, type EnemyKind } from "./enemies";
import {
  BASE_MAX_HP,
  BASE_MOVE_SPEED,
  BASE_ATTACK_DAMAGE,
  BASE_ATTACK_SPEED,
  DESCENT_TOTAL_FLOORS,
  DESCENT_FACTIONS,
} from "../../lib/descentConfig";

// =================================================================
// Types
// =================================================================

type Vec3 = { x: number; y: number; z: number };

type PlayerRef = {
  pos: Vec3;
  vel: Vec3;
  facing: number;          // radians
  hp: number;
  maxHp: number;
  lastAttackAt: number;
  specialReadyAt: number;
  dodgeReadyAt: number;
  iframesUntil: number;
  alive: boolean;
  rebelEarned: number;
};

type EnemyRef = {
  id: number;
  kind: EnemyKind;
  pos: Vec3;
  vel: Vec3;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  state: "idle" | "chase" | "attack" | "dead";
  lastAttackAt: number;
  meshRef?: THREE.Object3D | null;
  hitFlashUntil: number;
};

type Props = {
  factionId: string;
  floor: number;
  biome: Biome;
  onFloorComplete: (rebelEarned: number) => void;
  onDeath: () => void;
  onAbandon: () => void;
};

// =================================================================
// Procedural Ant character (low-poly, mythic)
// =================================================================

const AntCharacter: React.FC<{ groupRef: React.MutableRefObject<THREE.Group | null>; factionColor: string }> = ({ groupRef, factionColor }) => {
  const legSwingRef = useRef(0);
  // Refs to leg groups for the walk-cycle animation
  const legsRef = useRef<THREE.Group[]>([]);
  useFrame((_, dt) => {
    legSwingRef.current += dt * 9;
    const s = Math.sin(legSwingRef.current);
    legsRef.current.forEach((leg, i) => {
      if (!leg) return;
      const phase = (i % 2 === 0 ? 1 : -1);
      leg.rotation.x = s * 0.6 * phase;
    });
  });
  return (
    <group ref={(g) => { groupRef.current = g; }}>
      {/* Abdomen (rear) */}
      <mesh position={[0, 0.55, -0.55]} castShadow>
        <sphereGeometry args={[0.45, 16, 12]} />
        <meshStandardMaterial color={"#1a0d05"} roughness={0.4} metalness={0.3} />
      </mesh>
      {/* Thorax (middle) */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <sphereGeometry args={[0.34, 16, 12]} />
        <meshStandardMaterial color={factionColor} roughness={0.35} metalness={0.5} emissive={factionColor} emissiveIntensity={0.15} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.65, 0.5]} castShadow>
        <sphereGeometry args={[0.3, 16, 12]} />
        <meshStandardMaterial color={"#0e0703"} roughness={0.3} metalness={0.4} />
      </mesh>
      {/* Mandibles */}
      <mesh position={[-0.13, 0.58, 0.78]} rotation={[0, 0, -0.4]} castShadow>
        <coneGeometry args={[0.05, 0.18, 8]} />
        <meshStandardMaterial color={"#ffeecc"} roughness={0.2} metalness={0.7} />
      </mesh>
      <mesh position={[0.13, 0.58, 0.78]} rotation={[0, 0, 0.4]} castShadow>
        <coneGeometry args={[0.05, 0.18, 8]} />
        <meshStandardMaterial color={"#ffeecc"} roughness={0.2} metalness={0.7} />
      </mesh>
      {/* Glowing eyes */}
      <mesh position={[-0.13, 0.74, 0.72]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshBasicMaterial color={factionColor} />
      </mesh>
      <mesh position={[0.13, 0.74, 0.72]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshBasicMaterial color={factionColor} />
      </mesh>
      {/* Antennae */}
      <mesh position={[-0.1, 0.95, 0.6]} rotation={[-0.4, 0, -0.2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
        <meshStandardMaterial color={"#0e0703"} />
      </mesh>
      <mesh position={[0.1, 0.95, 0.6]} rotation={[-0.4, 0, 0.2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
        <meshStandardMaterial color={"#0e0703"} />
      </mesh>
      {/* 6 legs - 3 per side, animated walk cycle */}
      {[-0.3, 0, 0.3].map((zOff, i) => (
        <React.Fragment key={"legs_" + i}>
          <group position={[-0.32, 0.5, zOff]} ref={(g) => { if (g) legsRef.current[i*2] = g; }}>
            <mesh position={[-0.18, -0.18, 0]} rotation={[0, 0, -0.6]}>
              <cylinderGeometry args={[0.04, 0.04, 0.5, 6]} />
              <meshStandardMaterial color={"#0e0703"} />
            </mesh>
          </group>
          <group position={[0.32, 0.5, zOff]} ref={(g) => { if (g) legsRef.current[i*2+1] = g; }}>
            <mesh position={[0.18, -0.18, 0]} rotation={[0, 0, 0.6]}>
              <cylinderGeometry args={[0.04, 0.04, 0.5, 6]} />
              <meshStandardMaterial color={"#0e0703"} />
            </mesh>
          </group>
        </React.Fragment>
      ))}
    </group>
  );
};

// =================================================================
// Procedural Beetle enemy
// =================================================================

const BeetleMesh: React.FC<{
  groupRef: (g: THREE.Group | null) => void;
  bodyColor: string;
  glowColor: string;
  scale: number;
}> = ({ groupRef, bodyColor, glowColor, scale }) => {
  return (
    <group ref={groupRef} scale={scale}>
      {/* Domed shell */}
      <mesh position={[0, 0.4, 0]} castShadow>
        <sphereGeometry args={[0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={bodyColor} roughness={0.2} metalness={0.6} />
      </mesh>
      {/* Underside */}
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.5, 0.45, 0.18, 16]} />
        <meshStandardMaterial color={"#000"} roughness={0.8} />
      </mesh>
      {/* Glow stripe */}
      <mesh position={[0, 0.42, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.45, 0.04, 6, 24]} />
        <meshBasicMaterial color={glowColor} />
      </mesh>
      {/* Mandibles */}
      <mesh position={[-0.15, 0.3, 0.45]} rotation={[0, 0, -0.4]}>
        <coneGeometry args={[0.05, 0.2, 6]} />
        <meshStandardMaterial color={"#fff"} metalness={0.6} />
      </mesh>
      <mesh position={[0.15, 0.3, 0.45]} rotation={[0, 0, 0.4]}>
        <coneGeometry args={[0.05, 0.2, 6]} />
        <meshStandardMaterial color={"#fff"} metalness={0.6} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.18, 0.42, 0.32]}>
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshBasicMaterial color={glowColor} />
      </mesh>
      <mesh position={[0.18, 0.42, 0.32]}>
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshBasicMaterial color={glowColor} />
      </mesh>
      {/* 4 stubby legs */}
      {[[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]].map(([x, z], i) => (
        <mesh key={"bleg_" + i} position={[x, 0.05, z]} rotation={[0, 0, x > 0 ? 0.4 : -0.4]}>
          <cylinderGeometry args={[0.05, 0.07, 0.3, 6]} />
          <meshStandardMaterial color={"#000"} />
        </mesh>
      ))}
    </group>
  );
};

// =================================================================
// Chamber / arena geometry
// =================================================================

const Chamber: React.FC<{ biome: Biome }> = ({ biome }) => {
  const ARENA_RADIUS = 18;
  const WALL_HEIGHT = 4;
  const pillars = useMemo(() => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out.push({ x: Math.cos(a) * (ARENA_RADIUS - 2), z: Math.sin(a) * (ARENA_RADIUS - 2), h: 3 + Math.sin(i) * 0.6 });
    }
    return out;
  }, []);
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[ARENA_RADIUS, 48]} />
        <meshStandardMaterial color={biome.fogColor} roughness={0.95} metalness={0.1} />
      </mesh>
      {/* Outer ring wall (cylinder, inside-out) */}
      <mesh position={[0, WALL_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[ARENA_RADIUS, ARENA_RADIUS, WALL_HEIGHT, 48, 1, true]} />
        <meshStandardMaterial color={biome.skyTop} side={THREE.BackSide} roughness={0.9} />
      </mesh>
      {/* Glowing pillars at the perimeter */}
      {pillars.map((p, i) => (
        <group key={"pillar_" + i} position={[p.x, 0, p.z]}>
          <mesh position={[0, p.h / 2, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.4, p.h, 6]} />
            <meshStandardMaterial color={biome.skyTop} roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0, p.h + 0.2, 0]}>
            <sphereGeometry args={[0.25, 12, 8]} />
            <meshBasicMaterial color={biome.particleColor} />
          </mesh>
          <pointLight position={[0, p.h + 0.2, 0]} color={biome.keyLightColor} intensity={1.5} distance={10} decay={2} />
        </group>
      ))}
      {/* Central focus dais */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[2.5, 2.6, 0.1, 32]} />
        <meshStandardMaterial color={biome.fogColor} roughness={0.7} emissive={biome.particleColor} emissiveIntensity={0.05} />
      </mesh>
    </group>
  );
};

// =================================================================
// Inner Scene — runs the game loop via useFrame
// =================================================================

type SceneProps = {
  biome: Biome;
  factionColor: string;
  factionId: string;
  playerRef: React.MutableRefObject<PlayerRef>;
  enemiesRef: React.MutableRefObject<EnemyRef[]>;
  inputRef: React.MutableRefObject<DescentInput>;
  hudPushRef: React.MutableRefObject<(p: PlayerRef, alive: number, now: number) => void>;
  factionSpecialCooldownMs: number;
  onPlayerDeath: () => void;
  onAllClear: () => void;
};

const Scene: React.FC<SceneProps> = ({
  biome, factionColor, factionId, playerRef, enemiesRef, inputRef, hudPushRef,
  factionSpecialCooldownMs, onPlayerDeath, onAllClear,
}) => {
  const { camera } = useThree();
  const playerGroupRef = useRef<THREE.Group | null>(null);
  const enemyGroupsRef = useRef<Array<THREE.Group | null>>([]);
  const lastHudPushRef = useRef(0);
  const allClearFiredRef = useRef(false);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 1, 0));
  const cameraLerpRef = useRef(new THREE.Vector3(0, 6, -7));
  // Phase C: attack lunge animation + camera shake
  const playerAnimRef = useRef({ attackingUntil: 0, lungeOffset: 0 });
  const cameraShakeRef = useRef({ amplitude: 0, decayUntil: 0 });
  // Phase D: animation state machine for the rigged character
  const [animState, setAnimState] = useState<"idle" | "walk" | "run" | "attack" | "hurt" | "die">("idle");
  const [useGLB, setUseGLB] = useState(true); // false if GLB load fails — falls back to procedural
  const lastAnimUpdateRef = useRef(0);
  const lastHpRef = useRef(100);
  const lastAttackAtRef = useRef(0);

  // Set initial camera
  useEffect(() => {
    camera.position.set(0, 6, -7);
    camera.lookAt(0, 1, 0);
  }, [camera]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.033); // clamp dt so a hitch doesn't teleport entities
    const now = state.clock.elapsedTime * 1000;
    const player = playerRef.current;
    const enemies = enemiesRef.current;
    const input = inputRef.current;
    if (!player.alive) return;

    // ---------- Player movement (Phase C: camera-relative) ----------
    let mx = 0, mz = 0;
    if (input.up) mz += 1;
    if (input.down) mz -= 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    const inLen = Math.hypot(mx, mz);
    if (inLen > 0.001) {
      mx /= inLen; mz /= inLen;
      // Camera-relative basis: forward = camera XZ direction toward target
      const cf = new THREE.Vector3();
      camera.getWorldDirection(cf);
      cf.y = 0; cf.normalize();
      // Right = world up cross forward
      const cr = new THREE.Vector3(cf.z, 0, -cf.x); // perpendicular on XZ
      // Build world-space velocity: "up" = forward, "right" = strafe right
      const wx = cf.x * mz + cr.x * mx;
      const wz = cf.z * mz + cr.z * mx;
      const wlen = Math.hypot(wx, wz) || 1;
      const speed = BASE_MOVE_SPEED;
      player.pos.x += (wx / wlen) * speed * dt;
      player.pos.z += (wz / wlen) * speed * dt;
      // Face the world-space movement direction
      const targetFacing = Math.atan2(wx, wz);
      const da = ((targetFacing - player.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      player.facing += da * Math.min(1, dt * 14);
    }
    // Clamp to arena
    const distFromCenter = Math.hypot(player.pos.x, player.pos.z);
    const ARENA_R = 17;
    if (distFromCenter > ARENA_R) {
      const k = ARENA_R / distFromCenter;
      player.pos.x *= k; player.pos.z *= k;
    }
    // ---------- Player attack / special / dodge (Phase C: snappier) ----------
    const attackCooldownMs = 260; // was 625ms — much snappier
    if (input.attackPulse > 0) {
      input.attackPulse = 0;
      if (now - player.lastAttackAt >= attackCooldownMs) {
        player.lastAttackAt = now;
        playerAnimRef.current.attackingUntil = now + 180; // lunge animation duration
        const range = 2.4; // was 2.0 — more forgiving
        const facing = player.facing;
        const fx = Math.sin(facing), fz = Math.cos(facing);
        for (const e of enemies) {
          if (!e.alive) continue;
          const dx = e.pos.x - player.pos.x;
          const dz = e.pos.z - player.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist > range) continue;
          const dot = (dx * fx + dz * fz) / (dist || 1);
          if (dot < -0.2) continue; // ~155deg cone
          e.hp -= BASE_ATTACK_DAMAGE;
          e.hitFlashUntil = now + 160;
          // Knockback: push enemy 0.7m away
          const ndx = dx / (dist || 1), ndz = dz / (dist || 1);
          e.pos.x += ndx * 0.7;
          e.pos.z += ndz * 0.7;
          if (e.hp <= 0) {
            e.alive = false;
            e.state = "dead";
            player.rebelEarned += 8;
          }
        }
      }
    }
    // Special pulse — Phase B placeholder: heal 20 HP
    if (input.specialPulse > 0) {
      input.specialPulse = 0;
      if (now >= player.specialReadyAt) {
        player.specialReadyAt = now + factionSpecialCooldownMs;
        player.hp = Math.min(player.maxHp, player.hp + 20);
      }
    }
    // Dodge pulse — i-frames + small lunge
    if (input.dodgePulse > 0) {
      input.dodgePulse = 0;
      if (now >= player.dodgeReadyAt) {
        player.dodgeReadyAt = now + 900;
        player.iframesUntil = now + 350;
        player.pos.x += Math.sin(player.facing) * 1.5;
        player.pos.z += Math.cos(player.facing) * 1.5;
      }
    }
    // ---------- Enemy AI ----------
    let aliveCount = 0;
    for (const e of enemies) {
      if (!e.alive) continue;
      aliveCount++;
      const arch = ENEMIES[e.kind];
      const dx = player.pos.x - e.pos.x;
      const dz = player.pos.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      // State transitions
      if (dist <= arch.attackRange) e.state = "attack";
      else if (dist <= arch.detectRange) e.state = "chase";
      else e.state = "idle";
      // Idle: gentle wander around spawn point
      if (e.state === "idle") {
        // Slow drift towards center of arena
        const cx = -e.pos.x * 0.05, cz = -e.pos.z * 0.05;
        e.pos.x += cx * dt;
        e.pos.z += cz * dt;
      } else if (e.state === "chase") {
        const ndx = dx / (dist || 1);
        const ndz = dz / (dist || 1);
        e.pos.x += ndx * arch.moveSpeed * dt;
        e.pos.z += ndz * arch.moveSpeed * dt;
        e.facing = Math.atan2(ndx, ndz);
      } else if (e.state === "attack") {
        // Face player, attack on cooldown
        e.facing = Math.atan2(dx, dz);
        if (now - e.lastAttackAt >= arch.attackCooldownMs) {
          e.lastAttackAt = now;
          if (now > player.iframesUntil) {
            cameraShakeRef.current.amplitude = 0.4;
            cameraShakeRef.current.decayUntil = now + 220;
            player.hp -= arch.damage;
            if (player.hp <= 0) {
              player.hp = 0;
              player.alive = false;
            }
          }
        }
      }
      // Apply mesh transform
      const mesh = e.meshRef as THREE.Group | undefined;
      if (mesh) {
        mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
        mesh.rotation.y = e.facing;
        // Hit flash via emissive on first child material — simple version: scale pulse
        const flashing = now < e.hitFlashUntil;
        const s = arch.scale * (flashing ? 1.18 : 1);
        mesh.scale.setScalar(s);
      }
    }

    // ---------- Phase D: Animation state machine ----------
    if (now - lastAnimUpdateRef.current > 80) {
      lastAnimUpdateRef.current = now;
      let nextAnim: "idle" | "walk" | "run" | "attack" | "hurt" | "die" = "idle";
      if (player.hp <= 0) {
        nextAnim = "die";
      } else if (player.hp < lastHpRef.current - 0.5) {
        nextAnim = "hurt";
      } else if (player.lastAttackAt !== lastAttackAtRef.current) {
        nextAnim = "attack";
        lastAttackAtRef.current = player.lastAttackAt;
      } else {
        const moving = (input.up || input.down || input.left || input.right);
        if (moving) nextAnim = "run";
        else nextAnim = "idle";
      }
      lastHpRef.current = player.hp;
      setAnimState((prev) => {
        if (prev !== nextAnim) {
          console.log(`[HiveDescent run debug] DescentEngine animState ${prev} -> ${nextAnim} (moving=${input.up || input.down || input.left || input.right})`);
          return nextAnim;
        }
        return prev;
      });
    }
    // ---------- Player mesh transform (Phase C: with attack lunge) ----------
    const pg = playerGroupRef.current;
    if (pg) {
      // Lunge: when attacking, push the visual mesh forward briefly
      const lungeT = Math.max(0, (playerAnimRef.current.attackingUntil - now) / 180);
      const lunge = lungeT > 0 ? Math.sin(lungeT * Math.PI) * 0.4 : 0;
      const lx = Math.sin(player.facing) * lunge;
      const lz = Math.cos(player.facing) * lunge;
      pg.position.set(player.pos.x + lx, player.pos.y, player.pos.z + lz);
      pg.rotation.y = player.facing;
    }
    // ---------- Camera (third-person behind shoulder, with shake) ----------
    const camDist = 5.5;
    const camHeight = 4.2;
    const desiredX = player.pos.x - Math.sin(player.facing) * camDist;
    const desiredZ = player.pos.z - Math.cos(player.facing) * camDist;
    const desiredY = camHeight;
    cameraLerpRef.current.x += (desiredX - cameraLerpRef.current.x) * Math.min(1, dt * 5);
    cameraLerpRef.current.y += (desiredY - cameraLerpRef.current.y) * Math.min(1, dt * 5);
    cameraLerpRef.current.z += (desiredZ - cameraLerpRef.current.z) * Math.min(1, dt * 5);
    // Shake: random offset that decays
    let shakeX = 0, shakeY = 0;
    if (now < cameraShakeRef.current.decayUntil && cameraShakeRef.current.amplitude > 0) {
      const tLeft = (cameraShakeRef.current.decayUntil - now) / 220;
      const a = cameraShakeRef.current.amplitude * tLeft;
      shakeX = (Math.random() - 0.5) * a;
      shakeY = (Math.random() - 0.5) * a;
    }
    camera.position.set(cameraLerpRef.current.x + shakeX, cameraLerpRef.current.y + shakeY, cameraLerpRef.current.z);
    cameraTargetRef.current.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
    camera.lookAt(cameraTargetRef.current);
    // ---------- HUD bridge (throttle to ~10Hz) ----------
    if (now - lastHudPushRef.current > 100) {
      lastHudPushRef.current = now;
      hudPushRef.current(player, aliveCount, now);
    }

    // ---------- End conditions ----------
    if (!player.alive) {
      hudPushRef.current(player, aliveCount, now);
      onPlayerDeath();
      return;
    }
    if (aliveCount === 0 && !allClearFiredRef.current) {
      allClearFiredRef.current = true;
      hudPushRef.current(player, 0, now);
      // small delay so the HUD updates before we leave
      setTimeout(onAllClear, 600);
    }
  });

  return (
    <>
      {/* Lighting */}
      <ambientLight color={biome.ambientColor} intensity={0.4} />
      <directionalLight color={biome.keyLightColor} intensity={1.1} position={[8, 12, 5]} castShadow shadow-mapSize={[1024, 1024]} />
      <hemisphereLight color={biome.skyTop} groundColor={biome.skyBottom} intensity={0.4} />
      <fog attach="fog" args={[biome.fogColor, 8, 30]} />
      {/* Sky background plane */}
      <color attach="background" args={[biome.skyBottom]} />

      <Chamber biome={biome} />

      {/* Player */}
      <group position={[0, 0, 0]}>
        {useGLB ? (
          <group ref={playerGroupRef}>
            <FactionCharacter
              factionId={factionId}
              animState={animState}
              onMissingAssets={() => setUseGLB(false)}
            />
          </group>
        ) : (
          <AntCharacter groupRef={playerGroupRef} factionColor={factionColor} />
        )}
      </group>

      {/* Enemies */}
      {enemiesRef.current.map((e, i) => {
        const arch = ENEMIES[e.kind];
        return (
          <group key={"enemy_" + e.id}
            visible={e.alive}
          >
            <BeetleMesh
              groupRef={(g) => {
                e.meshRef = g;
                enemyGroupsRef.current[i] = g;
              }}
              bodyColor={arch.bodyColor}
              glowColor={arch.glowColor}
              scale={arch.scale}
            />
          </group>
        );
      })}
    </>
  );
};

// =================================================================
// Top-level DescentEngine component
// =================================================================

const DescentEngine: React.FC<Props> = ({
  factionId, floor, biome, onFloorComplete, onDeath, onAbandon,
}) => {
  const faction = useMemo(() => DESCENT_FACTIONS.find((f) => f.id === factionId) || DESCENT_FACTIONS[0], [factionId]);
  const factionColor = biome.particleColor;

  // -------- Persistent refs (engine state) --------
  const playerRef = useRef<PlayerRef>({
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    facing: 0,
    hp: BASE_MAX_HP,
    maxHp: BASE_MAX_HP,
    lastAttackAt: 0,
    specialReadyAt: 0,
    dodgeReadyAt: 0,
    iframesUntil: 0,
    alive: true,
    rebelEarned: 0,
  });

  const enemiesRef = useRef<EnemyRef[]>([]);
  // Spawn enemies synchronously when (floor, biome) changes, BEFORE first paint of new floor.
  // useMemo here runs during render, so enemiesRef is populated before <Scene> reads it.
  const spawnSig = useMemo(() => {
    const types = biome.enemyTypes;
    const count = spawnCountForFloor(floor);
    const list: EnemyRef[] = [];
    for (let i = 0; i < count; i++) {
      const kind = types[i % types.length] as EnemyKind;
      const arch = ENEMIES[kind];
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = 8 + Math.random() * 6;
      list.push({
        id: i, kind,
        pos: { x: Math.cos(angle) * r, y: 0, z: Math.sin(angle) * r },
        vel: { x: 0, y: 0, z: 0 },
        facing: angle + Math.PI,
        hp: arch.hp, maxHp: arch.hp,
        alive: true, state: "idle",
        lastAttackAt: 0, meshRef: null, hitFlashUntil: 0,
      });
    }
    enemiesRef.current = list;
    // Reset player state for the new floor
    playerRef.current.pos = { x: 0, y: 0, z: 0 };
    playerRef.current.facing = 0;
    playerRef.current.hp = playerRef.current.maxHp;
    playerRef.current.specialReadyAt = 0;
    playerRef.current.dodgeReadyAt = 0;
    playerRef.current.iframesUntil = 0;
    playerRef.current.alive = true;
    return floor + ":" + biome.name + ":" + count;
  }, [floor, biome]);

  const inputRef = useRef<DescentInput>({
    up: false, down: false, left: false, right: false,
    attackPulse: 0, specialPulse: 0, dodgePulse: 0,
  });

  // -------- Keyboard input --------
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space") e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") inputRef.current.up = true;
      if (k === "s" || k === "arrowdown") inputRef.current.down = true;
      if (k === "a" || k === "arrowleft") inputRef.current.left = true;
      if (k === "d" || k === "arrowright") inputRef.current.right = true;
      if (k === " ") { e.preventDefault(); inputRef.current.specialPulse++; }
      if (k === "shift") inputRef.current.dodgePulse++;
      if (k === "f" || k === "e" || k === " ") inputRef.current.attackPulse++;
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") inputRef.current.up = false;
      if (k === "s" || k === "arrowdown") inputRef.current.down = false;
      if (k === "a" || k === "arrowleft") inputRef.current.left = false;
      if (k === "d" || k === "arrowright") inputRef.current.right = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  // -------- HUD state (throttled bridge from engine) --------
  const [hudHp, setHudHp] = useState(BASE_MAX_HP);
  const [hudRebel, setHudRebel] = useState(0);
  const [hudEnemies, setHudEnemies] = useState(0);
  const [hudSpecialReadyAt, setHudSpecialReadyAt] = useState(0);
  const [hudNow, setHudNow] = useState(0);
  const hudPushRef = useRef<(p: PlayerRef, alive: number, now: number) => void>(() => {});
  hudPushRef.current = (p, alive, now) => {
    setHudHp(p.hp);
    setHudRebel(p.rebelEarned);
    setHudEnemies(alive);
    setHudSpecialReadyAt(p.specialReadyAt);
    setHudNow(now);
  };

  // -------- Detect mobile vs desktop for D-pad overlay --------
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(pointer: coarse)");
    setIsTouch(m.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  // Click-to-attack: clicking the canvas registers an attack pulse
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    inputRef.current.attackPulse++;
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: biome.skyBottom,
      touchAction: "none", userSelect: "none", overflow: "hidden",
    }}>
      <Canvas
        shadows
        camera={{ position: [0, 6, -7], fov: 55, near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
        onPointerDown={handleCanvasPointerDown}
        style={{ position: "absolute", inset: 0 }}
      >
        <Suspense fallback={null}>
          <Scene key={spawnSig}
            biome={biome}
            factionId={factionId}
            factionColor={factionColor}
            playerRef={playerRef}
            enemiesRef={enemiesRef}
            inputRef={inputRef}
            hudPushRef={hudPushRef}
            factionSpecialCooldownMs={faction.specialCooldownMs}
            onPlayerDeath={onDeath}
            onAllClear={() => onFloorComplete(playerRef.current.rebelEarned)}
          />
        </Suspense>
      </Canvas>

      {/* HUD overlay */}
      <HUD
        hp={hudHp}
        maxHp={playerRef.current.maxHp}
        rebel={hudRebel}
        floor={floor}
        totalFloors={DESCENT_TOTAL_FLOORS}
        biome={biome}
        factionName={faction.name}
        specialName={faction.specialName}
        specialReadyAt={hudSpecialReadyAt}
        nowMs={hudNow}
        enemiesAlive={hudEnemies}
        onAbandon={onAbandon}
      />

      {/* Mobile touch controls */}
      {isTouch && <MobileControls inputRef={inputRef} />}

      {/* Desktop hint overlay (fades after a few seconds) */}
      {!isTouch && <DesktopHint />}
    </div>
  );
};

// Tiny self-contained hint overlay that fades after 6 seconds
const DesktopHint: React.FC = () => {
  const [show, setShow] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShow(false), 6000); return () => clearTimeout(t); }, []);
  if (!show) return null;
  return (
    <div style={{
      position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
      pointerEvents: "none", color: "rgba(255,255,255,0.7)",
      background: "rgba(0,0,0,0.5)", padding: "14px 22px", borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.15)",
      fontSize: 13, letterSpacing: "0.1em", textAlign: "center",
      animation: "fadeOut 1s ease-out 5s forwards", zIndex: 11,
    }}>
      <div style={{ fontWeight: 800, marginBottom: 6, color: "#ff99dd" }}>CONTROLS</div>
      <div>WASD or Arrows · MOVE</div>
      <div>CLICK / F · ATTACK</div>
      <div>SPACE · SPECIAL · SHIFT · DODGE</div>
    </div>
  );
};

export default DescentEngine;
