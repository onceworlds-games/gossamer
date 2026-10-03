// A spider: where it is on the silk graph and how it moves. Walking follows threads and branches; at a knot the
// thread best lined up with the stick wins. Leaps fly a ballistic arc and lay a dragline; a spider whose footing goes
// hangs from its dragline (enough silk) or falls. Holding Down where nothing leads down lowers it on a dragline.
// The page that owns a spider runs moveSpider(); the host runs everything else (actions.js) for every spider.
import {
  SPECIES, STICKY_SLOW, HURRY, DRAGLINE_MIN, FALL_DAMAGE, DROP_SPEED, GRAVITY, W, H, T_SURFACE, T_STICKY,
  THREADS, DT, CUT_REFUND, RETREAT_HEAL, GROUND,
} from './data.js';
import { crossing } from './web.js';
import { inCover, retreatNode } from './garden.js';

const ROPE_MAX = 420;
const CLIMB = 95;

export function spiderMods(sp) {
  const up = sp.up ?? {};
  const tr = new Set(sp.tr ?? []);
  const base = SPECIES[sp.sp] ?? SPECIES.orb;
  const tier = (k) => Math.max(0, Math.min(3, up[k] | 0));
  const g = tier('glands');
  const L = tier('legs');
  return {
    maxSilk: base.silk + [0, 20, 40, 65][g] * (sp.sp === 'orb' ? 1 : 0.5),
    regen: base.regen + [0, 0.4, 0.8, 1.2][g],
    range: (base.range || 0) + 60 * g,
    speed: base.speed * [1, 1.1, 1.2, 1.3][L],
    run: (base.run ?? base.speed * HURRY) * [1, 1.1, 1.2, 1.3][L],
    stickySlow: [STICKY_SLOW, 0.5, 0.6, 0.7][L],
    leap: (base.leap ?? 260) * (sp.sp === 'jumper' ? [1, 1.12, 1.24, 1.36][L] : 1) * (tr.has('dancer') ? 1.4 : 1),
    leapFree: tr.has('dancer'),
    strong: [1, 1.3, 1.6, 2][tier('strong')],
    droplets: [1, 1.12, 1.24, 1.36][tier('droplets')],
    wash: [0.4, 0.3, 0.2, 0.1][tier('droplets')],
    shake: tier('shake'),
    eyes: tier('eyes'),
    alarm: tier('alarm'),
    templates: tier('templates'),
    lure: tier('lure'),
    venom: tier('venom'),
    camoWren: [1, 0.7, 0.45, 0.25][tier('camo')],
    camoWasp: [1, 0.85, 0.7, 0.55][tier('camo')],
    stalk: [1, 0.8, 0.65, 0.5][tier('camo')],
    silent: tr.has('whisper'),
    stickyCost: tr.has('spinneret') ? 0.7 : 1,
    radialCost: tr.has('spinneret') ? 1.3 : 1,
    eat: tr.has('gourmand') ? 0.5 : 1,
    wrapCost: tr.has('gourmand') ? 1.5 : 1,
    wrapTime: tr.has('quickwrap') ? 0.6 : 1,
    still: tr.has('patient') ? 2 : 1,
    refund: tr.has('recycler') ? 0.8 : CUT_REFUND,
    dmg: tr.has('thickskin') ? 0.6 : 1,
    balloon: tr.has('balloon'),
    banker: tr.has('banker'),
    fierce: tr.has('fierce'),
    lantern: tr.has('lantern'),
  };
}

export function createSpider(id, species, o = {}) {
  const sp = {
    id: String(id),
    sp: SPECIES[species] ? species : 'orb',
    idx: o.idx ?? 0,
    up: { ...(o.up ?? {}) },
    tr: [...(o.tr ?? [])],
    mode: 'walk', // walk | air | hang | downed
    node: 0,
    th: 0,
    s: 0,
    from: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 0,
    hp: 100,
    silk: 100,
    venom: 0,
    busy: 0,
    act: null, // host-run action: { k: 'wrap' | 'eat' | 'orb' | 'revive' | 'give' | 'spin', ... }
    glide: null, // { x0, y0, x1, y1, t, T }: easing to the hub while a Quick Orb is spun
    regenDelay: 0,
    still: 0,
    invuln: 0,
    downed: 0,
    hidden: false,
    inRetreat: false,
    noise: 0,
    air: null, // { t, T, tx, ty, skip, anchor, rope, aim }
    hang: null, // { anchor: { node } | { th, s }, len }
    charge: 0,
    remote: !!o.remote,
    stats: { food: 0, catches: 0, eaten: 0, casts: 0, silk: 0, damage: 0, given: 0, dew: 0, moths: 0, wasps: 0, dodges: 0, biggest: 0 },
  };
  sp.mods = spiderMods(sp);
  sp.hp = SPECIES[sp.sp].hp;
  sp.silk = o.silk ?? sp.mods.maxSilk;
  sp.venom = sp.mods.venom;
  return sp;
}

