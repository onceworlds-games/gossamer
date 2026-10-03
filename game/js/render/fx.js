// Small moving things: dew shaken off, silk wisps, a snapped thread whipping back, feathers, leaves in a gust, rain,
// and the rings a pluck sends out. One pool, reused; nothing is allocated per frame.
import { SILVER, AMBER, RUST, rgba } from './palette.js';
import { GROUND } from '../sim/data.js';

const MAX = 700;
const parts = Array.from({ length: MAX }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, kind: 0, rot: 0, vr: 0 }));
const DEW = 0;
const SILK = 1;
const LEAF = 2;
const FEATHER = 3;
const SPARK = 4;
const RAIN = 5;
const DUST = 6;
const rings = [];
const whips = [];
let cursor = 0;
let scale = 1;

export function setFxScale(s) {
  scale = s;
}

function spawn(kind, x, y, vx, vy, life, size, vr = 0) {
  for (let k = 0; k < MAX; k++) {
    cursor = (cursor + 1) % MAX;
    const p = parts[cursor];
    if (p.on) continue;
    p.on = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = p.max = life;
    p.size = size;
    p.rot = Math.random() * 6.28;
    p.vr = vr;
    return p;
  }
  return null;
}

export function dew(x, y, n = 8, power = 1) {
  n = Math.round(n * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (30 + Math.random() * 90) * power;
    spawn(DEW, x, y, Math.cos(a) * s, Math.sin(a) * s - 40, 0.6 + Math.random() * 0.5, 1 + Math.random() * 1.6);
  }
}

export function silk(x0, y0, x1, y1, n = 6) {
  n = Math.round(n * scale);
  for (let i = 0; i < n; i++) {
    const f = Math.random();
    spawn(SILK, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, (Math.random() - 0.5) * 20, -10 - Math.random() * 20, 0.5 + Math.random() * 0.6, 0.8 + Math.random());
  }
}

export function sparks(x, y, n = 6, warm = true) {
  n = Math.round(n * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 110;
    spawn(SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.3, warm ? 1.4 : 1);
  }
}

export function feathers(x, y, n = 6) {
  for (let i = 0; i < Math.round(n * scale); i++) spawn(FEATHER, x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 80, -30 - Math.random() * 50, 2 + Math.random() * 1.5, 3 + Math.random() * 3, (Math.random() - 0.5) * 4);
}

export function leaves(view, dir, n = 6) {
  for (let i = 0; i < Math.round(n * scale); i++) {
    const x = dir > 0 ? view.x0 - 20 : view.x1 + 20;
    spawn(LEAF, x, view.y0 + Math.random() * (view.y1 - view.y0), dir * (180 + Math.random() * 160), (Math.random() - 0.4) * 60, 3 + Math.random() * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 6);
  }
}

export function dust(x, y, n = 5) {
  for (let i = 0; i < Math.round(n * scale); i++) spawn(DUST, x + (Math.random() - 0.5) * 10, y, (Math.random() - 0.5) * 50, -20 - Math.random() * 30, 0.6 + Math.random() * 0.4, 2 + Math.random() * 2);
}

export function rain(view, n) {
  for (let i = 0; i < n; i++) spawn(RAIN, view.x0 + Math.random() * (view.x1 - view.x0 + 200) - 100, view.y0 - 20, -60, 700 + Math.random() * 200, 1.4, 1);
}

/** A pluck: rings spreading from where the web was touched (a note you can see). */
export function ring(x, y, amp, warm = false) {
  if (rings.length > 40) rings.shift();
  rings.push({ x, y, t: 0, amp: Math.min(1, amp), warm });
}

/** A snapped thread: its two halves whip back toward their anchors. */
export function whip(ax, ay, bx, by, type) {
  if (whips.length > 30) whips.shift();
  whips.push({ ax, ay, bx, by, t: 0, type });
}

export function updateFx(dt) {
  for (const p of parts) {
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.on = false;
      continue;
    }
    if (p.kind === DEW || p.kind === SPARK || p.kind === DUST) p.vy += 300 * dt;
    if (p.kind === LEAF || p.kind === FEATHER) {
      p.vy += (p.kind === FEATHER ? 25 : 40) * dt;
      p.vx *= 1 - dt * 0.5;
    }
    if (p.kind === SILK) p.vy -= 5 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.kind === RAIN && p.y > GROUND) {
      p.on = false;
      if (Math.random() < 0.3) spawn(DUST, p.x, GROUND - 2, (Math.random() - 0.5) * 40, -40, 0.25, 1);
    }
  }
  for (let i = rings.length - 1; i >= 0; i--) if ((rings[i].t += dt) > 0.9) rings.splice(i, 1);
  for (let i = whips.length - 1; i >= 0; i--) if ((whips[i].t += dt) > 0.45) whips.splice(i, 1);
}

export function clearFx() {
  for (const p of parts) p.on = false;
  rings.length = 0;
  whips.length = 0;
}

export function drawFx(ctx, z) {
  for (const r of rings) {
    const f = r.t / 0.9;
    ctx.strokeStyle = r.warm ? rgba(AMBER, (1 - f) * 0.5 * r.amp) : rgba(SILVER, (1 - f) * 0.45 * r.amp);
    ctx.lineWidth = Math.max(0.8 / z, 1.2 * (1 - f));
    ctx.beginPath();
    ctx.arc(r.x, r.y, 4 + f * 34 * (0.5 + r.amp), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const w of whips) {
    const f = w.t / 0.45;
    const mx = (w.ax + w.bx) / 2;
    const my = (w.ay + w.by) / 2;
    ctx.strokeStyle = rgba(w.type === 0 ? AMBER : SILVER, 0.8 * (1 - f));
    ctx.lineWidth = Math.max(0.8 / z, 1.2);
    for (const [ex, ey] of [[w.ax, w.ay], [w.bx, w.by]]) {
      // Each half curls back to its anchor.
      const sx = mx + (ex - mx) * f;
      const sy = my + (ey - my) * f;
      const cx = (sx + ex) / 2 + (ey - sy) * 0.3 * (1 - f);
      const cy = (sy + ey) / 2 - (ex - sx) * 0.3 * (1 - f);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.stroke();
    }
  }
  for (const p of parts) {
    if (!p.on) continue;
    const a = Math.min(1, p.life / p.max * 1.5);
    switch (p.kind) {
      case DEW:
        ctx.fillStyle = rgba(SILVER, 0.8 * a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.62, 0, Math.PI * 2);
        ctx.fill();
        break;
      case SILK:
        ctx.strokeStyle = rgba(SILVER, 0.35 * a);
        ctx.lineWidth = 0.6 / Math.max(0.5, z);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 5, p.y + Math.sin(p.rot) * 2);
        ctx.stroke();
        break;
      case SPARK:
        ctx.fillStyle = rgba(AMBER, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        break;
      case LEAF:
      case FEATHER:
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.kind === LEAF ? `rgba(40, 92, 82, ${a})` : `rgba(80, 58, 44, ${a})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      case RAIN:
        ctx.strokeStyle = 'rgba(190, 220, 214, 0.32)';
        ctx.lineWidth = 0.8 / Math.max(0.6, z);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
        ctx.stroke();
        break;
      case DUST:
        ctx.fillStyle = `rgba(120, 140, 130, ${0.4 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        break;
    }
  }
}

export { RUST };
