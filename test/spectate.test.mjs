// A page that arrives while a match is running watches it (a label, no controls, no character of its own) and plays the next one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';
import { FakePlatform, fakeOw } from './fakeplatform.mjs';
import { goodRunner, headlessPlayer, keyboard } from './drivers.mjs';

const h = installBrowser({ width: 640, height: 360 });
const platform = new FakePlatform();
const roomB = platform.join('B', 'Bea');
const B = headlessPlayer(platform, roomB);
platform.settings = { rounds: 1, mode: 'back' };
platform.startMatch(['B']);
const roomA = platform.join('A', 'Ann'); // arrives while the countdown runs: not one of the match's players
const { ow, out } = fakeOw(platform, roomA);
globalThis.onceworlds = ow;
await import('../game/main.js');

const texts = new Set();
const keys = keyboard(h, roomA, (L) => goodRunner(L));
const each = () => {
  platform.tick();
  B.drive();
  keys();
  for (const t of h.st.texts) texts.add(t);
  h.st.texts.length = 0;
};

test('a late page watches, then plays the next match', () => {
  h.run(30, each);
  h.fireCanvas('pointerdown', { clientX: 50, clientY: 50 }); // past the title
  h.run(60 * 8, each);
  assert.equal(roomA.spectating, true);
  assert.equal(out.controls, null, 'no touch controls for a watcher');
  assert.ok(texts.has('Watching'), 'a Watching label');
  assert.equal(platform.players.get('A').presence, null, 'a watcher has no character in the match');
  // the match runs to its podium and ends
  h.run(60 * 100, each);
  assert.equal(platform.ended, 1);
  assert.equal(platform.match.phase, 'lobby');
  h.run(30, each);
  assert.ok(out.controls && out.controls.buttons[0].id === 'run', 'the lobby arena has its controls');
  // the next match has both
  platform.settings = { rounds: 1, mode: 'back' };
  platform.startMatch(['B', 'A']);
  h.run(60 * 100, each);
  const g = roomA.state.g;
  assert.ok(g.roster.includes('A'));
  assert.equal(g.phase === 'final' || platform.ended === 2, true, 'the second match finished too');
  assert.ok(out.saved.stats && out.saved.stats.matches === 1, 'only the match it played was saved');
  assert.equal(h.st.audioErrors.length, 0);
});