export function refreshMods(sp) {
  sp.mods = spiderMods(sp);
  sp.silk = Math.min(sp.silk, sp.mods.maxSilk);
}

/** Puts the spider on node `id`. */
export function placeAt(world, sp, id) {
  const p = world.web.pos(id);
  if (!p) return false;
  sp.glide = null;
  sp.mode = 'walk';
  sp.node = id;
  sp.from = id;
  sp.th = 0;
  sp.s = 0;
  sp.air = null;
  sp.hang = null;
  sp.x = p.x;
  sp.y = p.y;
  return true;
}

/** The spider's world position from where it holds on. */
export function pose(world, sp) {
  const web = world.web;
  if (sp.mode === 'walk' || sp.mode === 'downed') {
    if (sp.node) {
      const n = web.ni(sp.node);
      if (n >= 0) {
        sp.x = web.x[n];
        sp.y = web.y[n];
        return true;
      }
    } else if (sp.th) {
      const t = web.ti(sp.th);
      if (t >= 0) {
        web.at(t, sp.s, sp);
        return true;
      }
    }
    return false;
  }
  if (sp.mode === 'hang') {
    const a = anchorPos(world, sp.hang.anchor);
    if (!a) return false;
    // Hanging: a pendulum under the anchor (x, y kept by the swing in moveSpider).
    return true;
  }
  return true;
}

export function anchorPos(world, anchor) {
  if (!anchor) return null;
  const web = world.web;
  if (anchor.node) return web.pos(anchor.node);
  const t = web.ti(anchor.th);
  return t < 0 ? null : web.at(t, anchor.s, {});
}

/** Where the spider holds on now, as a dragline anchor. */
function holdAnchor(sp) {
  if (sp.node) return { node: sp.node };
  if (sp.th) return { th: sp.th, s: sp.s };
  return null;
}

/** Remaps the spider after a thread it stood on was split (old -> a [start..t], b [t..end] at node). */
export function remapSplit(sp, split) {
  if (sp.th === split.old && !sp.node) {
    if (sp.s < split.t) {
      sp.th = split.a;
      sp.s = sp.s / split.t;
    } else {
      sp.th = split.b;
      sp.s = (sp.s - split.t) / (1 - split.t);
    }
  }
  const fix = (an) => {
    if (an && an.th === split.old) {
      if (an.s < split.t) {
        an.th = split.a;
        an.s /= split.t;
      } else {
        an.th = split.b;
        an.s = (an.s - split.t) / (1 - split.t);
      }
    }
  };
  fix(sp.hang?.anchor);
  fix(sp.air?.anchor);
}

// ---------------------------------------------------------------- moving (run by the page that owns this spider)
const scratch = {};

/**
 * inp: { mx, my (stick, -1..1, y down), hurry, leap: { x, y, power } | null }. Returns nothing; may push events.
 */
