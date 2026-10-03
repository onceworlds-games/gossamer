// Bot spiders: they play through the same inputs and commands a player sends. The balance harness uses them to
// measure the numbers, and the game's autopilot (?test, the title screen) uses them to keep a night lively.
import { PREY, SPECIES, T_STICKY, T_FRAME, T_SURFACE, N_PREY, GROUND, W, UPGRADES, upgradeCost } from './data.js';
import { makeRng, range, rand, chance, mix, hash } from './rng.js';
import { route, standSlot } from './path.js';
import { useTarget, fitOrb } from './actions.js';
import { retreatNode } from './garden.js';

export const SKILLS = {
  // A novice builds where the visitors fly nine times in ten: the lanes shimmer at dusk, when the site is chosen.
  novice: { react: 0.9, aim: 40, threat: 0.15, siteLuck: 0.9, repair: 0, prioritise: false, retreatHp: 0 },
  average: { react: 0.55, aim: 14, threat: 0.55, siteLuck: 0.85, repair: 0.6, prioritise: false, retreatHp: 25 },
  good: { react: 0.2, aim: 5, threat: 0.95, siteLuck: 1, repair: 1, prioritise: true, retreatHp: 35 },
  // A capable weaver that ignores hunters entirely (the wasp measurement's "unprotected" spider).
  unprotected: { react: 0.55, aim: 14, threat: 0, siteLuck: 0.85, repair: 0.6, prioritise: false, retreatHp: 0 },
};

export function makeBot(world, id, skill = 'average') {
  return { id, skill: SKILLS[skill] ? skill : 'average', k: SKILLS[skill] ?? SKILLS.average, rng: makeRng(mix(world.seed, hash(id))), think: 0, path: null, pathTo: 0, goal: null, site: null, built: 0, holding: false, siteTries: 0, cool: 0, lastSilk: 0, wrenDodge: null };
}

const input = () => ({ mx: 0, my: 0, hurry: false, leap: null, noDrop: true });

/** One tick: returns the input for this spider and may push commands into world.cmds. */
export function botTick(world, bot, dt) {
  const sp = world.spiders.find((s) => s.id === bot.id);
  const inp = input();
  if (!sp || sp.mode === 'downed' || world.phase === 'dawn') return inp;
  bot.think -= dt;
  bot.cool -= dt;
  if (bot.think <= 0) {
    bot.think = bot.k.react * range(bot.rng, 0.6, 1.4);
    decide(world, bot, sp);
  }
  if (bot.goal?.k === 'drop') {
    inp.my = 1;
    inp.noDrop = false;
    inp.drop = true;
    if (sp.mode === 'hang' && sp.y > bot.goal.y) bot.goal = null;
    return inp;
  }
  if (bot.goal?.k === 'leap') {
    inp.leap = { x: bot.goal.x, y: bot.goal.y, power: bot.goal.power ?? 1 };
    bot.goal = null;
    return inp;
  }
  if (sp.mode === 'hang') {
    inp.my = -1;
    return inp;
  }
  if (bot.path && bot.path.length) steer(world, bot, sp, inp);
  return inp;
}

function steer(world, bot, sp, inp) {
  const web = world.web;
  // Passing through a knot counts as reaching it (walking carries on through knots in one tick).
  while (bot.path.length && (sp.node === bot.path[0] || sp.from === bot.path[0])) bot.path.shift();
  const next = bot.path[0];
  if (!next) return;
  const p = web.pos(next);
  if (!p) {
    bot.path = null;
    return;
  }
  const dx = p.x - sp.x;
  const dy = p.y - sp.y;
  const d = Math.hypot(dx, dy) || 1;
  inp.mx = dx / d;
  inp.my = dy / d;
  // Mid-thread and the next knot is behind us along it: aim along the thread instead.
  if (!sp.node && sp.th) {
    const t = web.ti(sp.th);
    if (t >= 0) {
      const toB = web.nid[web.tb[t]] === next;
      const toA = web.nid[web.ta[t]] === next;
      if (toA || toB) {
        const ux = web.x[web.tb[t]] - web.x[web.ta[t]];
        const uy = web.y[web.tb[t]] - web.y[web.ta[t]];
        const L = Math.hypot(ux, uy) || 1;
        inp.mx = ((toB ? 1 : -1) * ux) / L;
        inp.my = ((toB ? 1 : -1) * uy) / L;
      }
    }
  }
}

