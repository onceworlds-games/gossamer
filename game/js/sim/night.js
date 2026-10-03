// A night's script, made from its seed before it starts: when each visitor arrives and on which lane, the quiet
// spell and the rush, the gusts, rain, mist and bloom, and when the hunters come. Also the rules a night runs under
// (traits, Cold Snap) and the tally at dawn.
import { makeRng, range, rand, chance, int, weighted, pick, mix } from './rng.js';
import { DUSK, NIGHT, GARDENS, PREY, quotaFor, THREADS, T_SURFACE, TRAITS, DAWN_RECYCLE } from './data.js';

/** Rules for the whole web from everyone's traits ('night' scope) and the Cold Snap level. */
export function nightRules(players, cold = 0, o = {}) {
  const has = (id) => players.some((p) => (p.tr ?? []).includes(id) && TRAITS[id]?.scope === 'night');
  const orbs = players.filter((p) => p.sp === 'orb');
  const bestDroplets = Math.max(0, ...orbs.map((p) => p.up?.droplets | 0));
  return {
    dusk: DUSK + (has('nightowl') ? 10 : 0),
    length: NIGHT + (has('longnight') ? 20 : 0),
    quotaMul: has('longnight') ? 1.1 : 1,
    preyMul: (has('huntersmoon') ? 1.2 : 1) * (cold >= 2 ? 0.88 : 1) * (o.preyMul ?? 1),
    wrenMul: has('huntersmoon') ? 2 : 1,
    taut: has('taut'),
    luckymoth: has('luckymoth'),
    heavyheart: has('heavyheart'),
    dewharp: has('dewharp'),
    ironframe: has('ironframe'),
    keeper: has('keeper'),
    feast: has('feast'),
    windreader: has('windreader'),
    gluerain: has('gluerain'),
    wash: [0.4, 0.3, 0.2, 0.1][Math.min(3, bestDroplets)],
    brittle: cold >= 3,
    recycle: cold >= 3 ? 0.4 : DAWN_RECYCLE,
    earlyWren: cold >= 4,
    leanGap: cold >= 2,
    snap: 1.35,
    alarmTangle: players.some((p) => (p.up?.alarm | 0) >= 2),
    eyesWren: players.some((p) => (p.up?.eyes | 0) >= 2),
    gentle: !!o.gentle,
  };
}

function speciesWeights(night, garden) {
  const g = GARDENS[garden]?.prey ?? GARDENS.cottage.prey;
  const n = night;
  return {
    gnat: 1 * g.gnat,
    midge: 0.9 * g.midge,
    fly: (0.75 + n * 0.02) * g.fly,
    moth: (n === 1 ? 0.14 : 0.24 + n * 0.035) * g.moth,
    beetle: (n < 3 ? 0 : 0.07 + n * 0.012) * g.beetle,
    dragonfly: (n < 6 ? (garden === 'reed' && n >= 4 ? 0.03 : 0) : 0.03 + (n - 6) * 0.012) * g.dragonfly,
  };
}

const LAND = { gnat: 0, midge: 0, fly: 0.35, moth: 0.45, beetle: 0.5, dragonfly: 0.3 };

/**
 * script: { dusk, length, wind, humidity, events: [{ t, k, ... }] } sorted by t. Prey events: { k: 'prey', sp, lane,
 * n (swarm size), landAt, big }. Others: gust/gustwarn, rain, mist, bloom, wasp, wren, mantis.
 */
