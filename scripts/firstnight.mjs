// The first thirty seconds, played with real keys and clicks in headless Chrome: walk, throw a thread, spin an orb,
// wait for the first visitor. Prints each hint as it appears. node scripts/firstnight.mjs
import { serve, launch, sleep } from './cdp.mjs';

const { server, port } = await serve('game');
const b = await launch({ width: 1000, height: 680 });
const errors = [];
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const ev = (x) => b.evaluate(x);
const key = async (k, ms = 80) => {
  const code = k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k;
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined });
  await sleep(ms);
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
};
const click = async (x, y) => {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const hint = () => ev('__gossamer.hints.text');
const seen = [];
const note = async (what) => {
  const h = await hint();
  if (h && !seen.includes(h)) seen.push(h);
  console.log(what.padEnd(28), '| hint:', h, '| food', await ev('Math.round(__gossamer.run?.world.food ?? 0)'));
};
try {
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=night` });
  await sleep(2500);
  await ev("document.querySelector('.play').click()");
  await sleep(800);
  await ev("document.querySelector('.go').click()");
  await sleep(4500);
  await note('night begins');
  // 1. Walk.
  // The hint names the key for the way the branch runs; press that.
  const way = await ev('__gossamer.run.heading()');
  const walk = { up: 'w', down: 's', left: 'a', right: 'd' }[way] ?? 'd';
  for (let i = 0; i < 3; i++) await key(walk, 800);
  await sleep(300);
  await note('after walking');
  // 2. A far twig: an anchor 160-360 px away, in range.
  const twig = await ev(`(() => { const r = __gossamer.run; const w = r.world, me = r.me(), web = w.web; let best = null;
    for (let s = 0; s < web.nodeHigh; s++) { if (web.nid[s] < 0 || web.nid[s] >= 2000) continue; const d = Math.hypot(web.x[s]-me.x, web.y[s]-me.y); if (d < 160 || d > 360) continue;
      const p = __gossamer.renderer.cam.toScreen(web.x[s], web.y[s]); if (p.x < 80 || p.x > 920 || p.y < 90 || p.y > 600) continue; if (!best || Math.abs(d - 250) < best.e) best = { x: p.x, y: p.y, e: Math.abs(d - 250) }; }
    return best; })()`);
  if (twig) await click(twig.x, twig.y);
  await sleep(700);
  await note('after the first thread');
  // 3. Quick Orb at the best site in reach.
  await key('5');
  const site = await ev(`(() => { const r = __gossamer.run; const me = r.me(); const s = r.world.garden.sites.filter(s => Math.hypot(s.x-me.x, s.y-me.y) < 480).sort((a,b) => a.lane - b.lane)[0]; if (!s) return null; const p = __gossamer.renderer.cam.toScreen(s.x, s.y); return { x: p.x, y: p.y }; })()`);
  if (site) await click(Math.max(20, Math.min(980, site.x)), Math.max(20, Math.min(660, site.y)));
  await sleep(6000);
  await note('after the orb');
  // 4. The first visitor arrives.
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if ((await ev('__gossamer.run.world.tally.caught.fly ?? 0')) > 0) break;
  }
  await note('after the first catch');
  console.log('\nhints seen:', seen.join(' -> '));
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no errors');
} finally {
  b.close();
  server.close();
}
