// Drawing the world: the grassy field, the Watcher, the characters, the scan beam. Everything takes a `view` that maps world units to
// pixels: x px = view.ox + x * view.S, y px = view.base - (y - view.camY) * view.S (y grows up the field and up the screen).

import { FIELD_LEN, FIELD_W, WATCHER_Y, clamp, hashStr, isBot, mulberry32 } from './rules.js';
import { S_DONE, S_GHOST, S_RUN, S_ZAP, S_ZIP } from './sim.js';
import { fx } from './fx.js';
import { GREEN, INK, RED, YELLOW, circle, ellipse, outlined, plate, rr, shade } from './style.js';

// ---------------------------------------------------------------- view

export function makeView(W, H, camY = 0, visH = 14) {
  const S = Math.min(H / visH, W / 13);
  return { W, H, S, ox: W / 2 - (FIELD_W / 2) * S, base: Math.round(H * 0.68), camY };
}

/** Keeps the camera on the field: the start line and the Watcher can always be reached, nothing past them is shown. */
export function clampCam(v, y) {
  const lo = -2.5 + (v.H - v.base) / v.S;
  const hi = 68 - v.base / v.S;
  return lo > hi ? (lo + hi) / 2 : clamp(y, lo, hi);
}

export const worldX = (v, x) => v.ox + x * v.S;
export const worldY = (v, y) => v.base - (y - v.camY) * v.S;

// ---------------------------------------------------------------- avatars

const avatars = new Map();
let avatarSource = null;

/** `fn(id)` resolves with an image URL (or null). Set once by main. */
export function setAvatarSource(fn) {
  avatarSource = fn;
}

/** The loaded head image of a player, or null (not loaded yet, a bot, or no avatar): draw a default face then. */
export function getAvatar(id) {
  let e = avatars.get(id);
  if (!e) {
    e = { img: null, ok: false };
    avatars.set(id, e);
    if (avatarSource && !isBot(id)) {
      Promise.resolve()
        .then(() => avatarSource(id))
        .then((url) => {
          if (!url || typeof Image === 'undefined') return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            e.ok = true;
          };
          img.onerror = () => {};
          e.img = img;
          img.src = url;
        })
        .catch(() => {});
    }
  }
  return e.ok ? e.img : null;
}

// ---------------------------------------------------------------- the field

const DECOR = (() => {
  const rng = mulberry32(2024);
  const list = [];
  for (let y = -4; y < 70; y += 2.1) {
    for (const side of [-1, 1]) {
      const n = rng() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const off = 1.8 + rng() * 10;
        const r = rng();
        list.push({ x: side < 0 ? -off : FIELD_W + off, y: y + rng() * 2, kind: r < 0.5 ? 0 : r < 0.72 ? 1 : 2, s: 0.8 + rng() * 0.7, hue: rng() });
      }
    }
  }
  list.sort((a, b) => b.y - a.y);
  return list;
})();

const FLOWERS = ['#ff6fb5', '#ffd42a', '#ffffff', '#ff8a3d'];

function drawDecor(ctx, v) {
  const S = v.S;
  for (const d of DECOR) {
    const px = worldX(v, d.x);
    const py = worldY(v, d.y);
    const u = S * d.s;
    if (py - 3.6 * u > v.H || py + 1.4 * u < 0 || px < -3 * u || px > v.W + 3 * u) continue;
    const lw = clamp(0.09 * u, 2, 4.5);
    if (d.kind === 0) {
      ellipse(ctx, px + 0.25 * u, py + 0.1 * u, 1.0 * u, 0.36 * u, 'rgba(30,60,30,0.28)');
      ctx.fillStyle = '#b5733a';
      ctx.fillRect(px - 0.2 * u, py - 0.85 * u, 0.4 * u, 0.95 * u);
      ctx.lineWidth = lw;
      ctx.strokeStyle = INK;
      ctx.strokeRect(px - 0.2 * u, py - 0.85 * u, 0.4 * u, 0.95 * u);
      circle(ctx, px, py - 1.8 * u, 1.15 * u, d.hue < 0.5 ? '#2fa84f' : '#3dbb5a', lw, INK);
      circle(ctx, px - 0.4 * u, py - 2.15 * u, 0.4 * u, 'rgba(255,255,255,0.22)');
    } else if (d.kind === 1) {
      ellipse(ctx, px + 0.2 * u, py + 0.05 * u, 0.9 * u, 0.3 * u, 'rgba(30,60,30,0.25)');
      ellipse(ctx, px, py - 0.4 * u, 0.85 * u, 0.6 * u, '#34b455', lw, INK);
      circle(ctx, px - 0.3 * u, py - 0.6 * u, 0.22 * u, 'rgba(255,255,255,0.22)');
    } else {
      for (let i = 0; i < 4; i++) {
        const fx0 = px + (i - 1.5) * 0.45 * u;
        const fy0 = py - (i % 2) * 0.25 * u;
        ctx.strokeStyle = '#2a8a3e';
        ctx.lineWidth = Math.max(2, 0.07 * u);
        ctx.beginPath();
        ctx.moveTo(fx0, fy0);
        ctx.lineTo(fx0, fy0 - 0.35 * u);
        ctx.stroke();
        circle(ctx, fx0, fy0 - 0.45 * u, 0.2 * u, FLOWERS[(i + ((d.hue * 4) | 0)) % 4], Math.max(1.5, 0.05 * u), INK);
      }
    }
  }
}

