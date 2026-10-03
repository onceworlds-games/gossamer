// Store art from the game's own renderer: ?poster=thumb1|thumb2|thumb3|thumb4|icon|badge-<id>. Each scene is set up
// from a fixed seed with the real simulation, settled, drawn once, and then window.__posterReady is set.
import { Renderer } from './renderer.js';
import { createWorld, stepWorld } from '../sim/world.js';
import { placeAt } from '../sim/spider.js';
import { planOrb, orbSteps } from '../sim/quickorb.js';
import { spawnPrey, stick } from '../sim/prey.js';
import { warnWren, spawnWasp } from '../sim/hostiles.js';
import { T_STICKY, T_SURFACE, N_PREY } from '../sim/data.js';
import { pulseFrom } from './webart.js';
import * as fx from './fx.js';
import { drawPrey, drawWasp, drawSpider, ball } from './creatures.js';
import { drawWeb } from './webart.js';
import { SILVER, AMBER, RUST, PAPER, rgba } from './palette.js';
import { SERIF, glyph } from './hud.js';

export async function runPoster(kind) {
  document.body.style.background = '#08171a';
  try {
    await document.fonts?.load?.('400 40px "EB Garamond"');
    await document.fonts?.load?.('italic 400 40px "EB Garamond"');
    await document.fonts?.load?.('400 30px "Cedarville Cursive"');
  } catch {}
  const canvas = document.getElementById('view');
  if (kind.startsWith('badge-')) return badge(canvas, kind.slice(6));
  if (kind === 'thumb4') return notebookPoster(canvas);
  const r = new Renderer(canvas);
  r.resize(innerWidth, innerHeight, Math.min(2, window.devicePixelRatio || 1));
  if (kind === 'icon') return iconPoster(r);
  const scene = SCENES[kind] ?? SCENES.thumb1;
  const s = scene();
  r.cam.user = s.zoom ?? 1.3;
  // Draw a few frames so pulses, rings and the camera settle, then hold.
  for (let i = 0; i < 40; i++) {
    r.draw({ ...s.view, t: 3 + i / 60, dt: 1 / 60, snap: i < 2 });
  }
  if (s.after) s.after(r);
  window.__posterReady = true;
}

/** Builds a night, spins an orb at the best site and lets it settle. */
function nightWith(o) {
  const w = createWorld({ seed: o.seed, night: o.night ?? 5, garden: o.garden, mode: 'practice', players: [{ id: 'p', sp: o.sp ?? 'orb', up: { strong: 2 } }] });
  w.script.events = [];
  const sp = w.spiders[0];
  sp.silk = 400;
  sp.mods.maxSilk = 400;
  sp.mods.range = 2000;
  const site = o.site ? o.site(w) : (w.garden.sites.find((x) => x.lane === 0) ?? w.garden.sites[0]);
  if (o.frame) frameAround(w, sp, site, o.frame);
  if (o.best === 'any') {
    // Every site in the garden: the one that makes the handsomest orb.
    let top = null;
    for (const cand of w.garden.sites) {
      const pick = roundest(w, cand, o.r ?? 110);
      if (!top || pick.score > top.score) top = pick;
    }
    if (top) Object.assign(site, top);
  } else if (o.best) Object.assign(site, roundest(w, site, o.r ?? 110));
  if (o.web !== false) {
    w.cmds.push({ id: 'p', t: 'orb', x: site.x, y: site.y, r: o.r ?? Math.max(95, site.r), p: o.pattern ?? 'orb' });
    for (let i = 0; i < 60 * 9; i++) stepWorld(w, {});
  }
  w.weather.sway = 0.1;
  return { w, sp, site };
}

/** The hub near a site that gives the fullest, most even orb (the poster wants a handsome web). */
function roundest(w, site, r) {
  let best = { x: site.x, y: site.y, score: -Infinity };
  let bs = -Infinity;
  for (let dy = -90; dy <= 90; dy += 15) {
    for (let dx = -120; dx <= 120; dx += 15) {
      const plan = planOrb(w.web, site.x + dx, site.y + dy, r, 'orb', 2000);
      if (!plan.ok) continue;
      const ends = plan.ends.filter(Boolean);
      if (ends.length < 8) continue;
      const ds = ends.map((e) => e.d);
      const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
      const spread = Math.sqrt(ds.reduce((a, d) => a + (d - mean) ** 2, 0) / ds.length);
      const score = orbSteps(plan).length * 2 - spread * 0.8 - Math.hypot(dx, dy) * 0.05;
      if (score > bs) {
        bs = score;
        best = { x: site.x + dx, y: site.y + dy, score };
      }
    }
  }
  return best;
}

