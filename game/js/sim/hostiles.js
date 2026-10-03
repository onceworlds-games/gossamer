// What hunts the hunter. The wasp patrols, hears casting and hurrying, chases, cuts silk in its way, stings, and
// steals cocoons. The wren warns (a shadow and a call) and then takes a whole band of the web and anyone exposed in
// it. The mantis, on the last night, walks the silk like a spider: cut it down, slow it with glue, bite it with venom.
import { WASP, WREN, MANTIS, W, H, GROUND, T_SURFACE, T_FRAME, T_ALARM, T_STICKY, N_PREY, PREY, SPECIES } from './data.js';
import { range, chance, rand } from './rng.js';
import { crossing } from './web.js';
import { removeThread } from './actions.js';
import { hurt, startFall, moveSpider, pose, placeAt } from './spider.js';
import { freeFromWeb } from './prey.js';

const alive = (sp) => sp.mode !== 'downed';

// ---------------------------------------------------------------- wasp
export function spawnWasp(world) {
  const r = world.rng;
  const fromLeft = rand(r) < 0.5;
  const pts = [];
  const n = 4 + Math.floor(rand(r) * 3);
  for (let i = 0; i < n; i++) pts.push([range(r, 200, W - 200), range(r, 160, GROUND - 160)]);
  pts.push([fromLeft ? W + 80 : -80, range(r, 100, 400)]);
  const w = { id: world.nextId++, st: 'patrol', x: fromLeft ? -60 : W + 60, y: range(r, 150, 450), vx: 0, vy: 0, t: 0, life: WASP.patrol + range(r, -4, 6), hp: WASP.hp, stun: 0, path: pts, pi: 0, target: null, cutTh: 0, cutT: 0, lost: 0, cool: 0, carry: 0, tangle: 0 };
  world.wasps.push(w);
  world.ev.push({ k: 'wasp', x: w.x, y: w.y });
  return w;
}

function hearing(world, w, sp) {
  if (!alive(sp) || sp.hidden || sp.inRetreat) return 0;
  const reach = WASP.detect * sp.mods.camoWasp * (0.65 + sp.noise * 0.9);
  const d = Math.hypot(sp.x - w.x, sp.y - w.y);
  return d < reach ? 1 - d / reach + 0.01 : 0;
}

