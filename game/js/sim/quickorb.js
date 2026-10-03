// Quick Orb: pick a hub and a radius, and the spider spins a whole web there, strand by strand. The plan is made
// once (where the radials can reach a branch or silk); the steps run over a few seconds and pay as they go, so a
// spider that runs dry leaves a smaller web. Patterns: orb (8 spokes), ladder (tall), funnel (a fan you hide in),
// and a close-woven orb (10 spokes, tight spiral).
import { THREADS, T_RADIAL, T_STICKY, T_SURFACE, MERGE, N_PREY } from './data.js';
import { crossing } from './web.js';

export const PATTERNS = {
  orb: { rays: 8, spread: 1, spacing: 16, from: 18, fill: 0.86, closed: true },
  ladder: { rays: 8, spread: 1, spacing: 13, from: 16, fill: 0.9, closed: true, tall: true },
  funnel: { rays: 7, spread: 0.62, spacing: 12, from: 16, fill: 0.9, closed: false },
  dense: { rays: 10, spread: 1, spacing: 12, from: 16, fill: 0.88, closed: true },
};
export const PREMIUM = 1.1;

export function patternsFor(tier) {
  return ['orb', ...(tier >= 1 ? ['ladder'] : []), ...(tier >= 2 ? ['funnel'] : []), ...(tier >= 3 ? ['dense'] : [])];
}

function rayAngles(p, tall) {
  const out = [];
  for (let k = 0; k < p.rays; k++) {
    if (p.closed) {
      let a = -Math.PI / 2 + (k / p.rays) * Math.PI * 2;
      if (tall) a += Math.sin(2 * a) * 0.28; // bunch the spokes toward up and down
      out.push(a);
    } else {
      // A fan opening upward from a low hub.
      out.push(Math.PI + (k / (p.rays - 1)) * Math.PI * p.spread * 1.6 - (Math.PI * (p.spread * 1.6 - 1)) / 2);
    }
  }
  return out;
}

/**
 * Where a spoke from (x, y) along angle a should end: every thread the ray crosses up to maxD, stopping at the first
 * sturdy branch (a cast snags there); among those, the one nearest the wanted radius r (silk counts too).
 */
function spokeEnd(web, x, y, a, maxD, r) {
  const ex = x + Math.cos(a) * maxD;
  const ey = y + Math.sin(a) * maxD;
  const hits = [];
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0) continue;
    const ta = web.ta[s];
    const tb = web.tb[s];
    if (web.kind[ta] === N_PREY || web.kind[tb] === N_PREY) continue;
    const u = crossing(x, y, ex, ey, web.x[ta], web.y[ta], web.x[tb], web.y[tb]);
    if (u < 0) continue;
    const v = crossing(web.x[ta], web.y[ta], web.x[tb], web.y[tb], x, y, ex, ey);
    const d = v * maxD;
    if (d > 12) hits.push({ s, t: u, d, snag: web.type[s] === T_SURFACE && (web.flag[s] & 1) });
  }
  hits.sort((p, q) => p.d - q.d);
  let best = null;
  let bestScore = Infinity;
  for (const h of hits) {
    const score = h.d < r * 0.45 ? 1000 + (r - h.d) : Math.abs(h.d - r);
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
    if (h.snag) break;
  }
  return best;
}

/**
 * Plans a web around (hx, hy) reaching about r px. Returns { ok, why, hub, ends: [{ x, y, s, t, a }], cost, pattern }.
 */