function drawFence(ctx, v, y, color) {
  const S = v.S;
  const py = worldY(v, y);
  if (py < -S || py > v.H + S) return;
  ctx.fillStyle = color;
  ctx.fillRect(0, py - 0.25 * S, v.W, 0.3 * S);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.strokeRect(-4, py - 0.25 * S, v.W + 8, 0.3 * S);
}

/** Grass, mowing stripes, chalk lines, distance signs, the START line. */
export function drawField(ctx, v) {
  const S = v.S;
  const top = v.camY + v.base / S; // world y at the top of the screen
  const bottom = v.camY - (v.H - v.base) / S;
  // the verge
  ctx.fillStyle = '#5db845';
  ctx.fillRect(0, 0, v.W, v.H);
  ctx.fillStyle = '#57ad40';
  for (let k = Math.floor(bottom / 6) - 1; k <= Math.ceil(top / 6); k++) {
    if (k % 2 === 0) ctx.fillRect(0, worldY(v, (k + 1) * 6), v.W, 6 * S + 1);
  }
  // the field, from the fence (y -3) to the hedge (y 67.2), in mowing stripes
  const x0 = worldX(v, 0);
  const fw = FIELD_W * S;
  for (let k = Math.floor(bottom / 3) - 1; k <= Math.ceil(top / 3); k++) {
    const lo = Math.max(k * 3, -3);
    const hi = Math.min((k + 1) * 3, 67.2);
    if (hi <= lo) continue;
    ctx.fillStyle = k % 2 === 0 ? '#8ae05c' : '#7fd554';
    ctx.fillRect(x0, worldY(v, hi), fw, (hi - lo) * S + 1);
  }
  // the hedge behind the Watcher: bumps along its front edge, solid above
  const edgeY = worldY(v, 67.2);
  if (edgeY > -S) {
    for (let x = -S; x < v.W + S; x += 1.35 * S) circle(ctx, x, edgeY, 0.85 * S, '#2d9448', 3, INK);
    ctx.fillStyle = '#2d9448';
    ctx.fillRect(0, 0, v.W, Math.max(0, edgeY));
  }

  drawDecor(ctx, v);
  drawFence(ctx, v, -3, '#c98a52');

  // chalk
  const chalk = 'rgba(255,255,255,0.92)';
  const yTop = worldY(v, FIELD_LEN + 2);
  const yBot = worldY(v, -1.5);
  ctx.strokeStyle = chalk;
  ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(3, 0.16 * S);
  ctx.beginPath();
  ctx.moveTo(x0, yTop);
  ctx.lineTo(x0, yBot);
  ctx.moveTo(x0 + fw, yTop);
  ctx.lineTo(x0 + fw, yBot);
  ctx.stroke();
  ctx.lineWidth = Math.max(2, 0.07 * S);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.setLineDash([1.1 * S, 0.9 * S]);
  ctx.beginPath();
  for (let lane = 2; lane < FIELD_W; lane += 2) {
    ctx.moveTo(worldX(v, lane), yTop);
    ctx.lineTo(worldX(v, lane), yBot);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // distance signs every quarter
  for (const [y, label] of [
    [15, '25%'],
    [30, '50%'],
    [45, '75%'],
  ]) {
    const py = worldY(v, y);
    if (py < -S || py > v.H + S) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(2, 0.1 * S);
    ctx.setLineDash([0.6 * S, 0.5 * S]);
    ctx.beginPath();
    ctx.moveTo(x0, py);
    ctx.lineTo(x0 + fw, py);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const sx of [x0 - 1.3 * S, x0 + fw + 1.3 * S]) {
      ctx.fillStyle = '#b5733a';
      ctx.fillRect(sx - 0.07 * S, py - 0.1 * S, 0.14 * S, 0.9 * S);
      plate(ctx, sx - 0.7 * S, py - 1.0 * S, 1.4 * S, 0.8 * S, 0.2 * S, '#fff8e8', Math.max(2, 0.07 * S), 0);
      outlined(ctx, label, sx, py - 0.6 * S, 0.5 * S, INK, '#fff8e8', 'center', 'middle', 0);
    }
  }

  // START
  const sy = worldY(v, 0.6);
  if (sy > -S && sy < v.H + 3 * S) {
    const cell = 0.4 * S;
    const cols = Math.round((FIELD_W * S) / cell);
    for (let i = 0; i < cols; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : INK;
      ctx.fillRect(x0 + i * cell, sy - cell, cell, cell);
      ctx.fillStyle = i % 2 === 0 ? INK : '#ffffff';
      ctx.fillRect(x0 + i * cell, sy, cell, cell);
    }
    outlined(ctx, 'START', worldX(v, FIELD_W / 2), worldY(v, -1.5), 1.25 * S, '#ffffff', INK, 'center', 'middle');
  }
}

