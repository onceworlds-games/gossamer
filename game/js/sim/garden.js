// Gardens: the branches, rails and stems a night's web hangs from, made from a seed. Every garden is one connected
// walkable graph (the ground joins everything), has a Retreat, prey lanes that cross open air with anchors on both
// sides, and at least one good web site on the main lane. generateGarden() repairs a seed that fails those checks.
import { makeRng, range, int, chance, pick, rand, mix } from './rng.js';
import { W, H, GROUND, T_SURFACE, N_ANCHOR, GARDEN_KEYS, GARDEN_IDS } from './data.js';
import { crossing } from './web.js';

class Builder {
  constructor(id, rng) {
    this.id = id;
    this.rng = rng;
    this.surfaces = []; // { pts: [[x, y]], kind, flex, root: [si, pi] | null, w0, w1, sway: [], phase, solid }
    this.cover = []; // ellipses { x, y, rx, ry }
    this.lanes = []; // { pts: [[x, y]], w, share }
    this.lights = []; // { x, y, r, kind: 'fireflies' | 'lamp', power }
    this.decor = []; // { k, si, pi, a, s, x, y }
    this.water = null;
    this.retreat = null;
    this.start = null;
  }

  surface(pts, o = {}) {
    const root = o.root ?? null;
    if (root) pts[0] = this.point(root[0], root[1]).slice();
    const s = { pts, kind: o.kind ?? 'stem', flex: o.flex ?? 0, root, w0: o.w0 ?? 4, w1: o.w1 ?? 1.5, phase: o.phase ?? range(this.rng, 0, 6.28), solid: !!o.solid, sway: [] };
    // Sway grows with the path length from where the plant is held.
    const base = root ? this.surfaces[root[0]].sway[root[1]] : 0;
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      s.sway.push(i === 0 ? base : base + Math.min(42, s.flex * 7 * (along / 100) ** 1.25));
    }
    this.surfaces.push(s);
    return this.surfaces.length - 1;
  }

  point(si, pi) {
    const s = this.surfaces[si];
    return s.pts[Math.max(0, Math.min(s.pts.length - 1, pi))];
  }
  last(si) {
    return this.surfaces[si].pts.length - 1;
  }
  /** Index of the point of surface si nearest to x (for rooting plants on the ground). */
  nearest(si, x, y = null) {
    const pts = this.surfaces[si].pts;
    let best = 0;
    let bd = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p[0] - x) + (y === null ? 0 : Math.abs(p[1] - y));
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  deco(k, si, pi, a = 0, s = 1, extra = {}) {
    this.decor.push({ k, si, pi, a, s, ...extra });
  }
}

/** A bending path: start, heading (radians; -PI/2 is up), length, total bend, segment count. */
function path(x, y, angle, len, bend, segs, wobble = 0, rng = null) {
  const pts = [[x, y]];
  let a = angle;
  const step = len / segs;
  for (let i = 1; i <= segs; i++) {
    a += bend / segs + (rng && wobble ? range(rng, -wobble, wobble) : 0);
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  return pts;
}

/** Straight polyline with a point every `step` px (so other things can grow from it). */
function line(x0, y0, x1, y1, step = 64) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  return pts;
}

function ground(b, y0 = GROUND, rough = 10, from = -30, to = W + 30) {
  const pts = [];
  for (let x = from; x <= to + 1; x += 64) pts.push([x, y0 + Math.sin(x * 0.006 + b.rng.s * 1e-9) * rough + range(b.rng, -3, 3)]);
  return b.surface(pts, { kind: 'ground', flex: 0, w0: 0, w1: 0 });
}

/** A stem from the ground with leaves, returning its surface index. */
function stem(b, g, x, height, o = {}) {
  const r = b.rng;
  const gi = b.nearest(g, x);
  const p = b.point(g, gi);
  const segs = o.segs ?? Math.max(3, Math.round(height / 70));
  const pts = path(p[0], p[1], -Math.PI / 2 + range(r, -0.12, 0.12) + (o.lean ?? 0), height, o.bend ?? range(r, -0.35, 0.35), segs, 0.05, r);
  const si = b.surface(pts, { kind: o.kind ?? 'stem', flex: o.flex ?? 1, root: [g, gi], w0: o.w0 ?? 4, w1: o.w1 ?? 1.6 });
  return si;
}

