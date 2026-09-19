# Rebel Grand Prix — asset pipeline

- `build_tracks.py` — the 15 tracks (closed splines + hazards) → `public/rgp/tracks/<id>/{map.png, surf.png, track.json, thumb.png}`.
  Surface ids: 0 grass · 1 road · 2 shoulder · 3 boost · 4 wall · 5 liquid · 6 sand · 7 slick. Maps are 48-colour PNGs (~50 KB) with block noise so they compress.
- `props.py` — billboard props + item sprites → `public/rgp/props.png` (64×64, 8 per row; ids in `engine.ts` PROP).
- Kart sprites: copy `dev-kart-page.tsx` to `pages/dev/kart.tsx`, run `next dev -p 3111`, then `render_all_karts.sh`
  (`kart_render.js` renders 16 yaw angles of the faction GLB seated in a procedural chassis; `assemble_karts.py` pixelizes to 96×96 ×16 sheets).
  Frame 0 = seen from behind, frames rotate the kart counter-clockwise (viewed from above). Palette-compress with PIL FASTOCTREE 64 colours.
- `dev-gp-page.tsx` → `pages/dev/gp.tsx?t=<track>&f=<faction>&k=<chassis>&ai=1` mounts RaceView (`ai=1` autopilots the player for smoke tests); `gpshot.js` screenshots/inspects it.
Dev pages are never committed under pages/dev.
