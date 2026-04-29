# Animation Test

Drop a single Mixamo character GLB here named **test.glb**, then visit:

  https://rebel-ants-playground-testing.vercel.app/descent/anim-test.html

## Mixamo export settings
- Format: **glTF Binary (.glb)**
- Skin: **With Skin**
- FPS: **30**
- Keyframe Reduction: **none**
- Pose: any animation that has clear motion (idle is OK, walk is more visible)

## What it tests
- Three.js loads a GLB with a baked animation track
- AnimationMixer is mounted on the SkinnedMesh
- The character is wrapped in a scale=5 group (matching Hive Descent v6)
- An on-screen log shows whether the bones are moving frame-to-frame

If the limbs visibly animate, the per-animation-GLB pipeline works in three.js
and we should rebuild the Hive Descent character pipeline this way.