/** A side twig growing from point pi of surface si. */
function twig(b, si, pi, angle, len, o = {}) {
  const p = b.point(si, pi);
  const segs = o.segs ?? Math.max(1, Math.round(len / 60));
  const pts = path(p[0], p[1], angle, len, o.bend ?? range(b.rng, -0.4, 0.4), segs, 0.06, b.rng);
  const t = b.surface(pts, { kind: o.kind ?? 'twig', flex: o.flex ?? 1.1, root: [si, pi], w0: o.w0 ?? 2.6, w1: o.w1 ?? 1 });
  if (o.leaf !== false) b.deco(o.tip ?? 'leaf', t, b.last(t), angle, o.leafSize ?? range(b.rng, 0.8, 1.25));
  return t;
}

function lane(b, pts, w, share) {
  b.lanes.push({ pts, w, share });
}

// ---------------------------------------------------------------- the four gardens
function cottage(b) {
  const r = b.rng;
  const g = ground(b);
  // The hedge: a dense mass on the left with a woody spine and twigs poking out of its face.
  const hx = range(r, 150, 230);
  const htop = range(r, 330, 420);
  b.cover.push({ x: hx * 0.45, y: (htop + GROUND) / 2, rx: hx * 0.75 + 40, ry: (GROUND - htop) / 2 + 30 });
  const spine = b.surface(path(b.point(g, b.nearest(g, hx * 0.55))[0], b.point(g, b.nearest(g, hx * 0.55))[1], -Math.PI / 2 - 0.05, GROUND - htop + 10, 0.1, 7, 0.05, r), { kind: 'trunk', root: [g, b.nearest(g, hx * 0.55)], flex: 0.15, w0: 9, w1: 4 });
  const ntw = int(r, 4, 6);
  for (let i = 0; i < ntw; i++) {
    const pi = 1 + Math.floor(((i + 0.5) / ntw) * (b.last(spine) - 1));
    const t = twig(b, spine, pi, range(r, -0.75, 0.15), range(r, 110, 190), { flex: 0.7, kind: 'twig' });
    if (i === 1) b.retreat = { si: t, pi: Math.max(1, b.last(t) - 1) };
    if (i === ntw - 1 || i === 2) twig(b, t, b.last(t) - 1 >= 1 ? b.last(t) - 1 : 1, range(r, -1.4, -0.6), range(r, 50, 80), { flex: 1 });
  }
  b.start = { si: spine, pi: Math.floor(b.last(spine) * 0.6) };
  // Tall flower stems in the border: they sway, so a web hung on them moves.
  const ns = int(r, 2, 3);
  for (let i = 0; i < ns; i++) {
    const x = range(r, 360, 620) + i * range(r, 90, 140);
    const s = stem(b, g, x, range(r, 380, 560), { flex: 1.1 });
    b.deco('flower', s, b.last(s), -Math.PI / 2, range(r, 1, 1.4));
    for (let k = 2; k < b.last(s); k += 2) twig(b, s, k, chance(r, 0.5) ? range(r, -0.9, -0.3) : range(r, -2.8, -2.2), range(r, 40, 70), { flex: 1.3, leafSize: 0.9 });
  }
  // A rose bush with an arching cane.
  const rx = range(r, 860, 1000);
  b.cover.push({ x: rx, y: GROUND - 70, rx: 110, ry: 80 });
  const cane = stem(b, g, rx, range(r, 420, 520), { lean: range(r, 0.3, 0.55), bend: range(r, 0.9, 1.3), flex: 0.9, kind: 'cane', segs: 8, w0: 5 });
  for (let k = 2; k <= b.last(cane); k += 2) twig(b, cane, k, range(r, -2.4, -0.6), range(r, 40, 75), { flex: 1, tip: chance(r, 0.4) ? 'rose' : 'leaf' });
  // The picket fence: posts and a top rail (stiff: nothing on it sways).
  const fx0 = range(r, 1180, 1260);
  const railY = range(r, 600, 680);
  const posts = [];
  for (let x = fx0; x < W + 40; x += 150) {
    const gi = b.nearest(g, x);
    const p = b.point(g, gi);
    posts.push(b.surface([p.slice(), [p[0], railY]], { kind: 'post', root: [g, gi], w0: 10, w1: 10 }));
  }
  const rp = b.point(posts[0], 1);
  const railPts = [rp.slice()];
  for (let k = 1; k < posts.length; k++) railPts.push(b.point(posts[k], 1).slice());
  railPts.push([W + 40, railY]);
  b.surface(railPts, { kind: 'rail', root: [posts[0], 1], w0: 7, w1: 7 });
  for (let x = fx0 + 18; x < W + 20; x += 26) b.decor.push({ k: 'picket', x, y: railY - 34, s: 1 });
  // The washing line, high across the garden, with pegs as anchors.
  const ly = range(r, 200, 270);
  const lx0 = range(r, 300, 420);
  const lx1 = range(r, 1240, 1400);
  const poleA = b.surface([b.point(g, b.nearest(g, lx0)).slice(), [lx0, ly]], { kind: 'pole', root: [g, b.nearest(g, lx0)], w0: 4, w1: 3.4 });
  const poleB = b.surface([b.point(g, b.nearest(g, lx1)).slice(), [lx1, ly - 10]], { kind: 'pole', root: [g, b.nearest(g, lx1)], w0: 4, w1: 3.4 });
  const linePts = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    linePts.push([lx0 + (lx1 - lx0) * t, ly + (ly - 10 - ly) * t + Math.sin(t * Math.PI) * 38]);
  }
  linePts[8] = b.point(poleB, 1).slice();
  const wline = b.surface(linePts, { kind: 'line', root: [poleA, 1], flex: 0.35, w0: 1.6, w1: 1.6 });
  for (let k = 2; k < 8; k += 3) b.deco('peg', wline, k);
  // Lanes: the main one runs from the hedge gap toward the kitchen light, past the flower stems.
  const mainY = range(r, 400, 520);
  lane(b, [[-60, mainY - 40], [500, mainY + range(r, -30, 30)], [900, mainY - range(r, 10, 60)], [W + 60, range(r, 300, 380)]], 70, 0.6);
  lane(b, [[W + 60, range(r, 700, 780)], [1000, range(r, 740, 800)], [400, range(r, 700, 760)], [-60, range(r, 640, 720)]], 80, 0.28);
  lane(b, [[range(r, 700, 1000), -60], [rx + range(r, -60, 60), GROUND - 260], [rx + 300, -60]], 60, 0.12);
  b.lights.push({ x: W - 60, y: range(r, 250, 330), r: 70, kind: 'window', power: 0.8 });
  b.lights.push({ x: range(r, 560, 820), y: range(r, 640, 760), r: 120, kind: 'fireflies', power: 0.6 });
}

