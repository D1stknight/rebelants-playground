const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  let errs = [];
  p.on('pageerror', e => errs.push(e.message));
  for (const n of process.argv.slice(2)) {
    errs = [];
    await p.goto('http://localhost:3111/dev/bounty?b=' + n, { waitUntil: 'load', timeout: 60000 });
    await p.waitForTimeout(3500);
    await p.keyboard.down('ArrowRight'); await p.keyboard.down('x');
    let maxX = 0;
    for (let i = 0; i < 60; i++) {
      await p.keyboard.down('z'); await p.waitForTimeout(150 + (i % 3) * 120); await p.keyboard.up('z'); await p.waitForTimeout(250);
      const st = await p.evaluate(() => { const g = window.__bg; return g ? { x: g.player.x, s: g.state, l: g.lives, over: g.over } : null; });
      if (!st) break; maxX = Math.max(maxX, st.x); if (st.over) break;
    }
    await p.keyboard.up('ArrowRight'); await p.keyboard.up('x');
    const st = await p.evaluate(() => { const g = window.__bg; return { x: Math.round(g.player.x), end: g.level.endX, s: g.state, l: g.lives, ents: g.ents.length, res: window.__end }; });
    console.log('board', n, JSON.stringify(st), 'maxX', Math.round(maxX), 'errors', errs.length ? errs.slice(0, 2) : 0);
  }
  await b.close();
})();
