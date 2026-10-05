// A page that reloads in the middle of a round comes back where it was (the room keeps its last presence), is told nothing new, and
// the match carries on to the podium. The first page is stopped and a fresh evaluation of main.js plays the part of the reloaded page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';
import { FakePlatform, fakeOw } from './fakeplatform.mjs';
import { goodRunner, headlessPlayer, keyboard } from './drivers.mjs';

const h = installBrowser({ width: 800, height: 400 });
const platform = new FakePlatform();
const roomB = platform.join('B', 'Bea');
let roomA = platform.join('A', 'Ann');
let { ow, out } = fakeOw(platform, roomA);
globalThis.onceworlds = ow;
await import('../game/main.js');
const B = headlessPlayer(platform, roomB);

const good = (room) => keyboard(h, room, (L) => goodRunner(L));
let keys = good(roomA);
let finalSeen = false;
const each = () => {
  platform.tick();
  B.drive();
  keys();
  const g = roomA.state.g;
  if (g && g.mid === platform.match.id && g.phase === 'final') finalSeen = true;
};

test('a reload mid-round puts the page back where it was', async () => {
  h.run(30, each);
  h.key('Space');
  h.key('Space', false);
  h.run(30, each);
  platform.settings = { rounds: 1, mode: 'back' };
  platform.startMatch(['B', 'A']);
  // run until the page's character is well up the field
  for (let i = 0; i < 60 * 40; i++) {
    h.run(1, each);
    const p = platform.players.get('A').presence;
    if (p && p.n === 1 && p.y > 20 && p.y < 45 && p.s === 0) break;
  }
  const before = platform.players.get('A').presence;
  assert.ok(before && before.n === 1, 'the page was playing round 1');
  assert.ok(before.y > 3, `it had got somewhere (y ${before.y})`);

  // ---- reload: the old page stops, the room keeps the player's seat and last presence, a fresh page loads
  h.st.raf = [];
  platform.drop(roomA);
  roomA = platform.join('A', 'Ann');
  ({ ow, out } = fakeOw(platform, roomA));
  globalThis.onceworlds = ow;
  keys = good(roomA);
  await import('../game/main.js?reloaded');
  for (let i = 0; i < 10; i++) { h.run(1, each); if (process.env.DBG) console.log('title', JSON.stringify(platform.players.get('A').presence)); }
  h.fireCanvas('pointerdown', { clientX: 100, clientY: 100 }); // a tap anywhere gets past the title mid-match
  for (let i = 0; i < 20; i++) { h.run(1, each); if (process.env.DBG) console.log('game', JSON.stringify(platform.players.get('A').presence)); }
  assert.equal(roomA.hidden !== false, false, 'the strip is not hidden once the page is in the game');
  const after = platform.players.get('A').presence;
  assert.ok(after.y >= before.y - 1, `it carried on from y ${before.y}, not from the start line (now ${after.y})`);
  assert.equal(after.n, 1);
  h.run(60 * 60 * 3, each);
  assert.ok(finalSeen, 'the match went on to its podium');
  assert.equal(platform.ended, 1);
  assert.equal(h.st.audioErrors.length, 0);
});
