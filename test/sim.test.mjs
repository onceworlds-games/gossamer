import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, command } from '../game/js/sim/world.js';
import { makeBot, botTick } from '../game/js/sim/bots.js';
import { makeScript, nightRules } from '../game/js/sim/night.js';
import { packWorld, unpackWorld, snapshot, applySnapshot } from '../game/js/sim/codec.js';
import { generateGarden } from '../game/js/sim/garden.js';
import { GARDEN_KEYS, W, H, GROUND, MAX_PREY, MAX_NODES, MAX_THREADS, PREY_KEYS } from '../game/js/sim/data.js';
import { makeRng, rand, range, mix } from '../game/js/sim/rng.js';

function signature(w) {
  let h = 0;
  const add = (v) => {
    h = (Math.imul(h ^ Math.round(v * 100), 16777619) + 1) >>> 0;
  };
  add(w.food);
  add(w.prey.length);
  for (const p of w.prey) add(p.x + p.y);
  for (let s = 0; s < w.web.nodeHigh; s++) if (w.web.nid[s] >= 0) add(w.web.x[s] + w.web.y[s] * 3);
  for (const sp of w.spiders) add(sp.x + sp.y + sp.silk + sp.hp);
  return h;
}

function run(seed, night, garden, ticks, skill = 'average') {
  const w = createWorld({ seed, night, garden, players: [{ id: 'a', sp: 'orb' }] });
  const bot = makeBot(w, 'a', skill);
  for (let i = 0; i < ticks; i++) stepWorld(w, { a: botTick(w, bot, 1 / 60) });
  return w;
}

test('the same seed and the same inputs give the same night, every time', () => {
  for (const garden of GARDEN_KEYS) {
    const a = run(4242, 6, garden, 60 * 50);
    const b = run(4242, 6, garden, 60 * 50);
    assert.equal(signature(a), signature(b), garden);
  }
});

test('night scripts: sorted, inside the night, every visitor on a real lane, every lane starting off screen', () => {
  for (let i = 0; i < 300; i++) {
    const garden = GARDEN_KEYS[i % 4];
    const night = 1 + (i % 12);
    const rules = nightRules([{ id: 'a', sp: 'orb', tr: i % 3 ? [] : ['huntersmoon', 'longnight', 'nightowl'] }], i % 6);
    const sc = makeScript(mix(i, 77), night, garden, rules, i % 6, i % 5 ? 'season' : 'endless');
    const end = sc.dusk + sc.length;
    let last = -Infinity;
    for (const e of sc.events) {
      assert.ok(e.t >= last - 1e-9, 'sorted');
      last = e.t;
      assert.ok(e.t > -7 && e.t < end, `event inside the night (${e.k} at ${e.t})`);
      if (e.k === 'prey') {
        assert.ok(PREY_KEYS.includes(e.sp));
        assert.ok(e.lane >= -1 && e.lane <= 2);
        assert.ok(e.n >= 1 && e.n <= 9);
      }
    }
    if (night === 10) assert.ok(sc.events.some((e) => e.k === 'mantis'), 'the mantis comes on the last night');
  }
  for (const id of GARDEN_KEYS) {
    for (let seed = 1; seed <= 60; seed++) {
      const g = generateGarden(id, seed * 31);
      for (const lane of g.lanes) {
        const [x, y] = lane.pts[0];
        assert.ok(x < 0 || x > W || y < 0, `${id} lane starts off screen (${x},${y})`);
      }
    }
  }
});