// ---------------------------------------------------------------- the finish

/** The FINISH gantry and the ribbon. `ribbon` is -1 while the ribbon is whole, else seconds since it broke. */
export function drawFinish(ctx, v, ribbon) {
  const S = v.S;
  const py = worldY(v, FIELD_LEN);
  if (py < -4 * S || py > v.H + 3 * S) return;
  const xl = worldX(v, -0.4);
  const xr = worldX(v, FIELD_W + 0.4);
  const lw = clamp(0.09 * S, 2.5, 5);
  // posts
  for (const x of [xl, xr]) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 0.17 * S, py - 2.1 * S, 0.34 * S, 2.2 * S);
    ctx.fillStyle = RED;
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 0.17 * S, py - 2.1 * S + i * 0.55 * S, 0.34 * S, 0.27 * S);
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.strokeRect(x - 0.17 * S, py - 2.1 * S, 0.34 * S, 2.2 * S);
  }
  // the banner
  const bx = xl - 0.2 * S;
  const bw = xr - xl + 0.4 * S;
  const by = py - 2.35 * S;
  const bh = 1.15 * S;
  plate(ctx, bx, by, bw, bh, 0.2 * S, '#ffffff', lw, 0.12 * S);
  const cell = 0.28 * S;
  ctx.save();
  rr(ctx, bx, by, bw, bh, 0.2 * S);
  ctx.clip();
  for (let i = 0; i * cell < bw; i++) {
    ctx.fillStyle = INK;
    if (i % 2 === 0) ctx.fillRect(bx + i * cell, by, cell, cell);
    else ctx.fillRect(bx + i * cell, by + bh - cell, cell, cell);
  }
  ctx.restore();
  outlined(ctx, 'FINISH', (xl + xr) / 2, by + bh / 2, 0.62 * S, '#ffffff', INK, 'center', 'middle');
  // the ribbon
  const rw = Math.max(5, 0.3 * S);
  ctx.lineCap = 'round';
  if (ribbon < 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = rw + lw;
    ctx.beginPath();
    ctx.moveTo(worldX(v, 0), py);
    ctx.lineTo(worldX(v, FIELD_W), py);
    ctx.stroke();
    ctx.strokeStyle = RED;
    ctx.lineWidth = rw;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([0.45 * S, 0.45 * S]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const fall = Math.min(1, ribbon / 0.6);
    for (const side of [-1, 1]) {
      const x0 = worldX(v, side < 0 ? 0 : FIELD_W);
      const sway = Math.sin(ribbon * 7) * 0.25 * S * (1 - fall * 0.5);
      const x1 = x0 - side * (2.6 + fall * 0.8) * S;
      const y1 = py + (0.2 + fall * 1.3) * S;
      ctx.beginPath();
      ctx.moveTo(x0, py);
      ctx.quadraticCurveTo((x0 + x1) / 2 + sway, py + 0.5 * S, x1, y1);
      ctx.strokeStyle = INK;
      ctx.lineWidth = rw + lw;
      ctx.stroke();
      ctx.strokeStyle = RED;
      ctx.lineWidth = rw;
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

// ---------------------------------------------------------------- the Watcher

const BODY = '#4aa8ff';
const BODY_DARK = '#2f86e0';
const LAMPS = [GREEN, YELLOW, RED];

/**
 * The Watcher: a big friendly round robot with a lamp. It faces away on green (you see its back and the antenna wiggling), turns on
 * yellow and faces the field on red with wide eyes. `light` is lightAt()'s answer (c, turn); o.lamp 'split' lights half green, half red.
 */
export function drawWatcher(ctx, cx, cy, S, light, t, o = {}) {
  const turn = o.turn ?? light?.turn ?? 0;
  const c = o.c ?? light?.c ?? 0;
  const front = turn >= 0.5;
  const w = Math.max(0.05, Math.abs(Math.cos(turn * Math.PI)));
  const lw = clamp(0.1 * S, 2.2, 6);
  const hop = c === 1 ? -Math.abs(Math.sin(t * 14)) * 0.12 * S : Math.sin(t * 3) * 0.04 * S;
  ctx.save();
  ellipse(ctx, cx + 0.25 * S, cy + 2.45 * S, 2.1 * S, 0.55 * S, 'rgba(30,20,50,0.28)');
  ctx.translate(cx, cy + hop);
  ctx.scale(w, 1);
  // antenna
  const sway = Math.sin(t * (c === 0 ? 5 : 11)) * 0.4 * S;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -1.9 * S);
  ctx.quadraticCurveTo(sway * 0.3, -2.5 * S, sway, -3.0 * S);
  ctx.stroke();
  circle(ctx, sway, -3.1 * S, 0.3 * S, YELLOW, lw, INK);
  // feet and arms
  ellipse(ctx, -0.9 * S, 2.0 * S, 0.7 * S, 0.42 * S, BODY_DARK, lw, INK);
  ellipse(ctx, 0.9 * S, 2.0 * S, 0.7 * S, 0.42 * S, BODY_DARK, lw, INK);
  const wave = c === 1 ? Math.sin(t * 16) * 0.25 * S : 0;
  circle(ctx, -2.1 * S, 0.4 * S + wave, 0.5 * S, BODY, lw, INK);
  circle(ctx, 2.1 * S, 0.4 * S - wave, 0.5 * S, BODY, lw, INK);
  // body
  circle(ctx, 0, 0, 2.0 * S, BODY, lw * 1.2, INK);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, 2.0 * S - lw * 0.6, 0, Math.PI * 2);
  ctx.clip();
  circle(ctx, -0.5 * S, 1.2 * S, 1.9 * S, 'rgba(255,255,255,0.14)');
  ctx.restore();
  // the lamp (on the face when it looks at you, on its back when it doesn't)
  const ly = front ? -0.62 * S : -0.55 * S;
  const lr = front ? 0.74 * S : 0.62 * S;
  if (front) {
    ellipse(ctx, 0, 0.15 * S, 1.6 * S, 1.45 * S, '#eef8ff', lw, INK);
  } else {
    rr(ctx, -1.05 * S, -1.2 * S, 2.1 * S, 2.5 * S, 0.55 * S);
    ctx.fillStyle = BODY_DARK;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,20,60,0.45)';
    ctx.lineWidth = Math.max(2, 0.09 * S);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.55 * S, (0.45 + i * 0.28) * S);
      ctx.lineTo(0.55 * S, (0.45 + i * 0.28) * S);
      ctx.stroke();
    }
  }
  circle(ctx, 0, ly, lr * 1.28, '#2b2f3a', lw, INK);
  if (o.lamp === 'split') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, ly, lr, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = GREEN;
    ctx.fillRect(-lr, ly - lr, lr, lr * 2);
    ctx.fillStyle = RED;
    ctx.fillRect(0, ly - lr, lr, lr * 2);
    ctx.restore();
    ctx.globalAlpha = 0.25;
    circle(ctx, -lr * 0.5, ly, lr * 1.5, GREEN);
    circle(ctx, lr * 0.5, ly, lr * 1.5, RED);
    ctx.globalAlpha = 1;
  } else {
    ctx.globalAlpha = 0.3 + (c === 2 ? 0.1 * Math.sin(t * 8) : 0);
    circle(ctx, 0, ly, lr * 1.9, LAMPS[c]);
    ctx.globalAlpha = 1;
    circle(ctx, 0, ly, lr, LAMPS[c], 0);
  }
  circle(ctx, -lr * 0.3, ly - lr * 0.32, lr * 0.26, 'rgba(255,255,255,0.7)');
  if (front) {
    const wide = c === 2 ? 1.18 : 1;
    for (const sx of [-1, 1]) {
      circle(ctx, sx * 0.85 * S, 0.62 * S, 0.43 * S * wide, '#ffffff', lw, INK);
      circle(ctx, sx * 0.85 * S, (0.68 + (c === 2 ? 0.06 : 0)) * S, 0.2 * S * (c === 2 ? 0.8 : 1), INK);
    }
    if (c === 2) ellipse(ctx, 0, 1.45 * S, 0.22 * S, 0.28 * S, '#7a1d2a', lw * 0.8, INK);
    else {
      ctx.beginPath();
      ctx.arc(0, 1.2 * S, 0.4 * S, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = lw;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
  ctx.restore();
}

/** The scan beam sweeping the field while the Watcher looks. */
export function drawBeam(ctx, v, light, t) {
  if (!light || light.wait) return;
  const a = clamp((light.turn - 0.82) / 0.18, 0, 1);
  if (a <= 0 || light.c !== 2) return;
  const S = v.S;
  const ox = worldX(v, FIELD_W / 2);
  const oy = worldY(v, WATCHER_Y - 0.6);
  const dir = Math.PI / 2 + Math.sin(t * 1.9) * 0.5;
  const len = 34 * S;
  const half = 0.36;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + Math.cos(dir - half) * len, oy + Math.sin(dir - half) * len);
  ctx.lineTo(ox + Math.cos(dir + half) * len, oy + Math.sin(dir + half) * len);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,60,60,0.15)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + Math.cos(dir - half * 0.3) * len, oy + Math.sin(dir - half * 0.3) * len);
  ctx.lineTo(ox + Math.cos(dir + half * 0.3) * len, oy + Math.sin(dir + half * 0.3) * len);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,90,90,0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,70,70,0.55)';
  ctx.lineWidth = Math.max(2, 0.08 * S);
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + Math.cos(dir) * len, oy + Math.sin(dir) * len);
  ctx.stroke();
  ctx.restore();
}

