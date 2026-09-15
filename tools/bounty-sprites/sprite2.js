const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 560, height: 560 } });
  await p.route(/gstatic\.com\/draco.*\/(draco_[a-z_]+\.(js|wasm))/, r => { const f = r.request().url().split('/').pop(); r.fulfill({ status: 200, contentType: f.endsWith('.wasm') ? 'application/wasm' : 'application/javascript', body: fs.readFileSync('/home/claude/repo/node_modules/three/examples/jsm/libs/draco/gltf/' + f) }); });
  const fid = process.argv[2] || 'samurai';
  await p.goto('http://localhost:3111/dev/sprite?f=' + fid, { waitUntil: 'load', timeout: 60000 });
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 }); await p.waitForTimeout(300);
  const poses = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const outDir = process.argv[4]; fs.mkdirSync(outDir, { recursive: true });
  let fit = null;
  for (const [i, pose] of poses.entries()) {
    await p.evaluate((pose) => { window.__clip(pose.clip || 'idle', pose.t || 0); window.__setY(pose.ry == null ? Math.PI / 2 : pose.ry); for (const r of (pose.rot || [])) window.__rot(r[0], r[1], r[2], r[3]); for (const r of (pose.pos || [])) window.__pos(r[0], r[1], r[2], r[3]); if (pose.gun) window.__gun(true, ...pose.gun); else window.__gun(false); if (pose.tilt) window.__tilt(...pose.tilt); }, pose);
    if (!fit) { fit = await p.evaluate(() => window.__fit(100)); fit = await p.evaluate((h) => window.__fit(h), fit[1] * 1.25); await p.evaluate(() => { const c = window.__camFix = true; }); }
    else await p.evaluate((f) => window.__fitFixed(f), fit);
    const data = await p.evaluate(() => window.__shot());
    fs.writeFileSync(`${outDir}/f${String(i).padStart(2, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  console.log('done', poses.length, fit);
  await b.close();
})();
