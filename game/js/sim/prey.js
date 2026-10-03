// The night's visitors: how each kind flies, lands and preens, what happens when it meets silk (sticks, bounces,
// tears through), how it struggles and escapes, and what a spider gets for eating it. Contacts are swept (the path
// from last tick to this one against every thread near it), so nothing fast passes through a strand.
import {
  PREY, MAX_PREY, W, H, GROUND, T_SURFACE, T_STICKY, T_ALARM, N_PREY, N_JUNCTION, JUNCTION_MASS, SILK_E, DT,
  HP_PER_FOOD, SILK_PER_FOOD, SPECIES, REACH,
} from './data.js';
import { rand, range, chance, gauss } from './rng.js';
import { crossing } from './web.js';
import { lanePoint } from './garden.js';
import { splitAt, removeThread } from './actions.js';
import { hurt } from './spider.js';

const lp = {};

export function spawnPrey(world, sp, laneIndex = -1, o = {}) {
  if (world.prey.length >= MAX_PREY) return null;
  const r = world.rng;
  const def = PREY[sp];
  if (!def) return null;
  const lanes = world.garden.lanes;
  const lane = laneIndex >= 0 ? lanes[laneIndex] : null;
  const p = {
    id: world.nextId++,
    sp,
    st: 'fly',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lane: laneIndex,
    u: 0,
    off: (o.off ?? gauss(r) * 0.45) * (lane?.w ?? 60),
    speed: def.speed * range(r, 0.85, 1.15) * (o.speedMul ?? 1),
    t: 0,
    phase: range(r, 0, 6.28),
    swarm: o.swarm ?? 0,
    landAt: o.landAt ?? -1,
    food: def.food * (o.big ? 3 : 1),
    big: !!o.big,
    hit: 0,
    hitT: 0,
    node: 0,
    timer: 0,
    kick: 0,
    wrap: 0,
    eaten: 0,
    heldBy: null,
    alarm: 0,
    landT: 0,
    preen: 0,
    facing: 1,
    zig: 0,
    zigT: 0,
    hover: 0,
    stray: null,
  };
  if (lane) {
    lanePoint(lane, 0, lp);
    p.x = lp.x - lp.dy * p.off;
    p.y = lp.y + lp.dx * p.off;
    p.vx = lp.dx * p.speed;
    p.vy = lp.dy * p.speed;
  } else {
    // A stray: from one edge of the garden to another, off the lanes.
    const side = Math.floor(rand(r) * 3);
    const a = side === 0 ? [-50, range(r, 120, GROUND - 120)] : side === 1 ? [W + 50, range(r, 120, GROUND - 120)] : [range(r, 100, W - 100), -50];
    const b = [side === 0 ? W + 60 : side === 1 ? -60 : range(r, -60, W + 60), side === 2 ? range(r, 300, GROUND - 100) : range(r, 100, GROUND - 120)];
    if (side === 2 && b[0] > 0 && b[0] < W) b[0] = rand(r) < 0.5 ? -60 : W + 60;
    p.stray = { pts: [a, [(a[0] + b[0]) / 2 + range(r, -200, 200), (a[1] + b[1]) / 2 + range(r, -120, 120)], b], w: 30, share: 0 };
    p.x = a[0];
    p.y = a[1];
  }
  if (o.x !== undefined) {
    p.x = o.x;
    p.y = o.y;
  }
  world.prey.push(p);
  return p;
}

function laneOf(world, p) {
  return p.stray ?? world.garden.lanes[p.lane] ?? null;
}

// ---------------------------------------------------------------- per tick
export function updatePrey(world, dt) {
  const web = world.web;
  for (const p of world.prey) {
    p.t += dt;
    if (p.hitT > 0) p.hitT -= dt;
    switch (p.st) {
      case 'fly':
        fly(world, p, dt);
        break;
      case 'land':
        perch(world, p, dt);
        break;
      case 'stuck':
      case 'subdued':
      case 'cocoon':
        onWeb(world, p, dt);
        break;
      case 'held':
        held(world, p);
        break;
      case 'fall':
        p.vy += 420 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > GROUND) {
          p.st = 'gone';
          world.ev.push({ k: 'lost', prey: p.id, sp: p.sp, x: p.x, y: GROUND, cocoon: !!p.wasCocoon });
        }
        break;
      default:
        break;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) p.st = 'gone';
  }
  // Drop the ones that are gone; their web knots become plain silk.
  let w = 0;
  for (const p of world.prey) {
    if (p.st === 'gone') {
      if (p.node && web.ni(p.node) >= 0) releaseNode(world, p.node);
      continue;
    }
    world.prey[w++] = p;
  }
  world.prey.length = w;
  void dt;
}