/** Zap lines from the Watcher to everyone who was just caught. */
export function drawZaps(ctx, v, chars, n, t) {
  const S = v.S;
  const ox = worldX(v, FIELD_W / 2);
  const oy = worldY(v, WATCHER_Y - 0.4);
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    if (ch.s !== S_ZAP) continue;
    const tx = worldX(v, ch.x);
    const ty = worldY(v, ch.y) - 0.9 * S;
    if (ty > v.H + S || ty < -v.H) continue;
    const segs = 7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [col, lw] of [
      [INK, 0.2 * S],
      [RED, 0.12 * S],
      ['#ffffff', 0.05 * S],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, lw);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      for (let k = 1; k < segs; k++) {
        const f = k / segs;
        const jitter = Math.sin(t * 70 + k * 2.3 + i) * 0.35 * S * Math.sin(f * Math.PI);
        ctx.lineTo(ox + (tx - ox) * f + jitter, oy + (ty - oy) * f + jitter * 0.4);
      }
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    circle(ctx, tx, ty, 0.55 * S * (0.8 + 0.2 * Math.sin(t * 40)), 'rgba(255,255,255,0.55)');
  }
}

// ---------------------------------------------------------------- characters

export function makeVis(id) {
  return { ph: (hashStr(id) % 628) / 100, q: 0, qv: 0, skid: 0, prevVy: 0, seed: hashStr(id), hop: 0, last: 0 };
}

