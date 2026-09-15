# Bounty Hunters — sprite & art pipeline

Everything in `public/bounty/` is generated here. Nothing in this folder ships; Next ignores `tools/`.

## Characters (pre-rendered from the real faction GLBs)
1. Copy `dev-sprite-page.tsx` to `pages/dev/sprite.tsx` and run `next dev -p 3111`. The page loads
   `/faction-wars/characters/<faction>/<faction>.glb` + idle/attack/hit/lose FBX, adds a box blaster to the right hand
   and exposes `__clip / __rot / __pos / __tilt / __gun / __fit / __shot` on `window`.
2. `node sprite2.js <faction> poses.json outdir` renders each pose to a 512px transparent PNG with Playwright
   (Chromium + swiftshader; DRACO is served from node_modules via a route). `gen_sprites.py` builds the pose list
   (idle ×2, run ×6, jump, shoot ×2, aim 45/90/−45, crouch ×2, death ×3, hit) and calls it.
3. `pixelize.py` → alpha-dilate (keeps the antennae), BOX downscale at a fixed world scale (40px standing height),
   24-colour median cut, 1px outline. `assemble()` lays frames out on 64×64 cells, feet 4px above the bottom.
   Model faces ry = 2.9 → sprites already face right; do NOT mirror.
   - `python3 gen_sprites.py samurai ronin …` → `hunter_<faction>.png` (20 frames, 10/row)
   - `python3 gen_sprites.py enemies` → `grunt.png` (ashigaru, hue +30) and `elite.png` (kenshi, hue +110), 14 frames, 7/row

## Placeholders (procedural pixel art)
- `hero.py` — the original hand-drawn ant rig (unused now, kept for reference)
- `enemies.py` — wasp, spider turret (also the hopper), 4 bosses, `items.png` (0 tag, 1–4 gun capsules, 5 heart,
  6 bullet, 7 enemy bullet, 8 laser, 9 flame, 10–13 explosion, 14 crate, 15 honey)
- `biomes.py` — `tiles_<biome>.png` (16 tiles: grass top, boulder fill, ledge, liquid A/B/body, corners, walls, deco,
  ceiling, flag, spikes) and the 3-layer parallax `bg_<biome>_{far,mid,near}.png`

## Testing without REBEL
Copy `dev-bounty-page.tsx` to `pages/dev/bounty.tsx` (`?b=<board>`); `overview.js <n>` renders a whole board as
400px strips, `smoke.js <n…>` runs a dumb bot and reports crashes, `play.js <url> "W2500 B2000 J P<x> T<n> S"`
plays a scripted sequence and screenshots.
