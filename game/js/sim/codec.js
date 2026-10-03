// Checkpoints: the whole night packed small enough for room state (three values under 16 KB each), so a new host
// carries on from it; and the light snapshot (10 Hz) that other players draw prey and hunters from.
import { PREY_KEYS, PREY, SPECIES } from './data.js';
import { spiderMods } from './spider.js';
import { addSpider } from './world.js';

const ST = ['fly', 'land', 'stuck', 'subdued', 'cocoon', 'held', 'fall', 'gone'];
const r1 = (v) => Math.round(v * 10) / 10;
const ri = (v) => Math.round(v);

function packPrey(p) {
  return [p.id, PREY_KEYS.indexOf(p.sp), ST.indexOf(p.st), ri(p.x), ri(p.y), ri(p.vx), ri(p.vy), p.lane, Math.round(p.u * 1000), ri(p.off), ri(p.speed), p.node, r1(p.timer), Math.round(p.wrap * 100), r1(p.eaten), p.heldBy ?? 0, p.swarm, Math.round(p.landAt * 100), r1(p.food), p.big ? 1 : 0, p.landTh ?? 0, Math.round((p.landS ?? 0) * 1000), r1(p.landT), Math.round(p.alarm * 100), p.facing, p.stray ? p.stray.pts.map((q) => [ri(q[0]), ri(q[1])]) : 0, p.bitten ? 1 : 0, r1(p.t)];
}

function unpackPrey(a) {
  if (!Array.isArray(a) || a.length < 25) return null;
  const n = (i, d = 0) => (Number.isFinite(a[i]) ? a[i] : d);
  const sp = PREY_KEYS[n(1)];
  const st = ST[n(2)];
  if (!sp || !st) return null;
  return {
    id: n(0), sp, st, x: n(3), y: n(4), vx: n(5), vy: n(6), lane: n(7, -1), u: n(8) / 1000, off: n(9), speed: n(10, 60), node: n(11), timer: n(12), wrap: n(13) / 100, eaten: n(14),
    heldBy: typeof a[15] === 'string' ? a[15] : null, swarm: n(16), landAt: n(17) / 100, food: n(18, 1), big: !!a[19], landTh: n(20), landS: n(21) / 1000, landT: n(22), alarm: n(23) / 100, facing: n(24, 1) >= 0 ? 1 : -1,
    stray: Array.isArray(a[25]) ? { pts: a[25].slice(0, 4).map((q) => [Number(q?.[0]) || 0, Number(q?.[1]) || 0]), w: 10, share: 0 } : null, bitten: !!a[26], t: n(27),
    hit: 0, hitT: 0, kick: 0.5, phase: (n(0) * 1.7) % 6.28, zig: 0, zigT: 0, hover: 0, preen: 0,
  };
}

function packSpider(sp) {
  const act = sp.act ? { ...sp.act, plan: undefined, steps: undefined } : null;
  return { id: sp.id, sp: sp.sp, idx: sp.idx, up: sp.up, tr: sp.tr, mode: sp.mode, node: sp.node, th: sp.th, s: r1(sp.s * 100) / 100, from: sp.from, x: ri(sp.x), y: ri(sp.y), hp: r1(sp.hp), silk: r1(sp.silk), venom: sp.venom, stats: sp.stats, downed: r1(sp.downed), act: act && act.k !== 'orb' ? act : null, hang: sp.hang };
}

export function packWorld(w) {
  const meta = {
    t: r1(w.t), tick: w.tick, phase: w.phase, si: w.si, rng: w.rng.s, nextId: w.nextId, food: r1(w.food), done: w.done,
    tally: w.tally, hubs: w.hubs, quick: [...w.quickHubs],
    weather: { ...w.weather, windX: r1(w.weather.windX), sway: Math.round(w.weather.sway * 1000) / 1000, gust: w.weather.gust },
    lights: w.lights.map((l) => [ri(l.x), ri(l.y), r1(l.power)]),
    spiders: w.spiders.map(packSpider),
    prey: w.prey.map(packPrey),
    swarms: Object.values(w.swarms).map((s) => [s.id, s.lane, Math.round(s.u * 1000), ri(s.x), ri(s.y), s.speed, ri(s.off)]),
    wasps: w.wasps.map((x) => ({ ...x, path: x.path.map((q) => [ri(q[0]), ri(q[1])]), x: ri(x.x), y: ri(x.y), vx: ri(x.vx), vy: ri(x.vy) })),
    wren: w.wren ? { ...w.wren, hit: [...w.wren.hit] } : null,
    mantis: w.mantis ? { st: w.mantis.st, mode: w.mantis.mode, node: w.mantis.node, th: w.mantis.th, s: w.mantis.s, x: ri(w.mantis.x), y: ri(w.mantis.y), falls: w.mantis.falls, bites: w.mantis.bites, wait: w.mantis.wait, t: r1(w.mantis.t) } : null,
    lures: w.lures,
    balls: w.balls,
  };
  const web = w.web.pack(w.garden.threadCount);
  return { meta, n: web.n, t: web.t };
}