function releaseNode(world, node) {
  const web = world.web;
  const s = web.ni(node);
  if (s < 0) return;
  if (web.adj[s].length === 0) web.removeNode(node);
  else {
    web.setKind(node, N_JUNCTION);
    web.setMass(node, JUNCTION_MASS);
  }
}

function fly(world, p, dt) {
  const def = PREY[p.sp];
  const lane = laneOf(world, p);
  const r = world.rng;
  const x0 = p.x;
  const y0 = p.y;
  // Where along the lane we want to be.
  let tx;
  let ty;
  if (lane) {
    p.u += (p.speed * dt) / (lanePoint(lane, p.u, lp).total || 1000);
    lanePoint(lane, Math.min(1, p.u + 0.04), lp);
    tx = lp.x - lp.dy * p.off;
    ty = lp.y + lp.dx * p.off;
  } else {
    tx = p.x + p.vx;
    ty = p.y + p.vy;
  }
  // Each kind's way of flying.
  if (p.sp === 'gnat' || p.sp === 'midge') {
    const sw = p.swarm ? world.swarms[p.swarm] : null;
    if (sw) {
      tx = sw.x + Math.sin(p.t * 3.1 + p.phase) * 14 + Math.sin(p.t * 7.3 + p.phase * 2) * 6;
      ty = sw.y + Math.cos(p.t * 2.7 + p.phase) * 10 + Math.sin(p.t * 5.9 + p.phase) * 5;
    }
  } else if (p.sp === 'fly') {
    p.zigT -= dt;
    if (p.zigT <= 0) {
      p.zig = range(r, -45, 45);
      p.zigT = range(r, 0.3, 0.9);
    }
    ty += p.zig;
    // A bolas spider's scent turns some flies too.
    const lure = world.lures.length ? attractor(world, p, true) : null;
    if (lure) {
      tx = tx * (1 - lure.pull) + lure.x * lure.pull;
      ty = ty * (1 - lure.pull) + (lure.y + p.zig * 0.3) * lure.pull;
    }
  } else if (p.sp === 'moth') {
    ty += Math.sin(p.t * 5 + p.phase) * 16;
    const lure = attractor(world, p);
    if (lure) {
      // Circle the light (or the lure) instead of passing it.
      const a = p.t * 1.6 + p.phase;
      tx = tx * (1 - lure.pull) + (lure.x + Math.cos(a) * lure.orbit) * lure.pull;
      ty = ty * (1 - lure.pull) + (lure.y + Math.sin(a) * lure.orbit * 0.6) * lure.pull;
      if (lure.pull > 0.5) p.u -= ((p.speed * dt) / 1000) * lure.pull * 0.85;
    }
  } else if (p.sp === 'beetle') {
    ty += 10;
  } else if (p.sp === 'dragonfly') {
    p.hover -= dt;
    if (p.hover < -range(r, 1.2, 2.6)) p.hover = range(r, 0.3, 0.7);
  }
  // Steer: turn toward the target with some inertia.
  const want = p.sp === 'dragonfly' && p.hover > 0 ? 8 : p.speed;
  let dx = tx - p.x;
  let dy = ty - p.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const agility = p.sp === 'beetle' ? 1.8 : p.sp === 'gnat' || p.sp === 'midge' ? 12 : p.sp === 'fly' ? 7 : 4;
  p.vx += (dx * want - p.vx) * Math.min(1, agility * dt);
  p.vy += (dy * want - p.vy) * Math.min(1, agility * dt);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.vx !== 0) p.facing = p.vx > 0 ? 1 : -1;
  if (p.y > GROUND - 6) {
    p.y = GROUND - 6;
    p.vy = -Math.abs(p.vy) * 0.5;
  }
  // Out of the garden at the far end of its lane: gone.
  if ((lane && p.u >= 1) || p.x < -160 || p.x > W + 160 || p.y < -200 || p.y > H + 50 || p.t > 90) {
    p.st = 'gone';
    return;
  }
  // Time to rest on a leaf?
  if (p.landAt >= 0 && p.u >= p.landAt && p.t > 1) tryLand(world, p);
  contacts(world, p, x0, y0, def);
}

