// One night in one garden: everything the host simulates, stepped at a fixed 60 Hz. Plain data in and out, seeded,
// no DOM: the balance harness, the tests and the game all run this same code.
import { DT, DEW_BEAD_MASS, DOWNED_SOLO, DOWNED_COOP, T_SURFACE, N_PREY, PREY, SPECIES, GARDEN_KEYS, W } from './data.js';
import { makeRng, mix, range } from './rng.js';
import { Web } from './web.js';
import { generateGarden, buildGarden, startNode, retreatNode } from './garden.js';
import { createSpider, moveSpider, upkeep, loseFooting, placeAt, hurt, refreshMods } from './spider.js';
import { cast, cut, use, bite, shake, startOrb, placeLure, fling, runActions, removeThread } from './actions.js';
import { spawnPrey, updatePrey, hunt, eatPrey, grabPrey, freeFromWeb } from './prey.js';
import { spawnWasp, updateWasps, warnWren, updateWren, spawnMantis, updateMantis, biteMantis } from './hostiles.js';
import { makeWeather, updateWeather, weatherEvent, dewLoad } from './weather.js';
import { nightRules, makeScript, quota } from './night.js';
import { lanePoint } from './garden.js';

const NOINPUT = { mx: 0, my: 0, hurry: false, leap: null };
const MASS = { orb: 1, jumper: 0.8, bolas: 1.2 };

/**
 * cfg: { seed, night, garden, cold, mode ('season' | 'daily' | 'endless' | 'tutorial' | 'practice'), players:
 * [{ id, sp, up, tr, silk }], role ('host' | 'mirror'), preyMul }
 */
export function createWorld(cfg) {
  const seed = (cfg.seed >>> 0) || 1;
  const night = Math.max(1, Math.min(99, cfg.night | 0 || 1));
  const cold = Math.max(0, Math.min(5, cfg.cold | 0));
  const mode = cfg.mode ?? 'season';
  const gardenId = GARDEN_KEYS.includes(cfg.garden) ? cfg.garden : 'cottage';
  const players = (cfg.players?.length ? cfg.players : [{ id: 'me', sp: 'orb' }]).slice(0, 4);
  const rules = nightRules(players, cold, { gentle: mode === 'tutorial', preyMul: cfg.preyMul });
  const script = makeScript(seed, night, gardenId, rules, cold, mode);
  const garden = generateGarden(gardenId, mix(seed, 0x9a7d + night));
  const web = new Web();
  buildGarden(web, garden);
  const world = {
    v: 1,
    seed,
    night,
    cold,
    mode,
    role: cfg.role ?? 'host',
    gardenId: garden.id,
    garden,
    web,
    rules,
    script,
    si: 0,
    dusk: script.dusk,
    length: script.length,
    t: 0,
    tick: 0,
    phase: 'dusk',
    rng: makeRng(mix(seed, 0xbeef + night)),
    ev: [],
    out: [],
    prey: [],
    swarms: {},
    wasps: [],
    wren: null,
    mantis: null,
    lures: [],
    balls: [],
    lights: garden.lights.map((l) => ({ ...l, x0: l.x, y0: l.y, p0: l.power })),
    food: 0,
    quota: 0,
    tally: { caught: {}, eaten: {}, escaped: {}, stolen: 0, snaps: 0, swoops: 0, gusts: 0, rain: false, mist: false, mantisOff: false },
    hubs: {},
    quickHubs: new Set(),
    hollows: [],
    stickFactor: 1,
    solid: new Set(garden.solidThreads ?? []),
    nextId: 1,
    spiders: [],
    cmds: [],
    done: false,
  };
  world.quota = quota(world);
  world.weather = makeWeather(script);
  hook(world);
  players.forEach((p, i) => addSpider(world, p, i));
  return world;
}

