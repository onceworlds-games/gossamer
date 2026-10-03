// The balance harness: bots play the real simulation across seeds and print what the spec's targets ask for.
//   npm run balance            (about two minutes)
//   node scripts/balance.mjs quick | full | <section> [--seeds N]   (sections: quota silk catch beetle wasp species)
import { createWorld, stepWorld } from '../game/js/sim/world.js';
import { makeBot, botTick, buildFor } from '../game/js/sim/bots.js';
import { planOrb, PATTERNS } from '../game/js/sim/quickorb.js';
import { spawnPrey } from '../game/js/sim/prey.js';
import { PREY, SPECIES, GARDEN_KEYS, T_FRAME, T_RADIAL } from '../game/js/sim/data.js';
import { lanePoint } from '../game/js/sim/garden.js';
import { mix } from '../game/js/sim/rng.js';

// A tuning knob for trying the spiral's spacing without editing the game: ORB_SPACING=20 node scripts/balance.mjs catch
if (process.env.ORB_SPACING) PATTERNS.orb.spacing = Number(process.env.ORB_SPACING);
const arg = process.argv[2] ?? 'all';
const flag = process.argv.indexOf('--seeds');
const SEEDS = flag > 0 ? Math.max(1, Number(process.argv[flag + 1]) | 0) : arg === 'quick' ? 8 : arg === 'full' ? 48 : 20;
const only = ['quick', 'full', 'all'].includes(arg) ? null : arg;
const want = (name) => !only || only === name;
const pct = (x) => `${Math.round(x * 100)}%`;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function playNight({ seed, night, garden = 'cottage', sp = 'orb', skill = 'average', up, noWasps = false, mode = 'season' }) {
  const w = createWorld({ seed, night, garden, mode, players: [{ id: 'a', sp, up: up ?? buildFor(skill, night, sp) }] });
  if (noWasps) w.script.events = w.script.events.filter((e) => e.k !== 'wasp');
  const bot = makeBot(w, 'a', skill);
  let ticks = 0;
  while (!w.done && ticks < 60 * 200) {
    stepWorld(w, { a: botTick(w, bot, 1 / 60) });
    ticks++;
  }
  const s = w.spiders[0];
  return { food: w.food, quota: w.quota, met: w.food >= w.quota, t: w.t, damage: s.stats.damage, stolen: w.tally.stolen, caught: Object.values(w.tally.caught).reduce((a, b) => a + b, 0), eaten: s.stats.eaten };
}

function table(title, rows) {
  console.log(`\n${title}`);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) console.log('  ' + r.map((c, i) => String(c).padEnd(widths[i])).join('  '));
}

const t0 = Date.now();

// ---------------------------------------------------------------- A. how often a night's quota is met
if (want('quota')) {
  const rows = [['night', 'quota', 'novice', 'average', 'good', 'food: novice / average / good (median)']];
  for (const night of [1, 3, 5, 7, 10]) {
    const row = [night];
    const foods = [];
    let quota = 0;
    for (const skill of ['novice', 'average', 'good']) {
      const res = [];
      for (let i = 0; i < SEEDS; i++) res.push(playNight({ seed: mix(9001 + i, night), night, garden: GARDEN_KEYS[i % 4], skill }));
      quota = res[0].quota;
      row.push(pct(mean(res.map((r) => (r.met ? 1 : 0)))));
      const f = res.map((r) => r.food).sort((a, b) => a - b);
      foods.push(Math.round(f[Math.floor(f.length / 2)]));
    }
    row.splice(1, 0, quota);
    row.push(foods.join(' / '));
    rows.push(row);
  }
  table('Quota met (targets: N1 novice >= 90%; N5 average >= 60%, novice <= 40%; N10 good 35-50%)', rows);
}

// ---------------------------------------------------------------- B. the standard orb's cost, and the wait for another
if (want('silk')) {
  const costs = [];
  for (let i = 0; i < SEEDS * 3; i++) {
    const w = createWorld({ seed: mix(5150 + i, 3), night: 3, garden: GARDEN_KEYS[i % 4], players: [{ id: 'a', sp: 'orb' }] });
    const site = w.garden.sites.find((s) => s.lane === 0) ?? w.garden.sites[0];
    if (!site) continue;
    const plan = planOrb(w.web, site.x, site.y, site.r, 'orb', 520);
    if (plan.ok) costs.push(plan.cost);
  }
  costs.sort((a, b) => a - b);
  const max = SPECIES.orb.silk;
  table('Standard Quick Orb (targets: 55-70% of max silk; a second web after ~35 s)', [
    ['mean', 'p10', 'p90', 'regen wait (from empty)'],
    [pct(mean(costs) / max), pct(costs[Math.floor(costs.length * 0.1)] / max), pct(costs[Math.floor(costs.length * 0.9)] / max), `${(mean(costs) / SPECIES.orb.regen).toFixed(0)} s`],
  ]);
}

// ---------------------------------------------------------------- C. catches a web makes, well and badly placed
function offLane(w) {
  const p = {};
  for (let y = 200; y < 820; y += 40) {
    for (let x = 120; x < 1480; x += 40) {
      const far = w.garden.lanes.every((l) => {
        for (let u = 0; u <= 1; u += 0.02) {
          lanePoint(l, u, p);
          if (Math.hypot(p.x - x, p.y - y) < l.w + 140) return false;
        }
        return true;
      });
      if (far && planOrb(w.web, x, y, 95, 'orb', 520).ok) return { x, y, r: 95 };
    }
  }
  return null;
}

