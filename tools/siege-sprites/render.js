// node tools/siege-sprites/render.js <fid> — needs `next dev -p 3111` + pages/dev/siege-sprite.tsx. Writes frames to /home/claude/siege/units/<fid>/<clip>_<i>.png
const { chromium } = require('playwright'); const fs = require('fs');
const PLAN = { idle: 8, attack: 10, magic: 10, special: 10, hit: 4, win: 8, defend: 4, lose: 6 };   // frames sampled per clip
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 512, height: 512 } });
  await p.route(/gstatic\.com\/draco.*\/(draco_[a-z_]+\.(js|wasm))/, r => { const f = r.request().url().split('/').pop(); r.fulfill({ status: 200, contentType: f.endsWith('.wasm') ? 'application/wasm' : 'application/javascript', body: fs.readFileSync('/home/claude/repo/node_modules/three/examples/jsm/libs/draco/gltf/' + f) }); });
  const fid = process.argv[2] || 'ronin'; const out = `/home/claude/siege/units/${fid}`; fs.mkdirSync(out, { recursive: true });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('http://localhost:3111/dev/siege-sprite?f=' + fid, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 }); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__setY(Math.PI / 2 + 0.35); window.__clip('idle', 0.2); });   // face screen-right, slight ¾ toward the camera
  let fit = await p.evaluate(() => window.__fit(100)); await p.evaluate((f) => window.__fitFixed(f, 1.35), fit);
  const meta = { fid, frames: {}, fit };
  for (const [clip, n] of Object.entries(PLAN)) {
    const len = await p.evaluate((c) => window.__clipLen(c), clip); meta.frames[clip] = [];
    for (let i = 0; i < n; i++) { const t = (i / n) * len * (clip === 'idle' ? 1 : 0.98); await p.evaluate(([c, t]) => window.__clip(c, t), [clip, t]); await p.evaluate((f) => window.__fitFixed(f, 1.35), fit); const d = await p.evaluate(() => window.__shot()); const f = `${out}/${clip}_${String(i).padStart(2, '0')}.png`; fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64')); meta.frames[clip].push(f); }
    console.log(fid, clip, n, 'len', len.toFixed(2));
  }
  fs.writeFileSync(`${out}/meta.json`, JSON.stringify(meta)); await b.close();
})();
