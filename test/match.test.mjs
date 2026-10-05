// A whole match with only bots, through the same pure code the host runs: roster, rounds, lights, bots, catches, scoring, results.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BotField } from '../game/bots.js';
import { advance, applyCaught, applyFinish, beginRound, closeRound, isRoundOver, newMatch } from '../game/flow.js';
import { FIELD_LEN, FIELD_W, ROUND_LIMIT_MS, STEP, STEP_MS, buildRoster, lightAt, makeSchedule, startPositions } from '../game/rules.js';
import { S_RUN } from '../game/sim.js';

export function simulateMatch(seed, { rounds = 3, mode = 'back', humans = [] } = {}) {
  const { ids, bots } = buildRoster(humans, seed);
  const botIds = ids.filter((id) => id in bots);
  let g = newMatch({ mid: `m${seed}`, by: 'host', ids, bots, rounds, mode, seed });
  g = beginRound(g, 0);
  const field = new BotField();
  const light = {};
  const stats = { rounds: 0, reds: 0, caught: 0, finishers: 0, durations: [], steps: 0 };
  let now = 0;
  for (;;) {
    assert.equal(g.phase, 'round');
    const xs = startPositions(ids, g.rs);
    field.setup(botIds, botIds.map((id) => xs[id]), g.rs);
    const sched = makeSchedule(g.rs);
    let t = g.t0;
    let lastRed = -1;
    for (;;) {
      lightAt(sched, (t - g.t0) / 1000, light);
      if (light.c === 2 && light.k !== lastRed) {
        lastRed = light.k;
        stats.reds++;
      }
      const events = field.step(light, STEP, g.mode, [], 0);
      for (const e of events) {
        if (e.type === 'caught') {
          g = applyCaught(g, e.id, e.y, t);
          stats.caught++;
        } else g = applyFinish(g, e.id, t);
      }
      for (const b of field.bots) {
        assert.ok(Number.isFinite(b.r.x) && Number.isFinite(b.r.y) && Number.isFinite(b.r.vx) && Number.isFinite(b.r.vy), 'NaN position');
        assert.ok(b.r.x >= 0 && b.r.x <= FIELD_W, `bot out of the field x=${b.r.x}`);
        assert.ok(b.r.y >= 0 && b.r.y <= FIELD_LEN + 3.01, `bot out of the field y=${b.r.y}`);
      }
      t += STEP_MS;
      stats.steps++;
      if (isRoundOver(g, t, botIds)) break;
      assert.ok(t <= g.until + 100, 'round never ended');
    }
    const dist = {};
    for (const b of field.bots) dist[b.id] = b.r.y;
    now = t;
    stats.durations.push((t - g.t0) / 1000);
    stats.finishers += Object.keys(g.fin).length;
    g = closeRound(g, now, dist);
    stats.rounds++;
    assert.equal(g.phase, 'board');
    assert.equal(g.res.length, ids.length, 'everyone is ranked');
    assert.equal(new Set(g.res).size, ids.length);
    now += 4000;
    g = advance(g, now);
    if (g.phase === 'final') break;
  }
  return { g, stats, ids };
}

test('a bot-only match ends, ranks everyone and keeps the field sane (20 seeds, both modes)', () => {
  let rounds = 0;
  let reds = 0;
  let caught = 0;
  let finishers = 0;
  const durations = [];
  for (let seed = 1; seed <= 20; seed++) {
    for (const mode of ['back', 'out']) {
      const { g, stats, ids } = simulateMatch(seed * 7919 + 13, { rounds: 3, mode });
      assert.equal(g.phase, 'final');
      assert.equal(stats.rounds, 3);
      assert.equal(g.final.length, ids.length);
      assert.equal(new Set(g.final).size, ids.length);
      for (const id of ids) assert.ok(Number.isInteger(g.scores[id]) && g.scores[id] >= 0);
      const sorted = g.final.map((id) => g.scores[id]);
      for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1] >= sorted[i], 'final order is by points');
      rounds += stats.rounds;
      reds += stats.reds;
      caught += stats.caught;
      finishers += stats.finishers;
      durations.push(...stats.durations);
    }
  }
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  console.log(`      rounds ${rounds}, mean round ${mean.toFixed(1)} s, finishers per round ${(finishers / rounds).toFixed(1)}/8, caught per red per bot ${(caught / (reds / 1) / 8).toFixed(2)}`);
  assert.ok(mean > 12 && mean < 70, `mean round length ${mean}`);
});

test('every round length option plays through', () => {
  for (const rounds of [1, 3, 5]) {
    const { g, stats } = simulateMatch(99 + rounds, { rounds });
    assert.equal(stats.rounds, rounds);
    assert.equal(g.n, rounds);
  }
});

test('with humans in the roster the bots still fill the table, and the humans can be ranked without playing', () => {
  const { ids, bots } = buildRoster(['a', 'b', 'c'], 5);
  assert.equal(ids.length, 8);
  assert.deepEqual(Object.keys(bots), ['bot1', 'bot2', 'bot3', 'bot4', 'bot5']);
  assert.equal(new Set(Object.values(bots)).size, 5, 'bot names are distinct');
  const { g } = simulateMatch(321, { humans: ['a', 'b', 'c'] });
  assert.equal(g.final.length, 8);
  assert.ok(g.final.includes('a') && g.final.includes('b') && g.final.includes('c'));
});

test('the round ends by time even if nobody finishes', () => {
  const { ids, bots } = buildRoster(['a'], 1);
  let g = newMatch({ mid: 'x', by: 'a', ids, bots, rounds: 1, mode: 'back', seed: 1 });
  g = beginRound(g, 0);
  assert.equal(isRoundOver(g, g.t0 - 1, ids), false);
  assert.equal(isRoundOver(g, g.t0 + 1000, ids), false);
  assert.equal(isRoundOver(g, g.t0 + ROUND_LIMIT_MS, ids), true);
});

test('the pure sim keeps a bot on the line when it never runs', () => {
  const field = new BotField();
  field.setup(['bot1'], [6], 3);
  const light = { c: 2, k: 0, tIn: 1, left: 1, fake: -1, turn: 1, wait: false };
  for (let i = 0; i < 600; i++) field.step(light, STEP, 'back', [], 0);
  assert.equal(field.bots[0].r.y, 0);
  assert.equal(field.bots[0].r.s, S_RUN);
});