export function moveSpider(world, sp, inp, dt = DT) {
  if (sp.mode === 'downed') return void pose(world, sp);
  if (sp.glide && glideStep(world, sp, dt)) return;
  if (sp.busy > 0 || (sp.act && sp.act.k !== 'give')) {
    if (sp.mode === 'walk' && !pose(world, sp)) loseFooting(world, sp);
    else if (sp.mode === 'hang') swing(world, sp, null, dt);
    return;
  }
  if (inp.leap && sp.mode !== 'air') startLeap(world, sp, inp.leap.x, inp.leap.y, inp.leap.power ?? 1);
  if (sp.mode === 'air') return void fly(world, sp, dt);
  if (sp.mode === 'hang') return void swing(world, sp, inp, dt);
  if (!pose(world, sp)) return void loseFooting(world, sp);
  let mx = Number.isFinite(inp.mx) ? inp.mx : 0;
  let my = Number.isFinite(inp.my) ? inp.my : 0;
  const mag = Math.hypot(mx, my);
  if (mag < 0.2) {
    sp.still += dt;
    sp.noise = Math.max(0, sp.noise - dt * 2);
    return;
  }
  sp.still = 0;
  mx /= mag;
  my /= mag;
  const speed = (inp.hurry ? sp.mods.run : sp.mods.speed) * Math.min(1, mag);
  sp.noise = Math.min(1, Math.max(sp.noise, inp.hurry ? 0.8 : 0.35));
  sp.facing = Math.atan2(my, mx);
  // Down, held a moment, with nothing leading down: lower yourself on a dragline.
  if (my > 0.75 && sp.sp !== 'bolas' && sp.sp !== 'mantis' && !inp.noDrop && !leadsDown(world, sp)) {
    sp.dropHold = (sp.dropHold ?? 0) + dt;
    if (sp.dropHold > 0.3 || inp.drop) {
      sp.dropHold = 0;
      if (sp.silk >= DRAGLINE_MIN * 0.4) startHang(world, sp, 2);
    }
    return;
  }
  sp.dropHold = 0;
  walk(world, sp, mx, my, speed * dt);
}

/** Spinning a Quick Orb: the spider eases over to the hub as the first spokes go out, so it never jumps there at the end. */
export function startGlide(sp, x, y) {
  const d = Math.hypot(x - sp.x, y - sp.y);
  sp.glide = { x0: sp.x, y0: sp.y, x1: x, y1: y, t: 0, T: Math.max(0.35, Math.min(2.2, 0.3 + d / 300)) };
}

function glideStep(world, sp, dt) {
  const g = sp.glide;
  g.t += dt;
  // The hub sags a little as the spokes go out: end where it really is.
  if (g.node) {
    const hp = world.web.pos(g.node);
    if (hp) {
      g.x1 = hp.x;
      g.y1 = hp.y;
    }
  }
  if (g.t > g.T + 6) {
    sp.glide = null;
    return false;
  }
  const f = Math.min(1, g.t / g.T);
  const e = f * f * (3 - 2 * f);
  sp.x = g.x0 + (g.x1 - g.x0) * e;
  sp.y = g.y0 + (g.y1 - g.y0) * e;
  if (f < 1 && Math.hypot(g.x1 - g.x0, g.y1 - g.y0) > 6) sp.facing = Math.atan2(g.y1 - g.y0, g.x1 - g.x0);
  return true;
}

function leadsDown(world, sp) {
  const web = world.web;
  if (sp.node) {
    const n = web.ni(sp.node);
    if (n < 0) return true;
    for (const t of web.adj[n]) {
      const o = web.other(t, n);
      const dx = web.x[o] - web.x[n];
      const dy = web.y[o] - web.y[n];
      if (dy / (Math.hypot(dx, dy) || 1) > 0.45) return true;
    }
    return web.y[n] > 900 || web.adj[n].some((t) => web.type[t] === T_SURFACE && isGround(world, t));
  }
  const t = web.ti(sp.th);
  if (t < 0) return true;
  const dx = web.x[web.tb[t]] - web.x[web.ta[t]];
  const dy = web.y[web.tb[t]] - web.y[web.ta[t]];
  return Math.abs(dy / (Math.hypot(dx, dy) || 1)) > 0.45 || (web.type[t] === T_SURFACE && isGround(world, t));
}

function isGround(world, t) {
  const web = world.web;
  if (web.type[t] !== T_SURFACE) return false;
  return web.tid[t] <= (world.garden.groundThreads ?? 0) || Math.min(web.y[web.ta[t]], web.y[web.tb[t]]) > GROUND - 40;
}

/** Below the soil: put the spider on the ground it went through. */
function catchGround(world, sp) {
  if (sp.y < GROUND - 30) return false;
  const web = world.web;
  const near = web.nearestThread(sp.x, Math.min(sp.y, GROUND + 20), 80, (t) => isGround(world, t));
  if (!near) return false;
  land(world, sp, near.s, near.t);
  return true;
}

