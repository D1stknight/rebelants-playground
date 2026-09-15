const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 675 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|walletconnect|reown|web3modal/i.test(m.text())) console.log('ERR', m.text().slice(0, 200)); });
  const url = process.argv[2] || 'http://localhost:3111/dev/bounty?b=1';
  await p.goto(url, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: '/home/claude/bh/play0.png' });
  const script = process.argv[3] || 'R3000 F1000 J R2000 S';
  let i = 1;
  for (const cmd of script.split(' ')) {
    const k = cmd[0], n = parseInt(cmd.slice(1) || '0', 10);
    if (k === 'R') { await p.keyboard.down('ArrowRight'); await p.waitForTimeout(n); await p.keyboard.up('ArrowRight'); }
    if (k === 'L') { await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(n); await p.keyboard.up('ArrowLeft'); }
    if (k === 'F') { await p.keyboard.down('x'); await p.waitForTimeout(n); await p.keyboard.up('x'); }
    if (k === 'B') { await p.keyboard.down('ArrowRight'); await p.keyboard.down('x'); await p.waitForTimeout(n); await p.keyboard.up('x'); await p.keyboard.up('ArrowRight'); }
    if (k === 'J') { await p.keyboard.down('z'); await p.waitForTimeout(300); await p.keyboard.up('z'); }
    if (k === 'U') { await p.keyboard.down('ArrowUp'); await p.keyboard.down('x'); await p.waitForTimeout(n); await p.keyboard.up('x'); await p.keyboard.up('ArrowUp'); }
    if (k === 'W') { await p.waitForTimeout(n); }
    if (k === 'P') { await p.evaluate((n) => { const g = window.__bg; g.player.x = n; g.cam = Math.max(0, n - 150); }, n); await p.waitForTimeout(300); }
    if (k === 'T') { await p.evaluate((n) => { const g = window.__bg; g.player.x = g.level.bossX - n; g.cam = g.player.x - 150; }, n); await p.waitForTimeout(300); }
    if (k === 'S') { await p.screenshot({ path: `/home/claude/bh/play${i++}.png` }); }
  }
  console.log('end', JSON.stringify(await p.evaluate(() => (window).__end || null)));
  await b.close();
})();
