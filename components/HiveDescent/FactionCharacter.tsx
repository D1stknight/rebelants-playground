// components/HiveDescent/FactionCharacter.tsx
// Phase D v3: explicit SkinnedMesh-based mixer with full diagnostic logging.
//
// v3 changes vs v2:
// - Mixer is mounted on the SkinnedMesh, not the scene root
// - Walks the loaded scene to find the SkinnedMesh and its skeleton bones explicitly
// - Validates that each retargeted track resolves to a real bone via getObjectByName
// - Drops cloneSkeleton (we render only one character per scene; clone is unnecessary)
// - Logs full bone hierarchy and the result of one frame of evaluation

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export type AnimStateName = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'die';

interface FactionCharacterProps {
  factionId: string;
  animState: AnimStateName;
  onMissingAssets?: () => void;
}

const ONE_SHOT: Record<AnimStateName, boolean> = {
  idle: false, walk: false, run: false,
  attack: true, hurt: true, die: true,
};

const animCache: Partial<Record<AnimStateName, THREE.AnimationClip>> = {};
let animCachePromise: Promise<void> | null = null;

function loadAnimationsOnce(): Promise<void> {
  if (animCachePromise) return animCachePromise;
  const fbxLoader = new FBXLoader();
  const names: AnimStateName[] = ['idle', 'walk', 'run', 'attack', 'hurt', 'die'];
  console.log('[FactionCharacter v3] Loading 6 animations');
  animCachePromise = Promise.all(names.map(name => {
    return new Promise<void>((resolve) => {
      fbxLoader.load(`/descent/models/animations/${name}.fbx`,
        (fbx: any) => {
          if (fbx.animations && fbx.animations.length > 0) {
            const clip = fbx.animations[0];
            clip.name = name;
            animCache[name] = clip;
            console.log(`[v3] Loaded ${name}: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s`);
            // Log first 3 track names so we see the EXACT format
            for (let i = 0; i < Math.min(3, clip.tracks.length); i++) {
              console.log(`  track[${i}]: ${clip.tracks[i].name}`);
            }
          }
          resolve();
        },
        undefined,
        (err: any) => { console.warn(`[v3] Failed ${name}:`, err); resolve(); }
      );
    });
  })).then(() => undefined);
  return animCachePromise;
}

/** Build a bone-name lookup map. Maps any normalized form (lowercase, no prefix) to the real bone name. */
function buildBoneMap(skinnedMesh: THREE.SkinnedMesh): Map<string, string> {
  const map = new Map<string, string>();
  const skeleton = skinnedMesh.skeleton;
  if (!skeleton) {
    console.warn('[v3] SkinnedMesh has no skeleton');
    return map;
  }
  console.log(`[v3] Skeleton has ${skeleton.bones.length} bones`);
  for (const bone of skeleton.bones) {
    const fullName = bone.name;
    const lower = fullName.toLowerCase();
    map.set(lower, fullName);
    // Also strip any "mixamorig" or "mixamorig:" prefix
    const stripped = fullName.replace(/^mixamorig:?/i, '').toLowerCase();
    if (stripped && stripped !== lower) map.set(stripped, fullName);
  }
  return map;
}

/** Retarget animation track names to match the bones in our skeleton.
 *  v4: Drops .position and .scale tracks. Mixamo FBX position tracks are in cm
 *  and teleport bones to wildly wrong locations on differently-scaled GLB skeletons.
 *  Rotation-only is the standard cross-scale solution. The character's world
 *  position is controlled by the parent group in DescentEngine, so we don't need
 *  root motion from the clips. */
