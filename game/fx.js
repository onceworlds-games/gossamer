// Juice: particles (world space), floating numbers, camera shake as decaying trauma, hit-stop, screen flash, pops.

import { clamp, easeOutBack } from './rules.js';
import { INK, outlined, star } from './style.js';

const MAX_PARTICLES = 360;
const MAX_TEXTS = 24;
const CONFETTI = ['#ff4d4d', '#ffd42a', '#22c768', '#38b6ff', '#9d5cff', '#ff5ec4', '#ff9a1f'];

const particles = [];
for (let i = 0; i < MAX_PARTICLES; i++) particles.push({ on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, size: 0.2, rot: 0, vr: 0, color: '#fff' });
const texts = [];
for (let i = 0; i < MAX_TEXTS; i++) texts.push({ on: false, x: 0, y: 0, vy: 0, life: 0, max: 1, str: '', color: '#fff', size: 30 });

// kinds
const DUST = 1;
const SPARK = 2;
const CONFETTI_K = 3;
const STAR = 4;
const RING = 5;
const SMOKE = 6;

let cursor = 0;
let scale = 1; // from the graphics quality
let reduced = false;
let trauma = 0;
let clock = 0;
let flashA = 0;
let flashColor = '#fff';

export const fx = {
  freezeT: 0, // seconds of hit-stop left

  configure(quality, reducedMotion) {
    scale = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;
    reduced = Boolean(reducedMotion);
  },

  clear() {
    for (const p of particles) p.on = false;
    for (const t of texts) t.on = false;
    trauma = 0;
    flashA = 0;
    this.freezeT = 0;
  },

  /** A soft puff of dust (running, skidding, landing). */
  dust(x, y, n = 3, spread = 0.5, color = '#efe3c4') {
    const count = Math.max(1, Math.round(n * scale * (reduced ? 0.5 : 1)));
    for (let i = 0; i < count; i++) {
      const p = take();
      p.kind = DUST;
      p.x = x + (Math.random() - 0.5) * spread;
      p.y = y + (Math.random() - 0.5) * 0.2;
      p.vx = (Math.random() - 0.5) * 1.4;
      p.vy = (Math.random() - 0.2) * 0.9;
      p.g = 0;
      p.life = 0;
      p.max = 0.35 + Math.random() * 0.25;
      p.size = 0.18 + Math.random() * 0.14;
      p.color = color;
    }
  },

  /** Little bright sparks flying out (hits, zaps, pops). */
  sparks(x, y, n = 10, color = '#ffe14a', speed = 5) {
    const count = Math.max(2, Math.round(n * scale * (reduced ? 0.5 : 1)));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const p = take();
      p.kind = SPARK;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.g = -4;
      p.life = 0;
      p.max = 0.3 + Math.random() * 0.25;
      p.size = 0.1 + Math.random() * 0.08;
      p.color = color;
    }
  },

  /** A burst of confetti. */
  confetti(x, y, n = 40, power = 7) {
    const count = Math.max(4, Math.round(n * scale * (reduced ? 0.4 : 1)));
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = power * (0.35 + Math.random() * 0.8);
      const p = take();
      p.kind = CONFETTI_K;
      p.x = x + (Math.random() - 0.5) * 0.6;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.g = -9;
      p.life = 0;
      p.max = 1.4 + Math.random() * 0.9;
      p.size = 0.16 + Math.random() * 0.12;
      p.rot = Math.random() * 6;
      p.vr = (Math.random() - 0.5) * 14;
      p.color = CONFETTI[(Math.random() * CONFETTI.length) | 0];
    }
  },

  stars(x, y, n = 5, power = 4) {
    const count = Math.max(1, Math.round(n * scale));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = take();
      p.kind = STAR;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * power * (0.4 + Math.random() * 0.6);
      p.vy = Math.sin(a) * power * (0.4 + Math.random() * 0.6);
      p.g = -2;
      p.life = 0;
      p.max = 0.5 + Math.random() * 0.3;
      p.size = 0.25 + Math.random() * 0.15;
      p.rot = Math.random() * 3;
      p.vr = 4;
      p.color = '#ffd42a';
    }
  },

  /** An expanding ring. */
  ring(x, y, color = '#fff', size = 1.6) {
    const p = take();
    p.kind = RING;
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.g = 0;
    p.life = 0;
    p.max = 0.45;
    p.size = size;
    p.color = color;
  },

  /** A big puff of smoke (a character landing back at the start). */
  smoke(x, y, n = 6) {
    const count = Math.max(1, Math.round(n * scale));
    for (let i = 0; i < count; i++) {
      const p = take();
      p.kind = SMOKE;
      p.x = x + (Math.random() - 0.5) * 0.8;
      p.y = y + Math.random() * 0.3;
      p.vx = (Math.random() - 0.5) * 2;
      p.vy = 0.4 + Math.random() * 1.2;
      p.g = 0;
      p.life = 0;
      p.max = 0.5 + Math.random() * 0.3;
      p.size = 0.3 + Math.random() * 0.25;
      p.color = '#ffffff';
    }
  },

  /** A number or word that pops up and floats away. */
  text(x, y, str, color = '#fff', size = 30) {
    let t = null;
    for (const c of texts) {
      if (!c.on) {
        t = c;
        break;
      }
    }
    if (!t) t = texts[0];
    t.on = true;
    t.x = x;
    t.y = y;
    t.vy = 1.6;
    t.life = 0;
    t.max = 1.1;
    t.str = str;
    t.color = color;
    t.size = size;
  },

  /** Camera shake: adds trauma (0..1); the offset is trauma squared. Never for small things. */
  shake(amount) {
    if (reduced) return;
    trauma = Math.min(1, trauma + amount);
  },

  freeze(ms) {
    if (reduced) return;
    this.freezeT = Math.max(this.freezeT, ms / 1000);
  },

  flash(color = '#ffffff', amount = 0.5) {
    if (reduced) return;
    flashColor = color;
    flashA = Math.max(flashA, amount);
  },

  update(dt) {
    clock += dt;
    trauma = Math.max(0, trauma - dt * 1.6);
    flashA = Math.max(0, flashA - dt * 2.6);
    for (const p of particles) {
      if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.on = false;
        continue;
      }
      p.vy += p.g * dt;
      if (p.kind === CONFETTI_K) {
        p.vx *= 1 - 1.4 * dt;
        p.vy = Math.max(p.vy, -2.6);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (const t of texts) {
      if (!t.on) continue;
      t.life += dt;
      if (t.life >= t.max) t.on = false;
      else t.y += t.vy * dt * (1 - t.life / t.max);
    }
  },

  /** The camera shake offset in pixels: smooth sines, never random jitter. */
  shakeOffset(out) {
    const a = trauma * trauma * 14;
    out.x = (Math.sin(clock * 47) + Math.sin(clock * 29 + 1.3)) * 0.5 * a;
    out.y = (Math.sin(clock * 41 + 2.1) + Math.sin(clock * 23 + 0.4)) * 0.5 * a;
    return out;
  },

  get trauma() {
    return trauma;
  },

  /** World-space particles. `view` maps world to pixels: x px = view.ox + x * view.S, y px = view.base - (y - view.camY) * view.S. */
  draw(ctx, view) {
    const S = view.S;
    for (const p of particles) {
      if (!p.on) continue;
      const u = p.life / p.max;
      const px = view.ox + p.x * S;
      const py = view.base - (p.y - view.camY) * S;
      if (py < -60 || py > view.H + 60 || px < -60 || px > view.W + 60) continue;
      switch (p.kind) {
        case DUST: {
          ctx.globalAlpha = 0.55 * (1 - u);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(px, py, p.size * S * (0.7 + u * 1.1), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case SMOKE: {
          ctx.globalAlpha = 0.7 * (1 - u);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(px, py, p.size * S * (0.6 + u * 1.2), 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = INK;
          ctx.stroke();
          break;
        }
        case SPARK: {
          ctx.globalAlpha = 1 - u;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(2, p.size * S * 0.9);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - p.vx * 0.045 * S, py + p.vy * 0.045 * S);
          ctx.stroke();
          break;
        }
        case CONFETTI_K: {
          ctx.globalAlpha = u > 0.8 ? (1 - u) / 0.2 : 1;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(p.rot);
          const w = p.size * S;
          ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.8 + 0.2);
          ctx.fillStyle = p.color;
          ctx.fillRect(-w / 2, -w * 0.3, w, w * 0.6);
          ctx.restore();
          break;
        }
        case STAR: {
          ctx.globalAlpha = 1 - u * u;
          star(ctx, px, py, p.size * S * (1 - u * 0.4), 4, 0.35, p.rot);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = INK;
          ctx.stroke();
          break;
        }
        case RING: {
          ctx.globalAlpha = 1 - u;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(2, 0.14 * S * (1 - u));
          ctx.beginPath();
          ctx.arc(px, py, p.size * S * (0.2 + u * 0.9), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        default:
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  },

  drawTexts(ctx, view) {
    for (const t of texts) {
      if (!t.on) continue;
      const u = t.life / t.max;
      const px = view.ox + t.x * view.S;
      const py = view.base - (t.y - view.camY) * view.S;
      const pop = u < 0.2 ? easeOutBack(u / 0.2) : 1;
      ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      outlined(ctx, t.str, px, py, t.size * Math.max(0.2, pop), t.color);
    }
    ctx.globalAlpha = 1;
  },

  drawFlash(ctx, W, H) {
    if (flashA <= 0.01) return;
    ctx.globalAlpha = Math.min(0.6, flashA);
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  },
};

function take() {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[(cursor + i) % MAX_PARTICLES];
    if (!p.on) {
      cursor = (cursor + i + 1) % MAX_PARTICLES;
      p.on = true;
      p.rot = 0;
      p.vr = 0;
      return p;
    }
  }
  // Full: take the next one anyway (the oldest is nearly done).
  const p = particles[cursor];
  cursor = (cursor + 1) % MAX_PARTICLES;
  p.on = true;
  p.rot = 0;
  p.vr = 0;
  return p;
}

/** A pop: 0 before it starts, overshoots a little, settles at 1. */
export function popScale(age, dur = 0.4) {
  if (age <= 0) return 0;
  if (age >= dur) return 1;
  return easeOutBack(clamp(age / dur, 0, 1));
}
