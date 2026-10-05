// Several matches in a row through the real page, with different seeds, round counts, modes and kinds of player (good, sloppy, idle),
// to find the rare branch: a fake-out during a catch, a tie, a photo finish, a ghost finishing the round alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './harness.mjs';
import { FakePlatform, fakeOw } from './fakeplatform.mjs';
import { goodRunner, headlessPlayer, keyboard } from './drivers.mjs';

const h = installBrowser({ width: 740, height: 360 });
const platform = new FakePlatform({ latency: 40 });
const roomB = platform.join('B', 'Bea');
const roomA = platform.join('A', 'Ann');
const roomC = platform.join('C', 'Cy');
const { ow, out } = fakeOw(platform, roomA);
globalThis.onceworlds = ow;
await import('../game/main.js');
const B = headlessPlayer(platform, roomB);
const C = headlessPlayer(platform, roomC, (L) => L.c === 0 || (L.c === 1 && L.tIn < 0.45)); // a bit greedy: gets caught sometimes

const policies = [
  (L) => goodRunner(L),
  (L, t) => L.c < 2 || t % 7000 < 3000, // runs through yellow and sometimes red
  () => false, // never runs: an idle player
  (L, t) => (t % 4000 < 2600 ? L.c === 0 : L.c < 2),
];
let policy = policies[0];
const keys = keyboard(h, roomA, (L, t) => policy(L, t));
const each = () => {
  platform.tick();
  B.drive();
  C.drive();
  keys();
};

test('a run of matches with every kind of player never throws and always ends', () => {
  h.run(30, each);
  h.key('Space');
  h.key('Space', false);
  h.run(30, each);
  const plan = [
    { rounds: 1, mode: 'back', seed: 11 },
    { rounds: 3, mode: 'out', seed: 222 },
    { rounds: 5, mode: 'back', seed: 3333 },
    { rounds: 1, mode: 'out', seed: 44444 },
    { rounds: 3, mode: 'back', seed: 555555 },
  ];
  plan.forEach((p, i) => {
    policy = policies[i % policies.length];
    platform.settings = { rounds: p.rounds, mode: p.mode };
    platform.startMatch(['B', 'A', 'C'], p.seed);
    const before = platform.ended;
    for (let k = 0; k < 60 * 60 * 9 && platform.ended === before; k++) h.run(1, each);
    assert.equal(platform.ended, before + 1, `match ${i + 1} ended`);
    const g = roomA.state.g;
    assert.equal(g.mid, `m${i + 1}`);
    assert.equal(g.phase, 'final');
    assert.equal(g.n, p.rounds);
    assert.equal(g.final.length, 8);
    assert.equal(new Set(g.final).size, 8);
    for (const id of g.roster) assert.ok(Number.isInteger(g.scores[id]) && g.scores[id] >= 0);
    h.run(120, each); // back in the lobby arena for a moment
    assert.equal(platform.match.phase, 'lobby');
  });
  assert.ok(out.saved.stats.matches === plan.length, `stats counted every match: ${out.saved.stats.matches}`);
  assert.equal(h.st.audioErrors.length, 0);
});
