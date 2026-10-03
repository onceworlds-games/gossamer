// What spiders do, decided by the host: cast, cut, wrap, eat, bite, shake dew, spin a Quick Orb, give silk, revive,
// and the hunter's and the fisher's verbs. Every request is checked here (range, silk, caps, species), so a page that
// lies gets refused the same way a page that's wrong does.
import {
  THREADS, T_FRAME, T_RADIAL, T_STICKY, T_ALARM, T_DRAG, T_SURFACE, N_ANCHOR, N_JUNCTION, N_PREY, PREY, SNAP_RADIUS, MERGE,
  PLAYER_NODES, PLAYER_THREADS, SPECIES, REACH, SILK_PER_FOOD, HP_PER_FOOD, REVIVE_TIME, JUNCTION_MASS, WASP, DT,
} from './data.js';
import { crossing } from './web.js';
import { placeAt, remapSplit, pose, hurt, loseFooting, anchorPos } from './spider.js';
import { planOrb, orbSteps, PATTERNS, PREMIUM, patternsFor } from './quickorb.js';

const refuse = (world, sp, why) => {
  world.ev.push({ k: 'refuse', id: sp.id, why, x: sp.x, y: sp.y });
  return false;
};

// ---------------------------------------------------------------- structure helpers
/** Splits a thread and moves every spider (and anything else that holds threads) onto the right half. */
export function splitAt(world, thId, t, o = {}) {
  const r = world.web.splitThread(thId, t, o);
  if (!r) return null;
  const split = { old: thId, a: r.a, b: r.b, t: r.t, node: r.node };
  for (const sp of world.spiders) remapSplit(sp, split);
  if (world.mantis) remapSplit(world.mantis, split);
  return r;
}

/** The node a spider stands at, making one if it stands mid-thread (or hangs on a dragline). */
function originNode(world, sp) {
  const web = world.web;
  if (sp.mode === 'walk' && sp.node && web.ni(sp.node) >= 0) return sp.node;
  if (sp.mode === 'walk' && sp.th) {
    const r = splitAt(world, sp.th, sp.s, { player: true });
    if (!r) return 0;
    sp.node = r.node;
    sp.th = 0;
    return r.node;
  }
  if (sp.mode === 'hang' && sp.hang) {
    // The dragline becomes real silk: anchor -> a knot where the spider hangs.
    const an = sp.hang.anchor;
    let anchorNode = an.node;
    if (!anchorNode && an.th) anchorNode = splitAt(world, an.th, an.s, { player: true })?.node ?? 0;
    if (!anchorNode || web.ni(anchorNode) < 0) return 0;
    const knot = web.addNode(sp.x, sp.y, N_JUNCTION, { player: true });
    if (knot < 0) return 0;
    const d = Math.hypot(sp.x - web.pos(anchorNode).x, sp.y - web.pos(anchorNode).y);
    web.addThread(anchorNode, knot, T_DRAG, { rest: Math.max(4, d), born: web.time });
    placeAt(world, sp, knot);
    return knot;
  }
  return 0;
}

/**
 * Where a cast aimed at (tx, ty) lands: the nearest knot or point on a thread or branch within the snap radius.
 * Returns { node } | { th, t } with x, y, or null.
 */
export function resolveTarget(world, sp, tx, ty, radius = SNAP_RADIUS) {
  const web = world.web;
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  const here = sp.node ? web.ni(sp.node) : -1;
  const onTh = sp.th && !sp.node ? web.ti(sp.th) : -1;
  const farFromMe = (x, y) => Math.hypot(x - sp.x, y - sp.y) > 14;
  const node = web.nearestNode(tx, ty, radius, (s) => s !== here && web.kind[s] !== N_PREY && web.adj[s].length > 0 && farFromMe(web.x[s], web.y[s]));
  const th = web.nearestThread(tx, ty, radius, (s) => {
    if (s === onTh) return false;
    if (here >= 0 && (web.ta[s] === here || web.tb[s] === here)) return false;
    return web.kind[web.ta[s]] !== N_PREY && web.kind[web.tb[s]] !== N_PREY;
  });
  if (node && (!th || node.d < 14 || node.d <= th.d + 10)) return { node: node.id, x: node.x, y: node.y };
  if (!th || !farFromMe(th.x, th.y)) return node ? { node: node.id, x: node.x, y: node.y } : null;
  const L = web.len[th.s] || 1;
  if (th.t * L < MERGE) return { node: web.nid[web.ta[th.s]], x: web.x[web.ta[th.s]], y: web.y[web.ta[th.s]] };
  if ((1 - th.t) * L < MERGE) return { node: web.nid[web.tb[th.s]], x: web.x[web.tb[th.s]], y: web.y[web.tb[th.s]] };
  return { th: th.id, t: th.t, x: th.x, y: th.y };
}

