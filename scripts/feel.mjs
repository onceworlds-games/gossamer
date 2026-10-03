// How building feels, in numbers: how often a pointer lands on the wrong thing, how a thread cap behaves, what silk
// costs, and how long a web takes by hand against a Quick Orb. Casting and spinning run through the real simulation;
// the hand's aim time and walking are modelled. npm run feel
import { createWorld, stepWorld, command } from '../game/js/sim/world.js';
import { resolveTarget, snapRadiusFor } from '../game/js/sim/actions.js';
import { planOrb } from '../game/js/sim/quickorb.js';
import { placeAt } from '../game/js/sim/spider.js';
import { makeRng, mix, rand, gauss } from '../game/js/sim/rng.js';
import { SNAP_RADIUS, THREADS, PLAYER_NODES, PLAYER_THREADS, GARDEN_KEYS, SPECIES } from '../game/js/sim/data.js';

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
function table(title, rows) {
  console.log(`\n${title}`);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) console.log('  ' + r.map((c, i) => String(c).padEnd(widths[i])).join('  '));
}

/** A garden with a Quick Orb already spun at its best site (silk for everything), the spider standing on its hub. */
function orbWorld(seed, garden = 'cottage') {
  const w = createWorld({ seed, night: 3, garden, players: [{ id: 'a', sp: 'orb' }] });
  w.script.events = [];
  const sp = w.spiders[0];
  sp.silk = sp.mods.maxSilk = 400;
  sp.mods.range = 520;
  const site = w.garden.sites.find((s) => s.lane === 0) ?? w.garden.sites[0];
  const from = w.web.nearestNode(site.x - 120, site.y + 40, 400, (s) => w.web.adj[s].length > 0 && w.web.kind[s] === 0);
  if (from) placeAt(w, sp, from.id);
  command(w, { id: 'a', t: 'orb', x: site.x, y: site.y, r: 95, p: 'orb' });
  for (let i = 0; i < 60 * 8 && (sp.act || i < 3); i++) stepWorld(w, {});
  return { w, sp, site };
}

// ---------------------------------------------------------------- A. where a pointer lands
function snapTest() {
  // err: the pointer's miss in screen px (a mouse; a finger after the loupe has shown where it will land; a bare finger).
  const cases = [
    { name: 'mouse, 1.5x view', err: 5, z: 1.5, old: true },
    { name: 'finger with loupe, 1.1x view', err: 9, z: 1.1, old: true },
    { name: 'finger with loupe, zoomed out 0.6x (was)', err: 9, z: 0.6, old: true },
    { name: 'finger with loupe, zoomed out 0.6x (now)', err: 9, z: 0.6, old: false },
    { name: 'bare finger, 0.8x view (was)', err: 24, z: 0.8, old: true },
    { name: 'bare finger, 0.8x view (now)', err: 24, z: 0.8, old: false },
  ];
  const classes = ['twig tips', 'knots of a spun web', 'strands of a spun web'];
  const rows = [['pointer', 'ring', ...classes.map((c) => `${c}: wrong / none`)]];
  for (const c of cases) {
    const radius = c.old ? SNAP_RADIUS : snapRadiusFor(c.z);
    const wrong = [0, 0, 0];
    const none = [0, 0, 0];
    const n = [0, 0, 0];
    for (let seed = 1; seed <= 12; seed++) {
      const { w, sp } = orbWorld(seed * 811, GARDEN_KEYS[seed % 4]);
      const web = w.web;
      const rng = makeRng(mix(seed, 99));
      const wants = [];
      const near = (x, y) => Math.hypot(x - sp.x, y - sp.y) > 30 && Math.hypot(x - sp.x, y - sp.y) < 480;
      for (let s = 0; s < web.nodeHigh; s++) {
        if (web.nid[s] < 0 || web.kind[s] === 2 || web.adj[s].length === 0 || !near(web.x[s], web.y[s])) continue;
        // A knot only counts when no other knot is within 20 px (two on top of each other can't be told apart by anyone).
        wants.push({ x: web.x[s], y: web.y[s], cls: web.nid[s] < 2000 ? 0 : 1 });
      }
      for (let s = 0; s < web.threadHigh; s++) {
        if (web.tid[s] < 0 || web.type[s] === 5 || web.len[s] < 40) continue;
        const t = 0.3 + rand(rng) * 0.4;
        const x = web.x[web.ta[s]] + (web.x[web.tb[s]] - web.x[web.ta[s]]) * t;
        const y = web.y[web.ta[s]] + (web.y[web.tb[s]] - web.y[web.ta[s]]) * t;
        if (near(x, y)) wants.push({ x, y, cls: 2 });
      }
      for (let k = 0; k < 220 && wants.length; k++) {
        const want = wants[Math.floor(rand(rng) * wants.length)];
        const e = (gauss(rng) * c.err) / c.z;
        const a = rand(rng) * Math.PI * 2;
        const got = resolveTarget(w, sp, want.x + Math.cos(a) * e * 0.7, want.y + Math.sin(a) * e * 0.7, radius);
        n[want.cls]++;
        if (!got) none[want.cls]++;
        else if (Math.hypot(got.x - want.x, got.y - want.y) > 14) wrong[want.cls]++;
      }
    }
    rows.push([c.name, Math.round(radius), ...[0, 1, 2].map((i) => `${pct(wrong[i] / Math.max(1, n[i]))} / ${pct(none[i] / Math.max(1, n[i]))}`)]);
  }
  table('Aiming: how often a cast lands on something other than what was meant, or on nothing (pointer error added)', rows);
}