function attractor(world, p, luresOnly = false) {
  let best = null;
  let bestPull = 0;
  for (const l of luresOnly ? [] : world.lights) {
    const d = Math.hypot(l.x - p.x, l.y - p.y);
    const reach = 260 * l.power;
    if (d > reach) continue;
    const pull = Math.min(0.8, (1 - d / reach) * 1.3 * l.power);
    if (pull > bestPull) {
      bestPull = pull;
      best = { x: l.x, y: l.y, pull, orbit: l.r * 0.6 };
    }
  }
  for (const l of world.lures) {
    if (p.sp !== 'moth' && !l.flies && p.sp !== 'fly') continue;
    const d = Math.hypot(l.x - p.x, l.y - p.y);
    const reach = 320 * l.power;
    if (d > reach) continue;
    const pull = Math.min(0.92, (1 - d / reach) * 1.6 * l.power * (p.sp === 'moth' ? 1 : 0.45));
    if (pull > bestPull) {
      bestPull = pull;
      best = { x: l.x, y: l.y, pull, orbit: 26 };
    }
  }
  return best;
}

/** Sticky silk holds; dry silk bounces (and sings); glass turns prey back; heavy prey can break what they hit. */
function contacts(world, p, x0, y0, def) {
  const web = world.web;
  let hit = -1;
  let hu = 2;
  let ht = 0;
  web.near(x0, y0, p.x, p.y, (s) => {
    if (web.tid[s] === p.hit && p.hitT > 0) return;
    const type = web.type[s];
    if (type === T_SURFACE && !(web.flag[s] & 2)) return;
    const a = web.ta[s];
    const b = web.tb[s];
    if (web.kind[a] === N_PREY && web.kind[b] === N_PREY) return;
    const u = crossing(web.x[a], web.y[a], web.x[b], web.y[b], x0, y0, p.x, p.y);
    if (u < 0 || u >= hu) return;
    hu = u;
    hit = s;
    ht = crossing(x0, y0, p.x, p.y, web.x[a], web.y[a], web.x[b], web.y[b]);
  });
  if (hit < 0) return;
  const id = web.tid[hit];
  p.hit = id;
  p.hitT = 0.3;
  const type = web.type[hit];
  const speed = Math.hypot(p.vx, p.vy);
  const hx = x0 + (p.x - x0) * hu;
  const hy = y0 + (p.y - y0) * hu;
  if (type === T_SURFACE) return bounce(world, p, hit, hx, hy, 0.6, false);
  if (type === T_ALARM) world.ev.push({ k: 'alarm', prey: p.id, sp: p.sp, x: hx, y: hy, th: id });
  const rules = world.rules;
  // Sticky silk.
  if (type === T_STICKY && web.stick[hit] > 0) {
    let chanceStick = def.stick * web.stick[hit] * (web.dry[hit] > 0 ? 1 : world.stickFactor);
    chanceStick *= 1 - 0.35 * Math.min(1, web.dew[hit] / 8);
    if (p.sp === 'beetle' && rules.heavyheart) chanceStick = Math.min(0.98, chanceStick * 2);
    if ((p.sp === 'gnat' || p.sp === 'midge') && rules.dewharp && web.vib[hit] > 25) chanceStick = 1;
    if (chance(world.rng, Math.min(0.98, chanceStick))) return stick(world, p, hit, ht, hx, hy);
    if (def.tear && chance(world.rng, def.tear)) {
      world.ev.push({ k: 'tear', prey: p.id, sp: p.sp, x: hx, y: hy, th: id });
      p.vx *= 0.7;
      p.vy *= 0.7;
      return removeThread(world, id, 3);
    }
    if (def.shred && breaks(web, hit, def.mass, speed * 0.8)) {
      world.ev.push({ k: 'tear', prey: p.id, sp: p.sp, x: hx, y: hy, th: id });
      p.vx *= 0.85;
      p.vy *= 0.85;
      return removeThread(world, id, 3);
    }
  } else if (def.mass >= 4 && breaks(web, hit, def.mass, speed)) {
    // Heavy and fast enough to break a dry thread outright.
    world.ev.push({ k: 'tear', prey: p.id, sp: p.sp, x: hx, y: hy, th: id });
    p.vx *= 0.75;
    p.vy *= 0.75;
    return removeThread(world, id, 3);
  }
  bounce(world, p, hit, hx, hy, 0.45, true);
}