function hook(world) {
  world.freePrey = (node) => {
    const p = world.prey.find((q) => q.node === node);
    if (p) freeFromWeb(world, p);
    else if (world.web.ni(node) >= 0 && world.web.adj[world.web.ni(node)].length === 0) world.web.removeNode(node);
  };
  world.eatPrey = (p, sp) => eatPrey(world, p, sp);
  world.grabPrey = (p, sp) => grabPrey(world, p, sp);
  world.revive = (o, by) => {
    o.mode = 'walk';
    o.hp = 40;
    o.downed = 0;
    o.invuln = 2;
    if (!o.node && !o.th) placeAt(world, o, retreatNode(world.garden));
    world.ev.push({ k: 'revived', id: o.id, by: by.id, x: o.x, y: o.y });
  };
}

export function addSpider(world, p, i = world.spiders.length) {
  const sp = createSpider(p.id, p.sp ?? 'orb', { idx: p.idx ?? i, up: p.up, tr: p.tr, silk: p.silk, remote: p.remote });
  if (Number.isFinite(p.silk)) sp.silk = Math.max(0, Math.min(sp.mods.maxSilk, p.silk));
  // Spread friends out a little around the start.
  const web = world.web;
  let node = startNode(world.garden);
  if (i > 0) {
    const s0 = web.pos(node);
    const near = s0 && web.nearestNode(s0.x + (i % 2 ? 1 : -1) * 40 * i, s0.y + 10, 160, (s) => web.kind[s] === 0 && web.adj[s].length > 0);
    if (near) node = near.id;
  }
  placeAt(world, sp, node);
  if (sp.mods.lantern) world.lights.push({ kind: 'lantern', owner: sp.id, x: sp.x, y: sp.y - 30, r: 40, power: 0.7, x0: sp.x, y0: sp.y, p0: 0.7 });
  world.spiders.push(sp);
  return sp;
}

export function spiderById(world, id) {
  for (const sp of world.spiders) if (sp.id === id) return sp;
  return null;
}

// ---------------------------------------------------------------- the tick
export function stepWorld(world, inputs = {}) {
  world.ev = [];
  const dt = DT;
  world.t += dt;
  world.tick++;
  if (world.phase === 'dusk' && world.t >= world.dusk) {
    world.phase = 'night';
    world.ev.push({ k: 'nightfall' });
  }
  if (world.phase === 'night' && world.t >= world.dusk + world.length) {
    world.phase = 'dawn';
    world.done = true;
    world.ev.push({ k: 'dawn' });
  }
  const ev = world.script.events;
  while (world.si < ev.length && ev[world.si].t <= world.t) runEvent(world, ev[world.si++]);
  updateWeather(world, dt);
  // A command that throws (a page that lies) is dropped, never retried, and never stops the night.
  const cmds = world.cmds;
  world.cmds = [];
  for (const c of cmds) {
    try {
      command(world, c);
    } catch {
      world.cmdErrors = (world.cmdErrors | 0) + 1;
    }
  }
  for (const sp of world.spiders) {
    if (sp.lost) {
      sp.lost = false;
      if (!sp.remote) loseFooting(world, sp);
    }
    if (sp.queued) drainQueued(world, sp);
    if (!sp.remote) moveSpider(world, sp, inputs[sp.id] ?? NOINPUT, dt);
    runActions(world, sp, dt);
    upkeep(world, sp, dt);
    if (sp.mode === 'downed') downedTick(world, sp, dt);
  }
  // The web feels everyone's weight (and the dew's).
  const web = world.web;
  web.load.fill(0, 0, web.nodeHigh);
  for (const sp of world.spiders) addLoad(world, sp, MASS[sp.sp] ?? 1);
  if (world.mantis && world.mantis.mode === 'walk') addLoad(world, world.mantis, 5);
  dewLoad(web, DEW_BEAD_MASS);
  web.step({ sway: world.weather.sway, windX: world.weather.windX, windY: world.weather.windY });
  for (const id of web.snapped) {
    const s = web.ti(id);
    if (s < 0) continue;
    const a = web.ta[s];
    const b = web.tb[s];
    world.ev.push({ k: 'snap', th: id, type: web.type[s], x: (web.x[a] + web.x[b]) / 2, y: (web.y[a] + web.y[b]) / 2, ax: web.x[a], ay: web.y[a], bx: web.x[b], by: web.y[b], len: web.len[s] });
    world.tally.snaps++;
    removeThread(world, id, 2);
  }
  updateSwarms(world, dt);
  updatePrey(world, dt);
  hunt(world, dt);
  updateWasps(world, dt);
  updateWren(world, dt);
  updateMantis(world, dt);
  for (let i = 0; i < world.ev.length; i++) {
    const e = world.ev[i];
    if (e.k === 'fallhurt') {
      const sp = spiderById(world, e.id);
      if (sp) hurt(world, sp, e.amount, 'fall');
    }
  }
  for (const e of world.ev) world.out.push(e);
  if (world.out.length > 800) world.out.splice(0, world.out.length - 800);
}