// ---------------------------------------------------------------- B. the caps
function capTest() {
  const w = createWorld({ seed: 4242, night: 3, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  w.script.events = [];
  const sp = w.spiders[0];
  sp.silk = sp.mods.maxSilk = 1e6;
  sp.mods.range = 900;
  const web = w.web;
  const rng = makeRng(7);
  const anchors = [];
  for (let s = 0; s < web.nodeHigh; s++) if (web.nid[s] >= 0 && web.nid[s] < 2000 && web.adj[s].length > 0) anchors.push(web.nid[s]);
  let orbs = 0;
  let casts = 0;
  let firstFull = null;
  const refusals = {};
  for (let guard = 0; guard < 400; guard++) {
    const site = w.garden.sites[guard % w.garden.sites.length];
    const from = web.nearestNode(site.x, site.y, 500, (s) => web.adj[s].length > 0 && web.kind[s] === 0);
    if (from) placeAt(w, sp, from.id);
    w.ev = [];
    command(w, { id: 'a', t: 'orb', x: site.x + (rand(rng) - 0.5) * 40, y: site.y + (rand(rng) - 0.5) * 40, r: 95, p: 'orb' });
    for (let i = 0; i < 60 * 9 && (sp.act || i < 2); i++) {
      stepWorld(w, {});
      for (const e of w.ev) if (e.k === 'refuse') refusals[e.why] = (refusals[e.why] ?? 0) + 1;
    }
    if (sp.act === null && w.ev.every((e) => e.k !== 'orbstart') && refusals.full) break;
    orbs++;
    if (refusals.full && !firstFull) firstFull = { orbs, nodes: web.playerNodes, threads: web.playerThreads };
    if (orbs > 40) break;
  }
  const before = { n: web.playerNodes, t: web.playerThreads };
  // After the last orb: single casts keep going until the caps.
  for (let k = 0; k < 600; k++) {
    const a = anchors[Math.floor(rand(rng) * anchors.length)];
    const p = web.pos(a);
    const from = web.nearestNode(p.x, p.y, 700, (s) => web.adj[s].length > 0 && web.kind[s] === 0);
    if (from) placeAt(w, sp, from.id);
    w.ev = [];
    const b = anchors[Math.floor(rand(rng) * anchors.length)];
    const q = web.pos(b);
    command(w, { id: 'a', t: 'cast', type: 2, x: q.x, y: q.y });
    for (let i = 0; i < 30; i++) stepWorld(w, {});
    casts++;
    for (const e of w.ev) if (e.k === 'refuse') refusals[e.why] = (refusals[e.why] ?? 0) + 1;
    if (web.playerNodes + 3 > PLAYER_NODES || web.playerThreads + 2 > PLAYER_THREADS) break;
  }
  table('Thread caps (300 knots, 400 threads for the players)', [
    ['Quick Orbs spun before one is refused', 'knots / threads then', 'then single casts until', 'refusals seen'],
    [orbs, `${before.n} / ${before.t}`, `${web.playerNodes} / ${web.playerThreads} (${casts} casts)`, JSON.stringify(refusals)],
  ]);
}

// ---------------------------------------------------------------- C. silk
function silkTable() {
  const rows = [['thing', 'silk', 'share of 100']];
  for (const [i, name] of [[0, 'Frame'], [1, 'Radial'], [2, 'Sticky'], [3, 'Alarm']]) rows.push([`${name}, a 150 px thread`, (150 * THREADS[i].cost).toFixed(1), pct((150 * THREADS[i].cost) / SPECIES.orb.silk)]);
  const costs = [];
  for (let seed = 1; seed <= 40; seed++) {
    const w = createWorld({ seed: seed * 313, night: 3, garden: GARDEN_KEYS[seed % 4], players: [{ id: 'a', sp: 'orb' }] });
    const site = w.garden.sites.find((s) => s.lane === 0) ?? w.garden.sites[0];
    const plan = planOrb(w.web, site.x, site.y, 95, 'orb', 520);
    if (plan.ok) costs.push(plan.cost);
  }
  rows.push(['a standard Quick Orb (mean)', mean(costs).toFixed(1), pct(mean(costs) / SPECIES.orb.silk)]);
  rows.push(['silk back after resting (1.8 per s)', '', `${(mean(costs) / SPECIES.orb.regen).toFixed(0)} s for an orb`]);
  table('Silk', rows);
}

// ---------------------------------------------------------------- D. a web by hand against a Quick Orb
function standOn(w, sp, thId, t) {
  sp.mode = 'walk';
  sp.node = 0;
  sp.th = thId;
  sp.s = t;
  sp.act = null;
  sp.busy = 0;
  const s = w.web.ti(thId);
  if (s >= 0) w.web.at(s, t, sp);
}

function manualOrb(seed, think, rings) {
  const w = createWorld({ seed, night: 3, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  w.script.events = [];
  const sp = w.spiders[0];
  sp.silk = sp.mods.maxSilk = 400;
  sp.mods.range = 520;
  const web = w.web;
  const site = w.garden.sites.find((s) => s.lane === 0) ?? w.garden.sites[0];
  const plan = planOrb(web, site.x, site.y, 95, 'orb', 520);
  if (!plan.ok) return null;
  const ends = plan.ends.filter(Boolean).sort((a, b) => a.a - b.a);
  if (ends.length < 6) return null;
  const hub = plan.hub;
  const speed = sp.mods.speed;
  let clock = 0;
  let casts = 0;
  let refused = 0;
  const silk0 = sp.silk;
  const wait = (sec) => {
    for (let i = 0; i < Math.ceil(sec * 60); i++) stepWorld(w, {});
    clock += sec;
  };
  const settle = () => {
    let guard = 0;
    while ((sp.busy > 0 || sp.act) && guard++ < 600) {
      stepWorld(w, {});
      clock += 1 / 60;
    }
  };
  const cast = (type, x, y) => {
    wait(think); // looking, deciding, aiming
    w.ev = [];
    command(w, { id: 'a', t: 'cast', type, x, y });
    stepWorld(w, {});
    clock += 1 / 60;
    casts++;
    if (w.ev.some((e) => e.k === 'refuse')) refused++;
    settle();
  };
  // 1. A frame across the site, from the first rim anchor to the opposite one, then onto its middle: the hub.
  const e0 = ends[0];
  const e4 = ends[Math.floor(ends.length / 2)];
  const start = web.nearestNode(e0.x, e0.y, 60, (s) => web.adj[s].length > 0 && web.kind[s] === 0) ?? web.nearestNode(e0.x, e0.y, 200, (s) => web.adj[s].length > 0);
  if (!start) return null;
  placeAt(w, sp, start.id);
  cast(0, e4.x, e4.y);
  if (web.playerThreads < 1) return null;
  const frame = web.nearestThread(hub.x, hub.y, 80, (s) => web.type[s] === 0 && web.nid[web.ta[s]] === start.id || web.nid[web.tb[s]] === start.id);
  if (!frame) return null;
  const frameLen = web.len[frame.s];
  standOn(w, sp, frame.id, frame.t);
  clock += (frame.t * frameLen) / speed; // walking out to the middle
  // 2. The rest of the spokes from the hub.
  for (const e of ends) {
    if (e === e0 || e === e4) continue;
    cast(1, e.x, e.y);
  }
  // 3. Rings: along the spokes, a sticky thread from each to the next at the ring's radius.
  const hubNode = web.nearestNode(hub.x, hub.y, 40, (s) => web.adj[s].length >= 3);
  if (!hubNode) return null;
  const radii = Array.from({ length: rings }, (_, i) => 30 + i * 28);
  const angles = ends.map((e) => Math.atan2(e.y - hub.y, e.x - hub.x));
  const onSpoke = (k, r) => web.nearestThread(hub.x + Math.cos(angles[k]) * r, hub.y + Math.sin(angles[k]) * r, 12, (s) => web.type[s] <= 1);
  let prevR = 0;
  for (const r of radii) {
    clock += Math.abs(r - prevR) / speed;
    prevR = r;
    for (let k = 0; k < ends.length; k++) {
      const here = onSpoke(k, r);
      if (!here) continue;
      standOn(w, sp, here.id, here.t);
      const next = (k + 1) % ends.length;
      cast(2, hub.x + Math.cos(angles[next]) * r, hub.y + Math.sin(angles[next]) * r);
    }
  }
  const caught = web.playerThreads;
  return { time: clock, casts, refused, silk: silk0 - sp.silk, threads: caught };
}

function quickOrb(seed) {
  const w = createWorld({ seed, night: 3, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  w.script.events = [];
  const sp = w.spiders[0];
  sp.silk = sp.mods.maxSilk = 400;
  sp.mods.range = 520;
  const site = w.garden.sites.find((s) => s.lane === 0) ?? w.garden.sites[0];
  const from = w.web.nearestNode(site.x - 120, site.y + 40, 400, (s) => w.web.adj[s].length > 0 && w.web.kind[s] === 0);
  if (from) placeAt(w, sp, from.id);
  const silk0 = sp.silk;
  command(w, { id: 'a', t: 'orb', x: site.x, y: site.y, r: 95, p: 'orb' });
  let ticks = 0;
  while ((sp.act || ticks < 3) && ticks < 60 * 20) {
    stepWorld(w, {});
    ticks++;
  }
  return { time: ticks / 60, silk: silk0 - sp.silk, threads: w.web.playerThreads };
}

function buildTable() {
  const rows = [['web', 'time to finish', 'silk', 'threads', 'casts']];
  const avg = (fn, n = 14) => {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const r = fn(i * 577);
      if (r) out.push(r);
    }
    return out;
  };
  const q = avg(quickOrb);
  rows.push(['Quick Orb (one tap)', `${mean(q.map((r) => r.time)).toFixed(1)} s`, mean(q.map((r) => r.silk)).toFixed(0), mean(q.map((r) => r.threads)).toFixed(0), '1']);
  for (const [name, think, rings] of [['by hand, quick fingers (0.4 s an aim), 2 rings', 0.4, 2], ['by hand, a novice (1.2 s an aim), 2 rings', 1.2, 2], ['by hand, a novice, 3 rings', 1.2, 3]]) {
    const m = avg((seed) => manualOrb(seed, think, rings));
    rows.push([name, `${mean(m.map((r) => r.time)).toFixed(1)} s`, mean(m.map((r) => r.silk)).toFixed(0), mean(m.map((r) => r.threads)).toFixed(0), `${mean(m.map((r) => r.casts)).toFixed(0)} (${mean(m.map((r) => r.refused)).toFixed(1)} refused)`]);
  }
  table('Building a web (dusk is 25 s; the hand-built web is spokes and rings round one hub; times include walking)', rows);
}

const only = process.argv[2];
const want = (n) => !only || only === n;
if (want('snap')) snapTest();
if (want('caps')) capTest();
if (want('silk')) silkTable();
if (want('build')) buildTable();
