# Shared Character Animations (Hive Descent)

These animation FBXs work for **every faction** because all rigged characters
use the standard Mixamo skeleton (`mixamorig:Hips`, `mixamorig:Spine`, etc).
You only need to download each animation **once** from Mixamo.

## Mixamo download settings (use for ALL animations)

- **Format:** FBX Binary (.fbx)
- **Skin:** Without Skin (just animation, no character — keeps file size tiny)
- **Frames Per Second:** 30
- **Keyframe Reduction:** None
- **In Place:** ✅ for idle/walk/run (no drift), ❌ for attack/hurt/die

## Required files

| File | Mixamo search term | In Place? | Engine state |
|---|---|---|---|
| idle.fbx | "Breathing Idle" | ✅ Yes | standing still |
| walk.fbx | "Standard Walk" | ✅ Yes | WASD/D-pad held, slow |
| run.fbx | "Standard Run" | ✅ Yes | WASD/D-pad held, fast |
| attack.fbx | "Sword And Shield Slash" or "Standing Melee Attack Downward" | ❌ No | click/⚔ button |
| hurt.fbx | "Standing React Small Gesture" or any "Hit Reaction" | ❌ No | took damage |
| die.fbx | "Standing Death Forward 01" or any "Standing Death" | ❌ No | HP = 0 |

## Pipeline

Drag each FBX into this folder via the GitHub web UI (Add file → Upload files).
The Phase D engine will load all 6 once, retarget onto the active faction's skeleton, and play them based on game state.
