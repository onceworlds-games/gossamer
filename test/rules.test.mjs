// The rules, one at a time: the lights, catching, finishing, scoring, ranking, ties, round end, and the bots' legal moves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BotField, makeBrain, think } from '../game/bots.js';
import { advance, applyCaught, applyFinish, awardsOf, beginRound, closeRound, finishMatch, isRoundOver, newMatch, photoFinish, rankMatch, roundOrder } from '../game/flow.js';
import { validG } from '../game/net.js';
import {
  CATCH_GRACE,
  FIELD_LEN,
  FIELD_W,
  POINTS,
  R,
  STEP,
  TABLE_SIZE,
  buildRoster,
  lightAt,
  makeSchedule,
  placeLabel,
  practiceLight,
  slotOrder,
  startPositions,
  startX,
} from '../game/rules.js';
import { S_DONE, S_GHOST, S_RUN, S_ZAP, S_ZIP, clearEvents, makeRunner, newEvents, separate, stepRunner } from '../game/sim.js';

const RED = { c: 2, k: 1, tIn: 1, left: 1, fake: -1, turn: 1, wait: false };
const GREEN = { c: 0, k: 1, tIn: 1, left: 1, fake: -1, turn: 0, wait: false };

test('the lights: every schedule is valid, deterministic, and has the right durations', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const a = makeSchedule(seed * 977);
    const b = makeSchedule(seed * 977);
    const out = {};
    let prevC = -1;
    let prevK = -1;
    for (let t = 0; t < 120; t += 0.01) {
      lightAt(a, t, out);
      assert.ok(out.c === 0 || out.c === 1 || out.c === 2);
      assert.ok(out.turn >= 0 && out.turn <= 1, `turn ${out.turn}`);
      assert.ok(out.tIn >= 0 && out.left > 0 && Number.isFinite(out.left));
      assert.ok(!out.wait);
      if (out.fake >= 0) {
        assert.ok(out.c === 0 && out.k > 0, 'fake-outs are during green, from the second cycle on');
      }
      // the order is always green, yellow, red, then the next green
      if (out.k === prevK) assert.ok(out.c >= prevC, 'colours only go forward within a cycle');
      else assert.ok(out.k === prevK + 1 && out.c === 0 && (prevC === 2 || prevK < 0));
      prevC = out.c;
      prevK = out.k;
    }
    // the same seed gives the same lights, however you ask
    for (const t of [0.3, 4.2, 17.77, 60.1, 3.3]) assert.deepEqual(lightAt(a, t, {}), lightAt(b, t, {}));
    for (let k = 0; k < 20; k++) {
      const c = a.cyc[k];
      if (!c) break;
      assert.ok(c.green >= (k === 0 ? 3 : 1.5) && c.green <= 5);
      assert.ok(c.yellow >= 0.6 && c.yellow <= 0.9);
      assert.ok(c.red >= 1.5 && c.red <= 3.5);
      if (c.fake >= 0) assert.ok(k > 0 && c.fake + 0.45 <= c.green - 0.6);
    }
  }
});

test('about a quarter of the greens from the second cycle on end in a fake-out', () => {
  let greens = 0;
  let fakes = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const s = makeSchedule(seed);
    lightAt(s, 100, {});
    for (let k = 1; k < 10; k++) {
      if (!s.cyc[k]) break;
      greens++;
      if (s.cyc[k].fake >= 0) fakes++;
    }
  }
  const share = fakes / greens;
  assert.ok(share > 0.1 && share < 0.3, `fake-out share ${share}`);
});

test('before the lights start there is only waiting; the lobby practice lights are slow and agree between pages', () => {
  const o = lightAt(makeSchedule(5), -1, {});
  assert.equal(o.wait, true);
  assert.equal(o.c, 0);
  const a = practiceLight(1_700_000_123_456, {});
  const b = practiceLight(1_700_000_123_456, {});
  assert.deepEqual(a, b);
  assert.ok(!a.wait);
  const s = makeSchedule(9, true);
  lightAt(s, 100, {});
  for (const c of s.cyc) assert.ok(c.yellow >= 1 && c.fake < 0);
});