function reed(b) {
  const r = b.rng;
  // Banks either side and the pond in the middle: falling in the water floats you to a bank.
  b.water = { y: GROUND - 60, x0: range(r, 300, 380), x1: range(r, 1200, 1300) };
  const g = ground(b, GROUND, 6);
  // Over the pond the "ground" is the water's skin: lily pads and floating weed you can walk on.
  for (const p of b.surfaces[g].pts) if (p[0] > b.water.x0 + 10 && p[0] < b.water.x1 - 10) p[1] = b.water.y + 4 + Math.sin(p[0] * 0.05) * 2;
  for (let x = b.water.x0 + 30; x < b.water.x1 - 20; x += range(r, 40, 80)) b.decor.push({ k: 'pad', x, y: b.water.y + 4, s: range(r, 0.8, 1.3) });
  // Reeds and rushes rise out of the water: tall, thin, and they bend a lot in wind.
  const n = int(r, 9, 12);
  for (let i = 0; i < n; i++) {
    const x = range(r, 80, W - 80);
    const s = stem(b, g, x, range(r, 330, 640), { flex: 1.6, kind: 'reed', w0: 3.2, w1: 1.1, bend: range(r, -0.2, 0.2), segs: 6 });
    b.deco(chance(r, 0.5) ? 'cattail' : 'seedhead', s, b.last(s), -Math.PI / 2, range(r, 0.9, 1.3));
    if (chance(r, 0.45)) twig(b, s, int(r, 2, 4), range(r, -1.2, -0.5) + (chance(r, 0.5) ? 0 : -1.6), range(r, 60, 110), { kind: 'blade', flex: 1.8, leaf: false, w0: 2.4, w1: 0.6 });
  }
  b.cover.push({ x: 120, y: GROUND - 60, rx: 160, ry: 90 });
  b.cover.push({ x: W - 120, y: GROUND - 60, rx: 160, ry: 90 });
  // A willow bough hangs in from the top left: drooping twigs, good high anchors.
  const by0 = range(r, 80, 140);
  const trunk = b.surface(line(b.point(g, 0)[0], b.point(g, 0)[1], -20, by0, 90), { kind: 'trunk', root: [g, 0], w0: 16, w1: 10 });
  const bough = b.surface(path(-20, by0, range(r, 0.05, 0.25), range(r, 520, 640), 0.3, 7, 0.04, r), { kind: 'bough', root: [trunk, b.last(trunk)], flex: 0.35, w0: 9, w1: 3 });
  for (let k = 1; k <= b.last(bough); k++) twig(b, bough, k, Math.PI / 2 + range(r, -0.35, 0.25), range(r, 90, 200), { kind: 'willow', flex: 1.4, tip: 'willowleaf' });
  // A jetty post on the right, stiff.
  const jx = range(r, 1320, 1460);
  const jg = b.point(g, b.nearest(g, jx));
  const jp = b.surface(line(jg[0], jg[1], jx, GROUND - range(r, 230, 300), 70), { kind: 'post', root: [g, b.nearest(g, jx)], w0: 14, w1: 12 });
  b.retreat = { si: twig(b, jp, b.last(jp), -0.5, 60, { flex: 0.4, kind: 'twig' }), pi: 1 };
  b.start = { si: jp, pi: b.last(jp) };
  lane(b, [[-60, range(r, 480, 560)], [600, range(r, 520, 600)], [1100, range(r, 480, 560)], [W + 60, range(r, 520, 600)]], 75, 0.55);
  lane(b, [[W + 60, range(r, 760, 820)], [800, range(r, 800, 840)], [-60, range(r, 770, 830)]], 60, 0.3);
  lane(b, [[range(r, 500, 900), -60], [range(r, 700, 1000), 500], [range(r, 900, 1300), -60]], 60, 0.15);
  b.lights.push({ x: range(r, 600, 1000), y: GROUND - 120, r: 140, kind: 'fireflies', power: 0.5 });
}

