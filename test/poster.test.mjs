// The store art: with ?poster=<name> the page needs no room and no SDK, draws one frame at the poster's exact size and says it's ready.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';

const h = installBrowser();
const posters = {
  cover: [1280, 720],
  action: [1280, 720],
  win: [1280, 720],
  icon: [512, 512],
  'badge-first-win': [256, 256],
  'badge-statue': [256, 256],
  'badge-photo-finish': [256, 256],
  'badge-marathon': [256, 256],
};

for (const [name, [w, hgt]] of Object.entries(posters)) {
  test(`poster ${name} is ${w}x${hgt}, drawn without the SDK`, async () => {
    globalThis.location = { search: `?poster=${name}` };
    h.canvas.width = 0;
    h.st.drawCalls = 0;
    h.st.texts.length = 0;
    document.body.dataset = {};
    assert.equal(globalThis.onceworlds, undefined);
    await import(`../game/main.js?poster-${name}`);
    assert.equal(document.body.dataset.ready, '1');
    assert.equal(h.canvas.width, w);
    assert.equal(h.canvas.height, hgt);
    assert.ok(h.st.drawCalls > 10, 'something was drawn');
    assert.equal(h.st.raf.length, 0, 'no game loop');
    if (name === 'cover') assert.ok(h.st.texts.some((t) => t.includes('RED LIGHT')), 'the title is the only text');
    if (name === 'action' || name === 'icon' || name.startsWith('badge-')) assert.equal(h.st.texts.length, 0, 'no text');
  });
}