function staticWeb(seed, good) {
  const w = createWorld({ seed, night: 3, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  w.script.events = w.script.events.filter((e) => !['wasp', 'wren'].includes(e.k));
  // Well placed: the best site on the main lane. Badly: somewhere an orb can hang that no lane passes near.
  const site = good ? w.garden.sites.find((s) => s.lane === 0) : offLane(w);
  if (!site) return null;
  const sp = w.spiders[0];
  sp.silk = 300;
  sp.mods.maxSilk = 300;
  sp.mods.range = 2000;
  w.cmds.push({ id: 'a', t: 'orb', x: site.x, y: site.y, r: site.r, p: 'orb' });
  let sticks = 0;
  let nightTicks = 0;
  while (!w.done) {
    stepWorld(w, {});
    if (w.phase === 'night') {
      nightTicks++;
      for (const e of w.ev) if (e.k === 'stick') sticks++;
    }
  }
  return sticks / (nightTicks / 60 / 60);
}

if (want('catch')) {
  const good = [];
  const bad = [];
  for (let i = 0; i < SEEDS; i++) {
    const g = staticWeb(mix(777 + i, 1), true);
    if (g !== null) good.push(g);
    const b = staticWeb(mix(777 + i, 1), false);
    if (b !== null) bad.push(b);
  }
  table('Catches per minute on night 3, web left alone (targets: across the main lane 10-14; badly placed < 4)', [
    ['main lane', 'off the lanes', 'samples'],
    [mean(good).toFixed(1), bad.length ? mean(bad).toFixed(1) : 'n/a', `${good.length} / ${bad.length}`],
  ]);
}

// ---------------------------------------------------------------- D. beetles against frames
function beetleTest(seed, strong) {
  const w = createWorld({ seed, night: 5, garden: GARDEN_KEYS[seed % 4], players: [{ id: 'a', sp: 'orb', up: strong ? { strong } : {} }] });
  w.script.events = [];
  const site = w.garden.sites.find((s) => s.lane === 0) ?? w.garden.sites[0];
  if (!site) return null;
  const sp = w.spiders[0];
  sp.silk = 300;
  sp.mods.maxSilk = 300;
  sp.mods.range = 2000;
  w.cmds.push({ id: 'a', t: 'orb', x: site.x, y: site.y, r: site.r, p: 'orb' });
  for (let i = 0; i < 60 * 12; i++) stepWorld(w, {});
  // The spider goes home; a beetle flies at the web.
  const r = w.rng;
  const side = seed % 2 ? -1 : 1;
  const b = spawnPrey(w, 'beetle', -1, { x: site.x + side * 320, y: site.y + ((seed * 37) % 60) - 30 });
  if (!b) return null;
  b.stray = { pts: [[b.x, b.y], [site.x + ((seed * 13) % 40) - 20, site.y + ((seed * 7) % 40) - 20], [site.x - side * 400, site.y]], w: 4, share: 0 };
  void r;
  let broke = false;
  for (let i = 0; i < 60 * 12; i++) {
    stepWorld(w, {});
    for (const e of w.ev) if ((e.k === 'snap' || e.k === 'tear') && (e.type === T_FRAME || e.type === T_RADIAL)) broke = true;
  }
  const stuck = w.tally.caught.beetle ?? 0;
  return { broke, stuck };
}

if (want('beetle')) {
  const rows = [['frame', 'web broken', 'beetle stuck']];
  for (const strong of [0, 1, 2]) {
    const res = [];
    for (let i = 0; i < SEEDS * 2; i++) {
      const r = beetleTest(mix(31 + i, strong), strong);
      if (r) res.push(r);
    }
    rows.push([strong ? `Strong Silk ${strong}` : 'base', pct(mean(res.map((r) => (r.broke ? 1 : 0)))), pct(mean(res.map((r) => (r.stuck ? 1 : 0))))]);
  }
  table('Beetles (targets: base frame broken ~70%; Strong Silk 2 almost never)', rows);
}

// ---------------------------------------------------------------- E. what a wasp patrol costs
if (want('wasp')) {
  const withW = [];
  const without = [];
  for (let i = 0; i < SEEDS; i++) {
    for (const night of [4, 6]) {
      const seed = mix(4242 + i, night);
      const a = playNight({ seed, night, skill: 'unprotected', up: buildFor('average', night) });
      const b = playNight({ seed, night, skill: 'unprotected', up: buildFor('average', night), noWasps: true });
      withW.push(a.food);
      without.push(b.food);
    }
  }
  table('Wasps against an unprotected spider (target: about 25% of a night\'s food)', [['food with wasps', 'without', 'lost'], [mean(withW).toFixed(1), mean(without).toFixed(1), pct(1 - mean(withW) / Math.max(1, mean(without)))]]);
}

// ---------------------------------------------------------------- F. the hunter and the fisher against the weaver
if (want('species')) {
  const rows = [['species', 'food/min (avg skill, nights 3-6)', 'vs orb']];
  const rate = {};
  for (const sp of ['orb', 'jumper', 'bolas']) {
    const res = [];
    for (let i = 0; i < SEEDS; i++) {
      for (const night of [3, 6]) {
        const r = playNight({ seed: mix(8080 + i, night), night, sp, garden: GARDEN_KEYS[i % 4], skill: 'average' });
        res.push(r.food / (r.t / 60));
      }
    }
    rate[sp] = mean(res);
  }
  for (const sp of ['orb', 'jumper', 'bolas']) rows.push([sp, rate[sp].toFixed(1), pct(rate[sp] / rate.orb)]);
  table('Species (target: jumper within +-20% of the orb weaver)', rows);
}

console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s, ${SEEDS} seeds per cell`);
export { PREY };