function greenhouse(b) {
  const r = b.rng;
  const g = ground(b, GROUND, 2);
  // The frame: glass walls and a pitched roof (glass is solid to prey: moths bat against it). Each wall has an open
  // vent where the night comes in.
  const wl = range(r, 70, 110);
  const wr = W - range(r, 70, 110);
  const eave = range(r, 330, 380);
  const ridge = range(r, 70, 110);
  const yL = range(r, 430, 500);
  const yR = range(r, 520, 600);
  const gl = b.point(g, b.nearest(g, wl));
  const gr = b.point(g, b.nearest(g, wr));
  b.surface(line(gl[0], gl[1], wl, yL + 44, 90), { kind: 'glass', root: [g, b.nearest(g, wl)], solid: true, w0: 5, w1: 5 });
  b.surface(line(gr[0], gr[1], wr, yR + 44, 90), { kind: 'glass', root: [g, b.nearest(g, wr)], solid: true, w0: 5, w1: 5 });
  const leftUp = b.surface(line(wl, yL - 44, wl, eave, 90), { kind: 'glass', solid: true, w0: 5, w1: 5 });
  const rightUp = b.surface(line(wr, yR - 44, wr, eave, 90), { kind: 'glass', solid: true, w0: 5, w1: 5 });
  const roofL = b.surface(line(wl, eave, (wl + wr) / 2, ridge, 64), { kind: 'glass', root: [leftUp, b.last(leftUp)], solid: true, w0: 5, w1: 5 });
  const roofPts = line(wr, eave, (wl + wr) / 2, ridge, 64);
  roofPts[roofPts.length - 1] = b.point(roofL, b.last(roofL)).slice();
  const roofR = b.surface(roofPts, { kind: 'glass', root: [rightUp, b.last(rightUp)], solid: true, w0: 5, w1: 5 });
  // Glazing bars: stiff struts from the floor up to a roof joint (that is what holds the roof up).
  for (let k = 1; k <= 3; k++) {
    const x = wl + ((wr - wl) * k) / 4;
    const gi = b.nearest(g, x);
    const roof = x < (wl + wr) / 2 ? roofL : roofR;
    const top = b.point(roof, b.nearest(roof, x));
    b.surface([b.point(g, gi).slice(), [top[0], (top[1] + GROUND) / 2], top.slice()], { kind: 'bar', root: [g, gi], w0: 4, w1: 4 });
  }
  // The staging bench and pots of tomatoes on stakes.
  const bench = range(r, 690, 740);
  const gb = b.point(g, b.nearest(g, 300));
  const legA = b.surface([gb.slice(), [300, bench]], { kind: 'post', root: [g, b.nearest(g, 300)], w0: 7, w1: 7 });
  const benchS = b.surface(line(300, bench, 1300, bench, 50), { kind: 'bench', root: [legA, 1], w0: 9, w1: 9 });
  const gb2 = b.point(g, b.nearest(g, 1300));
  b.surface([gb2.slice(), b.point(benchS, b.last(benchS)).slice()], { kind: 'post', root: [g, b.nearest(g, 1300)], w0: 7, w1: 7 });
  for (let x = 380; x < 1260; x += range(r, 170, 230)) {
    const bi = b.nearest(benchS, x);
    const bx = b.point(benchS, bi)[0];
    b.decor.push({ k: 'pot', x: bx, y: bench, s: 1 });
    const stake = b.surface([[bx, bench], [bx + range(r, -6, 6), bench - 70], [bx + range(r, -6, 6), bench - range(r, 260, 380)]], { kind: 'stake', root: [benchS, bi], w0: 3, w1: 3 });
    const vine = b.surface(path(bx, bench - 70, -Math.PI / 2 + range(r, -0.5, 0.5), range(r, 160, 260), range(r, -0.8, 0.8), 4, 0.15, r), { kind: 'vine', root: [stake, 1], flex: 1, w0: 2.4, w1: 1 });
    for (let k = 1; k <= b.last(vine); k++) b.deco(chance(r, 0.4) ? 'tomato' : 'leaf', vine, k, range(r, -3, 0), range(r, 0.8, 1.2));
  }
  // Two hanging lamps: moths come for them.
  for (const lx of [range(r, 420, 640), range(r, 960, 1180)]) {
    const roof = lx < (wl + wr) / 2 ? roofL : roofR;
    const rs = b.nearest(roof, lx);
    const rp = b.point(roof, rs);
    const chain = b.surface([rp.slice(), [rp[0], rp[1] + range(r, 120, 180)]], { kind: 'chain', root: [roof, rs], flex: 0.25, w0: 1.5, w1: 1.5 });
    const p = b.point(chain, 1);
    b.lights.push({ x: p[0], y: p[1] + 18, r: 90, kind: 'lamp', power: 1.2 });
    b.deco('lamp', chain, 1);
  }
  b.cover.push({ x: 160, y: GROUND - 50, rx: 120, ry: 70 });
  b.retreat = { si: legA, pi: 1 };
  b.start = { si: benchS, pi: 0 };
  // Every lane comes in and goes out through a vent.
  lane(b, [[-60, yL], [wl + 40, yL], [700, range(r, 380, 460)], [1100, range(r, 420, 520)], [wr - 40, yR], [W + 60, yR]], 70, 0.55);
  lane(b, [[W + 60, yR], [wr - 40, yR], [800, range(r, 560, 620)], [wl + 40, yL], [-60, yL]], 60, 0.3);
  lane(b, [[-60, yL], [wl + 40, yL], [range(r, 400, 700), range(r, 260, 340)], [range(r, 800, 1200), range(r, 280, 360)], [wr - 40, yR], [W + 60, yR]], 50, 0.15);
}

