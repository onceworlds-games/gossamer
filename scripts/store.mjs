// Captures the store art from the game's own scenes (?poster=...) in headless Chrome and writes it into store/.
//   npm run store            (everything)
//   node scripts/store.mjs thumb1
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const BADGES = ['first-catch', 'orb-complete', 'perfect-radials', 'moth-hunter', 'beetle-buster', 'wren-dodge', 'wasp-slayer', 'ten-nights', 'daily-weaver', 'silk-donor', 'dew-master', 'mantis-off'];
const SHOTS = [
  ['thumb1', 1280, 720, 'store/thumb-1.png'],
  ['thumb2', 1280, 720, 'store/thumb-2.png'],
  ['thumb3', 1280, 720, 'store/thumb-3.png'],
  ['thumb4', 1280, 720, 'store/thumb-4.png'],
  ['icon', 512, 512, 'store/icon.png'],
  ...BADGES.map((id) => [`badge-${id}`, 256, 256, `store/badges/${id}.png`]),
];

const only = process.argv[2];
mkdirSync('store/badges', { recursive: true });
const { server, port } = await serve('game');
const b = await launch({ width: 1280, height: 720 });
const errors = [];
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
for (const [kind, w, h, out] of SHOTS) {
  if (only && !kind.includes(only) && !out.includes(only)) continue;
  await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await b.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: kind.startsWith('badge') ? 0 : 1 } });
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?poster=${kind}` });
  let ok = false;
  for (let i = 0; i < 300 && !ok; i++) {
    await sleep(100);
    ok = (await b.evaluate('window.__posterReady === true')) === true;
  }
  await sleep(kind.startsWith('badge') ? 200 : 900);
  const r = await b.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  console.log(ok ? 'saved' : 'TIMEOUT', out);
}
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
b.close();
server.close();