/** Advances a character's look (stride, squash spring, skid) by dt. `ch` has vy and s. */
export function animChar(vis, ch, dt) {
  const moving = ch.s === S_RUN || ch.s === S_GHOST;
  vis.ph += (moving ? ch.vy : 0) * 2.4 * dt;
  vis.skid = Math.max(0, vis.skid - dt * 3.5);
  if (ch.s === S_RUN && dt > 0 && (vis.prevVy - ch.vy) / dt > 8 && ch.vy > 0.8) vis.skid = 1;
  vis.prevVy = ch.vy;
  vis.qv += (-150 * vis.q - 13 * vis.qv) * dt;
  vis.q += vis.qv * dt;
  if (vis.q > 0.6) vis.q = 0.6;
  if (vis.q < -0.6) vis.q = -0.6;
  if (vis.hop > 0) vis.hop = Math.max(0, vis.hop - dt * 2.2);
}

/** Squash (positive) or stretch (negative) with a spring. */
export function bump(vis, amount) {
  vis.q = amount;
  vis.qv = 0;
}

/** A cute face on a head circle (bots, and players whose avatar hasn't loaded). */
export function drawFace(ctx, x, y, r, seed, mood, antenna = false, color = '#fff') {
  const lw = clamp(r * 0.14, 2, 4.5);
  if (antenna) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.9);
    ctx.lineTo(x + r * 0.12, y - r * 1.55);
    ctx.stroke();
    ctx.lineCap = 'butt';
    circle(ctx, x + r * 0.12, y - r * 1.62, r * 0.2, color, lw * 0.8, INK);
  }
  circle(ctx, x, y, r, `hsl(${seed % 360},72%,76%)`, lw, INK);
  const kind = (seed >>> 3) % 3;
  const ex = r * 0.4;
  const ey = y - r * 0.08;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 0.8;
  if (mood === 'zap') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * ex - r * 0.14, ey - r * 0.14);
      ctx.lineTo(x + s * ex + r * 0.14, ey + r * 0.14);
      ctx.moveTo(x + s * ex + r * 0.14, ey - r * 0.14);
      ctx.lineTo(x + s * ex - r * 0.14, ey + r * 0.14);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - r * 0.3, y + r * 0.45);
    ctx.lineTo(x - r * 0.1, y + r * 0.3);
    ctx.lineTo(x + r * 0.1, y + r * 0.45);
    ctx.lineTo(x + r * 0.3, y + r * 0.3);
    ctx.stroke();
  } else if (mood === 'happy') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + s * ex, ey + r * 0.08, r * 0.15, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y + r * 0.22, r * 0.34, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = '#7a1d2a';
    ctx.fill();
    ctx.stroke();
  } else {
    const wide = mood === 'scared';
    for (const s of [-1, 1]) {
      if (kind === 0 && !wide) circle(ctx, x + s * ex, ey, r * 0.13, INK);
      else {
        circle(ctx, x + s * ex, ey, r * (wide ? 0.27 : 0.22), '#ffffff', lw * 0.6, INK);
        circle(ctx, x + s * ex, ey + r * 0.04, r * (wide ? 0.08 : 0.11), INK);
      }
    }
    if (mood === 'scared' || mood === 'ghost') ellipse(ctx, x, y + r * 0.42, r * 0.13, r * 0.18, '#7a1d2a', lw * 0.7, INK);
    else {
      ctx.beginPath();
      ctx.arc(x, y + r * 0.12, r * 0.38, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }
  }
  if (mood !== 'zap') {
    ctx.globalAlpha *= 0.5;
    circle(ctx, x - r * 0.62, y + r * 0.25, r * 0.13, '#ff7fa8');
    circle(ctx, x + r * 0.62, y + r * 0.25, r * 0.13, '#ff7fa8');
    ctx.globalAlpha /= 0.5;
  }
}