/** Would an impact of this mass and speed snap the thread? (Its stretch energy at the snapping point.) */
function breaks(web, s, mass, speed) {
  const k = (web.str[s] * SILK_E) / Math.max(1, web.rest[s]);
  const stretch = web.rest[s] * (web.snap[s] - 1);
  const capacity = 0.5 * k * stretch * stretch * 0.08;
  return 0.5 * mass * speed * speed > capacity;
}

function bounce(world, p, s, hx, hy, keep, sing) {
  const web = world.web;
  const a = web.ta[s];
  const b = web.tb[s];
  const tx = web.x[b] - web.x[a];
  const ty = web.y[b] - web.y[a];
  const L = Math.hypot(tx, ty) || 1;
  const nx = -ty / L;
  const ny = tx / L;
  const vn = p.vx * nx + p.vy * ny;
  p.vx = (p.vx - 2 * vn * nx) * keep;
  p.vy = (p.vy - 2 * vn * ny) * keep;
  p.x = hx + nx * Math.sign(-vn || 1) * 2;
  p.y = hy + ny * Math.sign(-vn || 1) * 2;
  if (sing) {
    const def = PREY[p.sp];
    const amp = Math.abs(vn) * def.mass * 2.4 + 30;
    web.pluck(s, amp, Math.abs(vn) * def.mass * 0.9, nx * Math.sign(vn), ny * Math.sign(vn));
    world.ev.push({ k: 'pluck', th: web.tid[s], amp, x: hx, y: hy, prey: p.sp });
  }
}

export function stick(world, p, s, t, hx, hy) {
  const web = world.web;
  const def = PREY[p.sp];
  const id = web.tid[s];
  const r = splitAt(world, id, t, { kind: N_PREY, mass: def.mass, player: false, vx: p.vx * 0.9, vy: p.vy * 0.9 });
  if (!r) return bounce(world, p, s, hx, hy, 0.4, true);
  p.st = 'stuck';
  p.node = r.node;
  p.timer = def.escape * range(world.rng, 0.85, 1.2);
  p.kick = range(world.rng, 0.3, 0.9);
  p.wrap = 0;
  const ns = web.ni(r.node);
  p.x = web.x[ns];
  p.y = web.y[ns];
  for (const t2 of web.adj[ns]) web.pluck(t2, 120 + def.mass * 160);
  world.ev.push({ k: 'stick', prey: p.id, sp: p.sp, x: p.x, y: p.y, th: r.a, big: p.big });
  world.tally.caught[p.sp] = (world.tally.caught[p.sp] ?? 0) + 1;
}