function churchyard(b) {
  const r = b.rng;
  const g = ground(b, GROUND, 14);
  // Gravestones: stiff slabs; their outlines are walkable and their tops are steady anchors.
  const n = int(r, 3, 5);
  for (let i = 0; i < n; i++) {
    const x = 380 + i * range(r, 220, 280);
    if (x > W - 200) break;
    const w = range(r, 70, 110);
    const h = range(r, 140, 230);
    const gi = b.nearest(g, x);
    const p = b.point(g, gi);
    const end = b.point(g, b.nearest(g, x + w));
    const xr = end[0] > p[0] + 20 ? end[0] : p[0] + 64;
    b.surface([p.slice(), [p[0], p[1] - h], [(p[0] + xr) / 2, p[1] - h - (xr - p[0]) * 0.32], [xr, p[1] - h], end[0] === xr ? end.slice() : [xr, p[1] - 1]], { kind: 'stone', root: [g, gi], w0: 3, w1: 3 });
    b.decor.push({ k: 'grave', x: p[0], y: p[1], w: xr - p[0], h, s: chance(r, 0.5) ? 1 : 0 });
  }
  // The yew: a huge dark mass top left, drooping branchlets everywhere (cover inside).
  const trunkX = range(r, 120, 200);
  const trunk = stem(b, g, trunkX, range(r, 620, 700), { kind: 'trunk', flex: 0.08, w0: 24, w1: 10, bend: 0.15, segs: 6 });
  b.cover.push({ x: trunkX + 60, y: 330, rx: 260, ry: 210 });
  for (let k = 2; k <= b.last(trunk); k++) {
    const bough = twig(b, trunk, k, range(r, -0.5, 0.35), range(r, 160, 300), { kind: 'bough', flex: 0.5, w0: 6, w1: 2, leaf: false });
    for (let j = 1; j <= b.last(bough); j++) twig(b, bough, j, Math.PI / 2 + range(r, -0.5, 0.2), range(r, 50, 110), { kind: 'yew', flex: 1.2, tip: 'yew' });
  }
  b.retreat = { si: trunk, pi: 2 };
  b.start = { si: trunk, pi: 3 };
  // An iron railing on the right: spiked, stiff, tall.
  const rx0 = range(r, 1250, 1350);
  const rail = [];
  const railTop = GROUND - range(r, 300, 330);
  for (let x = rx0; x < W + 30; x += 64) {
    const gi = b.nearest(g, x);
    const gp = b.point(g, gi);
    rail.push(b.surface([gp.slice(), [gp[0], railTop]], { kind: 'iron', root: [g, gi], w0: 4, w1: 4 }));
    b.deco('spike', rail[rail.length - 1], 1);
  }
  const barPts = rail.map((si) => b.point(si, 1).slice());
  b.surface(barPts, { kind: 'iron', root: [rail[0], 1], w0: 4, w1: 4 });
  // Long grass tufts between the stones.
  for (let i = 0; i < 6; i++) {
    const s = stem(b, g, range(r, 300, 1250), range(r, 120, 220), { kind: 'grass', flex: 1.7, w0: 2, w1: 0.6, segs: 3 });
    b.deco('grasshead', s, b.last(s), -Math.PI / 2, 1);
  }
  lane(b, [[-60, range(r, 520, 620)], [600, range(r, 560, 640)], [1100, range(r, 520, 600)], [W + 60, range(r, 480, 560)]], 75, 0.55);
  lane(b, [[W + 60, range(r, 760, 820)], [700, range(r, 760, 820)], [-60, range(r, 760, 820)]], 60, 0.3);
  lane(b, [[range(r, 600, 900), -60], [range(r, 800, 1100), 620], [range(r, 1000, 1400), -60]], 60, 0.15);
  b.lights.push({ x: range(r, 600, 1000), y: range(r, 700, 800), r: 100, kind: 'fireflies', power: 0.5 });
}