test('fuzz: any commands from any spider, thousands of ticks, nothing breaks', () => {
  const r = makeRng(1234);
  for (let round = 0; round < 6; round++) {
    const garden = GARDEN_KEYS[round % 4];
    const species = ['orb', 'jumper', 'bolas'];
    const players = [0, 1, 2].map((i) => ({ id: `s${i}`, sp: species[(i + round) % 3], up: { venom: 2, shake: 1, templates: 3 }, tr: ['fierce', 'balloon'] }));
    const w = createWorld({ seed: mix(round, 9), night: [3, 5, 7, 10, 11, 15][round], garden, players, mode: round > 3 ? 'endless' : 'season' });
    const junk = [NaN, Infinity, -Infinity, 1e12, -5, 'x', null, undefined, {}];
    for (let tick = 0; tick < 3500; tick++) {
      const inputs = {};
      for (const p of players) {
        inputs[p.id] = { mx: range(r, -1.4, 1.4), my: range(r, -1.4, 1.4), hurry: rand(r) < 0.2, leap: rand(r) < 0.01 ? { x: range(r, -100, W + 100), y: range(r, -100, H), power: rand(r) } : null };
        if (rand(r) < 0.04) {
          const kinds = ['cast', 'cut', 'use', 'bite', 'shake', 'orb', 'lure', 'fling', 'fall', 'prey', 'nonsense'];
          const t = kinds[Math.floor(rand(r) * kinds.length)];
          const pick = () => (rand(r) < 0.1 ? junk[Math.floor(rand(r) * junk.length)] : range(r, -50, W + 50));
          command(w, { id: p.id, t, type: Math.floor(range(r, -1, 6)), x: pick(), y: pick(), r: pick(), p: rand(r) < 0.5 ? 'orb' : 'dense', on: rand(r) < 0.5, power: pick(), amount: pick(), sp: 'fly' });
        }
      }
      stepWorld(w, inputs);
      assert.ok(w.prey.length <= MAX_PREY);
      assert.ok(w.web.nodes <= MAX_NODES && w.web.threads <= MAX_THREADS);
    }
    for (const sp of w.spiders) {
      assert.ok(Number.isFinite(sp.x) && Number.isFinite(sp.y) && Number.isFinite(sp.silk) && Number.isFinite(sp.hp), 'spider finite');
      assert.ok(sp.x > -250 && sp.x < W + 250 && sp.y > -350 && sp.y < H + 100, `spider in bounds ${sp.x},${sp.y}`);
      assert.ok(sp.silk >= 0 && sp.silk <= sp.mods.maxSilk + 1e-6);
      assert.ok(sp.hp >= 0 && sp.hp <= 100);
    }
    for (const p of w.prey) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.y <= GROUND + 20 && p.x > -200 && p.x < W + 200, 'prey finite and in bounds');
    assert.ok(Number.isFinite(w.food) && w.food >= 0);
  }
});

const parts = (ck) => {
  const { prey, swarms, wasps, ...meta } = ck.meta;
  return [JSON.stringify({ mid: 'x', k: 1, meta }), JSON.stringify({ mid: 'x', k: 1, n: ck.n }), JSON.stringify({ mid: 'x', k: 1, t: ck.t }), JSON.stringify({ mid: 'x', k: 1, prey, swarms, wasps })].map((s) => s.length);
};

test('a checkpoint fits in room state and a new host carries on from it', () => {
  const w = run(777, 8, 'cottage', 60 * 70, 'good');
  const ck = packWorld(w);
  for (const size of parts(ck)) assert.ok(size < 15500, `checkpoint part ${size} bytes`);
  const copy = createWorld({ seed: 777, night: 8, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  assert.ok(unpackWorld(copy, JSON.parse(JSON.stringify(ck))));
  assert.equal(copy.web.threads, w.web.threads);
  assert.equal(copy.prey.length, w.prey.length);
  assert.ok(Math.abs(copy.food - w.food) < 0.2);
  assert.ok(Math.abs(copy.t - w.t) < 0.2);
  // And the night goes on from there without trouble.
  for (let i = 0; i < 600; i++) stepWorld(copy, {});
  assert.ok(Number.isFinite(copy.food));
  const snap = JSON.stringify(snapshot(w)).length;
  assert.ok(snap < 11000, `snapshot ${snap} bytes`);
  const mirror = createWorld({ seed: 777, night: 8, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }], role: 'mirror' });
  applySnapshot(mirror, JSON.parse(JSON.stringify(snapshot(w))), 'b');
  assert.equal(mirror.prey.length, w.prey.length);
});