/** A cast line catches on the first sturdy branch it crosses before its target (thin foliage lets it pass). */
export function catchOnBranch(world, sp, target) {
  const web = world.web;
  let best = null;
  let bu = 0.97;
  const here = sp.node ? web.ni(sp.node) : -1;
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] !== T_SURFACE || !(web.flag[s] & 1)) continue;
    if (target.th === web.tid[s] || s === web.ti(sp.th)) continue;
    const a = web.ta[s];
    const b = web.tb[s];
    if (a === here || b === here) continue;
    if (target.node && (web.nid[a] === target.node || web.nid[b] === target.node)) continue;
    const along = crossing(web.x[a], web.y[a], web.x[b], web.y[b], sp.x, sp.y, target.x, target.y);
    if (along < 0.04 || along >= bu) continue;
    const t = crossing(sp.x, sp.y, target.x, target.y, web.x[a], web.y[a], web.x[b], web.y[b]);
    if (t < 0) continue;
    bu = along;
    best = { th: web.tid[s], t, x: web.x[a] + (web.x[b] - web.x[a]) * t, y: web.y[a] + (web.y[b] - web.y[a]) * t, caught: true };
  }
  return best ?? target;
}

export function threadCost(sp, type, len) {
  let c = len * THREADS[type].cost;
  if (type === T_STICKY) c *= sp.mods.stickyCost;
  if (type === T_RADIAL) c *= sp.mods.radialCost;
  if (type === T_ALARM && sp.mods.alarm >= 3) c *= 0.5;
  return c;
}

function castOptions(world, sp, type) {
  const strong = type === T_FRAME || type === T_RADIAL ? sp.mods.strong : 1;
  let snap = world.rules.snap;
  if (type === T_FRAME && world.rules.taut) snap = 1.45;
  if (type === T_ALARM && sp.mods.alarm >= 3) snap = 1.6;
  return { strength: THREADS[type].strength * strong, snap, stick: type === T_STICKY ? sp.mods.droplets : 0, born: world.web.time };
}

/** Is node slot n on a radial (so a sticky cast to it is a spiral segment)? */
function onRadial(web, n) {
  return web.adj[n].some((t) => web.type[t] === T_RADIAL);
}

export function cast(world, sp, type, tx, ty) {
  const web = world.web;
  if (sp.sp !== 'orb') return refuse(world, sp, 'species');
  if (![T_FRAME, T_RADIAL, T_STICKY, T_ALARM].includes(type)) return false;
  if (sp.mode === 'downed' || sp.mode === 'air') return refuse(world, sp, 'busy');
  if (sp.busy > 0 || sp.act) return refuse(world, sp, 'busy');
  let target = resolveTarget(world, sp, tx, ty);
  if (!target) return refuse(world, sp, 'nothing');
  target = catchOnBranch(world, sp, target);
  const len = Math.hypot(target.x - sp.x, target.y - sp.y);
  if (len > sp.mods.range) return refuse(world, sp, 'far');
  if (len < 14) return refuse(world, sp, 'near');
  const cost = threadCost(sp, type, len);
  if (sp.silk < cost) return refuse(world, sp, 'silk');
  if (web.playerNodes + 3 > PLAYER_NODES || web.playerThreads + 2 > PLAYER_THREADS) return refuse(world, sp, 'full');
  const from = originNode(world, sp);
  if (!from) return refuse(world, sp, 'nothing');
  let to = target.node;
  if (!to) to = splitAt(world, target.th, target.t, { player: true })?.node ?? 0;
  if (!to || to === from || web.ni(to) < 0) return refuse(world, sp, 'nothing');
  if (web.between(web.ni(from), web.ni(to)) >= 0) return refuse(world, sp, 'same');
  const id = web.addThread(from, to, type, castOptions(world, sp, type));
  if (id < 0) return refuse(world, sp, 'full');
  sp.silk -= cost;
  sp.stats.silk += cost;
  sp.stats.casts++;
  sp.regenDelay = Math.max(sp.regenDelay, 1.5);
  sp.busy = SPECIES.orb.castTime;
  sp.noise = sp.mods.silent ? sp.noise : 1;
  const ts = web.ti(id);
  const radialTarget = onRadial(web, web.ni(to)) && onRadial(web, web.ni(from));
  world.ev.push({ k: 'cast', id: sp.id, th: id, type, x: sp.x, y: sp.y, tx: target.x, ty: target.y, len, caught: !!target.caught, silent: sp.mods.silent });
  web.pluck(ts, 180);
  // A sticky strand from one radial to the next is a spiral segment: ride it across as it's spun.
  if (type === T_STICKY && radialTarget) {
    sp.act = { k: 'spin', th: id, from, to, t: 0, T: Math.max(0.12, len / (sp.mods.speed * 1.1)) };
    sp.busy = 0;
  }
  noteStructure(world, sp, from, to, type);
  return true;
}