/**
 * Restores a checkpoint into a world made from the same config. poses: { id: pose } for spiders other pages move;
 * keep: the id of the spider this page moves (its own position wins over the checkpoint's).
 */
export function unpackWorld(w, ck, poses = null, keep = null) {
  if (!ck || typeof ck !== 'object' || !ck.meta) return false;
  const m = ck.meta;
  try {
    // The web: the garden as built, then the silk on top.
    w.web.unpack({ n: ck.n, t: ck.t });
    w.web.time = Number(m.t) || 0;
    w.t = Number(m.t) || 0;
    w.tick = m.tick | 0;
    w.phase = ['dusk', 'night', 'dawn'].includes(m.phase) ? m.phase : 'night';
    w.si = Math.max(0, Math.min(w.script.events.length, m.si | 0));
    w.rng.s = m.rng >>> 0;
    w.nextId = Math.max(w.nextId, m.nextId | 0);
    w.food = Math.max(0, Number(m.food) || 0);
    w.done = !!m.done;
    if (m.tally && typeof m.tally === 'object') w.tally = { ...w.tally, ...m.tally };
    if (m.hubs && typeof m.hubs === 'object') w.hubs = m.hubs;
    if (Array.isArray(m.quick)) w.quickHubs = new Set(m.quick);
    if (m.weather && typeof m.weather === 'object') Object.assign(w.weather, m.weather);
    if (Array.isArray(m.lights)) m.lights.forEach((l, i) => w.lights[i] && Array.isArray(l) && Object.assign(w.lights[i], { x: Number(l[0]) || w.lights[i].x, y: Number(l[1]) || w.lights[i].y, power: Number(l[2]) || w.lights[i].power }));
    if (Array.isArray(m.spiders)) {
      for (const s of m.spiders) {
        if (!s || typeof s.id !== 'string') continue;
        let sp = w.spiders.find((q) => q.id === s.id);
        // Someone let in after the night began: give them their spider back too.
        if (!sp && w.spiders.length < 4) sp = addSpider(w, { id: s.id, sp: SPECIES[s.sp] ? s.sp : 'orb', up: s.up, tr: Array.isArray(s.tr) ? s.tr : [] });
        if (!sp) continue;
        Object.assign(sp, { hp: s.hp, silk: s.silk, venom: s.venom, stats: { ...sp.stats, ...s.stats }, downed: s.downed || 0 });
        if (s.act && s.act.k !== 'orb') sp.act = s.act;
        if (s.mode === 'downed') sp.mode = 'downed';
        if (s.id !== keep) {
          const pose = poses?.[s.id] ?? s;
          applyPose(w, sp, pose);
        }
      }
    }
    w.prey = Array.isArray(m.prey) ? m.prey.map(unpackPrey).filter(Boolean) : [];
    w.swarms = {};
    if (Array.isArray(m.swarms)) for (const s of m.swarms) if (Array.isArray(s)) w.swarms[s[0]] = { id: s[0], lane: s[1], u: s[2] / 1000, x: s[3], y: s[4], speed: s[5], off: s[6] };
    w.wasps = Array.isArray(m.wasps) ? m.wasps.filter((x) => x && Array.isArray(x.path)) : [];
    w.wren = m.wren && typeof m.wren === 'object' ? { ...m.wren, hit: new Set(m.wren.hit ?? []) } : null;
    if (m.mantis && !w.mantis) {
      // Bring back the mantis by spawning it, then putting it where it was.
      w.mantis = { id: 'mantis', sp: 'mantis', mods: { speed: 52, run: 52, stickySlow: 0.35, leap: 0, maxSilk: 0 }, silk: 0, hp: 1, busy: 0, act: null, still: 0, noise: 0, air: null, hang: null, invuln: 0, stats: {}, facing: 0, vx: 0, vy: 0, cool: 0, wind: 0, path: null, pathT: 0, target: null, from: 0 };
    }
    if (w.mantis && m.mantis) Object.assign(w.mantis, m.mantis);
    w.lures = Array.isArray(m.lures) ? m.lures : [];
    w.balls = Array.isArray(m.balls) ? m.balls : [];
    w.web.buildGrid();
    return true;
  } catch (err) {
    console.warn('checkpoint skipped', err);
    return false;
  }
}