function addLoad(world, sp, m) {
  const web = world.web;
  if (sp.mode === 'walk' || sp.mode === 'downed') {
    if (sp.node) {
      const n = web.ni(sp.node);
      if (n >= 0) web.load[n] += m;
    } else if (sp.th) {
      const t = web.ti(sp.th);
      if (t >= 0 && web.type[t] !== T_SURFACE) {
        web.load[web.ta[t]] += m * (1 - sp.s);
        web.load[web.tb[t]] += m * sp.s;
      }
    }
  } else if (sp.mode === 'hang' && sp.hang) {
    const an = sp.hang.anchor;
    if (an.node) {
      const n = web.ni(an.node);
      if (n >= 0) web.load[n] += m;
    } else {
      const t = web.ti(an.th);
      if (t >= 0) {
        web.load[web.ta[t]] += m * (1 - an.s);
        web.load[web.tb[t]] += m * an.s;
      }
    }
  }
}

function downedTick(world, sp, dt) {
  sp.downed += dt;
  const others = world.spiders.filter((s) => s !== sp && !s.away).length;
  if (sp.downed >= (others ? DOWNED_COOP : DOWNED_SOLO)) {
    sp.mode = 'walk';
    sp.hp = 30;
    sp.downed = 0;
    sp.invuln = 2;
    placeAt(world, sp, retreatNode(world.garden));
    world.ev.push({ k: 'wake', id: sp.id, x: sp.x, y: sp.y });
  }
}

function runEvent(world, e) {
  switch (e.k) {
    case 'prey': {
      if (world.phase === 'dawn') return;
      let swarm = 0;
      if (e.n > 1) {
        swarm = world.nextId++;
        const lane = world.garden.lanes[e.lane];
        const sw = { id: swarm, lane: e.lane, u: 0, x: -60, y: 400, speed: e.sp === 'midge' ? 34 : 44, off: range(world.rng, -0.4, 0.4) * (lane?.w ?? 60) };
        world.swarms[swarm] = sw;
        placeSwarm(world, sw);
      }
      for (let i = 0; i < e.n; i++) {
        const p = spawnPrey(world, e.sp, e.lane, { swarm, landAt: e.landAt, big: e.big && i === 0 });
        if (p && swarm) {
          const sw = world.swarms[swarm];
          p.speed = sw.speed;
          p.off = sw.off;
          p.x = sw.x + range(world.rng, -14, 14);
          p.y = sw.y + range(world.rng, -10, 10);
        }
      }
      break;
    }
    case 'wasp':
      spawnWasp(world);
      break;
    case 'wren':
      if (!world.wren && !world.weather.mist) warnWren(world);
      break;
    case 'mantis':
      if (!world.mantis) spawnMantis(world);
      break;
    default:
      weatherEvent(world, e);
  }
}

const lp = {};
function placeSwarm(world, sw) {
  const lane = world.garden.lanes[sw.lane];
  if (!lane) {
    sw.x = sw.lane < 0 ? -60 : sw.x;
    return;
  }
  lanePoint(lane, sw.u, lp);
  sw.x = lp.x - lp.dy * sw.off;
  sw.y = lp.y + lp.dx * sw.off;
}