function walk(world, sp, mx, my, budget) {
  const web = world.web;
  for (let guard = 0; guard < 6 && budget > 0.01; guard++) {
    if (sp.node) {
      const n = web.ni(sp.node);
      if (n < 0) return loseFooting(world, sp);
      let best = -1;
      let bestScore = 0.3;
      for (const t of web.adj[n]) {
        const o = web.other(t, n);
        const dx = web.x[o] - web.x[n];
        const dy = web.y[o] - web.y[n];
        const d = Math.hypot(dx, dy) || 1;
        let score = (dx * mx + dy * my) / d;
        if (web.tid[t] === sp.th) score -= 0.05; // a little reluctance to turn straight back
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best < 0) return;
      sp.th = web.tid[best];
      sp.s = web.ta[best] === n ? 0 : 1;
      sp.from = sp.node;
      sp.node = 0;
    }
    const t = web.ti(sp.th);
    if (t < 0) return loseFooting(world, sp);
    const a = web.ta[t];
    const b = web.tb[t];
    const L = Math.max(1, web.len[t] || Math.hypot(web.x[b] - web.x[a], web.y[b] - web.y[a]));
    if (L < 4) {
      // A sliver of a thread: just step to whichever end the stick is closer to pointing at.
      const end = sp.s < 0.5 ? b : a;
      arrive(world, sp, end);
      budget -= L;
      continue;
    }
    const ux = (web.x[b] - web.x[a]) / L;
    const uy = (web.y[b] - web.y[a]) / L;
    const along = ux * mx + uy * my;
    if (Math.abs(along) < 0.22) {
      // Mostly across this thread: step to the nearer knot if it's close, so the next press can turn.
      const near = sp.s < 0.5 ? a : b;
      if (Math.min(sp.s, 1 - sp.s) * L < 9) arrive(world, sp, near);
      return;
    }
    const slow = web.type[t] === T_STICKY ? sp.mods.stickySlow : 1;
    const dir = along > 0 ? 1 : -1;
    const ds = (budget * slow * Math.abs(along) ** 0.3) / L;
    const ns = sp.s + dir * ds;
    if (ns >= 1) {
      budget -= ((1 - sp.s) * L) / slow;
      arrive(world, sp, b);
    } else if (ns <= 0) {
      budget -= (sp.s * L) / slow;
      arrive(world, sp, a);
    } else {
      sp.s = ns;
      budget = 0;
    }
  }
  pose(world, sp);
}

function arrive(world, sp, slot) {
  sp.node = world.web.nid[slot];
  sp.from = sp.node;
  sp.x = world.web.x[slot];
  sp.y = world.web.y[slot];
}

/** The spider's footing is gone (the thread was cut, snapped or torn). */
export function loseFooting(world, sp) {
  const web = world.web;
  // Standing next to a knot that still exists: step onto it.
  if (sp.th && !sp.node) {
    const near = web.nearestNode(sp.x, sp.y, 9, (s) => web.kind[s] !== 2);
    if (near) return void (sp.node = near.id, (sp.from = near.id), pose(world, sp));
  }
  if (sp.node && web.ni(sp.node) >= 0 && web.adj[web.ni(sp.node)].length > 0) return void pose(world, sp);
  // Fall: the dragline catches us at the last knot we passed, if there is silk for it.
  const anchor = sp.from && sp.from !== sp.node && web.ni(sp.from) >= 0 ? { node: sp.from } : null;
  sp.node = 0;
  sp.th = 0;
  startFall(world, sp, anchor);
}

function startFall(world, sp, anchor) {
  const canRope = anchor && sp.silk >= DRAGLINE_MIN && sp.sp !== 'bolas';
  sp.mode = 'air';
  sp.vx = 0;
  sp.vy = 20;
  const a = canRope ? anchorPos(world, anchor) : null;
  sp.air = { t: 0, T: 0, tx: sp.x, ty: sp.y, skip: 0.1, anchor: canRope ? anchor : null, rope: a ? Math.min(ROPE_MAX, Math.hypot(sp.x - a.x, sp.y - a.y) + 40) : 0, fall: true, y0: sp.y };
  world.ev.push({ k: 'fall', id: sp.id, x: sp.x, y: sp.y, rope: !!sp.air.anchor });
}

