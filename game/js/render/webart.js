// The silk itself: fine silver lines, brighter where the moon catches glue, dew beads that grow through the night,
// travelling brightness where something touched it, and a warm shimmer on threads about to snap. Each kind has its
// own pattern (frame heavy, radial plain, sticky beaded, alarm dashed), so colour is never the only cue.
import { T_FRAME, T_RADIAL, T_STICKY, T_ALARM, T_DRAG, T_SURFACE, THREADS, N_PREY } from '../sim/data.js';
import { SILVER, AMBER, RUST, rgba, SILKS } from './palette.js';
import { glowSprite } from './backdrop.js';

const ALPHA = [0.78, 0.62, 0.86, 0.7, 0.5];
const pulses = [];
const GLINTS = new Float32Array(1500); // x, y, size of the beads that flare at dawn

/** Dew bead sprites by style: round beads, starred ones with a glint, or prisms that split the moonlight. */
const beads = {};
function beadSprite(style = 'round', k = 0) {
  const key = style === 'prism' ? `prism${k % 6}` : style;
  if (beads[key]) return beads[key];
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const tint = style === 'prism' ? [[255, 170, 170], [255, 214, 150], [235, 245, 160], [160, 235, 190], [160, 205, 255], [205, 175, 255]][k % 6] : [200, 226, 222];
  const grad = g.createRadialGradient(13, 12, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, `rgba(${tint[0]},${tint[1]},${tint[2]},0.55)`);
  grad.addColorStop(0.9, `rgba(${Math.round(tint[0] * 0.6)},${Math.round(tint[1] * 0.75)},${Math.round(tint[2] * 0.75)},0.28)`);
  grad.addColorStop(1, 'rgba(120,170,165,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(16, 16, style === 'star' ? 11 : 15, 0, Math.PI * 2);
  g.fill();
  if (style === 'star') {
    // A four-pointed glint across the bead.
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(16, 1.5);
    g.lineTo(16, 30.5);
    g.moveTo(1.5, 16);
    g.lineTo(30.5, 16);
    g.stroke();
  }
  beads[key] = c;
  return c;
}

/** A touch at thread `id` sends brightness out along the web (a few hops, each a little later and dimmer). */
export function pulseFrom(web, id, amp, now) {
  const s0 = web.ti(id);
  if (s0 < 0) return;
  const seen = new Set([s0]);
  let frontier = [[s0, 0]];
  for (let hop = 0; hop < 3 && frontier.length; hop++) {
    const next = [];
    for (const [s, delay] of frontier) {
      if (pulses.length > 90) pulses.shift();
      const len = web.len[s] || 40;
      pulses.push({ id: web.tid[s], t0: now + delay, dur: Math.max(0.08, len / 900), amp: amp * 0.62 ** hop });
      for (const n of [web.ta[s], web.tb[s]]) {
        for (const t of web.adj[n]) {
          if (seen.has(t) || web.type[t] === T_SURFACE) continue;
          seen.add(t);
          next.push([t, delay + len / 900]);
        }
      }
    }
    frontier = next.slice(0, 10);
  }
}

export function clearPulses() {
  pulses.length = 0;
}

/**
 * opts: { z (screen px per world px), t (seconds), q ('low'|'medium'|'high'), silk (tint key), mist, focus }.
 */
export function drawWeb(ctx, world, o) {
  const web = world.web;
  const z = o.z;
  const minW = 0.85 / z;
  const tint = SILKS[o.silk] ?? SILKS.silver;
  const col = (a) => `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${a})`;
  const now = web.time;
  // Threads by kind; growing ones (just cast) are drawn partly.
  for (const type of [T_DRAG, T_FRAME, T_RADIAL, T_ALARM, T_STICKY]) {
    ctx.lineWidth = Math.max(minW, THREADS[type].width);
    ctx.strokeStyle = col(ALPHA[type]);
    ctx.lineCap = 'round';
    if (type === T_ALARM) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let s = 0; s < web.threadHigh; s++) {
      if (web.tid[s] < 0 || web.type[s] !== type) continue;
      const a = web.ta[s];
      const b = web.tb[s];
      const grow = Math.min(1, (now - web.born[s]) / 0.22);
      if (grow <= 0) continue;
      ctx.moveTo(web.x[a], web.y[a]);
      ctx.lineTo(web.x[a] + (web.x[b] - web.x[a]) * grow, web.y[a] + (web.y[b] - web.y[a]) * grow);
    }
    ctx.stroke();
    if (type === T_ALARM) ctx.setLineDash([]);
  }
  // Glue droplets on sticky silk: a row of tiny bright points (rain dulls them).
  if (o.q !== 'low') {
    const wet = world.stickFactor < 1 ? 0.45 : 1;
    ctx.strokeStyle = col(0.9 * wet);
    ctx.lineWidth = Math.max(1.1 / z, 1.6);
    ctx.setLineDash([0.01, 5.5]);
    ctx.beginPath();
    for (let s = 0; s < web.threadHigh; s++) {
      if (web.tid[s] < 0 || web.type[s] !== T_STICKY || web.stick[s] <= 0) continue;
      ctx.moveTo(web.x[web.ta[s]], web.y[web.ta[s]]);
      ctx.lineTo(web.x[web.tb[s]], web.y[web.tb[s]]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Vibration and strain: brighter where it trembles, warm and flickering where it's about to go.
  ctx.globalCompositeOperation = 'lighter';
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] === T_SURFACE) continue;
    const v = web.vib[s];
    const strain = web.strain(s);
    if (v < 14 && strain < 0.55) continue;
    const a = web.ta[s];
    const b = web.tb[s];
    if (v >= 14) {
      ctx.strokeStyle = col(Math.min(0.75, v / 520));
      ctx.lineWidth = Math.max(minW * 2, THREADS[web.type[s]].width * 2.4);
      ctx.beginPath();
      ctx.moveTo(web.x[a], web.y[a]);
      ctx.lineTo(web.x[b], web.y[b]);
      ctx.stroke();
    }
    if (strain >= 0.55) {
      const flick = 0.5 + 0.5 * Math.sin(o.t * 38 + s * 1.7);
      ctx.strokeStyle = rgba(AMBER, (strain - 0.5) * 1.4 * (0.4 + 0.6 * flick));
      ctx.lineWidth = Math.max(minW * 1.6, THREADS[web.type[s]].width * 1.8);
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = o.t * 30;
      ctx.beginPath();
      ctx.moveTo(web.x[a], web.y[a]);
      ctx.lineTo(web.x[b], web.y[b]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Travelling pulses.
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    const f = (o.t - p.t0) / p.dur;
    if (f > 1.3) {
      pulses.splice(i, 1);
      continue;
    }
    if (f < 0) continue;
    const s = web.ti(p.id);
    if (s < 0) continue;
    const a = web.ta[s];
    const b = web.tb[s];
    const f0 = Math.max(0, f - 0.25);
    const f1 = Math.min(1, f);
    ctx.strokeStyle = col(Math.min(0.9, p.amp / 300) * (1 - Math.max(0, f - 1) * 3));
    ctx.lineWidth = Math.max(minW * 2.2, 2.4);
    ctx.beginPath();
    ctx.moveTo(web.x[a] + (web.x[b] - web.x[a]) * f0, web.y[a] + (web.y[b] - web.y[a]) * f0);
    ctx.lineTo(web.x[a] + (web.x[b] - web.x[a]) * f1, web.y[a] + (web.y[b] - web.y[a]) * f1);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  // Dew beads at fixed places along each thread, swelling as the night goes on.
  if (o.q !== 'low') {
    const style = o.dewStyle === 'star' || o.dewStyle === 'prism' ? o.dewStyle : 'round';
    let sprite = beadSprite(style);
    let budget = o.q === 'high' ? 2200 : 700;
    const glints = (o.dawn ?? 0) > 0.02;
    let nGlint = 0;
    for (let s = 0; s < web.threadHigh && budget > 0; s++) {
      if (web.tid[s] < 0 || web.type[s] === T_SURFACE) continue;
      const dew = web.dew[s];
      if (dew < 1) continue;
      const n = Math.min(40, Math.floor(dew));
      const a = web.ta[s];
      const b = web.tb[s];
      const size = Math.min(4.2, 1.2 + dew / Math.max(8, web.len[s] / 6)) * (style === 'star' ? 1.35 : 1);
      let h = (web.tid[s] * 2654435761) >>> 0;
      for (let k = 0; k < n && budget > 0; k++, budget--) {
        h = (h * 1103515245 + 12345) >>> 0;
        const f = ((h >>> 8) & 1023) / 1023;
        const x = web.x[a] + (web.x[b] - web.x[a]) * f;
        const y = web.y[a] + (web.y[b] - web.y[a]) * f + size * 0.4;
        const sz = size * (0.6 + ((h >>> 20) & 7) / 14);
        if (style === 'prism') sprite = beadSprite(style, (h >>> 4) % 6);
        ctx.drawImage(sprite, x - sz, y - sz, sz * 2, sz * 2);
        if (glints && (h >>> 12) % 3 === 0 && nGlint < GLINTS.length - 3) {
          GLINTS[nGlint++] = x;
          GLINTS[nGlint++] = y;
          GLINTS[nGlint++] = sz;
        }
      }
    }
    // Dawn catches the dew: every third bead flares, as in a photograph of a web at first light.
    if (nGlint) {
      const gs = glowSprite();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * o.dawn;
      for (let i = 0; i < nGlint; i += 3) {
        const r = GLINTS[i + 2] * 2.6;
        ctx.drawImage(gs, GLINTS[i] - r, GLINTS[i + 1] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

/** Thread-joining knots on the hub: a tiny dot where many threads meet (helps reading a web). */
export function drawKnots(ctx, world, z) {
  const web = world.web;
  ctx.fillStyle = rgba(SILVER, 0.7);
  const r = Math.max(1.1, 1.6 / z);
  for (let s = 0; s < web.nodeHigh; s++) {
    if (web.nid[s] < 2000 || web.kind[s] === N_PREY || web.adj[s].length < 4) continue;
    ctx.beginPath();
    ctx.arc(web.x[s], web.y[s], r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The aim line for a cast, a Quick Orb ghost, or the thread a cut would take. */
export function drawAim(ctx, aim, z, t) {
  if (!aim) return;
  const w = 1.4 / z;
  if (aim.kind === 'leap' && aim.arc) {
    // The hunter's jump: the arc it will fly, dotted, brighter as the charge builds.
    const { x0, y0, x1, y1 } = aim;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const T = Math.max(0.22, Math.min(0.62, d / 470));
    const vx = (x1 - x0) / T;
    const vy = (y1 - y0 - 0.5 * 420 * T * T) / T;
    ctx.fillStyle = aim.ok ? rgba(SILVER, 0.35 + 0.5 * (aim.power ?? 1)) : rgba(RUST, 0.8);
    for (let i = 1; i <= 14; i++) {
      const t = (T * i) / 14;
      ctx.beginPath();
      ctx.arc(x0 + vx * t, y0 + vy * t + 0.5 * 420 * t * t, (1.6 + (i === 14 ? 2 : 0)) / z, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (aim.kind === 'cast' || aim.kind === 'leap') {
    const ok = aim.ok;
    ctx.strokeStyle = ok ? rgba(SILVER, 0.75) : rgba(RUST, 0.85);
    ctx.lineWidth = w;
    ctx.setLineDash([6 / z, 5 / z]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath();
    ctx.moveTo(aim.x0, aim.y0);
    ctx.lineTo(aim.x1, aim.y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(aim.x1, aim.y1, 7 / z + Math.sin(t * 8) * 1.2 / z, 0, Math.PI * 2);
    ctx.stroke();
    if (aim.range) {
      ctx.strokeStyle = rgba(SILVER, 0.08);
      ctx.beginPath();
      ctx.arc(aim.x0, aim.y0, aim.range, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (aim.kind === 'orb' && aim.plan) {
    const p = aim.plan;
    ctx.strokeStyle = p.ok ? rgba(SILVER, 0.42) : rgba(RUST, 0.6);
    ctx.lineWidth = w;
    ctx.setLineDash([4 / z, 4 / z]);
    ctx.beginPath();
    for (const e of p.ends) {
      if (!e) continue;
      ctx.moveTo(aim.x1, aim.y1);
      ctx.lineTo(e.x, e.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (p.ok) {
      ctx.strokeStyle = rgba(SILVER, 0.22);
      for (let r = 20; r < aim.r * 0.85; r += 16) {
        ctx.beginPath();
        ctx.arc(aim.x1, aim.y1, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else if (aim.kind === 'cut' && aim.seg) {
    ctx.strokeStyle = rgba(RUST, 0.8 + 0.2 * Math.sin(t * 12));
    ctx.lineWidth = 3 / z;
    ctx.beginPath();
    ctx.moveTo(aim.seg[0], aim.seg[1]);
    ctx.lineTo(aim.seg[2], aim.seg[3]);
    ctx.stroke();
  }
}

export { SILVER };
