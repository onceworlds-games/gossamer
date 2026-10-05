// When the room closes the page shows one message and one button; the button joins a new room and the page starts over in it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';
import { FakePlatform, fakeOw } from './fakeplatform.mjs';
import * as ui from '../game/ui.js';

const h = installBrowser({ width: 640, height: 360 });
const platform = new FakePlatform();
const roomA = platform.join('A', 'Ann');
const { ow, out } = fakeOw(platform, roomA);
globalThis.onceworlds = ow;
await import('../game/main.js');

const texts = new Set();
const each = () => {
  platform.tick();
  for (const t of h.st.texts) texts.add(t);
  h.st.texts.length = 0;
};
const find = (id) => {
  for (let y = 0; y < 360; y += 6) for (let x = 0; x < 640; x += 6) if (ui.hitTest(x, y) === id) return [x, y];
  return null;
};

test('a closed room shows a message and a button, and the button starts over in a new room', async () => {
  h.run(30, each);
  h.key('Space');
  h.key('Space', false);
  h.run(30, each);
  assert.ok(texts.has('ROUNDS'));
  assert.ok(out.controls);
  roomA.emit('close', 'kicked');
  h.run(10, each);
  assert.ok(texts.has('You were removed'));
  assert.ok(texts.has('PLAY'));
  assert.equal(out.controls, null, 'controls go away with the room');
  const at = find('rejoin');
  assert.ok(at, 'the button is on screen');
  const second = platform.join('A', 'Ann');
  out.room = second; // what the platform's next rooms.join() hands back
  texts.clear();
  h.fireCanvas('pointerdown', { clientX: at[0], clientY: at[1] });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  h.run(30, each);
  assert.ok(texts.has('ROUNDS'), 'back in the lobby arena, in the new room');
  assert.ok(!texts.has('PLAY'), 'no title again');
  assert.ok(out.controls, 'controls are back');
  assert.ok(second.me.presence, 'the page plays in the new room');
});