function updateSwarms(world, dt) {
  for (const k in world.swarms) {
    const sw = world.swarms[k];
    const lane = world.garden.lanes[sw.lane];
    if (!lane) {
      // A stray swarm drifts across.
      sw.x += sw.speed * dt;
      if (sw.x > W + 120) delete world.swarms[k];
      continue;
    }
    sw.u += (sw.speed * dt) / (lanePoint(lane, sw.u, lp).total || 1000);
    sw.off += Math.sin(world.t * 0.7 + sw.id) * dt * 8;
    placeSwarm(world, sw);
    if (sw.u >= 1.02) delete world.swarms[k];
  }
}

// ---------------------------------------------------------------- commands (the host checks each one)
const QUEUE_FOR = 0.45; // s a cast or an orb asked for during the last one waits for its turn

/** True while the spider is in the short pause after a cast (or riding a spiral strand): a cast now would be refused as busy. */
function briefly(sp) {
  return sp.mode !== 'downed' && ((sp.busy > 0 && sp.busy <= 0.4 && !sp.act) || (sp.act?.k === 'spin' && sp.busy <= 0));
}

function drainQueued(world, sp) {
  const q = sp.queued;
  if (world.t > q.until || sp.mode === 'downed') {
    sp.queued = null;
    return;
  }
  if (sp.busy > 0 || sp.act || sp.mode === 'air') return;
  sp.queued = null;
  command(world, q.c);
}

export function command(world, c) {
  if (!c || typeof c !== 'object') return;
  const sp = spiderById(world, c.id);
  if (!sp) return;
  const num = (v) => (Number.isFinite(+v) ? +v : NaN);
  switch (c.t) {
    case 'cast':
    case 'orb':
      // Tapping a little ahead of the spinneret (a rhythm of casts) is remembered, not refused.
      if (briefly(sp) && !c.queued) {
        sp.queued = { c: { ...c, queued: true }, until: world.t + QUEUE_FOR };
        return;
      }
      if (c.t === 'orb') startOrb(world, sp, num(c.x), num(c.y), num(c.r), String(c.p ?? 'orb'));
      else cast(world, sp, num(c.type) | 0, num(c.x), num(c.y), num(c.sr));
      break;
    case 'cut':
      cut(world, sp, num(c.x), num(c.y));
      break;
    case 'use':
      use(world, sp, !!c.on);
      break;
    case 'bite':
      if (!(world.mantis && biteMantis(world, sp))) bite(world, sp);
      break;
    case 'shake':
      shake(world, sp);
      break;
    case 'lure':
      placeLure(world, sp);
      break;
    case 'fling':
      fling(world, sp, num(c.x), num(c.y), num(c.power));
      break;
    case 'fall':
      hurt(world, sp, Math.max(0, Math.min(15, num(c.amount) || 0)), 'fall');
      break;
    case 'prey':
      // The tutorial sends a visitor straight at the first web.
      if (world.mode === 'tutorial' && typeof c.sp === 'string' && Object.hasOwn(PREY, c.sp) && Number.isFinite(num(c.x))) {
        const p = spawnPrey(world, c.sp, -1, { x: num(c.x), y: num(c.y) });
        if (p) aimAt(p, c);
      }
      break;
    default:
      break;
  }
}

function aimAt(p, c) {
  const tx = Number(c.tx);
  const ty = Number(c.ty);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
  p.stray = { pts: [[p.x, p.y], [tx, ty], [tx + (tx - p.x), ty + (ty - p.y) * 0.3]], w: 4, share: 0 };
  p.u = 0;
}

export function upgradeSpider(world, id, up, tr) {
  const sp = spiderById(world, id);
  if (!sp) return;
  sp.up = { ...up };
  sp.tr = [...tr];
  refreshMods(sp);
}

/** Time left in the night (s), or 0 at dawn. */
export function timeLeft(world) {
  return Math.max(0, world.dusk + world.length - world.t);
}

export { NOINPUT, N_PREY, SPECIES };
