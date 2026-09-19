// kart_render.js <faction> <chassis> <paint> <accent> <outdir> [angles=16] [poseJSON]
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [fid, kid, paint, accent, outDir, anglesS, poseS] = process.argv.slice(2);
  const N = parseInt(anglesS || '16'); const pose = poseS ? JSON.parse(poseS) : {};
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 560, height: 560 } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.route(/gstatic\.com\/draco.*\/(draco_[a-z_]+\.(js|wasm))/, r => { const f = r.request().url().split('/').pop(); r.fulfill({ status: 200, contentType: f.endsWith('.wasm') ? 'application/wasm' : 'application/javascript', body: fs.readFileSync('/home/claude/repo/node_modules/three/examples/jsm/libs/draco/gltf/' + f) }); });
  await p.goto(`http://localhost:3111/dev/kart?f=${fid}&k=${kid}&p=${paint}&a=${accent}`, { waitUntil: 'load', timeout: 90000 });
  await p.waitForFunction(() => window.__ready, null, { timeout: 90000 }); await p.waitForTimeout(300);
  fs.mkdirSync(outDir, { recursive: true });
  const info = await p.evaluate((pose) => { const r = window.__pose(pose); window.__cam(1.12, pose.pitch == null ? 0.36 : pose.pitch); return r; }, pose);
  for (let i = 0; i < N; i++) {
    // angle 0 = seen from behind (kart front +x points away from the camera at +z → yaw so that +x maps to -z)
    const yaw = Math.PI / 2 + (i / N) * Math.PI * 2;
    const data = await p.evaluate((y) => { window.__yaw(y); return window.__shot(); }, yaw);
    fs.writeFileSync(`${outDir}/a${String(i).padStart(2, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  console.log('done', info);
  await b.close();
})();