export function planOrb(web, hx, hy, r, pattern = 'orb', range = 520) {
  const p = PATTERNS[pattern] ?? PATTERNS.orb;
  r = Math.max(50, Math.min(170, Number.isFinite(r) ? r : 95));
  const maxD = Math.min(range, r * (p.tall ? 2.4 : 1.9));
  const angles = rayAngles(p, p.tall);
  const ends = [];
  let miss = 0;
  let worstGap = 0;
  for (const a of angles) {
    const hit = spokeEnd(web, hx, hy, a, maxD, r);
    if (!hit) {
      ends.push(null);
      worstGap = Math.max(worstGap, ++miss);
      continue;
    }
    miss = 0;
    const ex = hx + Math.cos(a) * hit.d;
    const ey = hy + Math.sin(a) * hit.d;
    ends.push({ x: ex, y: ey, s: hit.s, id: web.tid[hit.s], t: hit.t, a, d: hit.d });
  }
  const found = ends.filter(Boolean);
  const need = p.closed ? Math.ceil(p.rays * 0.75) : p.rays - 2;
  if (found.length < need || worstGap > 2) return { ok: false, why: 'open', ends, cost: 0, pattern };
  // Spiral estimate: rings out to `fill` of the typical spoke (shorter spokes simply stop earlier).
  const minD = typicalSpoke(found);
  let spiral = 0;
  const rings = spiralRings(p, found, minD);
  for (const ring of rings) spiral += ring.len;
  const radial = found.reduce((sum, e) => sum + e.d, 0);
  const cost = (radial * THREADS[T_RADIAL].cost + spiral * THREADS[T_STICKY].cost) * PREMIUM;
  return { ok: true, hub: { x: hx, y: hy }, ends, cost, pattern, rings: rings.length };
}

/** The spoke length the spiral is sized to: a low median, so one short spoke doesn't shrink the whole web. */
function typicalSpoke(found) {
  const ds = found.map((e) => e.d).sort((a, b) => a - b);
  return ds[Math.floor(ds.length * 0.6)] ?? 60;
}

/** Spiral segment estimates: one entry per sticky segment with its length. */
function spiralRings(p, found, minD) {
  const out = [];
  const n = found.length;
  const turns = Math.max(1, Math.floor((minD * p.fill - p.from) / p.spacing));
  for (let j = 0; j < turns; j++) {
    for (let k = 0; k < n - (p.closed ? 0 : 1); k++) {
      const e0 = found[k];
      const e1 = found[(k + 1) % n];
      const r0 = radiusOn(p, e0, j, k / n, minD);
      const r1 = radiusOn(p, e1, j + (p.closed && k === n - 1 ? 1 : 0), ((k + 1) % n) / n, minD);
      if (r0 >= e0.d * 0.95 || r1 >= e1.d * 0.95) continue;
      const x0 = Math.cos(e0.a) * r0;
      const y0 = Math.sin(e0.a) * r0;
      const x1 = Math.cos(e1.a) * r1;
      const y1 = Math.sin(e1.a) * r1;
      out.push({ k, j, len: Math.hypot(x1 - x0, y1 - y0) });
    }
  }
  return out;
}

/** Distance from the hub of the spiral point on spoke e at turn j (+ fraction f of a turn). */
export function radiusOn(p, e, j, f, minD) {
  if (p.tall) return Math.min(e.d * p.fill, (p.from + p.spacing * (j + f)) * (e.d / minD) ** 0.7);
  return p.from + p.spacing * (j + f);
}

/**
 * Turns a plan into ordered steps the world runs: spokes first, then the spiral turn by turn.
 * Each step: { k: 'spoke', i } | { k: 'spiral', a: [i, r], b: [i, r] }.
 */
export function orbSteps(plan) {
  const p = PATTERNS[plan.pattern] ?? PATTERNS.orb;
  const found = plan.ends.map((e, i) => (e ? { ...e, i } : null)).filter(Boolean);
  const steps = found.map((e) => ({ k: 'spoke', i: e.i }));
  const n = found.length;
  const minD = typicalSpoke(found);
  const turns = Math.max(1, Math.floor((minD * p.fill - p.from) / p.spacing));
  for (let j = 0; j < turns; j++) {
    for (let k = 0; k < n - (p.closed ? 0 : 1); k++) {
      const e0 = found[k];
      const e1 = found[(k + 1) % n];
      const r0 = radiusOn(p, e0, j, k / n, minD);
      const r1 = radiusOn(p, e1, j + (p.closed && k === n - 1 ? 1 : 0), ((k + 1) % n) / n, minD);
      if (r0 >= e0.d * 0.95 || r1 >= e1.d * 0.95) continue;
      steps.push({ k: 'spiral', a: [e0.i, r0], b: [e1.i, r1] });
    }
  }
  return steps;
}

export { MERGE, T_SURFACE };
