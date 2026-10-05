// The real page (a client) plays a match with another human who is the host (a headless player driven here with the same net code),
// six bots, Out mode, three rounds. Halfway through the host role moves to the page under test, which must carry on from room state.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';
import { FakePlatform, fakeOw } from './fakeplatform.mjs';
import { createNet } from '../game/net.js';
import { FIELD_W } from '../game/rules.js';
import { headlessPlayer } from './drivers.mjs';

const h = installBrowser({ width: 640, height: 360 });
const platform = new FakePlatform();
const roomB = platform.join('B', 'Bea');
const roomA = platform.join('A', 'Ann');
const { ow, out } = fakeOw(platform, roomA);
globalThis.onceworlds = ow;
const roomC = platform.join('C', 'Cee'); // someone watching: reads the bots from their snapshots, like any page that isn't the host
const netC = createNet({}, roomC);
await import('../game/main.js');

// ---- the other human: a good player, headless, and the host
const B = headlessPlayer(platform, roomB);
const driveB = () => B.drive();

// ---- the page under test: a sloppy player who ignores the lights
let step = 0;
let holding = false;
let driving = false;
function driveA() {
  if (!driving) return;
  step++;
  const want = step % 500 < 330;
  if (want && !holding) h.key('Space');
  if (!want && holding) h.key('Space', false);
  holding = want;
}

const texts = new Set();
const seenBots = { moved: 0, maxY: 0, states: new Set(), bad: 0 };
const tmp = {};
const rounds = [];
let hostSwitched = false;
let finalSeen = false;
const phases = new Set();
function each() {
  platform.tick();
  driveB();
  driveA();
  for (const t of h.st.texts) texts.add(t);
  h.st.texts.length = 0;
  const g = roomA.state.g;
  const gc = netC.g();
  if (gc && gc.phase === 'round' && roomC.matchNow() > gc.t0) {
    for (let i = 0; i < 6; i++) {
      if (!netC.botAt(i, gc.rid, roomC.matchNow() - 140, tmp)) continue;
      if (![tmp.x, tmp.y, tmp.vx, tmp.vy, tmp.s].every(Number.isFinite) || tmp.x < 0 || tmp.x > FIELD_W || tmp.y < 0 || tmp.y > 70) seenBots.bad++;
      if (tmp.y > 3) seenBots.moved++;
      seenBots.maxY = Math.max(seenBots.maxY, tmp.y);
      seenBots.states.add(tmp.s);
    }
  }
  if (g && g.phase === 'board' && !rounds.some((r) => r.rid === g.rid)) rounds.push({ rid: g.rid, res: g.res.length, nFin: g.nFin, out: Object.keys(g.out).length, secs: (g.at - g.t0) / 1000 });
  if (g && g.mid === platform.match.id) {
    phases.add(g.phase);
    if (g.phase === 'final') finalSeen = true;
    if (!hostSwitched && g.n === 2 && g.phase === 'round' && platform.hostId === 'B' && roomA.matchNow() > g.t0 + 6000) {
      hostSwitched = true;
      platform.setHost('A');
    }
  }
}

test('a client page plays a whole Out-mode match with a human host, then the host moves to it', () => {
  h.run(60, each);
  assert.equal(out.orientation, 'landscape');
  assert.equal(roomA.hidden, true, 'the lobby strip is hidden under the title');
  assert.ok(texts.has('PLAY'));
  h.key('Space');
  h.key('Space', false);
  driving = true;
  h.run(30, each);
  assert.equal(roomA.hidden, false, 'PLAY brings the strip back');
  assert.ok(out.controls && out.controls.stick === 'analog' && out.controls.buttons[0].id === 'run', 'touch controls in the lobby arena');
  platform.settings = { rounds: 3, mode: 'out' };
  platform.startMatch(['B', 'A']);
  h.run(60 * 60 * 6, each);
  assert.ok(finalSeen, 'a podium was reached');
  assert.ok(hostSwitched, 'the host moved mid-round');
  assert.equal(platform.ended, 1, 'the host called endMatch once');
  assert.equal(platform.match.phase, 'lobby');
  assert.deepEqual([...phases].sort(), ['board', 'final', 'round']);
  const g = roomA.state.g;
  assert.equal(g.mode, 'out');
  assert.equal(g.n, 3);
  assert.equal(g.by, 'A', 'the new host wrote the rest of the match');
  assert.equal(g.final.length, 8);
  assert.ok(g.final.includes('A') && g.final.includes('B'));
  for (const id of g.roster) assert.ok(Number.isInteger(g.scores[id]));
  assert.ok(texts.has('BZZT!'));
  if (process.env.RLGL_DEBUG) console.log(JSON.stringify({ rounds, seenBots: { ...seenBots, states: [...seenBots.states] }, scores: g.scores, st: g.st, final: g.final, aw: g.aw }));
  assert.equal(seenBots.bad, 0, 'a client page reads sane bot positions from the snapshots');
  assert.ok(seenBots.moved > 500 && seenBots.maxY > 40, 'and the bots really run up the field');
  assert.equal(rounds.length, 3);
  for (const r of rounds) assert.equal(r.res, 8);
  assert.ok(out.saved.stats && out.saved.stats.matches === 1, 'the match was saved once');
  assert.equal(h.st.audioErrors.length, 0);
  assert.ok(out.controls, 'controls back on in the lobby');
});

test('both pages kept the same record', () => {
  const a = JSON.stringify(roomA.state.g);
  h.run(60, each);
  assert.equal(JSON.stringify(roomB.state.g).length > 10, true);
  assert.ok(a.length > 10);
});