export function cut(world, sp, tx, ty) {
  const web = world.web;
  if (sp.mode === 'downed') return false;
  if (sp.busy > 0) return refuse(world, sp, 'busy');
  const reach = 160;
  const pick = (x, y, r) => web.nearestThread(x, y, r, (s) => web.type[s] !== T_SURFACE && Math.hypot(web.x[web.ta[s]] - sp.x, web.y[web.ta[s]] - sp.y) < reach + web.len[s]);
  let hit = Number.isFinite(tx) && Number.isFinite(ty) ? pick(tx, ty, 40) : null;
  if (!hit) hit = pick(sp.x, sp.y, 50);
  if (!hit) return refuse(world, sp, 'nothing');
  const d = Math.sqrt(web.closest(hit.s, sp.x, sp.y).d2);
  if (d > reach) return refuse(world, sp, 'far');
  const type = web.type[hit.s];
  const refund = type === T_DRAG ? 0 : threadCost(sp, type, web.rest[hit.s]) * sp.mods.refund;
  sp.silk = Math.min(sp.mods.maxSilk, sp.silk + refund);
  world.ev.push({ k: 'cut', id: sp.id, th: hit.id, x: hit.x, y: hit.y, type, len: web.len[hit.s] });
  removeThread(world, hit.id, 1);
  sp.busy = 0.15;
  return true;
}

/** Removes a thread for any reason, letting go of prey and spiders that hung on it. reason: 1 cut, 2 snap, 3 torn. */
export function removeThread(world, id, reason) {
  const web = world.web;
  const s = web.ti(id);
  if (s < 0) return;
  const a = web.nid[web.ta[s]];
  const b = web.nid[web.tb[s]];
  web.removeThread(id, reason);
  for (const n of [a, b]) {
    const ns = web.ni(n);
    if (ns >= 0 && web.kind[ns] === N_PREY && web.adj[ns].length === 0) world.freePrey?.(n);
  }
  for (const sp of world.spiders) if ((sp.th === id && !sp.node) || (sp.node && web.ni(sp.node) < 0)) sp.lost = true;
}

// ---------------------------------------------------------------- hubs: spirals and radials (badges, the "complete" chord)
function hubOf(web, n, limit = 40) {
  // Walk along radials toward a knot with five or more of them.
  let prev = -1;
  let cur = n;
  for (let i = 0; i < limit; i++) {
    const radials = web.adj[cur].filter((t) => web.type[t] === T_RADIAL);
    if (radials.length >= 5) return { hub: cur, spoke: prev };
    let next = -1;
    for (const t of radials) {
      const o = web.other(t, cur);
      if (o === prev) continue;
      const nr = web.adj[o].filter((u) => web.type[u] === T_RADIAL).length;
      // Inward is the knot with more radials, or the one nearer a hub-like knot.
      if (next < 0 || nr > web.adj[next].filter((u) => web.type[u] === T_RADIAL).length) next = o;
    }
    if (next < 0) return null;
    if (prev >= 0 && radials.length >= 3) return null;
    // `spoke`: the thread leaving the hub along this spoke, found when we reach the hub.
    const t = web.between(cur, next);
    prev = cur;
    cur = next;
    if (web.adj[cur].filter((u) => web.type[u] === T_RADIAL).length >= 5) return { hub: cur, spoke: web.tid[t] };
  }
  return null;
}

