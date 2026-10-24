# Rebel Grand Prix — asset pipeline

- `build_tracks.py` — the 15 tracks (closed splines + hazards) → `public/rgp/tracks/<id>/{map.png, surf.png, track.json, thumb.png}`.
  Surface ids: 0 grass · 1 road · 2 shoulder · 3 boost · 4 wall · 5 liquid · 6 sand · 7 slick. Maps are 48-colour PNGs (~50 KB) with block noise so they compress.
- `props.py` — billboard props + item sprites → `public/rgp/props.png` (64×64, 8 per row; ids in `engine.ts` PROP).
- Kart sprites: copy `dev-kart-page.tsx` to `pages/dev/kart.tsx`, run `next dev -p 3111`, then `render_all_karts.sh`
  (`kart_render.js` renders 16 yaw angles of the faction GLB seated in a procedural chassis; `assemble_karts.py` pixelizes to 96×96 ×16 sheets).
  Frame 0 = seen from behind, frames rotate the kart counter-clockwise (viewed from above). Palette-compress with PIL FASTOCTREE 64 colours.
- `dev-gp-page.tsx` → `pages/dev/gp.tsx?t=<track>&f=<faction>&k=<chassis>&ai=1` mounts RaceView (`ai=1` autopilots the player for smoke tests); `gpshot.js` screenshots/inspects it.
Dev pages are never committed under pages/dev.

## Broadcast / F1 look (v2)
- `build_tracks_hd.py` repaints every track over the same geometry → `public/rgp/tracks/<id>/map_hd.webp` (2048², 2 texels per world unit) + `thumb.png`:
  mown grass, gravel run-off, asphalt with a rubbered line, white track limits, red/white kerbs on corners, chequered line + grid boxes, barriers, painted logos.
  Physics still come from `surf.png` / `track.json` (unchanged). The engine samples it bilinearly with a mip chain, at 2× resolution (drops to 1.5×/1× on slow devices).
- HD cars: copy `dev-f1-page.tsx` to `pages/dev/f1.tsx`, run `next dev -p 3111`, then `render_all_f1.sh` (`f1_render.js` = 16 yaw renders of a procedural
  F1 car with the faction rider; `assemble_f1.py` crops rows 250–778 to 288×149 frames → `public/rgp/cars/car_<f>_<k>.webp`). Engine: frame width = `CAR_W` world units,
  ground point 64.2% down the frame. The old pixel karts in `public/rgp/karts` stay as the fallback.
- `components/RebelGP/trackside.ts` paints the sky panorama, start-light gantry, grandstands and sponsor boards at runtime (no assets).
