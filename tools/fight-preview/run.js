// node hrun.js <script.json> <outdir> [w h]
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [scriptPath, out, W = 960, H = 540] = process.argv.slice(2); const S = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('LOG', m.text().slice(0, 300)); });
  await p.goto(`http://localhost:8123/hindex.html?w=${W}&h=${H}`); await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
  await p.evaluate(([a, c]) => window.setup(a, c), S.setup);
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const cmds = {}; for (const [f, js] of S.cmds) (cmds[f] ||= []).push(js);
  const shots = new Set(S.shots || []);
  for (let f = 0; f < S.frames; f++) {
    if (cmds[f]) for (const js of cmds[f]) await p.evaluate(js);
    await p.evaluate(() => window.step(1 / 30));
    if (!S.shots || shots.has(f)) await p.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.jpg`, quality: 85 });
  }
  const lg = await p.evaluate(() => window.log()); fs.writeFileSync(`${out}/events.txt`, lg.join('\n'));
  await b.close();
})();
