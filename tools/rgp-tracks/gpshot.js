// gpshot.js <url> <out> — keys via KEYS env "ArrowUp:3000;ArrowRight:400" (hold key for ms, sequential), WAIT ms before
const { chromium } = require('playwright');
(async () => {
  const [url, out] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const W = parseInt(process.env.W || '960'), H = parseInt(process.env.H || '540');
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|TUNNEL/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200)); });
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__gp, null, { timeout: 60000 });
  await p.waitForTimeout(parseInt(process.env.WAIT || '5000'));
  if (process.env.KEYS) for (const seg of process.env.KEYS.split(';')) { const [keys, ms] = seg.split(':'); const ks = keys.split('+'); for (const k of ks) await p.keyboard.down(k); await p.waitForTimeout(parseInt(ms)); for (const k of ks) await p.keyboard.up(k); }
  await p.screenshot({ path: out });
  console.log(await p.evaluate(() => { const g = window.__gp; const m = g.me; if (window.__gpEnd) return { END: window.__gpEnd, state: g.state }; return { state: g.state, t: g.t.toFixed(1), me: { x: m.x | 0, y: m.y | 0, h: +m.h.toFixed(2), speed: m.speed | 0, lap: m.lap, cp: m.cp, rank: m.rank, surf: g.surfAt(m.x, m.y) }, ranks: g.karts.map(k => k.rank + ':' + k.name + ':' + (k.prog | 0)).join(' ') }; }));
  await b.close();
})();