function noteStructure(world, sp, from, to, type) {
  const web = world.web;
  const fa = web.ni(from);
  const fb = web.ni(to);
  if (type === T_RADIAL) {
    for (const n of [fa, fb]) {
      const radials = web.adj[n].filter((t) => web.type[t] === T_RADIAL);
      if (radials.length >= 8 && !world.quickHubs?.has(web.nid[n])) {
        const angles = radials.map((t) => {
          const o = web.other(t, n);
          return Math.atan2(web.y[o] - web.y[n], web.x[o] - web.x[n]);
        }).sort((x, y) => x - y);
        const gap = (Math.PI * 2) / angles.length;
        let worst = 0;
        for (let i = 0; i < angles.length; i++) {
          const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
          worst = Math.max(worst, Math.abs(next - angles[i] - gap));
        }
        if (worst < (7 * Math.PI) / 180) world.ev.push({ k: 'perfect', id: sp.id, x: web.x[n], y: web.y[n] });
      }
    }
  }
  if (type !== T_STICKY) return;
  const ha = hubOf(web, fa);
  const hb = hubOf(web, fb);
  if (!ha || !hb || ha.hub !== hb.hub || ha.spoke === hb.spoke) return;
  const hubId = web.nid[ha.hub];
  const rec = (world.hubs[hubId] ??= { sectors: {}, done: false });
  rec.sectors[[ha.spoke, hb.spoke].sort((x, y) => x - y).join(':')] = true;
  const spokes = web.adj[ha.hub].filter((t) => web.type[t] === T_RADIAL).length;
  if (!rec.done && Object.keys(rec.sectors).length >= spokes) {
    rec.done = true;
    world.ev.push({ k: 'orbdone', id: sp.id, hub: hubId, x: web.x[ha.hub], y: web.y[ha.hub] });
  }
}

// ---------------------------------------------------------------- Quick Orb
/** The plan for an orb, shrunk until the silk on hand can spin it (a smaller whole web beats a big half one). */
const NUDGE = [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12], [10, 10], [-10, 10], [10, -10], [-10, -10], [24, 0], [-24, 0], [0, 24], [0, -24]];

/** A plan at (hx, hy), or at a spot a few px away if that's what lets it close all round. */
function nudgedOrb(web, hx, hy, r, pattern, range, reach = 0) {
  let first = null;
  for (const [dx, dy] of NUDGE) {
    const plan = planOrb(web, hx + dx, hy + dy, r, pattern, range, reach);
    if (plan.ok) return plan;
    first ??= plan;
  }
  return first;
}

export function fitOrb(web, hx, hy, r, pattern, range, silk) {
  let size = Number.isFinite(r) ? r : 95;
  let plan = nudgedOrb(web, hx, hy, size, pattern, range);
  if (!plan.ok) return plan;
  const reach = Math.max(220, size * 2);
  while (plan.cost > silk && size > 52) {
    size *= 0.86;
    const smaller = nudgedOrb(web, plan.hub.x, plan.hub.y, size, pattern, range, reach);
    if (!smaller.ok) break;
    plan = smaller;
  }
  if (plan.cost > silk * 1.15) return { ...plan, ok: false, why: 'silk' };
  plan.r = size;
  return plan;
}

export function startOrb(world, sp, hx, hy, r, pattern) {
  if (sp.sp !== 'orb') return refuse(world, sp, 'species');
  if (sp.mode !== 'walk' || sp.busy > 0 || sp.act) return refuse(world, sp, 'busy');
  if (!patternsFor(sp.mods.templates).includes(pattern)) pattern = 'orb';
  if (!Number.isFinite(hx) || !Number.isFinite(hy)) return false;
  if (Math.hypot(hx - sp.x, hy - sp.y) > sp.mods.range) return refuse(world, sp, 'far');
  const plan = fitOrb(world.web, hx, hy, r, pattern, sp.mods.range, sp.silk);
  if (!plan.ok) return refuse(world, sp, plan.why === 'silk' ? 'silk' : 'open');
  if (world.web.playerNodes + 60 > PLAYER_NODES || world.web.playerThreads + 70 > PLAYER_THREADS) return refuse(world, sp, 'full');
  sp.act = { k: 'orb', plan, steps: orbSteps(plan), i: 0, timer: 0.1, hub: 0, spokes: {}, at: null };
  world.ev.push({ k: 'orbstart', id: sp.id, x: hx, y: hy, pattern });
  return true;
}