export function updateWasps(world, dt) {
  for (const w of world.wasps) {
    w.t += dt;
    if (w.cool > 0) w.cool -= dt;
    if (w.tangle > 0) w.tangle -= dt;
    const slow = w.tangle > 0 ? 0.35 : 1;
    if (w.st === 'stunned') {
      w.stun -= dt;
      w.vy = 40;
      w.vx *= 0.9;
      move(w, dt);
      if (w.stun <= 0) w.st = 'leave';
      continue;
    }
    if (w.st === 'dying') {
      w.vy += 300 * dt;
      move(w, dt);
      if (w.y > GROUND) {
        w.st = 'gone';
        world.ev.push({ k: 'waspdead', x: w.x, y: w.y });
      }
      continue;
    }
    if (w.st === 'leave' || w.t > w.life + 20) {
      steer(w, w.x < W / 2 ? -120 : W + 120, w.y - 200, WASP.speed * 1.3, dt);
      if (w.x < -100 || w.x > W + 100 || w.y < -100) w.st = 'gone';
      continue;
    }
    // Pick a quarry: a spider it can hear, else a cocoon it can see.
    let quarry = null;
    let best = 0;
    for (const sp of world.spiders) {
      const h = hearing(world, w, sp);
      if (h > best) {
        best = h;
        quarry = sp;
      }
    }
    if (w.st === 'hunt') {
      const sp = world.spiders.find((s) => s.id === w.target);
      if (!sp || !alive(sp) || sp.hidden) w.lost += dt;
      else if (hearing(world, w, sp) > 0 || Math.hypot(sp.x - w.x, sp.y - w.y) < 260) w.lost = 0;
      else w.lost += dt;
      if (w.lost > 3) {
        w.st = 'patrol';
        w.target = null;
      }
    } else if (w.st === 'patrol' && quarry && w.cool <= 0 && w.t < w.life) {
      w.st = 'hunt';
      w.target = quarry.id;
      w.lost = 0;
      world.ev.push({ k: 'waspspot', id: quarry.id, x: w.x, y: w.y });
    }
    if (w.st === 'cut') {
      w.cutT -= dt;
      w.vx *= 0.8;
      w.vy *= 0.8;
      move(w, dt);
      if (w.cutT <= 0) {
        const s = world.web.ti(w.cutTh);
        if (s >= 0) {
          world.ev.push({ k: 'waspcut', th: w.cutTh, x: w.x, y: w.y, type: world.web.type[s] });
          removeThread(world, w.cutTh, 1);
        }
        w.st = w.target ? 'hunt' : 'patrol';
      }
      continue;
    }
    if (w.st === 'hunt') {
      const sp = world.spiders.find((s) => s.id === w.target);
      if (!sp) {
        w.st = 'patrol';
        continue;
      }
      // Silk in the way gets bitten through (frames too, unless Iron Frame).
      const blocker = blocking(world, w, sp.x, sp.y);
      if (blocker) {
        w.st = 'cut';
        w.cutTh = blocker.id;
        w.cutT = WASP.cutTime;
        if (blocker.alarm && world.rules.alarmTangle) w.tangle = 2;
        continue;
      }
      steer(w, sp.x, sp.y - 4, WASP.huntSpeed * slow, dt);
      if (Math.hypot(sp.x - w.x, sp.y - w.y) < 15 && sp.invuln <= 0) {
        hurt(world, sp, WASP.sting, 'wasp');
        world.ev.push({ k: 'sting', id: sp.id, x: sp.x, y: sp.y });
        // The sting knocks it off its thread (it hangs on its dragline, if it has silk for one).
        if (alive(sp) && sp.mode === 'walk' && sp.sp !== 'jumper') {
          const from = sp.node || sp.from;
          sp.node = 0;
          sp.th = 0;
          startFall(world, sp, from ? { node: from } : null);
          world.ev.push({ k: 'knock', id: sp.id, vx: 0, vy: 0 });
        }
        w.st = 'patrol';
        w.cool = 3;
        w.vx = -w.vx;
        w.vy = -160;
        // A jumper bites back.
        if (sp.sp === 'jumper' && alive(sp)) {
          w.hp -= 1;
          w.stun = WASP.stun;
          w.st = w.hp <= 0 ? 'dying' : 'stunned';
          if (w.hp <= 0) sp.stats.wasps++;
          world.ev.push({ k: 'waspbit', id: sp.id, x: w.x, y: w.y, dead: w.hp <= 0 });
        }
      }
      continue;
    }
    // Patrol, and take any cocoon passed close by.
    const loot = world.prey.find((p) => (p.st === 'cocoon' || p.st === 'subdued' || p.st === 'stuck') && Math.hypot(p.x - w.x, p.y - w.y) < WASP.loot && !p.heldBy);
    if (loot && (w.carry | 0) < 3 && w.t < w.life) {
      steer(w, loot.x, loot.y, WASP.speed * slow, dt);
      if (Math.hypot(loot.x - w.x, loot.y - w.y) < 10) {
        world.ev.push({ k: 'stolen', prey: loot.id, sp: loot.sp, x: loot.x, y: loot.y, by: 'wasp' });
        world.tally.stolen++;
        take(world, loot);
        // It eats on the wing and keeps looking (three thefts and it's full).
        w.carry = (w.carry | 0) + 1;
        if (w.carry >= 3) w.st = 'leave';
      }
      continue;
    }
    const pt = w.path[Math.min(w.pi, w.path.length - 1)];
    steer(w, pt[0], pt[1] + Math.sin(w.t * 2) * 30, WASP.speed * slow, dt);
    if (Math.hypot(pt[0] - w.x, pt[1] - w.y) < 40) w.pi++;
    if (w.pi >= w.path.length || w.t > w.life) w.st = 'leave';
  }
  world.wasps = world.wasps.filter((w) => w.st !== 'gone');
}

function blocking(world, w, tx, ty) {
  const web = world.web;
  const dx = tx - w.x;
  const dy = ty - w.y;
  const d = Math.hypot(dx, dy) || 1;
  const ax = w.x + (dx / d) * Math.min(d, 30);
  const ay = w.y + (dy / d) * Math.min(d, 30);
  let found = null;
  web.near(w.x, w.y, ax, ay, (s) => {
    if (found || web.type[s] === T_SURFACE) return;
    if (web.type[s] === T_FRAME && world.rules.ironframe) return;
    if (web.kind[web.ta[s]] === N_PREY || web.kind[web.tb[s]] === N_PREY) return;
    const u = crossing(web.x[web.ta[s]], web.y[web.ta[s]], web.x[web.tb[s]], web.y[web.tb[s]], w.x, w.y, ax, ay);
    if (u >= 0) found = { id: web.tid[s], alarm: web.type[s] === T_ALARM };
  });
  return found;
}