/** A frame first, the way a real orb weaver starts: a ring of strong lines between anchors around the site. */
function frameAround(w, sp, site, R) {
  const web = w.web;
  const pts = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 - Math.PI / 2;
    const near = web.nearestThread(site.x + Math.cos(a) * R, site.y + Math.sin(a) * R, R * 0.7);
    if (near) pts.push(near);
  }
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    const from = web.nearestNode(a.x, a.y, 30);
    placeAt(w, sp, from ? from.id : web.nid[web.ta[a.s]]);
    sp.busy = 0;
    sp.act = null;
    w.cmds.push({ id: 'p', t: 'cast', type: 0, x: b.x, y: b.y });
    stepWorld(w, {});
  }
  // Spokes reach the frame: go back to the middle.
  const mid = web.nearestNode(site.x, site.y, 400, (s2) => web.adj[s2].length > 0);
  if (mid) placeAt(w, sp, mid.id);
  for (let i = 0; i < 30; i++) stepWorld(w, {});
}

function dew(w, amount) {
  const web = w.web;
  for (let s = 0; s < web.threadHigh; s++) if (web.tid[s] >= 0 && web.type[s] !== T_SURFACE) web.dew[s] = Math.min(40, (web.len[s] / 7) * amount);
}

/** Sticks a prey of kind `sp` to the sticky thread nearest (x, y). */
function stickAt(w, sp, x, y, wrap = 0) {
  const web = w.web;
  const near = web.nearestThread(x, y, 200, (s) => web.type[s] === T_STICKY && web.kind[web.ta[s]] !== N_PREY && web.kind[web.tb[s]] !== N_PREY);
  if (!near) return null;
  const p = spawnPrey(w, sp, -1, { x: near.x, y: near.y });
  if (!p) return null;
  p.vx = 0;
  p.vy = 0;
  stick(w, p, near.s, near.t, near.x, near.y);
  p.wrap = wrap;
  p.timer = 99;
  return p;
}

function walkTo(w, sp, x, y) {
  const web = w.web;
  const n = web.nearestNode(x, y, 120, (s) => web.kind[s] !== N_PREY && web.adj[s].length > 1 && web.nid[s] >= 2000);
  if (n) placeAt(w, sp, n.id);
}

function silkBox(w) {
  const web = w.web;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let s = 0; s < web.nodeHigh; s++) {
    if (web.nid[s] < 2000 || web.kind[s] === N_PREY) continue;
    x0 = Math.min(x0, web.x[s]);
    x1 = Math.max(x1, web.x[s]);
    y0 = Math.min(y0, web.y[s]);
    y1 = Math.max(y1, web.y[s]);
  }
  return { x0, y0, x1, y1 };
}

function frame(w, sp, extra = {}) {
  const site = extra.site;
  const box = site ? { x0: site.x - site.r * 1.2, y0: site.y - site.r * 1.2, x1: site.x + site.r * 1.2, y1: site.y + site.r * 1.2 } : silkBox(w);
  const focus = { x: (box.x0 + box.x1) / 2 + (extra.dx ?? 0), y: (box.y0 + box.y1) / 2 + (extra.dy ?? 0) + 30, vx: 0, vy: 0 };
  return { world: w, me: 'p', spiders: w.spiders, focus, box: extra.box ?? { x0: box.x0 - (extra.pad ?? 0), y0: box.y0, x1: box.x1 + (extra.pad ?? 0), y1: box.y1 }, q: 'high', hud: null, silk: extra.silk ?? 'silver', dewStyle: 'round', mist: extra.mist ?? 0, retreat: false };
}

