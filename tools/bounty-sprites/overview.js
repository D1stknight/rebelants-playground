const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 675 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  const n = process.argv[2] || '1';
  await p.goto('http://localhost:3111/dev/bounty?b=' + n, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(4500);
  const shots = await p.evaluate(async () => {
    const g = window.__bg; const out = []; g.stop(); g.state = 'play';
    for (let x = 0; x < g.level.endX; x += 400) { g.cam = x; g.t += 0.4; g.render(); out.push(g.ctx.canvas.toDataURL('image/png')); }
    return out;
  });
  const dir = `/home/claude/bh/ov${n}`; fs.mkdirSync(dir, { recursive: true });
  shots.forEach((d, i) => fs.writeFileSync(`${dir}/${String(i).padStart(2, '0')}.png`, Buffer.from(d.split(',')[1], 'base64')));
  console.log('shots', shots.length);
  await b.close();
})();