/** A pose from presence (or a checkpoint): where another player's spider is and how it holds on. */
export function applyPose(w, sp, p) {
  if (!p || typeof p !== 'object') return;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const web = w.web;
  const mode = ['walk', 'air', 'hang', 'downed'].includes(p.mode) ? p.mode : 'walk';
  if (sp.mode === 'downed' && mode !== 'downed') return; // the host decides when someone is back up
  sp.x = Math.max(-200, Math.min(1800, num(p.x, sp.x)));
  sp.y = Math.max(-300, Math.min(1200, num(p.y, sp.y)));
  sp.facing = num(p.f ?? p.facing, sp.facing);
  sp.mode = mode;
  sp.node = Number.isInteger(p.node) && web.ni(p.node) >= 0 ? p.node : 0;
  sp.th = !sp.node && Number.isInteger(p.th) && web.ti(p.th) >= 0 ? p.th : 0;
  sp.s = Math.max(0, Math.min(1, num(p.s, 0)));
  if (mode === 'walk' && !sp.node && !sp.th) {
    // The thread it named isn't here (yet): hold on to the nearest one.
    const near = web.nearestThread(sp.x, sp.y, 30);
    if (near) {
      sp.th = near.id;
      sp.s = near.t;
    }
  }
  sp.hang = mode === 'hang' && p.hang && typeof p.hang === 'object' ? { anchor: p.hang.node ? { node: p.hang.node } : { th: p.hang.th, s: num(p.hang.s, 0.5) }, len: num(p.hang.len, 20) } : null;
  sp.noise = Math.max(0, Math.min(1, num(p.n, 0.3)));
  if (mode === 'air') {
    sp.vx = num(p.vx, 0);
    sp.vy = num(p.vy, 0);
  }
}

/** Light snapshot of what moves, for drawing on other pages (10 Hz). */
export function snapshot(w) {
  return {
    t: r1(w.t),
    f: r1(w.food),
    ph: w.phase,
    p: w.prey.map((p) => [p.id, PREY_KEYS.indexOf(p.sp), ST.indexOf(p.st), ri(p.x), ri(p.y), ri(p.vx), ri(p.vy), p.node, Math.round(p.wrap * 100), p.big ? 1 : 0, p.facing, p.heldBy ?? 0]),
    w: w.wasps.map((x) => [x.id, ri(x.x), ri(x.y), ri(x.vx), ri(x.vy), x.st]),
    r: w.wren ? [w.wren.st, r1(w.wren.t), ri(w.wren.x), ri(w.wren.y), w.wren.dir, w.wren.warn, w.wren.band] : 0,
    m: w.mantis ? [ri(w.mantis.x), ri(w.mantis.y), w.mantis.st, r1(w.mantis.facing ?? 0)] : 0,
    s: w.spiders.map((sp) => [sp.id, r1(sp.hp), r1(sp.silk), sp.venom, sp.mode === 'downed' ? 1 : 0, sp.act ? sp.act.k : 0, sp.act?.prey ?? 0, r1(sp.act?.t ?? 0), r1(sp.act?.T ?? 0), sp.sp]),
    we: { x: r1(w.weather.windX), s: Math.round(w.weather.sway * 1000) / 1000, r: w.weather.rain ? 1 : 0, m: w.weather.mist ? 1 : 0 },
    l: w.lures.map((l) => [l.id, l.owner, ri(l.x), ri(l.y), r1(l.power)]),
    b: w.balls.map((b) => [b.id, b.owner, ri(b.x), ri(b.y)]),
    lt: w.lights.map((l) => [ri(l.x), ri(l.y), r1(l.power)]),
  };
}