function steer(e, tx, ty, speed, dt, agility = 5) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx += ((dx / d) * speed - e.vx) * Math.min(1, agility * dt);
  e.vy += ((dy / d) * speed - e.vy) * Math.min(1, agility * dt);
  move(e, dt);
}

function move(e, dt) {
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  e.x = Math.max(-200, Math.min(W + 200, e.x));
  e.y = Math.max(-250, Math.min(H + 50, e.y));
}

/** Prey taken off the web (by a wasp, the wren, or the mantis). */
function take(world, p) {
  if (p.node) {
    const web = world.web;
    const node = p.node;
    p.node = 0;
    const ns = web.ni(node);
    if (ns >= 0) {
      web.setKind(node, 1);
      web.setMass(node, 0.03);
    }
  }
  for (const sp of world.spiders) if (sp.act?.prey === p.id) sp.act = null;
  p.st = 'gone';
  p.heldBy = null;
}

// ---------------------------------------------------------------- wren
export function warnWren(world) {
  const r = world.rng;
  const web = world.web;
  // Aim at the web: the middle of the silk, give or take.
  let sy = 0;
  let n = 0;
  for (let s = 0; s < web.nodeHigh; s++) {
    if (web.nid[s] < 2000) continue;
    sy += web.y[s];
    n++;
  }
  const y = n ? sy / n + range(r, -50, 50) : range(r, 300, 650);
  const warn = WREN.warn + (world.rules.eyesWren ? 1 : 0);
  world.wren = { st: 'warn', t: 0, warn, y: Math.max(140, Math.min(GROUND - 80, y)), dir: rand(r) < 0.5 ? 1 : -1, x: 0, hit: new Set(), band: WREN.band };
  world.wren.x = world.wren.dir > 0 ? -140 : W + 140;
  world.tally.swoops++;
  world.ev.push({ k: 'wrenwarn', y: world.wren.y, dir: world.wren.dir, band: WREN.band, warn });
}

export function updateWren(world, dt) {
  const wr = world.wren;
  if (!wr) return;
  wr.t += dt;
  if (wr.st === 'warn') {
    if (wr.t >= wr.warn) {
      wr.st = 'swoop';
      wr.t = 0;
      world.ev.push({ k: 'swoop', y: wr.y, dir: wr.dir });
    }
    return;
  }
  const x0 = wr.x;
  const speed = (W + 280) / WREN.cross;
  wr.x += wr.dir * speed * dt;
  const xa = Math.min(x0, wr.x);
  const xb = Math.max(x0, wr.x);
  const top = wr.y - wr.band / 2;
  const bot = wr.y + wr.band / 2;
  const web = world.web;
  // Silk crossing the band in this stretch is torn away.
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] === T_SURFACE) continue;
    const a = web.ta[s];
    const b = web.tb[s];
    const mx = (web.x[a] + web.x[b]) / 2;
    if (mx < xa - 20 || mx > xb + 20) continue;
    if (segInBand(web.x[a], web.y[a], web.x[b], web.y[b], xa - 20, xb + 20, top, bot)) {
      removeThread(world, web.tid[s], 4);
      world.tally.snaps++;
    }
  }
  for (const p of world.prey) {
    if (p.st === 'gone' || p.x < xa - 24 || p.x > xb + 24 || p.y < top || p.y > bot) continue;
    if (p.st === 'fly' || p.st === 'land') continue;
    world.ev.push({ k: 'stolen', prey: p.id, sp: p.sp, x: p.x, y: p.y, by: 'wren' });
    world.tally.stolen++;
    take(world, p);
  }
  for (const sp of world.spiders) {
    if (wr.hit.has(sp.id) || !alive(sp)) continue;
    if (sp.x < xa - 20 || sp.x > xb + 20) continue;
    if (sp.y < top - 10 || sp.y > bot + 10) {
      // Near miss: it was over you, and you weren't there. That's a dodge.
      if (Math.abs(sp.y - wr.y) < 220 && !sp.inRetreat) sp.stats.dodges++;
      wr.hit.add(sp.id);
      continue;
    }
    wr.hit.add(sp.id);
    if (sp.hidden || !chance(world.rng, sp.mods.camoWren)) {
      if (!sp.inRetreat) sp.stats.dodges++;
      world.ev.push({ k: 'unseen', id: sp.id, x: sp.x, y: sp.y });
      continue;
    }
    hurt(world, sp, WREN.damage, 'wren');
    if (alive(sp) && sp.mode !== 'air') {
      sp.node = 0;
      sp.th = 0;
      startFall(world, sp, null);
      sp.vx = wr.dir * 220;
      sp.vy = -60;
      world.ev.push({ k: 'knock', id: sp.id, vx: sp.vx, vy: sp.vy });
    }
  }
  if ((wr.dir > 0 && wr.x > W + 160) || (wr.dir < 0 && wr.x < -160)) world.wren = null;
}