const MAKERS = { cottage, reed, greenhouse, churchyard };

// ---------------------------------------------------------------- generation, checks and repair
export function generateGarden(id, seed) {
  const key = GARDEN_KEYS.includes(id) ? id : 'cottage';
  for (let attempt = 0; attempt < 12; attempt++) {
    const b = new Builder(key, makeRng(mix(seed >>> 0, attempt * 7919 + key.length)));
    MAKERS[key](b);
    const g = finish(b, seed, attempt);
    if (validate(g).ok) return g;
  }
  // Fall back to a cottage made from a fixed seed, which the tests show is always valid.
  const b = new Builder('cottage', makeRng(12345));
  cottage(b);
  return finish(b, 12345, 99);
}

function finish(b, seed, attempt) {
  // Clamp every point into the world, so nothing grows into the void.
  for (const s of b.surfaces) for (const p of s.pts) {
    p[0] = Math.max(-40, Math.min(W + 40, p[0]));
    p[1] = Math.max(30, Math.min(H - 10, p[1]));
  }
  const g = {
    id: b.id, seed: seed >>> 0, attempt, surfaces: b.surfaces, cover: b.cover, lanes: b.lanes, lights: b.lights, decor: b.decor, water: b.water,
    retreat: b.retreat, start: b.start,
  };
  g.sites = findSites(g);
  return g;
}