/** Applies a snapshot to a mirrored world (prey and hunters are drawn from it; spiders get their health and silk). */
export function applySnapshot(w, s, myId) {
  if (!s || typeof s !== 'object') return;
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  w.food = num(s.f, w.food);
  if (['dusk', 'night', 'dawn'].includes(s.ph)) {
    w.phase = s.ph;
    w.done = s.ph === 'dawn';
  }
  if (Number.isFinite(s.t) && Math.abs(s.t - w.t) > 0.5) w.t = s.t;
  const prev = new Map(w.prey.map((p) => [p.id, p]));
  const out = [];
  for (const a of Array.isArray(s.p) ? s.p.slice(0, 120) : []) {
    if (!Array.isArray(a)) continue;
    const sp = PREY_KEYS[a[1]];
    const st = ST[a[2]];
    if (!sp || !st) continue;
    const p = prev.get(a[0]) ?? { id: a[0], t: 0, phase: (num(a[0]) * 1.3) % 6.28 };
    // Remember where it was, so it can be drawn sliding between snapshots.
    p.px = p.x ?? num(a[3]);
    p.py = p.y ?? num(a[4]);
    Object.assign(p, { sp, st, x: num(a[3]), y: num(a[4]), vx: num(a[5]), vy: num(a[6]), node: num(a[7]), wrap: num(a[8]) / 100, big: !!a[9], facing: num(a[10], 1) >= 0 ? 1 : -1, heldBy: typeof a[11] === 'string' ? a[11] : null, food: PREY[sp]?.food ?? 1, snapT: 0 });
    out.push(p);
  }
  w.prey = out;
  w.wasps = (Array.isArray(s.w) ? s.w.slice(0, 12) : []).filter(Array.isArray).map((a) => ({ id: a[0], x: num(a[1]), y: num(a[2]), vx: num(a[3]), vy: num(a[4]), st: typeof a[5] === 'string' ? a[5] : 'patrol' }));
  w.wren = Array.isArray(s.r) ? { st: s.r[0] === 'swoop' ? 'swoop' : 'warn', t: num(s.r[1]), x: num(s.r[2]), y: num(s.r[3]), dir: num(s.r[4], 1) >= 0 ? 1 : -1, warn: num(s.r[5], 2.5), band: num(s.r[6], 86) } : null;
  if (Array.isArray(s.m)) {
    w.mantis ??= { st: 'hunt', facing: 0 };
    Object.assign(w.mantis, { x: num(s.m[0]), y: num(s.m[1]), st: typeof s.m[2] === 'string' ? s.m[2] : 'hunt', facing: num(s.m[3]) });
  } else w.mantis = null;
  for (const a of Array.isArray(s.s) ? s.s.slice(0, 4) : []) {
    if (!Array.isArray(a) || typeof a[0] !== 'string') continue;
    let sp = w.spiders.find((q) => q.id === a[0]);
    if (!sp && w.spiders.length < 4) sp = addSpider(w, { id: a[0], sp: SPECIES[a[9]] ? a[9] : 'orb', remote: a[0] !== myId });
    if (!sp) continue;
    sp.hp = num(a[1], sp.hp);
    const silk = num(a[2], sp.silk);
    if (sp.id !== myId || Math.abs(silk - sp.silk) > 4) sp.silk = silk;
    sp.venom = num(a[3], sp.venom);
    if (a[4]) sp.mode = 'downed';
    else if (sp.mode === 'downed') sp.mode = 'walk';
    sp.act = a[5] ? { k: String(a[5]), prey: num(a[6]), t: num(a[7]), T: num(a[8], 1) } : null;
  }
  if (s.we && typeof s.we === 'object') {
    w.weather.windX = num(s.we.x);
    w.weather.sway = num(s.we.s);
    w.weather.rain = !!s.we.r;
    w.weather.mist = !!s.we.m;
    w.stickFactor = w.weather.rain ? 0.6 : 1;
  }
  w.lures = (Array.isArray(s.l) ? s.l.slice(0, 8) : []).filter(Array.isArray).map((a) => ({ id: a[0], owner: String(a[1]), x: num(a[2]), y: num(a[3]), power: num(a[4], 1) }));
  w.balls = (Array.isArray(s.b) ? s.b.slice(0, 8) : []).filter(Array.isArray).map((a) => ({ id: a[0], owner: String(a[1]), x: num(a[2]), y: num(a[3]) }));
  if (Array.isArray(s.lt)) s.lt.forEach((l, i) => w.lights[i] && Array.isArray(l) && Object.assign(w.lights[i], { x: num(l[0], w.lights[i].x), y: num(l[1], w.lights[i].y), power: num(l[2], w.lights[i].power) }));
}

export { SPECIES, spiderMods };