function retargetClip(clip: THREE.AnimationClip, boneMap: Map<string, string>): THREE.AnimationClip {
  const newTracks: THREE.KeyframeTrack[] = [];
  let kept = 0, dropped = 0, skippedPos = 0, skippedScale = 0;
  const droppedNames: string[] = [];
  for (const track of clip.tracks) {
    const lastDot = track.name.lastIndexOf('.');
    if (lastDot === -1) { newTracks.push(track); continue; }
    const fbxBone = track.name.substring(0, lastDot);
    const property = track.name.substring(lastDot);

    // Drop position and scale tracks — they are in source-skeleton units (cm)
    // and break the visual when applied to our pre-scaled GLB skeleton.
    if (property === '.position') { skippedPos++; continue; }
    if (property === '.scale') { skippedScale++; continue; }

    // Try multiple forms: full, lower, stripped-prefix
    const stripped = fbxBone.replace(/^mixamorig:?/i, '').toLowerCase();
    const target = boneMap.get(fbxBone.toLowerCase()) || boneMap.get(stripped);

    if (target) {
      const newTrack = track.clone();
      newTrack.name = target + property;
      newTracks.push(newTrack);
      kept++;
    } else {
      dropped++;
      if (droppedNames.length < 3) droppedNames.push(fbxBone);
    }
  }
  console.log(`[v4 retarget] ${clip.name}: kept ${kept}/${clip.tracks.length} rot, skipped ${skippedPos} pos + ${skippedScale} scale, dropped ${dropped}${droppedNames.length ? ' (e.g. ' + droppedNames.join(', ') + ')' : ''}`);
  if (kept > 0 && newTracks.length > 0) {
    console.log(`  first kept: ${newTracks[0].name}`);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks);
}

