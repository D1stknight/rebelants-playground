// showcase capture: node arena3.js <out> <clips json> [W H]
// clip: { p, e, fin, pre: [[frame, js]], ko: frame, len: frames }
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const [out, clipsJson, W = 960, H = 540] = process.argv.slice(2); const clips = JSON.parse(clipsJson);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.route(/gstatic\.com\/draco\//, async (r) => { const f = path.join('/home/claude/repo/node_modules/three/examples/jsm/libs/draco/gltf', path.basename(new URL(r.request().url()).pathname)); r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' }); });
  await p.goto(`http://localhost:3111/dev/fwfight?p=${clips[0].p}&e=${clips[0].e}&h=${H}px`, { timeout: 180000 });
  await p.addStyleTag({ content: 'body{padding:0!important;margin:0!important} button:not([style]){display:none}' });
  await p.waitForSelector('canvas', { timeout: 120000 }); await p.waitForTimeout(9000);
  await p.clock.install(); await p.clock.pauseAt(Date.now() + 1000);
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true }); let n = 0;
  for (const c of clips) {
    await p.evaluate(([pf, ef]) => { const d = window.__dev; d.setPhp(100); d.setEhp(100); d.setPf(pf); d.setEf(ef); }, [c.p, c.e]);
    for (let i = 0; i < 40; i++) { await p.clock.runFor(33); await p.waitForTimeout(30); } // let models load (not captured)
    await p.evaluate(() => { window.__dev.setPhp(100); window.__dev.setEhp(100); });
    const cmds = {}; for (const [f, js] of c.pre) (cmds[f] ||= []).push(js);
    let clicked = false;
    for (let f = 0; f < c.len; f++) {
      if (cmds[f]) for (const js of cmds[f]) await p.evaluate(js).catch(e => console.log('EVAL', e.message));
      if (f === c.ko) await p.evaluate(() => window.__dev.setEhp(0));
      if (!clicked && f > c.ko) clicked = await p.evaluate((name) => { const bt = [...document.querySelectorAll('button')].find((x) => x.textContent.toLowerCase().includes(name.toLowerCase())); if (bt) { bt.click(); return true; } return false; }, c.fin);
      await p.clock.runFor(33);
      await p.screenshot({ path: `${out}/f${String(n++).padStart(5, '0')}.jpg`, quality: 88, timeout: 180000, clip: { x: 0, y: 0, width: +W, height: +H } });
    }
    console.log('clip', c.fin, n);
  }
  await b.close();
})();
