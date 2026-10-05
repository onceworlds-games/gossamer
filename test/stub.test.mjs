// The page on its own (no platform): it runs against its local stub room. Drives the real main.js frame by frame in a pretend browser:
// title, PLAY, the lobby arena, Enter to start, the countdown, a sloppy player through a whole 3-round match, the podium, back to the lobby.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';

const h = installBrowser({ width: 800, height: 400 });
await import('../game/main.js');

const everything = new Set();
const seen = () => new Set([...everything, ...h.st.texts]);
let lastFrame = [];
const go = (n, each) =>
  h.run(n, (i) => {
    lastFrame = h.st.texts.slice();
    for (const t of h.st.texts) everything.add(t);
    h.st.texts.length = 0;
    each?.(i);
  });

test('title, lobby, countdown, three rounds, podium and back, without a single bad canvas call', () => {
  go(60);
  assert.ok(seen().has('PLAY'), 'the title shows PLAY');
  h.key('Space');
  h.key('Space', false);
  go(60);
  assert.ok(seen().has('ROUNDS'), 'the lobby shows the settings');
  assert.ok(seen().has('Hold to run, let go on red!'), 'and the hint');
  // run around in the lobby arena (practice lights, nothing at stake)
  h.key('Space');
  go(600);
  h.key('Space', false);
  h.key('KeyA');
  go(30);
  h.key('KeyA', false);
  // start
  h.key('Enter');
  h.key('Enter', false);
  go(200);
  assert.ok(seen().has('3') || seen().has('2') || seen().has('1'), 'a countdown number');
  // a sloppy player: holds run on green and a good while into yellow, sometimes through red
  let step = 0;
  let holding = false;
  go(60 * 60 * 6, () => {
    step++;
    const want = step % 600 < 380; // runs for a while, stops for a while, ignoring the lights
    if (want && !holding) h.key('Space');
    if (!want && holding) h.key('Space', false);
    holding = want;
  });
  for (const word of ['GO!', 'FREEZE ON ', 'RED!', 'ROUND 1/3', 'ROUND 1', 'ROUND 3', 'BZZT!', 'STOP!']) {
    assert.ok(everything.has(word), `saw "${word}" on screen`);
  }
  assert.ok(everything.has('STATUE') || everything.has('SPEEDY'), 'the podium showed its awards');
  assert.ok(lastFrame.includes('Enter: start') && lastFrame.includes('ROUNDS'), 'back in the lobby arena after the match');
  assert.equal(h.st.audioErrors.length, 0, `audio errors: ${h.st.audioErrors.join(', ')}`);
  assert.ok(h.st.drawCalls > 100000);
});