export function makeScript(seed, night, garden, rules, cold = 0, mode = 'season') {
  const r = makeRng(mix(seed, 0x5eed));
  const gdef = GARDENS[garden] ?? GARDENS.cottage;
  const dusk = rules.dusk;
  const length = rules.length;
  const end = dusk + length;
  const events = [];
  const lanes = 3;
  const nightish = Math.max(1, Math.min(14, night));
  const base = (18 + 2.2 * nightish) * rules.preyMul * (rules.gentle ? 0.8 : 1);
  const gapStart = dusk + length * range(r, 0.3, 0.45);
  const gapLen = rules.leanGap ? 26 : 18;
  const rushStart = dusk + length * range(r, 0.62, 0.72);
  const rushLen = 22;
  const profile = (t) => {
    if (t < dusk) return t < 6 ? 0.1 : 0.4;
    if (t >= gapStart && t < gapStart + gapLen) return rules.leanGap ? 0.22 : 0.35;
    if (t >= rushStart && t < rushStart + rushLen) return 2.2;
    if (t > end - 8) return 0.6;
    return t > rushStart ? 1.1 : 1;
  };
  const weights = speciesWeights(nightish, garden);
  if (rules.gentle) weights.fly *= 1.4;
  let acc = -range(r, 0.5, 2);
  let firstMoth = rules.luckymoth;
  for (let t = 1; t < end - 3; t += 0.25) {
    acc += (base * profile(t) * 0.25) / 60;
    while (acc > 0) {
      const sp = weighted(r, weights);
      const swarm = sp === 'gnat' ? int(r, 4, 7) : sp === 'midge' ? int(r, 5, 9) : 1;
      const stray = chance(r, 0.12);
      const lane = stray ? -1 : laneFor(r, garden, lanes);
      const big = sp === 'moth' && firstMoth;
      if (big) firstMoth = false;
      events.push({ t: t + range(r, 0, 0.25), k: 'prey', sp, lane, n: swarm, landAt: chance(r, LAND[sp]) ? range(r, 0.25, 0.7) : -1, big });
      acc -= swarm * (sp === 'gnat' || sp === 'midge' ? 0.55 : 1) + range(r, 0, 0.6);
    }
  }
  if (!rules.gentle) {
    // Gusts, with their warning a few seconds ahead.
    const gusts = Math.round((1 + nightish / 3) * gdef.wind);
    for (let i = 0; i < gusts; i++) {
      const t = range(r, 10, end - 12);
      const dir = rand(r) < 0.5 ? -1 : 1;
      const power = range(r, 70, 150) * gdef.wind;
      const lead = rules.windreader ? 6 : 3;
      events.push({ t: t - lead, k: 'gustwarn', dir, power, lead });
      events.push({ t, k: 'gust', dir, power, dur: range(r, 1.8, 3.6) });
    }
    if (night >= 2 && chance(r, gdef.rain)) events.push({ t: range(r, dusk + 15, end - 45), k: 'rain', dur: range(r, 25, 40) });
    let mistAt = -1;
    if (chance(r, gdef.mist)) {
      mistAt = range(r, dusk, end - 60);
      events.push({ t: mistAt, k: 'mist', dur: range(r, 35, 60) });
    }
    if (chance(r, gdef.bloom) && night >= 2) {
      const t = range(r, dusk + 10, end - 60);
      events.push({ t, k: 'bloom', dur: 40, x: range(r, 300, 1300), y: range(r, 300, 760) });
      for (let i = 0; i < 3; i++) events.push({ t: t + range(r, 2, 30), k: 'prey', sp: 'moth', lane: laneFor(r, garden, lanes), n: 1, landAt: -1, big: false });
    }
    // Hunters.
    if (night >= 2) {
      const wasps = night >= 10 ? 2 : 1 + Math.floor((night - 1) / 3);
      for (let i = 0; i < wasps; i++) events.push({ t: range(r, dusk + 12, end - 30), k: 'wasp' });
    }
    const wrenFrom = rules.earlyWren ? 2 : 3;
    if (night >= wrenFrom) {
      const n = Math.round((1 + (night >= 7 ? 1 : 0)) * rules.wrenMul);
      let t = range(r, dusk + 18, dusk + 45);
      for (let i = 0; i < n && t < end - 15; i++) {
        if (mistAt < 0 || t < mistAt || t > mistAt + 60) events.push({ t, k: 'wren' });
        t += range(r, 28, 50);
      }
    }
    if (night === 10 || (mode === 'endless' && night > 10 && night % 5 === 0)) events.push({ t: dusk + 20, k: 'mantis' });
  }
  events.sort((a, b) => a.t - b.t);
  return {
    dusk,
    length,
    wind: range(r, 8, 35) * gdef.wind,
    humidity: range(r, 0.2, 0.45) + (garden === 'reed' ? 0.15 : 0),
    events,
    mainLane: 0,
  };
}

function laneFor(r, garden, lanes) {
  void garden;
  void lanes;
  // Shares match the garden's lanes (0.55-0.6 main, ~0.3, ~0.12): pick by those.
  const x = rand(r);
  return x < 0.58 ? 0 : x < 0.88 ? 1 : 2;
}

export function quota(world) {
  if (world.mode === 'daily' || world.mode === 'practice') return 0;
  return Math.round(quotaFor(world.night, world.cold) * world.rules.quotaMul * (world.mode === 'tutorial' ? 0.75 : 1));
}

/** What the night came to: for the notebook, the season and the badges. */
export function tally(world) {
  const web = world.web;
  let webSilk = 0;
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] === T_SURFACE) continue;
    webSilk += web.rest[s] * THREADS[web.type[s]].cost;
  }
  let cocoonFood = 0;
  let cocoons = 0;
  for (const p of world.prey) {
    if (p.st === 'cocoon' || p.st === 'subdued') {
      cocoons++;
      cocoonFood += p.food;
    }
  }
  const keeperFood = world.rules.keeper ? cocoonFood * 0.5 : 0;
  const food = world.food + keeperFood;
  const q = world.quota;
  const per = {};
  for (const sp of world.spiders) {
    per[sp.id] = { sp: sp.sp, ...sp.stats, food: Math.round(sp.stats.food * 10) / 10, silkLeft: Math.round(sp.silk), hp: Math.round(sp.hp), banker: sp.mods.banker };
  }
  return {
    night: world.night,
    garden: world.gardenId,
    mode: world.mode,
    food: Math.round(food * 10) / 10,
    quota: q,
    met: q <= 0 || food >= q,
    extra: Math.max(0, Math.floor(food - q)),
    cocoons,
    lostFood: Math.round((cocoonFood - keeperFood) * 10) / 10,
    webSilk: Math.round(webSilk),
    recycled: Math.round(webSilk * world.rules.recycle),
    caught: { ...world.tally.caught },
    eaten: { ...world.tally.eaten },
    escaped: { ...world.tally.escaped },
    stolen: world.tally.stolen,
    swoops: world.tally.swoops,
    gusts: world.tally.gusts,
    rain: world.tally.rain,
    mist: world.tally.mist,
    mantisOff: !!world.tally.mantisOff,
    snaps: world.tally.snaps,
    per,
  };
}

export { PREY, pick };