/** Leap toward (tx, ty): an arc that arrives there unless something is caught first. */
export function startLeap(world, sp, tx, ty, power = 1) {
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
  const anchor = holdAnchor(sp) ?? sp.hang?.anchor ?? null;
  let dx = tx - sp.x;
  let dy = ty - sp.y;
  let d = Math.hypot(dx, dy);
  if (d < 12) return false;
  const reach = sp.mods.leap * Math.max(0.25, Math.min(1, power));
  if (d > reach) {
    dx *= reach / d;
    dy *= reach / d;
    d = reach;
  }
  const cost = sp.mods.leapFree ? 0 : 2;
  const rope = sp.silk >= DRAGLINE_MIN && anchor;
  if (cost && sp.silk >= cost) {
    sp.silk -= cost;
    sp.regenDelay = Math.max(sp.regenDelay, 0.6);
  }
  const T = Math.max(0.22, Math.min(0.62, d / 470));
  sp.vx = dx / T;
  sp.vy = (dy - 0.5 * GRAVITY * T * T) / T;
  sp.mode = 'air';
  sp.air = { t: 0, T, tx: sp.x + dx, ty: sp.y + dy, skip: 0.12, anchor: rope ? anchor : null, rope: rope ? Math.min(ROPE_MAX, d * 1.15 + 50) : 0, fromTh: sp.th, fromNode: sp.node, y0: sp.y };
  sp.node = 0;
  sp.th = 0;
  sp.hang = null;
  sp.facing = Math.atan2(dy, dx);
  sp.noise = 1;
  world.ev.push({ k: 'leap', id: sp.id, x: sp.x, y: sp.y, tx: sp.air.tx, ty: sp.air.ty });
  return true;
}

function fly(world, sp, dt) {
  const air = sp.air;
  const web = world.web;
  air.t += dt;
  const x0 = sp.x;
  const y0 = sp.y;
  const g = sp.mods.balloon && air.fall ? GRAVITY * 0.25 : GRAVITY;
  sp.vy += g * dt;
  if (sp.mods.balloon && air.fall) sp.vy = Math.min(sp.vy, 110);
  sp.x += sp.vx * dt;
  sp.y += sp.vy * dt;
  // Caught by the dragline: swing from it.
  if (air.anchor) {
    const a = anchorPos(world, air.anchor);
    if (!a) air.anchor = null;
    else {
      const dx = sp.x - a.x;
      const dy = sp.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > air.rope) {
        sp.x = a.x + (dx / d) * air.rope;
        sp.y = a.y + (dy / d) * air.rope;
        const nx = dx / d;
        const ny = dy / d;
        const vr = sp.vx * nx + sp.vy * ny;
        if (vr > 0) {
          sp.vx -= vr * nx;
          sp.vy -= vr * ny;
        }
        if (air.t > air.T) {
          sp.mode = 'hang';
          sp.hang = { anchor: air.anchor, len: air.rope };
          sp.air = null;
          sp.silk = Math.max(0, sp.silk - air.rope * THREADS[4].cost * 0.5);
          world.ev.push({ k: 'caught', id: sp.id, x: sp.x, y: sp.y });
          return;
        }
      }
    }
  }
  // Landing: the first thread or branch the path crosses (not the one we left, at first).
  let best = null;
  let bu = 2;
  web.near(x0, y0, sp.x, sp.y, (t) => {
    if (air.t < air.skip && (web.tid[t] === air.fromTh || (air.fromNode && (web.nid[web.ta[t]] === air.fromNode || web.nid[web.tb[t]] === air.fromNode)))) return;
    const a = web.ta[t];
    const b = web.tb[t];
    const u = crossing(x0, y0, sp.x, sp.y, web.x[a], web.y[a], web.x[b], web.y[b]);
    if (u < 0) return;
    const along = segParam(x0, y0, sp.x, sp.y, web.x[a], web.y[a], web.x[b], web.y[b]);
    if (along < bu) {
      bu = along;
      best = { t, u };
    }
  });
  if (!best && air.t >= air.T && air.T > 0 && air.t - dt < air.T + 0.05) {
    // Arriving right at the aimed point: grab what's there.
    const near = web.nearestThread(sp.x, sp.y, 12);
    if (near) best = { t: near.s, u: near.t };
  }
  if (best) return land(world, sp, best.t, best.u);
  if (sp.y > GROUND + 12 && catchGround(world, sp)) return;
  if (sp.y > H + 60 || sp.x < -100 || sp.x > W + 100 || air.t > 6) {
    rescue(world, sp, 5);
  }
}