test('running: builds up to 6 units a second, stops in about 0.4 s, steers at 3', () => {
  const r = makeRunner('a', 6, 0);
  const ev = newEvents();
  for (let i = 0; i < 60; i++) stepRunner(r, true, 0, STEP, GREEN, 'back', ev);
  assert.ok(Math.abs(r.vy - 6) < 1e-9, `top speed ${r.vy}`);
  let t = 0;
  while (r.vy > 0) {
    stepRunner(r, false, 0, STEP, GREEN, 'back', ev);
    t += STEP;
  }
  assert.ok(t > 0.41 && t < 0.45, `stopping took ${t}`);
  stepRunner(r, false, 1, STEP, GREEN, 'back', ev);
  assert.ok(Math.abs(r.vx - 3) < 1e-9);
  r.x = 11.9;
  for (let i = 0; i < 30; i++) stepRunner(r, false, 1, STEP, GREEN, 'back', ev);
  assert.ok(r.x <= FIELD_W - R + 1e-9, 'stays on the field');
});

test('caught: moving faster than 0.4 on red, after the 0.15 s grace; standing still or letting go in time is safe', () => {
  const ev = newEvents();
  const caught = (setup, light) => {
    const r = makeRunner('a', 6, 10);
    setup(r);
    clearEvents(ev);
    stepRunner(r, false, 0, STEP, light, 'back', ev);
    return ev.caught;
  };
  assert.equal(caught((r) => (r.vy = 5), { ...RED, tIn: 0.1 }), false, 'in the grace');
  assert.equal(caught((r) => (r.vy = 5), { ...RED, tIn: CATCH_GRACE }), true);
  assert.equal(caught((r) => (r.vy = 0.7), { ...RED, tIn: 1 }), true, 'still creeping');
  assert.equal(caught((r) => (r.vy = 0.3), { ...RED, tIn: 1 }), false, 'slower than 0.4 is a statue');
  assert.equal(caught((r) => (r.vy = 0), { ...RED, tIn: 1 }), false, 'standing still');
  assert.equal(caught((r) => (r.vy = 5), { ...GREEN }), false);
  // steering on red is moving too
  const r = makeRunner('a', 6, 10);
  clearEvents(ev);
  stepRunner(r, false, 1, STEP, { ...RED, tIn: 1 }, 'back', ev);
  assert.equal(ev.caught, true);
  // letting go when yellow starts is early enough (yellow is at least 0.6 s)
  const s = makeRunner('b', 6, 10);
  s.vy = 6;
  let got = false;
  for (let i = 0; i < 60 * 0.6 + 60 * CATCH_GRACE; i++) {
    clearEvents(ev);
    const t = i * STEP;
    const light = t < 0.6 ? { ...GREEN, c: 1 } : { ...RED, tIn: t - 0.6 };
    stepRunner(s, false, 0, STEP, light, 'back', ev);
    got ||= ev.caught;
  }
  assert.equal(got, false);
});

test('caught in Back mode: frozen, then carried to the start in 0.8 s, then free; in Out mode a ghost that cannot finish', () => {
  const ev = newEvents();
  const r = makeRunner('a', 6, 30);
  r.vy = 6;
  clearEvents(ev);
  stepRunner(r, true, 0, STEP, { ...RED, tIn: 1 }, 'back', ev);
  assert.ok(ev.caught && r.s === S_ZAP && r.vy === 0);
  let t = 0;
  let states = new Set();
  while (r.s !== S_RUN && t < 5) {
    clearEvents(ev);
    stepRunner(r, true, 1, STEP, { ...RED, tIn: 1 }, 'back', ev);
    states.add(r.s);
    t += STEP;
    assert.ok(r.y >= 0 && r.y <= 30.2);
  }
  assert.ok(states.has(S_ZIP));
  assert.ok(t > 1.1 && t < 1.2, `back at the start after ${t} s`);
  assert.equal(r.y, 0);
  assert.ok(ev.returned);

  const g = makeRunner('g', 6, 30);
  g.vy = 6;
  clearEvents(ev);
  stepRunner(g, true, 0, STEP, { ...RED, tIn: 1 }, 'out', ev);
  for (let i = 0; i < 60; i++) stepRunner(g, true, 0, STEP, GREEN, 'out', ev);
  assert.equal(g.s, S_GHOST);
  for (let i = 0; i < 60 * 30; i++) stepRunner(g, true, 0, STEP, { ...RED, tIn: 1 }, 'out', ev);
  assert.ok(g.y < FIELD_LEN, 'a ghost never reaches the ribbon');
  assert.equal(g.s, S_GHOST, 'and is never caught again');
});