function segInBand(x1, y1, x2, y2, xa, xb, top, bot) {
  // Clip the segment to the x range, then see whether that piece reaches the band.
  const lo = Math.max(Math.min(x1, x2), xa);
  const hi = Math.min(Math.max(x1, x2), xb);
  if (lo > hi) return false;
  const yAt = (x) => (Math.abs(x2 - x1) < 1e-6 ? Math.min(y1, y2) : y1 + ((y2 - y1) * (x - x1)) / (x2 - x1));
  const ya = Math.abs(x2 - x1) < 1e-6 ? Math.min(y1, y2) : yAt(lo);
  const yb = Math.abs(x2 - x1) < 1e-6 ? Math.max(y1, y2) : yAt(hi);
  return Math.max(ya, yb) >= top && Math.min(ya, yb) <= bot;
}

// ---------------------------------------------------------------- mantis (the last night)
export function spawnMantis(world) {
  const fromLeft = rand(world.rng) < 0.5;
  const web = world.web;
  const g = world.garden;
  const gx = fromLeft ? 60 : W - 60;
  const start = web.nearestNode(gx, GROUND, 200, (s) => web.kind[s] === 0);
  const m = {
    id: 'mantis', sp: 'mantis', st: 'climb', mode: 'walk', node: 0, th: 0, s: 0, from: 0, x: gx, y: GROUND, vx: 0, vy: 0, facing: 0,
    silk: 0, hp: 1, busy: 0, act: null, still: 0, noise: 0, air: null, hang: null, invuln: 0, stats: {},
    mods: { speed: MANTIS.speed, run: MANTIS.speed, stickySlow: 0.35, leap: 0, maxSilk: 0, mods: 0 },
    t: 0, wind: 0, cool: 0, falls: 0, bites: 0, wait: 6, path: null, pathT: 0, target: null,
  };
  if (start) placeAt(world, m, start.id);
  world.mantis = m;
  world.ev.push({ k: 'mantis', x: m.x, y: m.y });
  void g;
  return m;
}

export function updateMantis(world, dt) {
  const m = world.mantis;
  if (!m || m.st === 'gone') return;
  m.t += dt;
  if (m.cool > 0) m.cool -= dt;
  if (m.st === 'stunned') {
    m.wait -= dt;
    if (m.wait <= 0) m.st = 'hunt';
    return;
  }
  if (m.st === 'leave') {
    m.x += (m.x < W / 2 ? -1 : 1) * 70 * dt;
    if (m.x < -80 || m.x > W + 80) m.st = 'gone';
    return;
  }
  if (m.mode === 'air') {
    // Fell: it lands and sulks before climbing again.
    m.vy += 420 * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.y >= GROUND - 4) {
      m.y = GROUND - 4;
      m.falls++;
      world.ev.push({ k: 'mantisfall', x: m.x, y: m.y, falls: m.falls });
      if (m.falls >= MANTIS.falls) return void driveOff(world, m);
      const n = world.web.nearestNode(m.x, GROUND, 160, (s) => world.web.kind[s] === 0);
      if (n) placeAt(world, m, n.id);
      m.mode = 'walk';
      m.air = null;
      m.st = 'stunned';
      m.wait = MANTIS.climb;
    }
    return;
  }
  if (m.wait > 0 && m.st === 'climb') {
    m.wait -= dt;
    return;
  }
  // Strike: a slow wind-up anyone can read, then a fast lunge.
  if (m.st === 'windup') {
    m.wind -= dt;
    if (m.wind <= 0) {
      const sp = world.spiders.find((s) => s.id === m.target);
      if (sp && alive(sp) && !sp.hidden && Math.hypot(sp.x - m.x, sp.y - m.y) < MANTIS.reach + 12) {
        hurt(world, sp, MANTIS.damage, 'mantis');
        if (alive(sp) && sp.mode === 'walk') {
          sp.node = 0;
          sp.th = 0;
          startFall(world, sp, null);
          sp.vx = Math.sign(sp.x - m.x) * 180;
        }
      }
      world.ev.push({ k: 'strike', x: m.x, y: m.y, tx: sp?.x ?? m.x, ty: sp?.y ?? m.y });
      m.st = 'hunt';
      m.cool = 2.4;
    }
    return;
  }
  // Eat any cocoon within reach of its forelegs.
  for (const p of world.prey) {
    if ((p.st === 'cocoon' || p.st === 'subdued' || p.st === 'stuck') && Math.hypot(p.x - m.x, p.y - m.y) < 22) {
      world.ev.push({ k: 'stolen', prey: p.id, sp: p.sp, x: p.x, y: p.y, by: 'mantis' });
      world.tally.stolen++;
      take(world, p);
    }
  }
  // Hunt the nearest exposed spider; otherwise wander toward the silk.
  let target = null;
  let bd = Infinity;
  for (const sp of world.spiders) {
    if (!alive(sp) || sp.hidden) continue;
    const d = Math.hypot(sp.x - m.x, sp.y - m.y);
    if (d < bd) {
      bd = d;
      target = sp;
    }
  }
  m.target = target?.id ?? null;
  if (target && bd < MANTIS.reach && m.cool <= 0) {
    m.st = 'windup';
    m.wind = MANTIS.windup;
    m.facing = Math.atan2(target.y - m.y, target.x - m.x);
    world.ev.push({ k: 'windup', x: m.x, y: m.y, tx: target.x, ty: target.y, id: target.id });
    return;
  }
  m.st = 'hunt';
  const goal = target ? { x: target.x, y: target.y } : silkCentre(world);
  m.pathT -= dt;
  if (m.pathT <= 0 || !m.path) {
    m.path = route(world, m, goal);
    m.pathT = 1.5;
  }
  const next = m.path?.[0];
  let mx = goal.x - m.x;
  let my = goal.y - m.y;
  if (next) {
    const p = world.web.pos(next);
    if (p) {
      if (Math.hypot(p.x - m.x, p.y - m.y) < 6) m.path.shift();
      mx = p.x - m.x;
      my = p.y - m.y;
    }
  }
  const d = Math.hypot(mx, my) || 1;
  moveSpider(world, m, { mx: mx / d, my: my / d, hurry: false }, dt);
  if (m.mode === 'walk' && !pose(world, m)) {
    m.mode = 'air';
    m.vx = 0;
    m.vy = 0;
  }
  m.facing = Math.atan2(my, mx);
}