function onWeb(world, p, dt) {
  const web = world.web;
  const ns = web.ni(p.node);
  if (ns < 0) return void freeFromWeb(world, p);
  p.x = web.x[ns];
  p.y = web.y[ns];
  if (p.st !== 'stuck') return;
  const def = PREY[p.sp];
  // Struggle: kicks that shake the web, weaker as the wrapping closes in.
  p.kick -= dt;
  if (p.kick <= 0) {
    p.kick = range(world.rng, 0.3, 0.9);
    const calm = 1 - 0.75 * (p.wrap ?? 0);
    let power = def.struggle * calm * (p.sp === 'beetle' && world.rules.heavyheart ? 0.5 : 1);
    const a = range(world.rng, 0, Math.PI * 2);
    const kx = Math.cos(a) * power;
    const ky = Math.sin(a) * power - power * 0.3;
    const h = DT / 6;
    web.px[ns] -= kx * h;
    web.py[ns] -= ky * h;
    for (const t of web.adj[ns]) web.pluck(t, power * def.mass * 0.6 + 40);
    world.ev.push({ k: 'struggle', prey: p.id, sp: p.sp, x: p.x, y: p.y, amp: power * def.mass });
    if (def.armour || p.sp === 'dragonfly') thrash(world, p, ns, power, def);
  }
  p.timer -= dt * (1 - 0.8 * (p.wrap ?? 0));
  if (p.timer <= 0) {
    // Free: tear out the strands it hangs on and fly off.
    world.ev.push({ k: 'escape', prey: p.id, sp: p.sp, x: p.x, y: p.y });
    world.tally.escaped[p.sp] = (world.tally.escaped[p.sp] ?? 0) + 1;
    const node = p.node;
    for (const t of [...web.adj[ns]]) removeThread(world, web.tid[t], 3);
    if (web.ni(node) >= 0) web.removeNode(node);
    flyOff(world, p);
  }
}

/**
 * A heavy armoured insect throws its weight around: each kick loads the dry silk near it (frames and radials within
 * two knots). Thread strength decides: a weak frame gives way, a strong one holds.
 */
function thrash(world, p, ns, power, def) {
  const web = world.web;
  const seen = new Set();
  let frontier = [ns];
  for (let hop = 0; hop < 2; hop++) {
    const next = [];
    for (const n of frontier) {
      for (const t of web.adj[n]) {
        if (seen.has(t)) continue;
        seen.add(t);
        next.push(web.other(t, n));
        const type = web.type[t];
        if (type !== 0 && type !== 1) continue;
        // Load: the kick's momentum, spread over the hops, against the thread's strength.
        const load = (power * def.mass * (hop ? 0.85 : 1) * range(world.rng, 0.6, 1.4)) / (web.str[t] * 11.5);
        if (load > 1) {
          world.ev.push({ k: 'tear', prey: p.id, sp: p.sp, x: web.x[n], y: web.y[n], th: web.tid[t], type });
          removeThread(world, web.tid[t], 3);
          return;
        }
      }
    }
    frontier = next;
  }
}

function flyOff(world, p) {
  p.st = 'fly';
  p.node = 0;
  p.wrap = 0;
  p.heldBy = null;
  p.stray = { pts: [[p.x, p.y], [p.x < W / 2 ? -80 : W + 80, Math.max(60, p.y - 200)]], w: 10, share: 0 };
  p.u = 0;
  p.lane = -1;
  p.landAt = -1;
  p.hitT = 0.6;
  p.vy = -80;
}

/** A stuck prey's last thread went (snapped, cut, torn): it drops, and a live one flies off. */
export function freeFromWeb(world, p) {
  const web = world.web;
  if (p.node && web.ni(p.node) >= 0 && web.adj[web.ni(p.node)].length === 0) web.removeNode(p.node);
  p.node = 0;
  for (const sp of world.spiders) if (sp.act?.prey === p.id) sp.act = null;
  if (p.st === 'stuck') return flyOff(world, p);
  p.wasCocoon = p.st === 'cocoon';
  p.st = 'fall';
  p.vx = 0;
  p.vy = 30;
  p.heldBy = null;
}

function tryLand(world, p) {
  const web = world.web;
  p.landAt = -1;
  const near = web.nearestThread(p.x, p.y, 140, (s) => web.type[s] === T_SURFACE && Math.min(web.y[web.ta[s]], web.y[web.tb[s]]) < GROUND - 30 && !(web.flag[s] & 2));
  if (!near) return;
  p.st = 'land';
  p.landTh = near.id;
  p.landS = near.t;
  p.landT = range(world.rng, 4, 9);
  p.preen = 0;
  p.facing = rand(world.rng) < 0.5 ? -1 : 1;
  p.vx = p.vy = 0;
  web.at(near.s, near.t, p);
  world.ev.push({ k: 'perch', prey: p.id, sp: p.sp, x: p.x, y: p.y });
}