function orbStep(world, sp, act) {
  const web = world.web;
  const step = act.steps[act.i++];
  if (!step) return true;
  const plan = act.plan;
  const opt = (type) => castOptions(world, sp, type);
  const pay = (type, len) => {
    const c = threadCost(sp, type, len) * PREMIUM;
    if (sp.silk < c) return false;
    sp.silk -= c;
    sp.stats.silk += c;
    return true;
  };
  if (step.k === 'spoke') {
    const end = plan.ends[step.i];
    if (!act.hub) {
      act.hub = web.addNode(plan.hub.x, plan.hub.y, N_JUNCTION, { player: true });
      if (act.hub < 0) return true;
      world.quickHubs.add(act.hub);
    }
    const hubPos = web.pos(act.hub);
    if (!hubPos) return true;
    let to = 0;
    const ts = web.ti(end.id);
    if (ts >= 0) {
      const c = web.closest(ts, end.x, end.y);
      const L = web.len[ts] || 1;
      if (c.t * L < MERGE) to = web.nid[web.ta[ts]];
      else if ((1 - c.t) * L < MERGE) to = web.nid[web.tb[ts]];
      else to = splitAt(world, end.id, c.t, { player: true })?.node ?? 0;
    } else {
      const n = web.nearestNode(end.x, end.y, 14, (s) => web.kind[s] !== N_PREY);
      to = n?.id ?? 0;
    }
    if (!to) return false;
    const p = web.pos(to);
    const len = Math.hypot(p.x - hubPos.x, p.y - hubPos.y);
    if (!pay(T_RADIAL, len)) return true;
    const id = web.addThread(act.hub, to, T_RADIAL, opt(T_RADIAL));
    if (id >= 0) {
      act.spokes[step.i] = { node: act.hub, th: id, d: 0 };
      act.at = p;
      world.ev.push({ k: 'spin', id: sp.id, th: id, type: T_RADIAL, x: hubPos.x, y: hubPos.y, tx: p.x, ty: p.y, len });
    }
    return false;
  }
  // Spiral: make (or find) the knot on each spoke at its radius, then spin sticky between them.
  const knot = ([i, r]) => {
    const sp0 = act.spokes[i];
    if (!sp0) return 0;
    const hubPos = web.pos(act.hub);
    const ts = web.ti(sp0.th);
    if (!hubPos || ts < 0) return 0;
    // The outer part of this spoke runs from sp0.node to its end; split it at distance r from the hub.
    const inner = web.ni(sp0.node);
    const outer = web.other(ts, inner);
    const d0 = Math.hypot(web.x[inner] - hubPos.x, web.y[inner] - hubPos.y);
    const d1 = Math.hypot(web.x[outer] - hubPos.x, web.y[outer] - hubPos.y);
    if (r <= d0 + 3) return sp0.node;
    if (r >= d1 - 4) return 0;
    let t = (r - d0) / (d1 - d0);
    if (web.ta[ts] !== inner) t = 1 - t;
    const res = splitAt(world, sp0.th, t, { player: true });
    if (!res) return 0;
    const innerHalf = web.ta[ts] === inner ? res.a : res.b;
    const outerHalf = innerHalf === res.a ? res.b : res.a;
    void innerHalf;
    act.spokes[i] = { node: res.node, th: outerHalf, d: r };
    return res.node;
  };
  const a = knot(step.a);
  const b = knot(step.b);
  if (!a || !b || a === b) return false;
  const pa = web.pos(a);
  const pb = web.pos(b);
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  if (!pay(T_STICKY, len)) return true;
  const id = web.addThread(a, b, T_STICKY, opt(T_STICKY));
  if (id >= 0) {
    act.at = pb;
    world.ev.push({ k: 'spin', id: sp.id, th: id, type: T_STICKY, x: pa.x, y: pa.y, tx: pb.x, ty: pb.y, len });
  }
  return false;
}