/** Shortest hop route over the graph from the mantis to the knot nearest the goal (no prey knots). */
function route(world, m, goal) {
  const web = world.web;
  const start = m.node ? web.ni(m.node) : m.th ? web.ta[web.ti(m.th)] ?? -1 : -1;
  const end = web.nearestNode(goal.x, goal.y, 400, (s) => web.kind[s] !== N_PREY);
  if (start < 0 || !end) return null;
  const prev = new Int32Array(web.nodeHigh).fill(-2);
  prev[start] = -1;
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const n = q[qi];
    if (n === end.s) break;
    for (const t of web.adj[n]) {
      const o = web.other(t, n);
      if (prev[o] !== -2 || web.kind[o] === N_PREY) continue;
      prev[o] = n;
      q.push(o);
    }
  }
  if (prev[end.s] === -2) return null;
  const path = [];
  for (let n = end.s; n >= 0 && n !== start; n = prev[n]) path.unshift(web.nid[n]);
  return path.slice(0, 40);
}

function silkCentre(world) {
  const web = world.web;
  let x = 0;
  let y = 0;
  let n = 0;
  for (let s = 0; s < web.nodeHigh; s++) {
    if (web.nid[s] < 2000) continue;
    x += web.x[s];
    y += web.y[s];
    n++;
  }
  return n ? { x: x / n, y: y / n } : { x: W / 2, y: H / 2 };
}

/** Venom bites sting it into retreat after three. */
export function biteMantis(world, sp) {
  const m = world.mantis;
  if (!m || m.st === 'gone' || m.st === 'leave') return false;
  if (Math.hypot(m.x - sp.x, m.y - sp.y) > 34) return false;
  if (sp.venom <= 0 && sp.sp !== 'jumper') {
    hurt(world, sp, 12, 'mantis');
    return true;
  }
  if (sp.sp !== 'jumper') sp.venom--;
  m.bites++;
  m.st = 'stunned';
  m.wait = 2.2;
  world.ev.push({ k: 'mantisbit', id: sp.id, x: m.x, y: m.y, bites: m.bites });
  if (m.bites >= 3) driveOff(world, m);
  return true;
}

function driveOff(world, m) {
  m.st = 'leave';
  world.tally.mantisOff = true;
  world.ev.push({ k: 'mantisoff', x: m.x, y: m.y });
}

export { PREY, SPECIES, T_STICKY, freeFromWeb };