/** Resting on a leaf: preening now and then; watching for spiders in front of it. */
function perch(world, p, dt) {
  const web = world.web;
  const s = web.ti(p.landTh);
  if (s < 0) return takeOff(world, p, null);
  web.at(s, p.landS, p);
  p.landT -= dt;
  p.preen -= dt;
  if (p.preen < -range(world.rng, 1.5, 3.5)) p.preen = range(world.rng, 1.2, 2.6);
  const preening = p.preen > 0;
  const half = preening ? 0.45 : 1.05;
  const reach = preening ? 55 : 120;
  let threat = null;
  let worst = 0;
  for (const sp of world.spiders) {
    if (sp.mode === 'downed') continue;
    const dx = sp.x - p.x;
    const dy = sp.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > reach) continue;
    const ang = Math.abs(Math.atan2(dy, dx * p.facing));
    const seen = ang < half || d < 28;
    if (!seen) continue;
    const noise = Math.max(0.15, sp.noise) * (sp.sp === 'jumper' ? sp.mods.stalk : 1);
    const a = (noise * 1.8 + (1 - d / reach) * 0.8) * dt * 2.1;
    if (a > worst) {
      worst = a;
      threat = sp;
    }
  }
  p.alarm = threat ? Math.min(1, p.alarm + worst) : Math.max(0, p.alarm - dt * 0.6);
  if (p.alarm >= 1 || p.landT <= 0) takeOff(world, p, threat);
}

function takeOff(world, p, from) {
  p.st = 'fly';
  p.alarm = 0;
  p.hitT = 0.4;
  if (from) {
    // Flee: straight away from whoever startled it, then out of the garden.
    const dx = p.x - from.x;
    const dy = p.y - from.y - 40;
    const d = Math.hypot(dx, dy) || 1;
    p.stray = { pts: [[p.x, p.y], [p.x + (dx / d) * 240, p.y + (dy / d) * 240], [dx > 0 ? W + 80 : -80, Math.max(60, p.y - 260)]], w: 10, share: 0 };
    p.u = 0;
    p.lane = -1;
    p.speed *= 1.25;
    world.ev.push({ k: 'flee', prey: p.id, sp: p.sp, x: p.x, y: p.y });
  }
  p.vy = -60;
}

function held(world, p) {
  const sp = world.spiders.find((s) => s.id === p.heldBy);
  const ball = world.balls.find((b) => b.prey === p.id);
  if (ball) {
    p.x = ball.x;
    p.y = ball.y;
    return;
  }
  if (!sp || sp.mode === 'downed') {
    p.heldBy = null;
    p.wasCocoon = false;
    p.st = 'fall';
    p.vx = 0;
    p.vy = 20;
    return;
  }
  p.x = sp.x + Math.cos(sp.facing) * 7;
  p.y = sp.y + Math.sin(sp.facing) * 7;
}

/** A hunter's pounce or a bolas ball got it. */
export function grabPrey(world, p, sp) {
  if (p.node) freeNode(world, p);
  p.st = 'held';
  p.heldBy = sp.id;
  p.hitT = 9;
  world.tally.caught[p.sp] = (world.tally.caught[p.sp] ?? 0) + 1;
  world.ev.push({ k: 'grab', id: sp.id, prey: p.id, sp: p.sp, x: p.x, y: p.y });
}

function freeNode(world, p) {
  const web = world.web;
  const ns = web.ni(p.node);
  if (ns >= 0) for (const t of [...web.adj[ns]]) removeThread(world, web.tid[t], 3);
  if (web.ni(p.node) >= 0) web.removeNode(p.node);
  p.node = 0;
}

/** Eating done: the food is banked, the spider is fed (health and silk), and the knot is plain silk again. */
export function eatPrey(world, p, sp) {
  const rules = world.rules;
  let food = p.food;
  if (rules.feast) food *= p.sp === 'moth' || p.sp === 'beetle' ? 1.5 : p.sp === 'gnat' ? 0.5 : 1;
  world.food += food;
  world.tally.eaten[p.sp] = (world.tally.eaten[p.sp] ?? 0) + 1;
  sp.stats.food += food;
  sp.stats.eaten++;
  if (p.sp === 'moth') sp.stats.moths++;
  sp.stats.biggest = Math.max(sp.stats.biggest, food);
  sp.hp = Math.min(SPECIES[sp.sp].hp, sp.hp + food * HP_PER_FOOD);
  sp.silk = Math.min(sp.mods.maxSilk, sp.silk + food * SILK_PER_FOOD);
  p.st = 'gone';
  p.heldBy = null;
  world.ev.push({ k: 'eat', id: sp.id, prey: p.id, sp: p.sp, food, x: p.x, y: p.y, big: p.big });
}

