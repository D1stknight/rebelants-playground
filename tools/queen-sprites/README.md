# Queen sprite layers (Queen's Egg Shuffle)
The queen on /shuffle is a 2-D paper doll drawn by `components/QueenStage.tsx` — body + staff (pivots in her fist) + fist patch —
rendered from the real `public/models/queen/queen.glb` so she matches the model without loading 20 MB.

1. `cp tools/queen-sprites/dev-queen-page.tsx pages/dev/queen.tsx` and run `next dev -p 3111` (remove the page before committing).
2. `node tools/queen-sprites/shot.js` → `q_front.png`, `q_left34.png`, … (1024 px, transparent).
3. `python3 tools/queen-sprites/build_layers.py q_front.png public/queen/sprite` → `body.png`, `staff.png`, `fist.png`, `layers.json`
   (pivot = fist centre, gem = staff tip, all in the 1024 render space; `scale` maps to the 640 px web layers).