function goTo(world, bot, sp, slot) {
  const web = world.web;
  const from = standSlot(web, sp);
  if (from < 0 || slot < 0) return false;
  if (from === slot) {
    bot.path = [];
    if (!sp.node) bot.path = [web.nid[slot]];
    return true;
  }
  bot.path = route(web, from, slot);
  // Mid-thread, the route starts at the knot we're walking toward first.
  if (bot.path && !sp.node) bot.path.unshift(web.nid[from]);
  bot.pathTo = web.nid[slot];
  return !!bot.path;
}

function decide(world, bot, sp) {
  if (sp.act || sp.busy > 0) return;
  if (threats(world, bot, sp)) return;
  if (sp.sp === 'orb') return orbBot(world, bot, sp);
  if (sp.sp === 'jumper') return jumperBot(world, bot, sp);
  return bolasBot(world, bot, sp);
}

/** The wren's band and hunting wasps: hide or drop out of the way. Returns true if busy dodging. */
function threats(world, bot, sp) {
  const k = bot.k;
  const wr = world.wren;
  if (wr && wr.st === 'warn' && Math.abs(sp.y - wr.y) < wr.band / 2 + 26 && !sp.hidden) {
    if (bot.wrenDodge !== wr) bot.wrenDodge = chance(bot.rng, k.threat) ? wr : false;
    if (bot.wrenDodge === wr) {
      if (sp.mode === 'walk' && sp.silk > 8) {
        bot.goal = { k: 'drop', y: wr.y + wr.band / 2 + 34 };
        bot.path = null;
        return true;
      }
    }
  }
  const hunted = world.wasps.some((w) => w.st === 'hunt' && w.target === sp.id);
  const low = sp.hp < k.retreatHp;
  if ((hunted && sp.sp !== 'jumper' && chance(bot.rng, k.threat) && sp.venom <= 0) || low) {
    const r = world.web.ni(retreatNode(world.garden));
    if (!sp.inRetreat) goTo(world, bot, sp, r);
    return true;
  }
  if (hunted && sp.venom > 0) world.cmds.push({ id: sp.id, t: 'bite' });
  return false;
}

// ---------------------------------------------------------------- the orb weaver
function chooseSite(world, bot, not = null) {
  const sites = world.garden.sites.filter((s) => s !== not);
  if (!sites.length) return null;
  if (!chance(bot.rng, bot.k.siteLuck)) {
    // A poor choice: somewhere it can hang, but not where the prey fly.
    const off = sites.filter((s) => s.lane !== 0);
    const pickFrom = off.length ? off : sites;
    return { ...pickFrom[Math.floor(rand(bot.rng) * pickFrom.length)], bad: true };
  }
  const main = sites.filter((s) => s.lane === 0);
  const pool = bot.skill === 'good' && main.length ? main.slice(0, 1) : (main.length ? main : sites).slice(0, 3);
  return pool[Math.floor(rand(bot.rng) * pool.length)];
}

function webNear(world, x, y, r) {
  const web = world.web;
  let n = 0;
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] !== T_STICKY) continue;
    const a = web.ta[s];
    if (Math.hypot(web.x[a] - x, web.y[a] - y) < r) n++;
  }
  return n;
}