/** Parameter along (x0,y0)-(x1,y1) where it meets segment ab. */
function segParam(x0, y0, x1, y1, ax, ay, bx, by) {
  const u = crossing(ax, ay, bx, by, x0, y0, x1, y1);
  return u < 0 ? 2 : u;
}

function land(world, sp, t, u) {
  const web = world.web;
  const air = sp.air;
  sp.mode = 'walk';
  sp.th = web.tid[t];
  sp.s = Math.min(1, Math.max(0, u));
  sp.node = 0;
  sp.from = web.nid[sp.s < 0.5 ? web.ta[t] : web.tb[t]];
  const drop = air ? sp.y - air.y0 : 0;
  sp.air = null;
  sp.vx = sp.vy = 0;
  pose(world, sp);
  if (u < 0.04) arrive(world, sp, web.ta[t]);
  else if (u > 0.96) arrive(world, sp, web.tb[t]);
  // Thump the thread we landed on: it rings, and so do we if it was a long way down.
  web.pluck(t, 260, 120, 0, 1);
  world.ev.push({ k: 'land', id: sp.id, x: sp.x, y: sp.y, th: web.tid[t] });
  if (drop > 150 && !sp.mods.balloon && web.type[t] === T_SURFACE) world.ev.push({ k: 'fallhurt', id: sp.id, amount: FALL_DAMAGE });
  // Onto the pond's lily pads: a splash, nothing worse.
  const wtr = world.garden.water;
  if (wtr && web.type[t] === T_SURFACE && sp.x > wtr.x0 && sp.x < wtr.x1 && sp.y > wtr.y - 10) world.ev.push({ k: 'splash', id: sp.id, x: sp.x, y: sp.y });
}

/** Back to the Retreat (out of the world, or after being downed). */
export function rescue(world, sp, damage = 0) {
  sp.glide = null;
  placeAt(world, sp, retreatNode(world.garden));
  if (damage) world.ev.push({ k: 'fallhurt', id: sp.id, amount: damage });
}

export function startHang(world, sp, len) {
  const anchor = holdAnchor(sp);
  if (!anchor) return false;
  sp.mode = 'hang';
  sp.hang = { anchor, len: Math.max(2, len) };
  sp.node = 0;
  sp.th = 0;
  sp.vx = sp.vy = 0;
  world.ev.push({ k: 'drop', id: sp.id, x: sp.x, y: sp.y });
  return true;
}

