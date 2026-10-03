// Opens the game in headless Chrome, runs a script of steps and saves screenshots. Used while building.
//   node scripts/shot.mjs <out-dir> [width] [height] [steps...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const [out = '/tmp/gossamer-shots', w = '1100', h = '760', ...steps] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { server, port } = await serve('game');
const b = await launch({ width: Number(w), height: Number(h) });
const errors = [];
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(`${m.params.type}: ${m.params.args?.map((a) => a.value ?? a.description).join(' ')}`);
});
await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=${process.env.TEST ?? 'bot'}` });
await sleep(2500);
let n = 0;
for (const step of steps.length ? steps : ['shot']) {
  if (step === 'shot') {
    const r = await b.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}/shot-${n++}.png`, Buffer.from(r.result.data, 'base64'));
  } else if (step.startsWith('wait:')) await sleep(Number(step.slice(5)));
  else if (step.startsWith('eval:')) console.log('eval', String(JSON.stringify(await b.evaluate(step.slice(5)))).slice(0, 400));
  else if (step.startsWith('click:')) {
    const [x, y] = step.slice(6).split(',').map(Number);
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  } else if (step.startsWith('key:')) {
    const key = step.slice(4);
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, text: key.length === 1 ? key : undefined });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key });
  }
}
console.log(errors.length ? `ERRORS:\n${errors.slice(0, 20).join('\n')}` : 'no errors');
b.close();
server.close();