// ---------------------------------------------------------------- hunters and fishers
/** Jumpers in the air catch what they pass; bolas balls catch moths. */
export function hunt(world, dt) {
  for (const sp of world.spiders) {
    if (sp.sp !== 'jumper' || sp.mode !== 'air') continue;
    if (world.prey.some((q) => q.heldBy === sp.id && q.st === 'held')) continue;
    for (const p of world.prey) {
      if (p.st !== 'fly' && p.st !== 'land' && p.st !== 'stuck') continue;
      const flying = p.st === 'fly';
      // Gnats and midges scatter from a leaping spider; only bigger fliers can be snatched out of the air.
      if (flying && (p.sp === 'gnat' || p.sp === 'midge')) continue;
      const reach = flying ? 6 + PREY[p.sp].size * 0.25 : 12 + PREY[p.sp].size * 0.6;
      if (Math.hypot(p.x - sp.x, p.y - sp.y) > reach) continue;
      // A flier sees it coming and swerves, nearly always: the hunter's meal is the one that landed.
      if (flying && p.dodged !== sp.air) {
        p.dodged = sp.air;
        if (chance(world.rng, { fly: 0.88, moth: 0.6, beetle: 0.4, dragonfly: 0.92 }[p.sp] ?? 0.9)) continue;
      }
      if (PREY[p.sp].armour || p.sp === 'dragonfly') {
        if (sp.venom <= 0) {
          hurt(world, sp, 8, 'kick');
          world.ev.push({ k: 'kicked', id: sp.id, prey: p.id, x: p.x, y: p.y });
          break;
        }
        sp.venom--;
      }
      grabPrey(world, p, sp);
      break;
    }
  }
  // A jumper that has landed with prey in its jaws starts eating.
  for (const sp of world.spiders) {
    if (sp.act || sp.mode === 'air' || sp.mode === 'downed') continue;
    const p = world.prey.find((q) => q.heldBy === sp.id && q.st === 'held' && !world.balls.some((b) => b.prey === q.id));
    if (p) sp.act = { k: 'eat', prey: p.id, t: 0, T: PREY[p.sp].eat * sp.mods.eat };
  }
  // Bolas balls: out along their throw, then reeled back (with whatever they caught).
  for (let i = world.balls.length - 1; i >= 0; i--) {
    const b = world.balls[i];
    const owner = world.spiders.find((s) => s.id === b.owner);
    if (!owner) {
      world.balls.splice(i, 1);
      continue;
    }
    b.t += dt;
    if (!b.back) {
      b.vy += 160 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (const p of world.prey) {
        if (p.st !== 'fly' && p.st !== 'land') continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) > 14 + PREY[p.sp].size * 0.4) continue;
        const odds = p.sp === 'moth' ? 0.95 : p.sp === 'fly' ? 0.55 : p.sp === 'midge' || p.sp === 'gnat' ? 0.15 : 0.06;
        if (chance(world.rng, Math.min(0.98, odds * b.sticky))) {
          grabPrey(world, p, owner);
          b.prey = p.id;
          b.back = true;
          world.ev.push({ k: 'bolashit', id: owner.id, prey: p.id, sp: p.sp, x: b.x, y: b.y });
          break;
        }
      }
      if (b.t >= b.T) b.back = true;
    } else {
      const dx = owner.x - b.x;
      const dy = owner.y - b.y;
      const d = Math.hypot(dx, dy);
      const v = 420 * dt;
      if (d <= v + 6) {
        world.balls.splice(i, 1);
        continue;
      }
      b.x += (dx / d) * v;
      b.y += (dy / d) * v;
    }
  }
  for (let i = world.lures.length - 1; i >= 0; i--) {
    world.lures[i].t -= dt;
    if (world.lures[i].t <= 0) world.lures.splice(i, 1);
  }
}

export { REACH, T_STICKY };