test('practice (the lobby): a buzz once per red, never a penalty', () => {
  const ev = newEvents();
  const r = makeRunner('a', 6, 10);
  let buzzes = 0;
  for (let i = 0; i < 60; i++) {
    clearEvents(ev);
    stepRunner(r, true, 0, STEP, { ...RED, tIn: 1 }, 'practice', ev);
    if (ev.buzz) buzzes++;
    assert.equal(ev.caught, false);
  }
  assert.equal(buzzes, 1);
  assert.equal(r.s, S_RUN);
  assert.ok(r.y > 10, 'it kept running');
});

test('finishing: crossing the ribbon, coasting to a stop past it, never beyond the coast limit', () => {
  const r = makeRunner('a', 6, FIELD_LEN - 0.05);
  r.vy = 6;
  const ev = newEvents();
  stepRunner(r, true, 0, STEP, GREEN, 'back', ev);
  stepRunner(r, true, 0, STEP, GREEN, 'back', ev);
  assert.equal(r.s, S_DONE);
  assert.ok(ev.finished);
  for (let i = 0; i < 120; i++) stepRunner(r, true, 0, STEP, RED, 'back', ev);
  assert.ok(r.y >= FIELD_LEN && r.y < FIELD_LEN + 3);
  assert.equal(r.vy, 0);
});

test('soft collisions push you aside without making you "move"', () => {
  const a = makeRunner('a', 6, 5);
  const list = [{ id: 'b', x: 6.2, y: 5, on: true }, { id: 'c', x: 9, y: 9, on: true }];
  const before = a.x;
  separate(a, list, 2);
  assert.ok(a.x < before, 'pushed away from b');
  assert.equal(a.vx, 0);
  assert.equal(a.vy, 0);
  const z = makeRunner('z', 6, 5);
  z.s = S_ZIP;
  separate(z, list, 2);
  assert.equal(z.x, 6, 'a character being carried home is not in the way');
  const d = makeRunner('d', 6, 5);
  separate(d, [{ id: 'e', x: 6, y: 5, on: true }], 1);
  assert.notEqual(d.x, 6, 'exactly on top of someone still gets out');
});