/**
 * Gives every surface point a node key; points of different surfaces closer than 3 px are one node (that is how a
 * line ends on a pole or a roof meets at the ridge). Returns rows of keys and the key positions.
 */
function nodeKeys(g) {
  const keys = [];
  const pos = [];
  for (let si = 0; si < g.surfaces.length; si++) {
    const s = g.surfaces[si];
    const row = [];
    for (let pi = 0; pi < s.pts.length; pi++) {
      if (pi === 0 && s.root && keys[s.root[0]]) {
        row.push(keys[s.root[0]][Math.min(s.root[1], keys[s.root[0]].length - 1)]);
        continue;
      }
      const [x, y] = s.pts[pi];
      // A point right on top of the previous one adds nothing but a sliver of a branch: skip it.
      const prev = row.length ? pos[row[row.length - 1]] : null;
      if (prev && Math.hypot(prev[0] - x, prev[1] - y) < 6 && pi < s.pts.length - 1) continue;
      let k = -1;
      for (let j = 0; j < pos.length; j++) {
        if (Math.abs(pos[j][0] - x) < 5 && Math.abs(pos[j][1] - y) < 5 && pos[j][2] !== si) {
          k = j;
          break;
        }
      }
      if (k < 0) {
        k = pos.length;
        pos.push([x, y, si, s.sway[pi], s.phase]);
      }
      row.push(k);
    }
    keys.push(row);
  }
  return { keys, pos };
}

/** Branch kinds a cast line snags on (thin foliage lets it through). */
const SNAG = new Set(['ground', 'trunk', 'post', 'rail', 'pole', 'bench', 'bar', 'glass', 'iron', 'stone', 'bough', 'line', 'chain']);

/** Builds the garden into a web: anchor nodes for each point, static branch threads between them. Returns ids. */
export function buildGarden(web, g) {
  const { keys, pos } = nodeKeys(g);
  const nodeId = pos.map((p, k) => web.addNode(p[0], p[1], N_ANCHOR, { id: k + 1, sway: p[3], phase: p[4], player: 0 }));
  let tid = 1;
  const ids = keys.map((row) => row.map((k) => nodeId[k]));
  g.solidThreads = [];
  ids.forEach((row, si) => {
    const first = tid;
    const sf = g.surfaces[si];
    const flag = (SNAG.has(sf.kind) ? 1 : 0) | (sf.solid ? 2 : 0);
    for (let pi = 1; pi < row.length; pi++) {
      if (row[pi] !== row[pi - 1]) web.addThread(row[pi - 1], row[pi], T_SURFACE, { id: tid++, flag });
    }
    if (si === 0) g.groundThreads = tid - 1; // the ground is built first: its branches are ids 1..groundThreads
    if (g.surfaces[si].solid) for (let id = first; id < tid; id++) g.solidThreads.push(id);
  });
  web.nextNode = Math.max(web.nextNode, GARDEN_IDS);
  web.nextThread = Math.max(web.nextThread, GARDEN_IDS);
  g.nodeIds = ids;
  g.threadCount = tid - 1;
  g.nodeCount = pos.length;
  return ids;
}

export function retreatNode(g) {
  const r = g.retreat;
  return g.nodeIds?.[r.si]?.[r.pi] ?? 1;
}
export function startNode(g) {
  const s = g.start;
  return g.nodeIds?.[s.si]?.[s.pi] ?? 1;
}

/** Is (x, y) hidden in foliage? */
export function inCover(g, x, y) {
  for (const c of g.cover) {
    const dx = (x - c.x) / c.rx;
    const dy = (y - c.y) / c.ry;
    if (dx * dx + dy * dy < 1) return true;
  }
  return false;
}