test('a web at its caps with every visitor in the air still checkpoints under the room limit', () => {
  const w = createWorld({ seed: 5, night: 9, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  const sp = w.spiders[0];
  sp.silk = 1e5;
  sp.mods.maxSilk = 1e5;
  sp.mods.range = 3000;
  const r = makeRng(3);
  const web = w.web;
  for (let i = 0; i < 6000 && web.playerThreads < 396; i++) {
    // Stand on a random knot and throw a thread at another.
    const slots = [];
    for (let s = 0; s < web.nodeHigh; s++) if (web.nid[s] >= 0 && web.kind[s] !== 2 && web.adj[s].length) slots.push(s);
    const a = slots[Math.floor(rand(r) * slots.length)];
    const b = slots[Math.floor(rand(r) * slots.length)];
    sp.mode = 'walk';
    sp.node = web.nid[a];
    sp.th = 0;
    sp.x = web.x[a];
    sp.y = web.y[a];
    sp.busy = 0;
    sp.act = null;
    command(w, { id: 'a', t: 'cast', type: Math.floor(rand(r) * 4), x: web.x[b] + range(r, -20, 20), y: web.y[b] + range(r, -20, 20) });
  }
  for (let i = 0; i < 60 * 40; i++) stepWorld(w, {});
  const ck = packWorld(w);
  for (const size of parts(ck)) assert.ok(size < 15900, `full web checkpoint part ${size} bytes (${web.playerThreads} threads, ${w.prey.length} prey)`);
  assert.ok(web.playerThreads > 300, `reached ${web.playerThreads} threads`);
});

test('commands are checked: wrong species, no silk, too far and out-of-world targets are refused', () => {
  const w = createWorld({ seed: 11, night: 2, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }, { id: 'j', sp: 'jumper' }] });
  const refusals = () => w.ev.filter((e) => e.k === 'refuse').map((e) => e.why);
  command(w, { id: 'j', t: 'cast', type: 0, x: 400, y: 400 });
  assert.deepEqual(refusals(), ['species']);
  w.ev = [];
  w.spiders[0].silk = 0;
  const s = w.garden.sites[0];
  command(w, { id: 'a', t: 'cast', type: 0, x: w.spiders[0].x + 150, y: w.spiders[0].y });
  assert.ok(['silk', 'nothing', 'far'].includes(refusals()[0]));
  w.ev = [];
  command(w, { id: 'a', t: 'cast', type: 0, x: 1e9, y: -1e9 });
  assert.ok(refusals().length === 1);
  w.ev = [];
  command(w, { id: 'nobody', t: 'cast', type: 0, x: s.x, y: s.y });
  assert.equal(w.ev.length, 0);
});

test('the mantis climbs and hunts, and leaves after three venom bites', async () => {
  const { spawnMantis, biteMantis } = await import('../game/js/sim/hostiles.js');
  const w = createWorld({ seed: 2026, night: 10, garden: 'cottage', players: [{ id: 'a', sp: 'orb', up: { venom: 3 } }] });
  w.script.events = [];
  const bot = makeBot(w, 'a', 'good');
  for (let i = 0; i < 60 * 15; i++) stepWorld(w, { a: botTick(w, bot, 1 / 60) });
  const m = spawnMantis(w);
  let moved = 0;
  let last = { x: m.x, y: m.y };
  for (let i = 0; i < 60 * 30; i++) {
    stepWorld(w, { a: botTick(w, bot, 1 / 60) });
    moved += Math.hypot(m.x - last.x, m.y - last.y);
    last = { x: m.x, y: m.y };
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
  }
  assert.ok(moved > 50, `the mantis moves (${moved | 0} px)`);
  // Three venom bites from close by send it away.
  const sp = w.spiders[0];
  for (let k = 0; k < 3; k++) {
    sp.x = m.x;
    sp.y = m.y;
    m.st = 'hunt';
    biteMantis(w, sp);
  }
  assert.equal(m.st, 'leave');
  assert.ok(w.tally.mantisOff);
});