function orbBot(world, bot, sp) {
  const web = world.web;
  // The web we asked for was refused: forget it and look elsewhere.
  if (bot.asked !== undefined && world.t - bot.asked < 1 && world.out.concat(world.ev).some((e) => e.k === 'refuse' && e.id === sp.id && e.why !== 'busy')) {
    bot.built = 0;
    bot.asked = undefined;
    bot.site = chooseSite(world, bot, bot.site);
    return;
  }
  // 1. Food first: stuck prey on our web, then cocoons.
  const food = pickFood(world, bot, sp);
  if (food) {
    const d = Math.hypot(food.x - sp.x, food.y - sp.y);
    if (d < 26) {
      const t = useTarget(world, sp);
      if (t && (t.k === 'eat' || t.k === 'wrap')) {
        world.cmds.push({ id: sp.id, t: 'use', on: true });
        bot.holding = true;
        return;
      }
    }
    const slot = web.ni(food.node);
    if (slot >= 0 && (bot.pathTo !== food.node || !bot.path)) goTo(world, bot, sp, slot);
    return;
  }
  if (bot.holding) {
    world.cmds.push({ id: sp.id, t: 'use', on: false });
    bot.holding = false;
  }
  // 2. A web where the prey fly (or a new one after the old was torn down).
  if (!bot.site) bot.site = chooseSite(world, bot);
  const site = bot.site;
  if (!site) return;
  const have = webNear(world, site.x, site.y, (site.r ?? 90) + 20);
  const wantRepair = bot.built > 0 && have < bot.built * 0.4 && chance(bot.rng, bot.k.repair);
  if ((bot.built === 0 || wantRepair) && bot.cool <= 0) {
    const dist = Math.hypot(site.x - sp.x, site.y - sp.y);
    if (dist > sp.mods.range - 30) return approach(world, bot, sp, site);
    const plan = fitOrb(web, site.x, site.y, site.r ?? 95, 'orb', sp.mods.range, sp.silk);
    if (!plan.ok && (plan.why !== 'silk' || sp.silk >= sp.mods.maxSilk * 0.95)) {
      // Nothing to hang it from here: try another place.
      bot.site = chooseSite(world, bot, site);
      bot.cool = 0.5;
      return;
    }
    // Wait for silk unless a decent web fits already (a novice doesn't wait).
    const full = sp.silk >= sp.mods.maxSilk * 0.95;
    if (!plan.ok || ((plan.r ?? 0) < (site.r ?? 95) * 0.8 && !full && bot.skill !== 'novice')) return;
    world.cmds.push({ id: sp.id, t: 'orb', x: plan.hub.x, y: plan.hub.y, r: plan.r ?? site.r, p: 'orb' });
    bot.built = Math.max(10, plan.rings);
    bot.asked = world.t;
    bot.cool = 3;
    return;
  }
  // 3. Wait at the hub-ish: near the site, not in the sticky.
  if (bot.built && Math.hypot(site.x - sp.x, site.y - sp.y) > 60 && (!bot.path || !bot.path.length)) {
    const n = web.nearestNode(site.x, site.y, 120, (s) => web.kind[s] !== N_PREY && web.adj[s].length > 0);
    if (n) goTo(world, bot, sp, n.s);
  }
}

function approach(world, bot, sp, site) {
  const web = world.web;
  const n = web.nearestNode(site.x, site.y, 400, (s) => web.adj[s].length > 0 && web.kind[s] !== N_PREY);
  if (n && bot.pathTo !== n.id) goTo(world, bot, sp, n.s);
}

