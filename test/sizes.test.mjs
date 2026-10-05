// The same page on every kind of screen: a phone held both ways, a tiny window, a laptop, a wide monitor. A whole one-round match at
// each size (title, lobby, countdown, round, scoreboard, podium) must draw without a single bad canvas call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';
import * as ui from '../game/ui.js';

const h = installBrowser({ width: 800, height: 400 });
await import('../game/main.js');

const texts = new Set();
let lastFrame = [];
const go = (n, each) =>
  h.run(n, (i) => {
    lastFrame = h.st.texts.slice();
    for (const t of h.st.texts) texts.add(t);
    h.st.texts.length = 0;
    each?.(i);
  });
const find = (id) => {
  const W = globalThis.innerWidth;
  const H = globalThis.innerHeight;
  for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) if (ui.hitTest(x, y) === id) return [x, y];
  return null;
};
const resize = (w, hh) => {
  globalThis.innerWidth = w;
  globalThis.innerHeight = hh;
  h.fire('resize');
};

test('a one-round match at every screen size', () => {
  go(30);
  h.key('Space');
  h.key('Space', false);
  go(30);
  // rounds 3 -> 5 -> 1
  for (let i = 0; i < 2; i++) {
    const at = find('set-rounds');
    assert.ok(at, 'the Rounds chip is on screen');
    h.fireCanvas('pointerdown', { clientX: at[0], clientY: at[1] });
    h.fireCanvas('pointerup', { clientX: at[0], clientY: at[1] });
    go(20);
  }
  const sizes = [
    [800, 400],
    [360, 640],
    [640, 360],
    [300, 150],
    [1920, 1080],
    [3440, 1440],
    [1024, 768],
    [844, 390],
    [120, 60],
  ];
  let holding = false;
  let n = 0;
  for (const [w, hh] of sizes) {
    resize(w, hh);
    texts.clear();
    h.key('Enter');
    h.key('Enter', false);
    go(60 * 140, () => {
      n++;
      const want = n % 420 < 280;
      if (want && !holding) h.key('Space');
      if (!want && holding) h.key('Space', false);
      holding = want;
    });
    assert.ok(texts.has('ROUND 1'), `${w}x${hh}: the scoreboard`);
    assert.ok(lastFrame.includes('ROUNDS') && lastFrame.includes('CAUGHT'), `${w}x${hh}: back in the lobby when it's over`);
    assert.ok(texts.has('SPEEDY') || texts.has('STATUE') || texts.has('1'), `${w}x${hh}: a podium`);
    assert.ok(h.canvas.width > 0 && h.canvas.height > 0);
  }
  assert.equal(h.st.audioErrors.length, 0);
});