/**
 * One character. ch: { x, y, vx, vy, s, color, bot, avatar (Image|null), mood, away, alpha, isMe, vis, face (number) }.
 * The feet are at (x, y). Everything is drawn relative to the feet.
 */
export function drawChar(ctx, v, ch, t) {
  const S = v.S;
  const px = worldX(v, ch.x);
  const py = worldY(v, ch.y);
  if (py < -3 * S || py > v.H + 2 * S || px < -2 * S || px > v.W + 2 * S) return;
  const vis = ch.vis;
  const s = ch.s;
  const lw = clamp(0.085 * S, 2.4, 5);
  let alpha = ch.alpha === undefined ? 1 : ch.alpha;
  if (s === S_GHOST) alpha *= 0.42;
  if (ch.away) alpha *= 0.55;
  const spd = s === S_RUN || s === S_GHOST ? Math.min(1, ch.vy / 4) : 0;
  const ph = vis.ph;
  let bob = -Math.abs(Math.sin(ph)) * 0.14 * spd;
  let tilt = clamp(ch.vx / 3, -1, 1) * 0.16 + Math.sin(ph) * 0.05 * spd;
  let sxs = 1 + vis.q * 0.7 + vis.skid * 0.16;
  let sys = 1 - vis.q * 0.7 - vis.skid * 0.12;
  let shakeX = 0;
  let arms = 0;
  if (s === S_RUN && spd === 0) {
    const breathe = Math.sin(t * 3 + vis.seed) * 0.015;
    sys += breathe;
    sxs -= breathe;
  }
  if (s === S_ZAP) {
    shakeX = Math.sin(t * 90) * 0.06 * S;
    arms = 1;
  } else if (s === S_ZIP) {
    sys *= 1.25;
    sxs *= 0.82;
    alpha *= 0.85;
  } else if (s === S_DONE) {
    bob = -Math.abs(Math.sin(t * 7 + vis.seed)) * 0.3;
    arms = 1;
  } else if (s === S_GHOST) {
    bob = -0.25 + Math.sin(t * 2.6 + vis.seed) * 0.12;
  }
  if (ch.hop) bob -= Math.sin(clamp(ch.hop, 0, 1) * Math.PI) * 0.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  // the ring under your own character, and its shadow (a flat darker shape)
  if (ch.isMe) {
    ctx.lineWidth = Math.max(3, 0.1 * S);
    ctx.strokeStyle = `rgba(255,255,255,${0.7 + 0.25 * Math.sin(t * 5)})`;
    ctx.beginPath();
    ctx.ellipse(px, py + 0.04 * S, 0.78 * S, 0.34 * S, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (s !== S_GHOST) ellipse(ctx, px + 0.08 * S, py + 0.04 * S, 0.52 * S * (1 + bob * 0.2), 0.2 * S, 'rgba(30,20,50,0.3)');
  if (s === S_ZIP) {
    // speed lines trailing up the field
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(2, 0.07 * S);
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(px + i * 0.3 * S, py - 1.4 * S);
      ctx.lineTo(px + i * 0.3 * S, py - (2.0 + 0.4 * ((i + 3) % 3)) * S);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  ctx.translate(px + shakeX, py + bob * S);
  ctx.rotate(tilt);
  ctx.scale(sxs, sys);
  const flashing = s === S_ZAP && Math.floor(t * 16) % 2 === 0;
  const body = flashing ? '#ffffff' : s === S_GHOST ? '#dff2ff' : ch.color;
  const dark = flashing ? '#ffd0d0' : shade(ch.color, -0.28);
  // feet
  const step = Math.sin(ph) * 0.13 * spd * S;
  const fcol = flashing ? '#ffffff' : s === S_GHOST ? '#bfe0f5' : dark;
  ellipse(ctx, -0.22 * S, -0.06 * S - step, 0.17 * S, 0.12 * S, fcol, lw, INK);
  ellipse(ctx, 0.22 * S, -0.06 * S + step, 0.17 * S, 0.12 * S, fcol, lw, INK);
  // arms
  const swing = Math.sin(ph) * 0.12 * spd * S;
  const armY = arms ? -0.95 * S : -0.45 * S;
  const armX = arms ? 0.56 * S : 0.55 * S;
  circle(ctx, -armX, armY + (arms ? 0 : swing), 0.15 * S, fcol, lw, INK);
  circle(ctx, armX, armY - (arms ? 0 : swing), 0.15 * S, fcol, lw, INK);
  // body
  rr(ctx, -0.44 * S, -0.78 * S, 0.88 * S, 0.7 * S, 0.3 * S);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(-0.18 * S, -0.58 * S, 0.12 * S, 0.07 * S, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // head
  const hy = -1.12 * S;
  const hr = 0.47 * S;
  const mood = ch.mood || 'ok';
  if (ch.avatar) {
    circle(ctx, 0, hy, hr, shade(ch.color, 0.6), lw, INK);
    const nw = ch.avatar.naturalWidth || 1;
    const nh = ch.avatar.naturalHeight || 1;
    const k = Math.min((1.12 * S) / nw, (1.12 * S) / nh);
    try {
      ctx.drawImage(ch.avatar, -(nw * k) / 2, hy - (nh * k) / 2 + 0.04 * S, nw * k, nh * k);
    } catch {
      // a broken image: the plain head shows
    }
    if (mood === 'zap') {
      ctx.strokeStyle = RED;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(0, hy, hr * 1.05, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else drawFace(ctx, 0, hy, hr, ch.face >>> 0, mood, Boolean(ch.bot), ch.color);
  if (flashing) {
    ctx.globalAlpha = alpha * 0.35;
    circle(ctx, 0, -0.6 * S, 0.9 * S, '#ff3b3b');
  }
  ctx.restore();
}

/** Name tags, READY checks and the "YOU" arrow, on top of everyone. `chars` have name, ready, showYou. */
export function drawTags(ctx, v, chars, n, t, o = {}) {
  const S = v.S;
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const px = worldX(v, ch.x);
    const py = worldY(v, ch.y);
    if (py < -2 * S || py > v.H + 3 * S || px < -2 * S || px > v.W + 2 * S) continue;
    let alpha = ch.alpha === undefined ? 1 : ch.alpha;
    if (ch.s === S_GHOST) alpha *= 0.6;
    if (ch.away) alpha *= 0.6;
    ctx.globalAlpha = alpha;
    if (ch.name && o.names !== false) outlined(ctx, ch.name, px, py + 0.62 * S, Math.max(11, 0.4 * S), '#ffffff', INK, 'center', 'middle', Math.max(3, 0.08 * S));
    ctx.globalAlpha = 1;
    let top = py - 1.95 * S;
    if (ch.ready) {
      const wob = Math.sin(t * 6 + i) * 0.06 * S;
      const h = Math.max(28, 0.9 * S);
      const w = h * 3.1;
      plate(ctx, px - w / 2, top - h + wob, w, h, h / 2, GREEN, Math.max(2.5, 0.07 * S), 0);
      outlined(ctx, 'READY', px + h * 0.28, top - h / 2 + wob, h * 0.58, '#ffffff', INK, 'center', 'middle', Math.max(2.5, h * 0.12));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(3, h * 0.13);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(px - w / 2 + h * 0.5, top - h / 2 + wob);
      ctx.lineTo(px - w / 2 + h * 0.68, top - h * 0.32 + wob);
      ctx.lineTo(px - w / 2 + h * 0.98, top - h * 0.7 + wob);
      ctx.stroke();
      ctx.lineCap = 'butt';
      top -= h + 4;
    }
    if (ch.showYou) {
      const bounce = Math.abs(Math.sin(t * 5)) * 0.35 * S;
      const ay = top - 0.1 * S - bounce;
      const aw = 0.45 * S;
      ctx.beginPath();
      ctx.moveTo(px, ay + 0.1 * S);
      ctx.lineTo(px - aw, ay - 0.5 * S);
      ctx.lineTo(px + aw, ay - 0.5 * S);
      ctx.closePath();
      ctx.fillStyle = '#ffd42a';
      ctx.fill();
      ctx.lineWidth = Math.max(3, 0.08 * S);
      ctx.strokeStyle = INK;
      ctx.lineJoin = 'round';
      ctx.stroke();
      outlined(ctx, 'YOU', px, ay - 0.95 * S, Math.max(13, 0.55 * S), '#ffd42a', INK);
    }
  }
}

/** Three chevrons pulsing up the lane ahead of a character that hasn't started: the way is up the field. */
export function drawGuide(ctx, v, x, y, t) {
  const S = v.S;
  const px = worldX(v, x);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const phase = (t * 1.6 - i * 0.28) % 1.6;
    const a = Math.max(0, 1 - Math.abs(phase - 0.5) * 1.6);
    if (a <= 0) continue;
    const cy = worldY(v, y + 2.2 + i * 1.1);
    ctx.globalAlpha = a * 0.9;
    for (const [col, lw] of [
      [INK, 0.34 * S],
      ['#ffffff', 0.2 * S],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(3, lw);
      ctx.beginPath();
      ctx.moveTo(px - 0.55 * S, cy + 0.25 * S);
      ctx.lineTo(px, cy - 0.25 * S);
      ctx.lineTo(px + 0.55 * S, cy + 0.25 * S);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

// ---------------------------------------------------------------- the whole scene

/**
 * Draws the world for a frame. sc: { light, t, ribbon, chars, n, tagOptions, skipFx } (chars sorted or not: they're sorted here, far
 * ones first). The caller draws the HUD and screens on top.
 */
export function drawScene(ctx, v, sc) {
  drawField(ctx, v);
  drawWatcher(ctx, worldX(v, FIELD_W / 2), worldY(v, WATCHER_Y), v.S, sc.light, sc.t);
  drawFinish(ctx, v, sc.ribbon);
  const chars = sc.chars;
  // far ones first (a small insertion sort: at most a dozen)
  for (let i = 1; i < sc.n; i++) {
    const c = chars[i];
    let j = i - 1;
    while (j >= 0 && chars[j].y < c.y) {
      chars[j + 1] = chars[j];
      j--;
    }
    chars[j + 1] = c;
  }
  for (let i = 0; i < sc.n; i++) drawChar(ctx, v, chars[i], sc.t);
  drawZaps(ctx, v, chars, sc.n, sc.t);
  drawBeam(ctx, v, sc.light, sc.t);
  if (!sc.skipFx) fx.draw(ctx, v);
  drawTags(ctx, v, chars, sc.n, sc.t, sc.tagOptions);
  if (!sc.skipFx) fx.drawTexts(ctx, v);
}