function pickFood(world, bot, sp) {
  let best = null;
  let bs = -Infinity;
  for (const p of world.prey) {
    if (!['stuck', 'cocoon', 'subdued'].includes(p.st) || !p.node) continue;
    if (p.heldBy && p.heldBy !== sp.id) continue;
    const d = Math.hypot(p.x - sp.x, p.y - sp.y);
    if (d > 420) continue;
    const def = PREY[p.sp];
    let score = -d / 100;
    if (bot.k.prioritise) {
      score += def.food / 3;
      if (p.st === 'stuck') score += 2 + Math.max(0, 4 - p.timer);
    } else if (p.st === 'stuck') score += 1;
    if (score > bs) {
      bs = score;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the jumper
function jumperBot(world, bot, sp) {
  const web = world.web;
  let best = null;
  let bs = Infinity;
  for (const p of world.prey) {
    if (p.st !== 'land' && p.st !== 'fly' && p.st !== 'stuck') continue;
    if (p.st === 'fly' && (p.sp === 'gnat' || p.sp === 'midge')) continue;
    const d = Math.hypot(p.x - sp.x, p.y - sp.y);
    if (d > 520) continue;
    const def = PREY[p.sp];
    if ((def.armour || p.sp === 'dragonfly') && sp.venom <= 0) continue;
    const cost = d - def.food * 20 + (p.st === 'fly' ? 140 : 0);
    if (cost < bs) {
      bs = cost;
      best = p;
    }
  }
  if (!best) return;
  const d = Math.hypot(best.x - sp.x, best.y - sp.y);
  const reach = sp.mods.leap * 0.95;
  if (d < reach && sp.mode === 'walk') {
    // Wait for a preen if it's watching us; otherwise go.
    const watching = best.st === 'land' && best.preen <= 0 && Math.sign(sp.x - best.x) === best.facing && d > 60;
    if (watching && bot.skill !== 'novice' && chance(bot.rng, 0.7)) return;
    const lead = best.st === 'fly' ? 0.25 : 0;
    const ax = best.x + best.vx * lead + range(bot.rng, -1, 1) * bot.k.aim;
    const ay = best.y + best.vy * lead + range(bot.rng, -1, 1) * bot.k.aim;
    bot.goal = { k: 'leap', x: ax, y: ay, power: Math.min(1, (d + 20) / sp.mods.leap) };
    return;
  }
  // Creep closer, from behind if it's perched.
  const tx = best.st === 'land' ? best.x - best.facing * 90 : best.x;
  const n = web.nearestNode(tx, best.y + 20, 300, (s) => web.adj[s].length > 0 && web.kind[s] !== N_PREY);
  if (n && bot.pathTo !== n.id) goTo(world, bot, sp, n.s);
}

// ---------------------------------------------------------------- the bolas spider
function bolasBot(world, bot, sp) {
  const web = world.web;
  if (!bot.site) {
    const main = world.garden.sites.filter((s) => s.lane === 0);
    bot.site = main[0] ?? world.garden.sites[0] ?? { x: W / 2, y: 500 };
  }
  const site = bot.site;
  const d = Math.hypot(site.x - sp.x, site.y - sp.y);
  if (d > 140) {
    const n = web.nearestNode(site.x, site.y, 260, (s) => web.adj[s].length > 0 && web.kind[s] !== N_PREY);
    if (n && bot.pathTo !== n.id) goTo(world, bot, sp, n.s);
    return;
  }
  if (!world.lures.some((l) => l.owner === sp.id) && sp.silk > 10) {
    world.cmds.push({ id: sp.id, t: 'lure' });
    return;
  }
  if (world.balls.some((b) => b.owner === sp.id)) return;
  let target = null;
  let bd = 230;
  for (const p of world.prey) {
    if (p.st !== 'fly' && p.st !== 'land') continue;
    if (p.sp !== 'moth' && !(p.sp === 'fly' && chance(bot.rng, 0.2))) continue;
    const dd = Math.hypot(p.x - sp.x, p.y - sp.y);
    if (dd < bd) {
      bd = dd;
      target = p;
    }
  }
  if (target) {
    const lead = bd / 500;
    world.cmds.push({ id: sp.id, t: 'fling', x: target.x + target.vx * lead + range(bot.rng, -1, 1) * bot.k.aim, y: target.y + target.vy * lead + range(bot.rng, -1, 1) * bot.k.aim, power: Math.min(1, bd / 200) });
  }
}

// ---------------------------------------------------------------- what a bot of each skill would have bought
const PRIORITY = {
  novice: ['legs', 'glands', 'eyes', 'camo', 'shake', 'alarm'],
  average: ['glands', 'droplets', 'strong', 'legs', 'eyes', 'camo', 'venom', 'shake'],
  good: ['droplets', 'glands', 'strong', 'venom', 'camo', 'droplets', 'glands', 'eyes', 'legs', 'eggsac'],
};
const INCOME = { novice: 7, average: 11, good: 15 };

/** Upgrades a spider of this skill would plausibly own by night n. */
export function buildFor(skill, night, sp = 'orb') {
  let points = Math.max(0, night - 1) * INCOME[skill];
  const up = {};
  const order = PRIORITY[skill];
  for (let pass = 0; pass < 3; pass++) {
    for (const id of order) {
      if (!UPGRADES[id].for.includes(sp)) continue;
      const tier = up[id] | 0;
      if (tier > pass || tier >= 3) continue;
      const c = upgradeCost(id, tier);
      if (c <= points) {
        points -= c;
        up[id] = tier + 1;
      }
    }
  }
  return up;
}


export { SPECIES };