const SCENES = {
  // The cover: a dewy orb in moonlight, a moth stuck, the spider on its way to it.
  thumb1() {
    // A seed and hub chosen for a full, even orb on the main lane (searched with planOrb).
    const { w, sp, site } = nightWith({ seed: 253408, garden: 'cottage', r: 115, site: () => ({ x: 479, y: 429, r: 115 }) });
    dew(w, 0.55);
    const moth = stickAt(w, 'moth', site.x + 45, site.y + 28);
    if (moth) moth.big = true;
    stickAt(w, 'gnat', site.x - 50, site.y - 30);
    stickAt(w, 'fly', site.x - 20, site.y + 60, 0.6);
    if (moth) walkTo(w, sp, moth.x - 40, moth.y - 18);
    sp.facing = 0.3;
    for (let i = 0; i < 30; i++) stepWorld(w, {});
    for (const p of w.prey) p.timer = 99;
    const view = frame(w, sp, { site: { x: site.x + 50, y: site.y - 5, r: 105 } });
    return {
      zoom: 1.04,
      view,
      after(r) {
        const ctx = r.ctx;
        ctx.setTransform(r.pr, 0, 0, r.pr, 0, 0);
        ctx.font = `italic 400 ${Math.round(r.cam.sh * 0.11)}px ${SERIF}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(2, 8, 9, 0.55)';
        ctx.fillText('Gossamer', r.cam.sw * 0.055 + 2, r.cam.sh * 0.17 + 3);
        ctx.fillStyle = SILVER;
        ctx.fillText('Gossamer', r.cam.sw * 0.055, r.cam.sh * 0.17);
      },
    };
  },
  // The web singing: a beetle has just hit it; brightness runs out along the threads and rings spread.
  thumb2() {
    const { w, sp, site } = nightWith({ seed: 777001, garden: 'reed', r: 110, best: true, site: (wd) => ({ ...[...wd.garden.sites].sort((a, b) => b.y - a.y)[0] }) });
    dew(w, 0.4);
    const beetle = stickAt(w, 'beetle', site.x + 12, site.y - 16);
    if (beetle) beetle.st = 'subdued';
    stickAt(w, 'midge', site.x - 40, site.y + 30);
    stickAt(w, 'midge', site.x - 28, site.y + 46);
    walkTo(w, sp, site.x - 70, site.y - 20);
    for (let i = 0; i < 12; i++) stepWorld(w, {});
    const web = w.web;
    if (beetle) {
      const ns = web.ni(beetle.node);
      for (const t of web.adj[ns] ?? []) {
        web.vib[t] = 900;
        pulseFrom(web, web.tid[t], 700, 3.45);
      }
      fx.ring(beetle.x, beetle.y, 1, true);
    }
    return { zoom: 1.25, view: frame(w, sp, { site: { x: site.x, y: site.y + 20, r: 110 }, mist: 0.25 }) };
  },
  // The wren's shadow over the web; the spider drops out of its way.
  thumb3() {
    const { w, sp, site } = nightWith({ seed: 31337, garden: 'churchyard', r: 110, best: true });
    dew(w, 0.25);
    stickAt(w, 'moth', site.x + 30, site.y + 20, 1);
    walkTo(w, sp, site.x, site.y + 70);
    warnWren(w);
    w.wren.y = site.y - 10;
    w.wren.st = 'swoop';
    w.wren.dir = 1;
    w.wren.x = site.x - 170;
    w.wren.t = 0.3;
    spawnWasp(w);
    w.wasps[0].x = site.x + 160;
    w.wasps[0].y = site.y + 60;
    w.wasps[0].vx = -80;
    w.wren.x = site.x - 120;
    fx.feathers(site.x - 120, site.y - 10, 8);
    return { zoom: 1.25, view: frame(w, sp, { site: { x: site.x - 40, y: site.y + 10, r: 120 } }) };
  },
  // The icon: an orb with the spider at its hub, on deep teal (drawn in iconPoster).
  icon() {
    return null;
  },
};

/** One bold subject: a dewy orb, the spider at its hub, on a soft teal ground. */
function iconPoster(r) {
  const ctx = r.ctx;
  const S = r.cam.sw;
  ctx.setTransform(r.pr, 0, 0, r.pr, 0, 0);
  const g = ctx.createRadialGradient(S * 0.4, S * 0.34, S * 0.04, S / 2, S / 2, S * 0.74);
  g.addColorStop(0, '#2a6062');
  g.addColorStop(0.55, '#133537');
  g.addColorStop(1, '#08171a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.translate(S / 2, S / 2);
  const R = S * 0.37;
  const spokes = 14;
  const ang = (k) => (k / spokes) * Math.PI * 2 - Math.PI / 2 + 0.05;
  // Frame lines out to the edges, then spokes, then the spiral, then dew.
  ctx.strokeStyle = 'rgba(230, 238, 232, 0.55)';
  ctx.lineWidth = S * 0.004;
  ctx.beginPath();
  for (let k = 0; k < spokes; k++) {
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(ang(k)) * R * 1.02, Math.sin(ang(k)) * R * 1.02);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(236, 242, 238, 0.85)';
  ctx.lineWidth = S * 0.0032;
  ctx.beginPath();
  let first = true;
  for (let turn = 0; turn < 8.6; turn += 1 / spokes) {
    const k = Math.round(turn * spokes) % spokes;
    const rad = R * (0.16 + 0.1 * turn);
    if (rad > R * 0.98) break;
    const x = Math.cos(ang(k)) * rad;
    const y = Math.sin(ang(k)) * rad;
    if (first) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    first = false;
  }
  ctx.stroke();
  let h = 7;
  for (let i = 0; i < 160; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const turn = ((h >>> 8) % 1000) / 1000 * 8;
    const k = (h >>> 3) % spokes;
    const f = ((h >>> 16) % 100) / 100;
    const r1 = R * (0.16 + 0.1 * turn);
    const r2 = R * (0.16 + 0.1 * (turn + 1 / spokes));
    if (r2 > R * 0.97) continue;
    const x = Math.cos(ang(k)) * r1 * (1 - f) + Math.cos(ang(k + 1)) * r2 * f;
    const y = Math.sin(ang(k)) * r1 * (1 - f) + Math.sin(ang(k + 1)) * r2 * f;
    const sz = S * (0.004 + ((h >>> 24) % 5) * 0.0012);
    ctx.fillStyle = 'rgba(214, 236, 230, 0.75)';
    ctx.beginPath();
    ctx.arc(x, y + sz * 0.5, sz, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(x - sz * 0.45, y - sz * 0.1, sz * 0.4, sz * 0.4);
  }
  iconSpider(ctx, 0, S * 0.01, S / 512);
  window.__posterReady = true;
}

/** The spider as a mark: head down at the hub, legs out in pairs, moon on its back. */
function iconSpider(ctx, x, y, k) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const legs = [
    [-0.62, 58, 74, -1], [-0.22, 52, 62, -1], [0.3, 48, 56, -1], [0.75, 56, 70, -1],
    [-0.62, 58, 74, 1], [-0.22, 52, 62, 1], [0.3, 48, 56, 1], [0.75, 56, 70, 1],
  ];
  for (const pass of [0, 1]) {
    for (const [a, l1, l2, side] of legs) {
      const hx = side * 8;
      const hy = 4 + a * 10;
      const kx = hx + side * Math.cos(a) * l1;
      const ky = hy + Math.sin(a) * l1 - 18;
      const fx = kx + side * Math.cos(a + 0.9) * l2;
      const fy = ky + Math.sin(a + 0.9) * l2 * 1.1 + 10;
      ctx.strokeStyle = pass === 0 ? 'rgba(230, 238, 232, 0.45)' : '#0b1415';
      ctx.lineWidth = pass === 0 ? 9 : 5.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#0b1415';
  ctx.beginPath();
  ctx.ellipse(0, 34, 26, 32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -8, 15, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  // The folium on its back, pale like the moon.
  ctx.fillStyle = 'rgba(223, 232, 226, 0.85)';
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.quadraticCurveTo(15, 32, 0, 60);
  ctx.quadraticCurveTo(-15, 32, 0, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230, 238, 232, 0.6)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 34, 26, -2.5, -0.65);
  ctx.stroke();
  ctx.fillStyle = AMBER;
  for (const [ex, ey, er] of [[-5, -15, 3.2], [5, -15, 3.2], [-10, -10, 2], [10, -10, 2]]) {
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the notebook page (thumb 4)
async function notebookPoster(canvas) {
  const r = new Renderer(canvas);
  r.resize(innerWidth, innerHeight, Math.min(2, window.devicePixelRatio || 1));
  const { w, sp } = nightWith({ seed: 99, garden: 'cottage', r: 110 });
  for (let i = 0; i < 20; i++) r.draw({ ...frame(w, sp), t: 2, dt: 1 / 60, dim: 0.35, snap: i < 2 });
  const { Notebook } = await import('../app/notebook.js');
  const fakeSeason = {
    v: 1, sid: 'poster', seed: 5, mode: 'season', garden: 'cottage', cold: 0, night: 4, lives: 2, over: false, score: 0, food: 120,
    history: [{ n: 3, food: 41, quota: 30, met: true, g: 'cottage', rain: false, mist: true, swoops: 1, stolen: 1, mantis: false, top: 'moth' }],
    roster: { me: { sp: 'orb', up: { glands: 1, droplets: 2, strong: 1 }, tr: ['nightowl', 'taut'], mp: 23, earned: 40, food: 120, nights: 3, draft: ['lantern', 'quickwrap', 'feast'], silk: 60 } },
  };
  const game = {
    me: 'me',
    room: { state: { season: fakeSeason, result: { mid: 'x', t: { eaten: { gnat: 9, fly: 4, moth: 3, beetle: 1 }, rain: false, mist: true, gusts: 1, swoops: 1, stolen: 1, mantisOff: false, lostFood: 0 }, out: { moult: { me: 11 } } } }, players: new Map([['me', { id: 'me', name: 'You' }]]), host: 'me', match: { phase: 'lobby' } },
    season: () => fakeSeason,
    amHost: () => true,
    profile: { eggs: 0, unlocked: { species: ['orb', 'jumper'], gardens: ['cottage', 'reed'], colours: ['silver'], dews: ['round'], stickers: [] }, cold: 0, hatchlings: [], equip: { colour: 'silver' } },
    nightSeed: () => 1234,
    request: () => {},
  };
  const nb = new Notebook(game);
  nb.mount(document.getElementById('ui'), false);
  setTimeout(() => (window.__posterReady = true), 600);
}

// ---------------------------------------------------------------- badges, drawn as small emblems
const BADGES = {
  'first-catch': (c) => {
    line(c, -60, -80, 60, -70, 1.4);
    cocoon(c, 0, 0, 1.6);
  },
  'orb-complete': (c) => orb(c, 0, 0, 78, 8, 5),
  'perfect-radials': (c) => {
    orb(c, 0, 0, 80, 12, 0);
    c.fillStyle = AMBER;
    c.beginPath();
    c.arc(0, 0, 7, 0, Math.PI * 2);
    c.fill();
  },
  'moth-hunter': (c) => critter(c, 'moth', 5.2, 4, 'fly'),
  'beetle-buster': (c) => {
    line(c, -84, 40, 84, 40, 4);
    critter(c, 'beetle', 5, 8);
  },
  'wren-dodge': (c) => {
    c.fillStyle = '#2b1d16';
    c.beginPath();
    c.ellipse(-8, -26, 46, 26, -0.1, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(-50, -30);
    c.lineTo(-80, -64);
    c.lineTo(-66, -22);
    c.fill();
    line(c, 40, -90, 40, 40, 1.2);
    spiderMark(c, 40, 52, 1.1);
  },
  'wasp-slayer': (c) => {
    c.save();
    c.scale(5, 5);
    drawWasp(c, { x: 0, y: -4, vx: 1, vy: 0, st: 'patrol' }, 0.3);
    c.restore();
    c.strokeStyle = RUST;
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(-70, 60);
    c.lineTo(70, -60);
    c.stroke();
  },
  'ten-nights': (c) => {
    c.fillStyle = '#e9efe6';
    c.beginPath();
    c.arc(0, 0, 40, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      c.fillStyle = AMBER;
      c.beginPath();
      c.arc(Math.cos(a) * 72, Math.sin(a) * 72, 6, 0, Math.PI * 2);
      c.fill();
    }
  },
  'daily-weaver': (c) => {
    orb(c, 0, 10, 62, 8, 4);
    c.strokeStyle = AMBER;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(0, -64, 22, Math.PI, 0);
    c.stroke();
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i / 4) * Math.PI;
      line(c, Math.cos(a) * 30, -64 + Math.sin(a) * 30, Math.cos(a) * 40, -64 + Math.sin(a) * 40, 3, AMBER);
    }
  },
  'silk-donor': (c) => {
    spiderMark(c, -50, 10, 1.1);
    spiderMark(c, 50, 10, 1.1);
    c.strokeStyle = SILVER;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-36, 6);
    c.quadraticCurveTo(0, -40, 36, 6);
    c.stroke();
  },
  'dew-master': (c) => {
    line(c, -84, -10, 84, 20, 1.4);
    for (let i = 0; i < 6; i++) {
      const x = -60 + i * 24;
      const y = -6 + i * 4.5 + 6;
      c.fillStyle = 'rgba(214, 236, 230, 0.9)';
      c.beginPath();
      c.arc(x, y, 7 + (i % 3) * 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.fillRect(x - 3, y - 4, 3, 3);
    }
  },
  'mantis-off': (c) => {
    c.strokeStyle = '#8eaa9c';
    c.fillStyle = '#8eaa9c';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-40, 40);
    c.lineTo(10, -10);
    c.lineTo(30, -50);
    c.stroke();
    c.beginPath();
    c.moveTo(30, -50);
    c.lineTo(54, -40);
    c.lineTo(40, -26);
    c.fill();
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(14, -18);
    c.lineTo(44, -6);
    c.lineTo(58, 16);
    c.stroke();
    line(c, -84, 70, -20, 70, 2);
    line(c, 4, 74, 84, 66, 2);
  },
};

function badge(canvas, id) {
  const S = 256;
  canvas.style.width = `${S}px`;
  canvas.style.height = `${S}px`;
  canvas.width = S;
  canvas.height = S;
  document.body.style.background = 'transparent';
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, S, S);
  c.save();
  c.translate(S / 2, S / 2);
  // The frame every badge shares: a deep teal disc, a silver rim, a faint web behind.
  const g = c.createRadialGradient(-30, -40, 10, 0, 0, 124);
  g.addColorStop(0, '#1d4a49');
  g.addColorStop(1, '#0a1e20');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 122, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = rgba(SILVER, 0.85);
  c.lineWidth = 4;
  c.stroke();
  c.strokeStyle = rgba(SILVER, 0.25);
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(0, 0, 112, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = 0.12;
  orb(c, 0, 0, 108, 12, 6);
  c.globalAlpha = 1;
  (BADGES[id] ?? BADGES['orb-complete'])(c);
  c.restore();
  window.__posterReady = true;
}

function line(c, x0, y0, x1, y1, w, col = SILVER) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

function orb(c, x, y, R, spokes, rings) {
  c.strokeStyle = SILVER;
  c.lineWidth = 2;
  c.beginPath();
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
  }
  c.stroke();
  c.lineWidth = 1.4;
  for (let j = 1; j <= rings; j++) {
    const r = (R * (j + 0.4)) / (rings + 1);
    c.beginPath();
    for (let k = 0; k <= spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      if (k === 0) c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.stroke();
  }
}

function cocoon(c, x, y, s) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.fillStyle = '#dfe6de';
  c.beginPath();
  c.ellipse(0, 0, 22, 40, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(120, 140, 135, 0.7)';
  c.lineWidth = 1.5;
  for (let k = -3; k <= 3; k++) {
    c.beginPath();
    c.moveTo(-21, k * 10);
    c.lineTo(21, k * 10 + 8);
    c.stroke();
  }
  c.restore();
}

function critter(c, sp, s, dy, st = 'land') {
  c.save();
  c.translate(0, dy);
  c.scale(s, s);
  drawPrey(c, { sp, st, x: 0, y: 0, vx: 1, vy: 0, facing: 1, id: 4, wrap: 0 }, 0.05, 'high');
  c.restore();
}

function spiderMark(c, x, y, s) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.strokeStyle = '#0e1718';
  c.lineWidth = 3;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const a = -0.9 + k * 0.6;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(side * 18 * Math.cos(a), 18 * Math.sin(a) - 6);
      c.lineTo(side * 28 * Math.cos(a), 18 * Math.sin(a) + 10);
      c.stroke();
    }
  }
  c.fillStyle = '#0e1718';
  c.beginPath();
  c.ellipse(0, 6, 11, 14, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(0, -10, 7, 6, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = rgba(SILVER, 0.6);
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(0, 6, 11, -2.6, -0.5);
  c.stroke();
  c.fillStyle = AMBER;
  c.fillRect(-3, -13, 2, 2);
  c.fillRect(1, -13, 2, 2);
  c.restore();
}

export { ball, glyph, PAPER };
