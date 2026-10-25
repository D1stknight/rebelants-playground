# Fight engine preview tools

The Faction Wars fighters are driven by code (`components/fight`): IK poses, hit-stop, effects and the
22 finishing moves. These tools render them offline, frame by frame, so moves can be reviewed without playing.

## Offline harness (engine only)
1. Decode the faction models once (Blender/three can't read the Draco GLBs directly in this harness):
   `for f in ashigaru buke bushi kenshi ronin samurai shogun sohei warrior wokou yamabushi; do npx @gltf-transform/cli copy public/faction-wars/characters/$f/$f.glb <dir>/models/$f.glb; done`
2. Bundle: `npx esbuild tools/fight-preview/harness.ts --bundle --format=esm --external:three --external:'three/examples/jsm/*' --outfile=<dir>/harness.js`
3. Serve `<dir>` with `index.html`, `harness.js`, `models/` and a `three` symlink to `node_modules/three`.
4. `node run.js script.json out 960 540` — script: `{ "setup": ["kenshi","samurai"], "frames": 200, "cmds": [[3,"ko('enemy')"],[20,"void fin('player',0)"]] }`.
   Commands: `cmd(side, anim)`, `ko(side)`, `fin(side, index)` (use `void`, it returns a promise).

## Real arena capture
With `next dev` running and a dev page that renders `<FactionWarsArena>` (see the comment in `capture-arena.js`),
`node capture-arena.js out '<clips json>'` steps Playwright's fake clock 33 ms per frame and screenshots each frame.
