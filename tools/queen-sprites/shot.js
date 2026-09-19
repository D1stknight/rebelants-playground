const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('http://localhost:3111/dev/queen' /* copy tools/queen-sprites/dev-queen-page.tsx to pages/dev/queen.tsx first */, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 }); await p.waitForTimeout(500);
  console.log('size', await p.evaluate(() => window.__size));
  const views = { front: 0, left34: Math.PI / 5, right34: -Math.PI / 5, left: Math.PI / 2.4, right: -Math.PI / 2.4 };
  for (const [n, ry] of Object.entries(views)) { await p.evaluate((ry) => { window.__setY(ry); window.__cam(0); }, ry); await p.waitForTimeout(100); const d = await p.evaluate(() => window.__shot()); fs.writeFileSync(`q_${n}.png`, Buffer.from(d.split(',')[1], 'base64')); console.log(n); }
  await b.close();
})();
