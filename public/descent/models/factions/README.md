# Faction Character Models (Hive Descent)

This folder holds rigged 3D character GLBs — one per faction.
The Hive Descent engine looks for them at runtime by faction id.

## Pipeline

Each faction follows the same path:

1. Generate mesh + textures in **Meshy** (no rig)
2. Auto-rig in **Mixamo** (free)
3. Download from Mixamo as **FBX Binary, With Skin, T-Pose** (NOT GLB — Mixamo's GLB exporter has broken texture paths)
4. Drop the FBX in this chat with Claude — Claude runs the cleaner tool which:
   - Converts FBX → GLB with embedded textures
   - Scales to 1.5m height (engine standard)
   - Strips junk single-frame animations
   - Compresses textures from 4096² → 1024² (~30× size reduction)
5. The cleaned GLB lands in this folder as `<faction_id>.glb`

## Expected files

| Faction id | File | Status |
|---|---|---|
| samurai | samurai.glb | ⏳ pending upload |
| spartan | spartan.glb | ⏳ |
| viking | viking.glb | ⏳ |
| pirate | pirate.glb | ⏳ |
| ninja | ninja.glb | ⏳ |
| knight | knight.glb | ⏳ |
| pharaoh | pharaoh.glb | ⏳ |
| aztec | aztec.glb | ⏳ |
| mongol | mongol.glb | ⏳ |
| roman | roman.glb | ⏳ |
| zulu | zulu.glb | ⏳ |

## Engine fallback

If a GLB is missing for a faction, the engine renders a procedural low-poly ant in that faction's accent color — game stays playable while characters get added.