export default function FactionCharacter({ factionId, animState, onMissingAssets }: FactionCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Partial<Record<AnimStateName, THREE.AnimationAction>>>({});
  const currentActionRef = useRef<AnimStateName | null>(null);

  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);
  const [skinnedMesh, setSkinnedMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [animsReady, setAnimsReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Load the GLB
  useEffect(() => {
    let cancelled = false;
    console.log(`[v3] Loading /descent/models/factions/${factionId}.glb`);
    const loader = new GLTFLoader();
    loader.load(
      `/descent/models/factions/${factionId}.glb`,
      (loaded: any) => {
        if (cancelled) return;
        const scene = loaded.scene as THREE.Group;
        // Find the SkinnedMesh
        let foundSkinned: THREE.SkinnedMesh | null = null;
        const allMeshes: string[] = [];
        scene.traverse((obj: any) => {
          if (obj.isMesh) allMeshes.push(`${obj.name} (skinned=${!!obj.isSkinnedMesh})`);
          if (obj.isSkinnedMesh && !foundSkinned) foundSkinned = obj;
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            obj.frustumCulled = false;
          }
        });
        console.log(`[v3] GLB loaded. Meshes found: ${allMeshes.length}`);
        for (const m of allMeshes.slice(0, 5)) console.log(`  ${m}`);
        if (!foundSkinned) {
          console.warn('[v3] No SkinnedMesh — model has no rig?');
          setLoadFailed(true);
          onMissingAssets?.();
          return;
        }
        const sm = foundSkinned as THREE.SkinnedMesh;
        if (sm.skeleton) {
          console.log(`[v3] SkinnedMesh: ${sm.name}, skeleton has ${sm.skeleton.bones.length} bones`);
          // Log first 3 bones with parent chain
          for (let i = 0; i < Math.min(3, sm.skeleton.bones.length); i++) {
            const b = sm.skeleton.bones[i];
            const parents: string[] = [];
            let p: any = b.parent;
            while (p && parents.length < 4) { parents.push(p.name || p.type); p = p.parent; }
            console.log(`  bone[${i}]: ${b.name} <- ${parents.join(' <- ')}`);
          }
        }
        setLoadedScene(scene);
        setSkinnedMesh(sm);
      },
      undefined,
      (err: any) => {
        if (cancelled) return;
        console.warn(`[v3] GLB load failed:`, err);
        setLoadFailed(true);
        onMissingAssets?.();
      }
    );
    return () => { cancelled = true; };
  }, [factionId, onMissingAssets]);

  // Load animations
  useEffect(() => {
    let cancelled = false;
    loadAnimationsOnce().then(() => {
      if (cancelled) return;
      if (!animCache.idle) {
        setLoadFailed(true);
        onMissingAssets?.();
      } else {
        setAnimsReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [onMissingAssets]);

  // Set up mixer when both are ready
  useEffect(() => {
    if (!loadedScene || !skinnedMesh || !animsReady) return;

    // Build bone lookup from the SkinnedMesh's actual skeleton
    const boneMap = buildBoneMap(skinnedMesh);
    
    // Mount mixer on the LOADED SCENE (the root that contains both the mesh and bones)
    // Mount on the scene root. AnimationMixer will resolve track names via PropertyBinding.findNode().
    const mixer = new THREE.AnimationMixer(loadedScene);
    mixerRef.current = mixer;
    console.log(`[v3] Mixer created on loadedScene`);

    // Verify at least one bone is findable from the mixer's root
    const firstBone = skinnedMesh.skeleton?.bones[0];
    if (firstBone) {
      const found = loadedScene.getObjectByName(firstBone.name);
      console.log(`[v3] getObjectByName('${firstBone.name}') from scene root: ${found ? 'FOUND' : 'NOT FOUND'}`);
      if (!found) {
        // Bones live outside the scene — try parenting them
        console.warn('[v3] Bones not under scene root. Skeleton bones may be detached.');
      }
    }

    const actions: Partial<Record<AnimStateName, THREE.AnimationAction>> = {};
    (Object.keys(animCache) as AnimStateName[]).forEach(name => {
      const raw = animCache[name];
      if (!raw) return;
      const clip = retargetClip(raw, boneMap);
      if (clip.tracks.length === 0) {
        console.warn(`[v3] ${name} has no tracks after retarget; skipping`);
        return;
      }
      const action = mixer.clipAction(clip);
      if (ONE_SHOT[name]) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      actions[name] = action;
    });
    actionsRef.current = actions;

    if (actions.idle) {
      actions.idle.play();
      currentActionRef.current = 'idle';
      console.log('[v3] Started idle animation');
      // Force one update so we can verify the mixer evaluates
      mixer.update(0.016);
      const firstBoneNow = skinnedMesh.skeleton?.bones[0];
      if (firstBoneNow) {
        console.log(`[v3] After 1 frame, ${firstBoneNow.name}.position:`, firstBoneNow.position.x.toFixed(3), firstBoneNow.position.y.toFixed(3), firstBoneNow.position.z.toFixed(3));
      }
    }

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = {};
      currentActionRef.current = null;
    };
  }, [loadedScene, skinnedMesh, animsReady]);

  // Animation state changes — crossfade
  useEffect(() => {
    if (!mixerRef.current) return;
    const actions = actionsRef.current;
    const target = animState;
    const current = currentActionRef.current;
    if (current === target) return;

    const targetAction = actions[target];
    const currentAction = current ? actions[current] : null;
    if (!targetAction) {
      if (target !== 'idle' && actions.idle && current !== 'idle') {
        actions.idle.reset().fadeIn(0.2).play();
        if (currentAction) currentAction.fadeOut(0.2);
        currentActionRef.current = 'idle';
      }
      return;
    }
    targetAction.reset().fadeIn(0.2).play();
    if (currentAction && currentAction !== targetAction) currentAction.fadeOut(0.2);
    currentActionRef.current = target;

    if (ONE_SHOT[target] && target !== 'die') {
      const clip = animCache[target];
      const duration = clip ? clip.duration * 1000 : 800;
      const handle = setTimeout(() => {
        if (currentActionRef.current === target && actions.idle) {
          actions.idle.reset().fadeIn(0.15).play();
          targetAction.fadeOut(0.15);
          currentActionRef.current = 'idle';
        }
      }, duration);
      return () => clearTimeout(handle);
    }
  }, [animState]);

  useFrame((_, dt) => {
    if (mixerRef.current) mixerRef.current.update(dt);
  });

  if (loadFailed || !loadedScene) return null;

  return (
    <group ref={groupRef}>
      <primitive object={loadedScene} />
    </group>
  );
}