function swing(world, sp, inp, dt) {
  const hang = sp.hang;
  const a = anchorPos(world, hang?.anchor);
  if (!a) {
    sp.hang = null;
    return startFall(world, sp, null);
  }
  const my = inp ? inp.my || 0 : 0;
  const mx = inp ? inp.mx || 0 : 0;
  if (my < -0.5) {
    hang.len -= CLIMB * dt;
    if (hang.len < 5) {
      // Back up to the anchor.
      const an = hang.anchor;
      sp.mode = 'walk';
      sp.hang = null;
      if (an.node) placeAt(world, sp, an.node);
      else {
        sp.th = an.th;
        sp.s = an.s;
        sp.node = 0;
        pose(world, sp);
      }
      return;
    }
  } else if (my > 0.5 && hang.len < ROPE_MAX) {
    const grow = Math.min(DROP_SPEED * dt, ROPE_MAX - hang.len);
    const cost = grow * THREADS[4].cost * 0.5;
    if (sp.silk >= cost) {
      sp.silk -= cost;
      sp.regenDelay = Math.max(sp.regenDelay, 0.5);
      hang.len += grow;
    }
  }
  // Pendulum: gravity, a push from the stick, the rope.
  const x0 = sp.x;
  const y0 = sp.y;
  sp.vx += mx * 160 * dt;
  sp.vy += GRAVITY * dt;
  sp.vx *= 0.985;
  sp.vy *= 0.985;
  sp.x += sp.vx * dt;
  sp.y += sp.vy * dt;
  const dx = sp.x - a.x;
  const dy = sp.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d > hang.len) {
    sp.x = a.x + (dx / d) * hang.len;
    sp.y = a.y + (dy / d) * hang.len;
    const nx = dx / d;
    const ny = dy / d;
    const vr = sp.vx * nx + sp.vy * ny;
    if (vr > 0) {
      sp.vx -= vr * nx;
      sp.vy -= vr * ny;
    }
  }
  sp.facing = Math.atan2(a.y - sp.y, a.x - sp.x);
  if (sp.y > GROUND + 12) {
    sp.hang = null;
    if (!catchGround(world, sp)) rescue(world, sp, 0);
    return;
  }
  // A swing that sweeps across another thread grabs it.
  if (Math.hypot(sp.x - x0, sp.y - y0) > 0.5) {
    const web = world.web;
    let got = null;
    web.near(x0, y0, sp.x, sp.y, (t) => {
      if (got) return;
      if (hang.anchor.th && web.tid[t] === hang.anchor.th) return;
      if (hang.anchor.node && (web.nid[web.ta[t]] === hang.anchor.node || web.nid[web.tb[t]] === hang.anchor.node)) return;
      const u = crossing(x0, y0, sp.x, sp.y, web.x[web.ta[t]], web.y[web.ta[t]], web.x[web.tb[t]], web.y[web.tb[t]]);
      if (u >= 0) got = { t, u };
    });
    if (got && Math.hypot(sp.vx, sp.vy) > 25) {
      sp.hang = null;
      land(world, sp, got.t, got.u);
    }
  }
}

// ---------------------------------------------------------------- upkeep (run by the host for every spider)
export function upkeep(world, sp, dt) {
  const g = world.garden;
  // Silk comes back when the spinnerets rest.
  if (sp.regenDelay > 0) sp.regenDelay -= dt;
  else if (sp.mode !== 'downed') sp.silk = Math.min(sp.mods.maxSilk, sp.silk + sp.mods.regen * (sp.still > 1 ? sp.mods.still : 1) * dt);
  if (sp.busy > 0) sp.busy = Math.max(0, sp.busy - dt);
  if (sp.invuln > 0) sp.invuln -= dt;
  const rn = world.web.pos(retreatNode(g));
  sp.inRetreat = !!rn && sp.mode === 'walk' && Math.hypot(sp.x - rn.x, sp.y - rn.y) < 18;
  sp.hidden = sp.inRetreat || inCover(g, sp.x, sp.y) || inHollow(world, sp);
  if (sp.inRetreat && sp.mode !== 'downed') sp.hp = Math.min(SPECIES[sp.sp].hp, sp.hp + RETREAT_HEAL * dt);
  if (sp.mode === 'air' || sp.mode === 'hang') sp.hidden = false;
  if (!Number.isFinite(sp.silk)) sp.silk = 0;
  if (!Number.isFinite(sp.hp)) sp.hp = 1;
}

/** Sitting in a funnel web's hollow. */
function inHollow(world, sp) {
  for (const id of world.hollows ?? []) {
    const p = world.web.pos(id);
    if (p && Math.hypot(p.x - sp.x, p.y - sp.y) < 16) return true;
  }
  return false;
}

export function hurt(world, sp, amount, why) {
  if (sp.mode === 'downed' || sp.invuln > 0 || !(amount > 0)) return false;
  const dmg = amount * sp.mods.dmg;
  sp.hp = Math.max(0, sp.hp - dmg);
  sp.stats.damage += dmg;
  sp.invuln = 0.6;
  world.ev.push({ k: 'hurt', id: sp.id, amount: dmg, why, x: sp.x, y: sp.y, done: true });
  if (sp.hp <= 0) {
    sp.mode = 'downed';
    sp.downed = 0;
    sp.act = null;
    sp.glide = null;
    sp.air = null;
    sp.hang = null;
    world.ev.push({ k: 'downed', id: sp.id, why, x: sp.x, y: sp.y });
  }
  return true;
}

export { holdAnchor, startFall };