test('start slots: everyone on the line, inside the field, no overlap, a different order each round', () => {
  for (const n of [1, 2, 8, 12]) {
    const xs = Array.from({ length: n }, (_, i) => startX(i, n));
    for (const x of xs) assert.ok(x >= R && x <= FIELD_W - R);
    for (let i = 1; i < n; i++) assert.ok(xs[i] - xs[i - 1] >= 2 * R + 0.05 || n === 1);
  }
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
  const r1 = startPositions(ids, 111);
  const r2 = startPositions(ids, 222);
  assert.notDeepEqual(r1, r2);
  assert.equal(new Set(Object.values(r1)).size, 8);
  assert.deepEqual(slotOrder(8, 5).slice().sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

function matchOf(n = 4, rounds = 3, mode = 'back') {
  const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const g = newMatch({ mid: 'm', by: 'p1', ids, bots: {}, rounds, mode, seed: 7 });
  return { g: beginRound(g, 0), ids };
}

test('a round: the banner, then the lights; finishing is recorded once, by time; late and stale reports change nothing', () => {
  const { g } = matchOf();
  assert.equal(g.n, 1);
  assert.equal(g.t0, 1500 + 900, 'round 1 has the GO! before its banner');
  assert.equal(beginRound({ ...g, n: 1 }, 5000).t0, 5000 + 1500);
  let h = applyFinish(g, 'p2', g.t0 + 12000);
  assert.equal(h.fin.p2, 12000);
  assert.equal(applyFinish(h, 'p2', g.t0 + 13000), h, 'the first finish stands');
  assert.equal(applyFinish(g, 'nobody', g.t0 + 12000), g, 'not in the match');
  assert.equal(applyFinish(g, 'p1', g.t0 + 80000), g, 'after the round');
  const board = { ...g, phase: 'board' };
  assert.equal(applyFinish(board, 'p1', g.t0 + 1000), board, 'not during a scoreboard');
  const c = applyCaught(g, 'p3', 40, g.t0 + 5000);
  assert.equal(c.caught.p3, 1);
  assert.equal(c.st.p3[1], 1);
  assert.deepEqual(c.out, {}, 'Back mode: nobody is out');
  assert.equal(applyCaught(applyFinish(g, 'p3', g.t0 + 9000), 'p3', 10, g.t0 + 9500).caught.p3, undefined, "a finisher can't be caught");
});

test('Out mode: caught means out of the round at that height, and out is out', () => {
  const { g } = matchOf(4, 3, 'out');
  const c = applyCaught(g, 'p2', 33.33, g.t0 + 4000);
  assert.equal(c.out.p2, 33.3);
  assert.equal(applyFinish(c, 'p2', g.t0 + 20000), c, 'an out player cannot finish');
  assert.equal(applyCaught(c, 'p2', 50, g.t0 + 6000), c, 'nor be caught twice');
});

test('the round ends when everyone who can finish has, or when time is up', () => {
  const { g, ids } = matchOf();
  assert.equal(isRoundOver(g, g.t0 - 1, ids), false, 'not during the banner');
  assert.equal(isRoundOver(g, g.t0 + 30000, ids), false);
  let h = g;
  for (const id of ids.slice(0, 3)) h = applyFinish(h, id, h.t0 + 15000);
  assert.equal(isRoundOver(h, h.t0 + 16000, ids), false, 'one is still running');
  assert.equal(isRoundOver(h, h.t0 + 16000, ids.slice(0, 3)), true, 'unless they are away and not waited for');
  h = applyFinish(h, ids[3], h.t0 + 17000);
  assert.equal(isRoundOver(h, h.t0 + 17001, ids), true);
  assert.equal(isRoundOver(g, g.until, ids), true, 'time is up');
  // Out mode: nobody left running ends it too
  const { g: o, ids: oids } = matchOf(3, 3, 'out');
  let p = applyFinish(o, 'p1', o.t0 + 20000);
  p = applyCaught(p, 'p2', 20, p.t0 + 10000);
  assert.equal(isRoundOver(p, p.t0 + 20001, oids), false);
  p = applyCaught(p, 'p3', 25, p.t0 + 10000);
  assert.equal(isRoundOver(p, p.t0 + 20001, oids), true);
});

test('points: finishers 10, 7, 5, 4, 3, 2, 1 then 1 each; the rest by distance and nothing; ties broken the same way every time', () => {
  const { g, ids } = matchOf(10);
  let h = g;
  ids.slice(0, 8).forEach((id, i) => (h = applyFinish(h, id, h.t0 + 10000 + i * 100)));
  const dist = { p9: 40, p10: 55 };
  const closed = closeRound(h, h.t0 + 70000, dist);
  assert.deepEqual(closed.res, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p10', 'p9'], 'finishers by time, then by distance');
  assert.deepEqual(
    ids.map((id) => closed.rp[id]),
    [10, 7, 5, 4, 3, 2, 1, 1, 0, 0],
  );
  assert.equal(closed.phase, 'board');
  assert.equal(closed.nFin, 8);
  assert.equal(closed.st.p1[0], 1, 'a round win');
  assert.equal(closed.st.p1[2], 10000, 'a best time');
  assert.deepEqual(POINTS, [10, 7, 5, 4, 3, 2, 1]);
  // nobody finished: everyone ranked by distance, no points
  const none = closeRound(g, 70000, { p1: 5, p2: 50, p3: 20, p4: 20 });
  assert.deepEqual(none.res.slice(0, 4), ['p2', 'p3', 'p4', 'p1'], 'equal distance goes by seat');
  assert.ok(Object.values(none.rp).every((p) => p === 0));
  assert.equal(none.st.p2[0], 0, 'no winner, no round win');
});

test('Out mode order: still running beats out, and out players rank by where they were caught', () => {
  const { g } = matchOf(5, 3, 'out');
  let h = applyFinish(g, 'p1', g.t0 + 30000);
  h = applyCaught(h, 'p2', 50, h.t0 + 5000);
  h = applyCaught(h, 'p3', 10, h.t0 + 5000);
  const { order, nFin } = roundOrder(h, { p4: 5, p5: 2 });
  assert.equal(nFin, 1);
  assert.deepEqual(order, ['p1', 'p4', 'p5', 'p2', 'p3']);
});

test('the match: rounds, the scoreboard in between, the podium after the last; ties by wins, then fewer catches, then seat', () => {
  let { g } = matchOf(4, 2);
  g = closeRound(applyFinish(g, 'p2', g.t0 + 9000), g.t0 + 70000, { p1: 10, p3: 5, p4: 1 });
  assert.equal(g.phase, 'board');
  g = advance(g, g.until);
  assert.equal(g.phase, 'round');
  assert.equal(g.n, 2);
  assert.deepEqual(g.fin, {}, 'a fresh round');
  assert.notEqual(g.rs, matchOf(4, 2).g.rs, 'each round has its own lights');
  g = closeRound(applyFinish(g, 'p3', g.t0 + 9000), g.t0 + 70000, { p1: 10, p2: 5, p4: 1 });
  const final = advance(g, g.until);
  assert.equal(final.phase, 'final');
  assert.equal(final.final.length, 4);
  const pts = final.final.map((id) => final.scores[id]);
  assert.deepEqual(pts, [...pts].sort((a, b) => b - a));
  // tie-breaks
  const t = { ...final, scores: { p1: 5, p2: 5, p3: 5, p4: 5 }, st: { p1: [0, 2, 0], p2: [1, 3, 0], p3: [1, 1, 0], p4: [0, 0, 0] } };
  assert.deepEqual(rankMatch(t), ['p3', 'p2', 'p4', 'p1'], 'wins, then fewer catches, then seat');
});

test('awards: Statue for the fewest catches (only if it differs), Speedy for the fastest finish', () => {
  const { g } = matchOf(3);
  const base = { ...g, scores: { p1: 3, p2: 2, p3: 1 } };
  assert.deepEqual(awardsOf({ ...base, st: { p1: [0, 0, 0], p2: [0, 0, 0], p3: [0, 0, 0] } }), { statue: null, speedy: null }, 'nobody was caught: no Statue');
  const a = awardsOf({ ...base, st: { p1: [0, 2, 21000], p2: [0, 0, 18000], p3: [0, 1, 0] } });
  assert.equal(a.statue, 'p2');
  assert.equal(a.speedy, 'p2');
  const b = finishMatch({ ...base, n: 3, st: { p1: [0, 2, 21000], p2: [0, 3, 18000], p3: [0, 1, 0] } }, 1000);
  assert.deepEqual(b.aw, { statue: 'p3', speedy: 'p2' });
});

test('photo finish: first by less than half a second', () => {
  const { g } = matchOf();
  let h = applyFinish(applyFinish(g, 'p1', g.t0 + 20000), 'p2', g.t0 + 20400);
  h = closeRound(h, h.t0 + 25000, { p3: 3, p4: 2 });
  assert.equal(photoFinish(h, 'p1'), true);
  assert.equal(photoFinish(h, 'p2'), false);
  let k = applyFinish(applyFinish(g, 'p1', g.t0 + 20000), 'p2', g.t0 + 20600);
  k = closeRound(k, k.t0 + 25000, { p3: 3, p4: 2 });
  assert.equal(photoFinish(k, 'p1'), false);
});

test('roster: humans first, bots to a table of 8 with distinct names, none when there are 8 or more people', () => {
  const r = buildRoster(['h1'], 99);
  assert.equal(r.ids.length, TABLE_SIZE);
  assert.equal(r.ids[0], 'h1');
  assert.equal(Object.keys(r.bots).length, 7);
  assert.equal(new Set(Object.values(r.bots)).size, 7);
  assert.deepEqual(buildRoster(['h1'], 99), r, 'the same seed builds the same table on every page');
  const full = buildRoster(Array.from({ length: 12 }, (_, i) => `h${i}`), 3);
  assert.equal(full.ids.length, 12);
  assert.deepEqual(full.bots, {});
  assert.equal(placeLabel(1), '1st');
  assert.equal(placeLabel(2), '2nd');
  assert.equal(placeLabel(3), '3rd');
  assert.equal(placeLabel(4), '4th');
  assert.equal(placeLabel(11), '11th');
  assert.equal(placeLabel(12), '12th');
});

test('a record the host writes passes the page checks, and garbage does not', () => {
  const { g } = matchOf(8);
  assert.equal(validG(g), true);
  assert.equal(validG(closeRound(g, g.t0 + 70000, {})), true);
  assert.equal(validG(finishMatch(closeRound(g, g.t0 + 70000, {}), 100000)), true);
  assert.equal(validG(JSON.parse(JSON.stringify(g))), true, 'survives the wire');
  for (const bad of [null, 5, 'x', {}, { ...g, roster: 'abc' }, { ...g, phase: 'oops' }, { ...g, t0: NaN }, { ...g, fin: [] }, { ...g, roster: [] }, { ...g, mode: 'x' }, { ...g, scores: { p1: 'a' } }, { ...g, st: { p1: [1] } }, { ...g, phase: 'board', res: null }]) {
    assert.equal(validG(bad), false, JSON.stringify(bad)?.slice(0, 60));
  }
});

test('bots only make legal moves: run on green, stop on yellow, never steer on red, stay on the field, dodge', () => {
  const rng = (seed) => makeBrain(`bot${seed}`, seed);
  for (let seed = 1; seed <= 30; seed++) {
    const b = rng(seed);
    const r = makeRunner(b.id, 6, 10);
    r.vy = 0;
    const field = [];
    // waiting
    think(b, r, { wait: true, c: 0, k: -1, tIn: -1, fake: -1 }, field, 0);
    assert.equal(b.run, false);
    // green: runs after a short reaction
    let ran = false;
    for (let t = 0; t < 1; t += 0.01) {
      think(b, r, { wait: false, c: 0, k: 0, tIn: t, fake: -1 }, field, 0);
      if (b.run) ran = true;
      if (t < 0.14) assert.equal(b.run, false, 'a reaction delay first');
    }
    assert.ok(ran);
    // red: never runs, never steers
    for (let t = 0; t < 3; t += 0.1) {
      think(b, r, { wait: false, c: 2, k: 0, tIn: t, fake: -1 }, field, 0);
      assert.equal(b.run, false);
      assert.equal(b.steer, 0);
    }
    // yellow: lets go within 0.12-0.45 s (plus a late streak) of the start
    let stopped = null;
    for (let t = 0; t < 0.9; t += 0.01) {
      think(b, r, { wait: false, c: 1, k: 1, tIn: t, fake: -1 }, field, 0);
      if (!b.run && stopped === null) stopped = t;
    }
    assert.ok(stopped >= 0.11 && stopped <= 1.0, `stopped at ${stopped}`);
  }
  // dodging: someone just ahead, a bot steers around, never into a wall
  const b = makeBrain('bot3', 4);
  const r = makeRunner('bot3', 6, 10);
  const ahead = [{ id: 'x', x: 6.1, y: 11.2, on: true }];
  think(b, r, { wait: false, c: 0, k: 0, tIn: 1, fake: -1 }, ahead, 1);
  assert.ok(b.run && b.steer !== 0);
  const wall = makeRunner('bot3', 0.5, 10);
  think(b, wall, { wait: false, c: 0, k: 0, tIn: 1, fake: -1 }, [{ id: 'x', x: 0.7, y: 11, on: true }], 1);
  assert.ok(b.steer >= 0);
});

test('bots get caught on roughly a fifth of the reds they run into, and never leave the field', () => {
  let exposures = 0;
  let caughtCount = 0;
  const light = {};
  for (let seed = 1; seed <= 60; seed++) {
    const { ids } = buildRoster([], seed);
    const field = new BotField();
    const xs = startPositions(ids, seed);
    field.setup(ids, ids.map((id) => xs[id]), seed);
    const sched = makeSchedule(seed * 31);
    let prev = 0;
    for (let t = 3; t < 60; t += STEP) {
      lightAt(sched, t - 3, light);
      if (light.c === 1 && prev === 0) for (const b of field.bots) if (b.r.s === S_RUN && b.r.vy > 3) exposures++;
      prev = light.c;
      for (const e of field.step(light, STEP, 'back', [], 0)) if (e.type === 'caught') caughtCount++;
      for (const b of field.bots) assert.ok(b.r.x >= R - 1e-9 && b.r.x <= FIELD_W - R + 1e-9 && b.r.y >= 0 && b.r.y <= FIELD_LEN + 3.001);
    }
  }
  const rate = caughtCount / exposures;
  assert.ok(rate > 0.1 && rate < 0.4, `caught rate ${rate}`);
});