// ---------------------------------------------------------------- the contextual action (E): eat, wrap, give, revive
export function nearestPrey(world, sp, states, reach = REACH) {
  let best = null;
  let bd = reach;
  for (const p of world.prey) {
    if (!states.includes(p.st)) continue;
    if (p.heldBy && p.heldBy !== sp.id) continue;
    const d = Math.hypot(p.x - sp.x, p.y - sp.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function nearestMate(world, sp, pred, reach = 30) {
  let best = null;
  let bd = reach;
  for (const o of world.spiders) {
    if (o === sp || !pred(o)) continue;
    const d = Math.hypot(o.x - sp.x, o.y - sp.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** What E would do right now (also drives the touch button's label). */
export function useTarget(world, sp) {
  if (sp.mode === 'downed') return null;
  const downed = nearestMate(world, sp, (o) => o.mode === 'downed');
  if (downed) return { k: 'revive', who: downed };
  const food = nearestPrey(world, sp, ['cocoon', 'subdued']);
  if (food) return { k: 'eat', prey: food };
  const stuck = nearestPrey(world, sp, ['stuck']);
  if (stuck) return PREY[stuck.sp].small ? { k: 'eat', prey: stuck } : { k: 'wrap', prey: stuck };
  const mate = nearestMate(world, sp, (o) => o.mode !== 'downed' && o.silk < o.mods.maxSilk - 5);
  if (mate && sp.silk > 12) return { k: 'give', who: mate };
  return null;
}

export function use(world, sp, on) {
  if (!on) {
    if (sp.act && ['wrap', 'give', 'revive'].includes(sp.act.k)) sp.act = null;
    return true;
  }
  if (sp.busy > 0 || sp.act || sp.mode === 'air') return false;
  const t = useTarget(world, sp);
  if (!t) return refuse(world, sp, 'nothing');
  if (t.k === 'eat') {
    const p = t.prey;
    const time = PREY[p.sp].eat * sp.mods.eat;
    if (p.st === 'stuck') p.st = 'subdued';
    p.heldBy = sp.id;
    sp.act = { k: 'eat', prey: p.id, t: p.eaten ?? 0, T: time };
    world.ev.push({ k: 'eatstart', id: sp.id, prey: p.id, sp: p.sp, x: p.x, y: p.y });
  } else if (t.k === 'wrap') {
    const p = t.prey;
    const armour = PREY[p.sp].armour && !(p.bitten ?? false) ? 2 : 1;
    sp.act = { k: 'wrap', prey: p.id, T: PREY[p.sp].wrap * sp.mods.wrapTime * armour };
    world.ev.push({ k: 'wrapstart', id: sp.id, prey: p.id, x: p.x, y: p.y });
  } else if (t.k === 'give') sp.act = { k: 'give', who: t.who.id };
  else if (t.k === 'revive') sp.act = { k: 'revive', who: t.who.id, t: 0 };
  return true;
}

export function bite(world, sp) {
  if (sp.mode === 'downed' || sp.busy > 0 || sp.act) return false;
  // A wasp in reach first: that's the fight that matters.
  const wasp = world.wasps.find((w) => w.st !== 'gone' && Math.hypot(w.x - sp.x, w.y - sp.y) < REACH + 8);
  if (wasp) return biteWasp(world, sp, wasp);
  const p = nearestPrey(world, sp, ['stuck', 'land', 'fly'], REACH + 4);
  if (!p) return refuse(world, sp, 'nothing');
  const def = PREY[p.sp];
  if ((def.armour || p.sp === 'dragonfly') && sp.sp !== 'jumper') {
    if (sp.venom <= 0) {
      hurt(world, sp, 8, 'kick');
      world.ev.push({ k: 'kicked', id: sp.id, prey: p.id, x: p.x, y: p.y });
      return false;
    }
    sp.venom--;
  }
  if (p.st === 'fly' || p.st === 'land') {
    if (sp.sp === 'orb') return refuse(world, sp, 'nothing');
    world.grabPrey?.(p, sp);
  } else p.st = 'subdued';
  p.bitten = true;
  sp.busy = 0.2;
  world.ev.push({ k: 'bite', id: sp.id, prey: p.id, x: p.x, y: p.y });
  return true;
}

export function biteWasp(world, sp, wasp) {
  const can = sp.sp === 'jumper' || sp.venom > 0 || sp.mods.fierce;
  if (!can) {
    hurt(world, sp, 15, 'wasp');
    return false;
  }
  if (sp.sp !== 'jumper' && !sp.mods.fierce) sp.venom--;
  wasp.hp -= sp.sp === 'jumper' || sp.venom >= 0 ? 1 : 0;
  wasp.stun = WASP.stun;
  wasp.st = wasp.hp <= 0 ? 'dying' : 'stunned';
  sp.busy = 0.25;
  world.ev.push({ k: 'waspbit', id: sp.id, x: wasp.x, y: wasp.y, dead: wasp.hp <= 0 });
  if (wasp.hp <= 0) sp.stats.wasps++;
  return true;
}

export function shake(world, sp) {
  const web = world.web;
  if (sp.sp !== 'orb' || sp.mods.shake < 1) return refuse(world, sp, 'species');
  if (sp.mode !== 'walk' || sp.busy > 0) return false;
  if ((sp.shakeCool ?? 0) > 0) return refuse(world, sp, 'busy');
  const r = sp.mods.shake >= 2 ? 180 : 120;
  let beads = 0;
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] === T_SURFACE) continue;
    const c = web.closest(s, sp.x, sp.y);
    if (c.d2 > r * r) continue;
    beads += Math.floor(web.dew[s]);
    web.dew[s] = 0;
    if (sp.mods.shake >= 2) web.dry[s] = 15;
    if (sp.mods.shake >= 3) web.dry[s] = Math.max(web.dry[s], 20);
    web.pluck(s, 420, 160, 0, -1);
    web.log(['s', web.tid[s], web.stick[s], 0]);
  }
  sp.stats.dew += beads;
  sp.shakeCool = 3;
  sp.busy = 0.3;
  world.ev.push({ k: 'shake', id: sp.id, x: sp.x, y: sp.y, beads, r });
  return true;
}

// ---------------------------------------------------------------- the fisher (bolas) and the hunter (jumper)
export function placeLure(world, sp) {
  if (sp.sp !== 'bolas' || sp.mode === 'downed' || sp.mode === 'air') return refuse(world, sp, 'species');
  const max = sp.mods.lure >= 2 ? 2 : 1;
  const mine = world.lures.filter((l) => l.owner === sp.id);
  if (sp.silk < 8) return refuse(world, sp, 'silk');
  if (mine.length >= max) world.lures.splice(world.lures.indexOf(mine[0]), 1);
  sp.silk -= 8;
  sp.regenDelay = 1;
  world.lures.push({ id: world.nextId++, owner: sp.id, x: sp.x, y: sp.y + 10, t: 45, power: [1.3, 1.5, 1.65, 1.8][sp.mods.lure], flies: sp.mods.lure >= 3 });
  world.ev.push({ k: 'lure', id: sp.id, x: sp.x, y: sp.y });
  return true;
}

export function fling(world, sp, ax, ay, power) {
  if (sp.sp !== 'bolas' || sp.mode === 'downed' || sp.busy > 0) return false;
  if (world.balls.some((b) => b.owner === sp.id)) return false;
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
  if (sp.silk < 3) return refuse(world, sp, 'silk');
  sp.silk -= 3;
  sp.regenDelay = 0.8;
  const p = Math.max(0.3, Math.min(1, Number(power) || 0.5));
  const dx = ax - sp.x;
  const dy = ay - sp.y;
  const d = Math.hypot(dx, dy) || 1;
  const speed = 260 + 360 * p;
  world.balls.push({ id: world.nextId++, owner: sp.id, x: sp.x, y: sp.y, vx: (dx / d) * speed, vy: (dy / d) * speed, t: 0, T: (SPECIES.bolas.fling * (0.6 + 0.6 * p)) / speed, sticky: 1 * sp.mods.droplets, back: false });
  sp.busy = 0.2;
  world.ev.push({ k: 'fling', id: sp.id, x: sp.x, y: sp.y, power: p });
  return true;
}

// ---------------------------------------------------------------- per tick, on the host
export function runActions(world, sp, dt) {
  const web = world.web;
  if (sp.shakeCool > 0) sp.shakeCool -= dt;
  const act = sp.act;
  if (!act) return;
  if (sp.mode === 'downed') return void (sp.act = null);
  switch (act.k) {
    case 'spin': {
      act.t += dt;
      const ts = web.ti(act.th);
      if (ts < 0) {
        sp.act = null;
        return void loseFooting(world, sp);
      }
      const f = Math.min(1, act.t / act.T);
      const fromStart = web.nid[web.ta[ts]] === act.from;
      sp.mode = 'walk';
      sp.th = act.th;
      sp.node = 0;
      sp.s = fromStart ? f : 1 - f;
      pose(world, sp);
      if (f >= 1) {
        sp.act = null;
        placeAt(world, sp, act.to);
        world.ev.push({ k: 'place', id: sp.id, node: act.to });
      }
      return;
    }
    case 'orb': {
      act.timer -= dt;
      while (act.timer <= 0 && sp.act) {
        const stop = orbStep(world, sp, act);
        const next = act.steps[act.i];
        act.timer += next?.k === 'spoke' ? 0.16 : 0.1;
        if (stop || act.i >= act.steps.length) {
          sp.act = null;
          if (act.hub && web.ni(act.hub) >= 0) {
            placeAt(world, sp, act.hub);
            world.ev.push({ k: 'place', id: sp.id, node: act.hub });
            world.ev.push({ k: 'orbdone', id: sp.id, hub: act.hub, x: sp.x, y: sp.y, quick: true, partial: act.i < act.steps.length });
          }
          sp.regenDelay = 1.5;
        }
      }
      return;
    }
    case 'wrap': {
      const p = world.prey.find((q) => q.id === act.prey);
      if (!p || !['stuck', 'subdued'].includes(p.st) || Math.hypot(p.x - sp.x, p.y - sp.y) > REACH + 10) return void (sp.act = null);
      const cost = ((1.5 + 2 * PREY[p.sp].mass) * sp.mods.wrapCost * dt) / act.T;
      if (sp.silk < cost) return void (sp.act = null, refuse(world, sp, 'silk'));
      sp.silk -= cost;
      sp.regenDelay = Math.max(sp.regenDelay, 0.5);
      p.wrap = Math.min(1, (p.wrap ?? 0) + dt / act.T);
      if (p.wrap >= 1) {
        p.st = 'cocoon';
        p.heldBy = null;
        sp.act = null;
        sp.stats.catches++;
        world.ev.push({ k: 'cocoon', id: sp.id, prey: p.id, sp: p.sp, x: p.x, y: p.y });
      }
      return;
    }
    case 'eat': {
      const p = world.prey.find((q) => q.id === act.prey);
      if (!p || !['stuck', 'subdued', 'cocoon', 'held'].includes(p.st) || Math.hypot(p.x - sp.x, p.y - sp.y) > REACH + 14) {
        if (p) p.heldBy = null;
        return void (sp.act = null);
      }
      act.t += dt;
      p.eaten = act.t;
      if (act.t >= act.T) {
        sp.act = null;
        world.eatPrey?.(p, sp);
      }
      return;
    }
    case 'give': {
      const o = world.spiders.find((q) => q.id === act.who);
      if (!o || o.mode === 'downed' || Math.hypot(o.x - sp.x, o.y - sp.y) > 40 || sp.silk < 2 || o.silk >= o.mods.maxSilk) return void (sp.act = null);
      const amt = Math.min(10 * dt, sp.silk - 1, o.mods.maxSilk - o.silk);
      sp.silk -= amt;
      o.silk += amt;
      sp.stats.given += amt;
      if (Math.random() < dt * 4) world.ev.push({ k: 'give', id: sp.id, to: o.id, x: o.x, y: o.y });
      return;
    }
    case 'revive': {
      const o = world.spiders.find((q) => q.id === act.who);
      if (!o || o.mode !== 'downed' || Math.hypot(o.x - sp.x, o.y - sp.y) > 40) return void (sp.act = null);
      act.t += dt;
      if (act.t >= REVIVE_TIME) {
        sp.act = null;
        world.revive?.(o, sp);
      }
      return;
    }
    default:
      sp.act = null;
  }
}

export { JUNCTION_MASS, N_ANCHOR, anchorPos, DT };