/** Point along lane at parameter u (0..1 by length). */
export function lanePoint(lane, u, out = {}) {
  const pts = lane.pts;
  if (!lane.lens) {
    lane.lens = [0];
    for (let i = 1; i < pts.length; i++) lane.lens.push(lane.lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = lane.lens[lane.lens.length - 1];
  const d = Math.max(0, Math.min(1, u)) * total;
  let i = 1;
  while (i < pts.length - 1 && lane.lens[i] < d) i++;
  const seg = lane.lens[i] - lane.lens[i - 1] || 1;
  const t = (d - lane.lens[i - 1]) / seg;
  out.x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
  out.y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
  out.dx = (pts[i][0] - pts[i - 1][0]) / seg;
  out.dy = (pts[i][1] - pts[i - 1][1]) / seg;
  out.total = total;
  return out;
}

/**
 * Where a spoke from (x, y) along angle a would anchor: crossings with branches up to maxD, stopping at the first
 * sturdy one (casts snag there), choosing the one nearest the wanted radius. Returns its distance or Infinity.
 */
export function spokeHit(g, x, y, a, maxD, want) {
  const ex = x + Math.cos(a) * maxD;
  const ey = y + Math.sin(a) * maxD;
  const hits = [];
  for (const s of g.surfaces) {
    const snag = SNAG.has(s.kind);
    for (let i = 1; i < s.pts.length; i++) {
      const u = crossing(s.pts[i - 1][0], s.pts[i - 1][1], s.pts[i][0], s.pts[i][1], x, y, ex, ey);
      if (u >= 0 && u * maxD > 12) hits.push([u * maxD, snag]);
    }
  }
  hits.sort((p, q) => p[0] - q[0]);
  let best = Infinity;
  let score = Infinity;
  for (const [d, snag] of hits) {
    const sc = d < want * 0.45 ? 1000 + want - d : Math.abs(d - want);
    if (sc < score) {
      score = sc;
      best = d;
    }
    if (snag) break;
  }
  return best;
}

/**
 * Good web sites: points near a lane where a spoke can reach an anchor all round (an orb fits and is held). The
 * bots and the validation use them; the forecast talks about the best one.
 */
export function findSites(g) {
  const sites = [];
  const p = {};
  const RAYS = 16;
  g.lanes.forEach((lane, li) => {
    for (let u = 0.08; u < 0.95; u += 0.035) {
      lanePoint(lane, u, p);
      if (p.x < 40 || p.x > W - 40 || p.y < 60 || p.y > GROUND - 60) continue;
      const ok = [];
      const ds = [];
      for (let k = 0; k < RAYS; k++) {
        const d = spokeHit(g, p.x, p.y, (k / RAYS) * Math.PI * 2, 230, 105);
        const good = d >= 45 && d < 230;
        ok.push(good);
        if (good) ds.push(d);
      }
      const hits = ds.length;
      let maxGap = 0;
      for (let k = 0; k < RAYS; k++) {
        let gap = 0;
        while (gap < RAYS && !ok[(k + gap) % RAYS]) gap++;
        maxGap = Math.max(maxGap, gap);
      }
      if (hits >= 11 && maxGap <= 3) {
        ds.sort((a, b) => a - b);
        const median = ds[Math.floor(ds.length / 2)];
        sites.push({ x: p.x, y: p.y, lane: li, r: Math.max(60, Math.min(140, median * 0.9)), score: hits * 10 + lane.share * 60 + Math.min(median, 140) / 6 });
      }
    }
  });
  sites.sort((a, b) => b.score - a.score);
  // Keep sites that aren't on top of each other: the best few on each lane.
  const out = [];
  for (const s of sites) {
    if (out.filter((o) => o.lane === s.lane).length >= 3) continue;
    if (out.every((o) => Math.hypot(o.x - s.x, o.y - s.y) > 60)) out.push(s);
  }
  return out.sort((a, b) => b.score - a.score);
}

export function validate(g) {
  const problems = [];
  if (!g.surfaces.length) problems.push('empty');
  if (!g.retreat || !g.surfaces[g.retreat.si]) problems.push('no retreat');
  if (!g.start || !g.surfaces[g.start.si]) problems.push('no start');
  if (g.lanes.length < 2) problems.push('lanes');
  if (!g.sites.some((s) => s.lane === 0)) problems.push('no site on main lane');
  for (const s of g.surfaces) for (const p of s.pts) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) problems.push('nan');
  // Connected: union the merged points along every surface; one component means every branch can be walked to.
  const { keys, pos } = nodeKeys(g);
  const parent = pos.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const row of keys) for (let i = 1; i < row.length; i++) parent[find(row[i])] = find(row[i - 1]);
  const roots = new Set(pos.map((_, i) => find(i)));
  const reach = { size: roots.size === 1 ? g.surfaces.length : -1 };
  if (reach.size !== g.surfaces.length) problems.push('disconnected');
  return { ok: problems.length === 0, problems };
}

export { pick, rand };
