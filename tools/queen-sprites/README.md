# Queen sprite layers (Queen's Egg Shuffle)
The queen on /shuffle is a 2-D paper doll drawn by `components/QueenStage.tsx` — body + staff (pivots in her fist) + fist patch —
rendered from the real `public/models/queen/queen.glb` so she matches the model without loading 20 MB.

1. `cp tools/queen-sprites/dev-queen-page.tsx pages/dev/queen.tsx` and run `next dev -p 3111` (remove the page before committing).
2. `node tools/queen-sprites/shot.js` → `q_front.png`, `q_left34.png`, … (1024 px, transparent).
3. `python3 tools/queen-sprites/build_layers.py q_front.png public/queen/sprite` → `body.png`, `staff.png`, `fist.png`, `layers.json`
   (pivot = fist centre, gem = staff tip, all in the 1024 render space; `scale` maps to the 640 px web layers).

## v3 — live rigged queen (components/QueenRig.ts)
- `rig_queen.py` (Blender `bpy`, run with `python3 -I`): bone-heat weights on a welded proxy transferred to the real mesh, staff islands
  rigid to the right hand, head locked; exports `queen_rig.glb` (full res, for `dev-qrig-page.tsx`) and a decimated web build →
  `gltf-transform meshopt queen_web_raw.glb q_mo.glb` → `public/models/queen/queen_web.glb` (~1.2 MB).
- QueenStage draws the live model (two-bone IK + springs per pose) and lays the painted faces over the head; faces are rebuilt from
  the rig's rest render (`dev-q3d-page.tsx`, pose "rest", 0 s) with `build_faces_v2.py` so they match the live shading exactly.

## Voice (public/queen/voice)
- `build_voice.py`: every Egg Shuffle line spoken by Kokoro-82M (Apache-2.0, offline; model from npm `kokoro-q8-shards`, voices from npm
  `kokoro-js`), a little throne-room echo, loudness-normalised mp3 + `lines.json` (duration + loudness envelope at 30 fps).
  QueenStage plays the line and drives the mouth from the envelope (closes in the dips, opens on loud vowels). Change the voice with
  `VOICE=bf_isabella` (any kokoro-js voice) and re-run. New lines in Shuffle need adding to LINES here.
