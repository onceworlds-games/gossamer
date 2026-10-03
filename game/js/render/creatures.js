// Everything alive: spiders on IK legs that grip real threads, the prey (each its own silhouette and wingbeat),
// wasps in stripes, the wren and its shadow, the mantis, fireflies, lures and bolas balls.
import { PREY, T_SURFACE, N_PREY, W, GROUND } from '../sim/data.js';
import { SILVER, AMBER, RUST, PAPER, rgba } from './palette.js';
import { glowSprite } from './backdrop.js';

const rigs = new Map();
const PATTERNS = ['folium', 'dots', 'bands', 'chevron'];
const TINTS = ['#dfe8e2', '#f0c27a', '#9fd8c4', '#e8a58e'];

// ---------------------------------------------------------------- spiders
const LEGS = [
  // [side, attach angle (radians from forward), rest reach angle, femur, tibia]
  [1, 0.5, 0.5, 9.5, 12],
  [1, 1.15, 1.2, 8, 10],
  [1, 1.9, 2.0, 7, 9],
  [1, 2.5, 2.7, 8.5, 11],
  [-1, 0.5, 0.5, 9.5, 12],
  [-1, 1.15, 1.2, 8, 10],
  [-1, 1.9, 2.0, 7, 9],
  [-1, 2.5, 2.7, 8.5, 11],
];

function rigFor(id) {
  let r = rigs.get(id);
  if (!r) {
    r = { feet: LEGS.map(() => ({ x: 0, y: 0, tx: 0, ty: 0, lift: 0, init: false })), step: 0, angle: 0, bob: 0, lastX: 0, lastY: 0, seen: 0 };
    rigs.set(id, r);
  }
  return r;
}

export function forgetRig(id) {
  rigs.delete(id);
}

/** Threads near the spider its feet may grip. */
function nearThreads(web, sp, out) {
  out.length = 0;
  const add = (s) => {
    if (s >= 0 && !out.includes(s)) out.push(s);
  };
  const around = (n) => {
    if (n < 0) return;
    for (const t of web.adj[n]) {
      add(t);
      const o = web.other(t, n);
      for (const t2 of web.adj[o]) if (out.length < 40) add(t2);
    }
  };
  if (sp.node) around(web.ni(sp.node));
  else if (sp.th) {
    const t = web.ti(sp.th);
    if (t >= 0) {
      add(t);
      around(web.ta[t]);
      around(web.tb[t]);
    }
  }
  return out;
}

const cand = [];
const c = {};

/** pose: { x, y, facing, mode, hang?, act?, charge?, sp, idx, downed } (a spider or a remote copy). */
export function drawSpider(ctx, world, sp, t, dt, o = {}) {
  const web = world.web;
  const rig = rigFor(sp.id);
  const kind = sp.sp ?? 'orb';
  const scale = kind === 'jumper' ? 1.12 : kind === 'bolas' ? 1.25 : 1.35;
  const moving = Math.hypot(sp.x - rig.lastX, sp.y - rig.lastY) / Math.max(dt, 1e-3);
  rig.lastX = sp.x;
  rig.lastY = sp.y;
  // Body angle: along the thread when walking, along the swing when hanging, the flight when leaping.
  let target = sp.facing ?? 0;
  if (sp.mode === 'walk' && sp.th && !sp.node) {
    const s = web.ti(sp.th);
    if (s >= 0) {
      const a = Math.atan2(web.y[web.tb[s]] - web.y[web.ta[s]], web.x[web.tb[s]] - web.x[web.ta[s]]);
      target = Math.cos(a - target) >= 0 ? a : a + Math.PI;
    }
  }
  if (sp.mode === 'hang') target = -Math.PI / 2;
  let d = target - rig.angle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  rig.angle += d * Math.min(1, dt * 14);
  const ang = rig.angle;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const downed = sp.mode === 'downed';
  // Feet: rest where the leg wants to be, gripping the nearest silk or branch; step when stretched too far.
  nearThreads(web, sp, cand);
  rig.step += dt;
  for (let i = 0; i < 8; i++) {
    const L = LEGS[i];
    const f = rig.feet[i];
    const reach = (L[3] + L[4]) * 0.86 * scale;
    const ra = L[2] * L[0];
    let wx = sp.x + Math.cos(ang + ra) * reach;
    let wy = sp.y + Math.sin(ang + ra) * reach;
    if (downed) {
      wx = sp.x + Math.cos(ang + ra) * reach * 0.35;
      wy = sp.y + Math.sin(ang + ra) * reach * 0.35 + 2;
    } else if (sp.mode === 'walk' && cand.length) {
      let best = 1e9;
      let bx = wx;
      let by = wy;
      for (const s of cand) {
        if (web.tid[s] < 0) continue;
        web.closest(s, wx, wy, c);
        if (c.d2 < best) {
          best = c.d2;
          bx = c.x;
          by = c.y;
        }
      }
      if (best < (reach * 0.9) ** 2) {
        wx = bx;
        wy = by;
      }
    } else if (sp.mode === 'air') {
      wx = sp.x + Math.cos(ang + ra * 0.7) * reach * 0.9;
      wy = sp.y + Math.sin(ang + ra * 0.7) * reach * 0.9;
    }
    if (!f.init) {
      f.x = f.tx = wx;
      f.y = f.ty = wy;
      f.init = true;
    }
    const group = (i + (i >= 4 ? 1 : 0)) % 2;
    const stretch = Math.hypot(wx - f.tx, wy - f.ty);
    if (stretch > reach * 0.45 || sp.mode !== 'walk') {
      if (sp.mode !== 'walk' || (Math.floor(rig.step * 12) % 2 === group && f.lift <= 0)) {
        f.tx = wx;
        f.ty = wy;
        f.lift = sp.mode === 'walk' ? 1 : 0;
      }
    }
    const k = Math.min(1, dt * (sp.mode === 'walk' ? 26 : 12));
    f.x += (f.tx - f.x) * k;
    f.y += (f.ty - f.y) * k;
    if (f.lift > 0) f.lift = Math.max(0, f.lift - dt * 9);
  }
  // Legs.
  const body = downed ? '#2a3433' : '#0e1718';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 8; i++) {
    const L = LEGS[i];
    const f = rig.feet[i];
    const hx = sp.x + Math.cos(ang + L[1] * L[0]) * 2.6 * scale + ca * 1.5;
    const hy = sp.y + Math.sin(ang + L[1] * L[0]) * 2.6 * scale + sa * 1.5;
    let fx = f.x;
    let fy = f.y - f.lift * 3;
    const a = L[3] * scale;
    const b = L[4] * scale;
    let dx = fx - hx;
    let dy = fy - hy;
    let dd = Math.hypot(dx, dy) || 0.001;
    if (dd > a + b - 0.05) {
      fx = hx + (dx / dd) * (a + b - 0.05);
      fy = hy + (dy / dd) * (a + b - 0.05);
      dx = fx - hx;
      dy = fy - hy;
      dd = a + b - 0.05;
    }
    const base = Math.atan2(dy, dx);
    const cosA = Math.max(-1, Math.min(1, (a * a + dd * dd - b * b) / (2 * a * dd)));
    // Knees bend up and away from the body.
    const side = L[0] * (Math.cos(base - ang) > 0 ? 1 : -1);
    const ka = base - side * Math.acos(cosA);
    const kx = hx + Math.cos(ka) * a;
    const ky = hy + Math.sin(ka) * a;
    // A pale edge first, so dark legs read against dark leaves; then the leg; then a lit knee.
    ctx.strokeStyle = rgba(SILVER, downed ? 0.12 : 0.3);
    ctx.lineWidth = (kind === 'jumper' ? 2.6 : 2.1) * scale;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.strokeStyle = body;
    ctx.lineWidth = (kind === 'jumper' ? 1.7 : 1.3) * scale;
    ctx.stroke();
    ctx.fillStyle = rgba(SILVER, 0.55);
    ctx.beginPath();
    ctx.arc(kx, ky, 0.75 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // Body: abdomen behind, head in front; each species its own shape; a moonlit edge on top.
  const idx = (sp.idx ?? 0) % 4;
  ctx.save();
  ctx.translate(sp.x, sp.y);
  ctx.rotate(ang);
  ctx.scale(scale, scale);
  const breathe = 1 + Math.sin(t * 2.2 + idx) * 0.025;
  if (kind === 'jumper') {
    ellipse(ctx, -4.6, 0, 4.2 * breathe, 3.4, body);
    ellipse(ctx, 1.6, 0, 4.6, 3.9, body);
    ctx.fillStyle = rgba(TINTS[idx], 0.7);
    for (let k = 0; k < 3; k++) ctx.fillRect(-7 + k * 2.2, -2.4, 1, 4.8);
    ctx.fillStyle = AMBER;
    eye(ctx, 5, -1.4, 1.25, t);
    eye(ctx, 5, 1.4, 1.25, t);
    ctx.fillStyle = rgba(SILVER, 0.35);
    for (let k = 0; k < 10; k++) ctx.fillRect(-1 + Math.cos(k) * 4.4, Math.sin(k * 1.7) * 3.6, 0.6, 0.6);
  } else if (kind === 'bolas') {
    ellipse(ctx, -5.4, 0, 6.2 * breathe, 6, '#cfc6ae');
    ctx.fillStyle = 'rgba(80, 70, 50, 0.4)';
    ellipse(ctx, -7.4, -2.6, 1.6, 1.4, 'rgba(80, 70, 50, 0.5)');
    ellipse(ctx, -7.4, 2.6, 1.6, 1.4, 'rgba(80, 70, 50, 0.5)');
    ellipse(ctx, 1.8, 0, 3.2, 2.8, body);
    ctx.fillStyle = AMBER;
    eye(ctx, 3.8, -0.9, 0.7, t);
    eye(ctx, 3.8, 0.9, 0.7, t);
  } else {
    ellipse(ctx, -6, 0, 6.6 * breathe, 5.4, body);
    pattern(ctx, PATTERNS[idx], TINTS[idx]);
    ellipse(ctx, 1.6, 0, 3.7, 3.1, body);
    ctx.fillStyle = AMBER;
    eye(ctx, 4.2, -1, 0.75, t);
    eye(ctx, 4.2, 1, 0.75, t);
  }
  ctx.restore();
  // Moon rim on the upper edge of the abdomen.
  ctx.strokeStyle = rgba(SILVER, downed ? 0.15 : 0.42);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(sp.x - ca * 6 * scale, sp.y - sa * 6 * scale, 6 * scale, -Math.PI * 0.85, -Math.PI * 0.15);
  ctx.stroke();
  // A dragline above a hanging spider; the bolas line and ball.
  if (sp.mode === 'hang' && o.anchor) {
    ctx.strokeStyle = rgba(SILVER, 0.5);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(o.anchor.x, o.anchor.y);
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
  }
  if (kind === 'bolas' && o.spin !== undefined) {
    const a = t * (6 + o.spin * 16);
    const len = 22 + o.spin * 40;
    const bx = sp.x + Math.cos(a) * len * 0.5;
    const by = sp.y + 18 + Math.sin(a) * len * 0.35 + len * 0.4;
    ctx.strokeStyle = rgba(SILVER, 0.55);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y + 4);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ball(ctx, bx, by);
  }
}

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function eye(ctx, x, y, r, t) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (Math.sin(t * 0.7 + x) > 0.6) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 244, 220, 0.9)';
    ctx.fillRect(x - r * 0.3, y - r * 0.5, r * 0.45, r * 0.45);
    ctx.restore();
  }
}

function pattern(ctx, kind, tint) {
  ctx.fillStyle = rgba(tint, 0.75);
  ctx.strokeStyle = rgba(tint, 0.75);
  ctx.lineWidth = 0.7;
  if (kind === 'folium') {
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.quadraticCurveTo(-6, -3.2, -1.5, 0);
    ctx.quadraticCurveTo(-6, 3.2, -11, 0);
    ctx.fill();
  } else if (kind === 'dots') {
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(-9 + k * 2.2, -1.6, 0.7, 0, Math.PI * 2);
      ctx.arc(-9 + k * 2.2, 1.6, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'bands') {
    for (let k = 0; k < 3; k++) ctx.fillRect(-10 + k * 2.6, -3.6, 1.1, 7.2);
  } else {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(-10 + k * 2.6, -3);
      ctx.lineTo(-8.4 + k * 2.6, 0);
      ctx.lineTo(-10 + k * 2.6, 3);
      ctx.stroke();
    }
  }
}

export function ball(ctx, x, y) {
  ctx.fillStyle = 'rgba(236, 226, 196, 0.95)';
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x - 1.4, y - 1.6, 1.1, 1.1);
}

// ---------------------------------------------------------------- prey
export function drawPrey(ctx, p, t, q) {
  const def = PREY[p.sp];
  if (!def) return;
  const big = p.big ? 1.55 : 1;
  const flap = p.st === 'fly' || p.st === 'stuck' ? Math.abs(Math.sin(t * (p.sp === 'moth' ? 17 : p.sp === 'beetle' ? 30 : 55) + p.id)) : 0.15;
  const dir = p.facing ?? (p.vx >= 0 ? 1 : -1);
  if (p.st === 'cocoon' || (p.st === 'fall' && p.wasCocoon)) return cocoon(ctx, p, def, t);
  const twitch = p.st === 'stuck' ? Math.sin(t * 40 + p.id) * 0.6 : 0;
  ctx.save();
  ctx.translate(p.x + twitch, p.y);
  if (p.st === 'fly' && p.sp !== 'gnat' && p.sp !== 'midge') ctx.rotate(Math.atan2(p.vy, Math.abs(p.vx) + 1e-3) * 0.4 * dir);
  const show = p.sp === 'gnat' || p.sp === 'midge' ? 1.6 : 1.45;
  ctx.scale(dir * big * show, big * show);
  switch (p.sp) {
    case 'gnat':
    case 'midge':
      ctx.fillStyle = '#1b2422';
      ctx.beginPath();
      ctx.arc(0, 0, def.size * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(SILVER, 0.25 + flap * 0.35);
      ctx.fillRect(-1.6, -1.6 - flap, 1.4, 1);
      if (p.sp === 'midge') {
        ctx.strokeStyle = '#1b2422';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-2, 2.6);
        ctx.moveTo(0, 0);
        ctx.lineTo(2, 2.6);
        ctx.stroke();
      }
      break;
    case 'fly':
      ctx.fillStyle = rgba(SILVER, 0.3);
      ctx.beginPath();
      ctx.ellipse(-0.5, -2.2 - flap, 3.2, 1.3 * (0.4 + flap), -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#121a1a';
      ctx.beginPath();
      ctx.ellipse(-0.6, 0, 3.4, 2.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(2.8, 0, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(200, 80, 60, 0.75)';
      ctx.fillRect(3.2, -1.1, 1, 1);
      break;
    case 'moth': {
      const open = p.st === 'land' || p.st === 'subdued' ? 0.25 : 0.35 + flap * 0.65;
      ctx.fillStyle = p.big ? '#cdbf9c' : '#a39778';
      ctx.beginPath();
      ctx.moveTo(-1, 0);
      ctx.quadraticCurveTo(-7, -9 * open, -11, -4 * open - 1);
      ctx.quadraticCurveTo(-6, -1, -1, 0);
      ctx.moveTo(1, 0);
      ctx.quadraticCurveTo(4, -10 * open, 9, -6 * open - 1);
      ctx.quadraticCurveTo(5, -1, 1, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(70, 58, 40, 0.55)';
      ctx.fillRect(-6, -4 * open, 1.2, 3 * open + 0.5);
      ctx.fillRect(4, -4.5 * open, 1.2, 3 * open + 0.5);
      ctx.fillStyle = AMBER;
      ctx.beginPath();
      ctx.arc(5.5, -4.2 * open - 0.4, 1, 0, Math.PI * 2);
      ctx.arc(-7.5, -3 * open - 0.5, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3d3426';
      ctx.beginPath();
      ctx.ellipse(0, 0.6, 4.6, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'beetle':
      ctx.fillStyle = '#0c1616';
      ctx.beginPath();
      ctx.ellipse(-1, 0, 6, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(5, 0.4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0c1616';
      ctx.lineWidth = 0.8;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 2.5, 3);
        ctx.lineTo(k * 2.5 + 1.8, 6 + Math.sin(t * 20 + k) * 0.6);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(SILVER, 0.55);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(-1, 0.6, 4.6, -2.4, -0.6);
      ctx.stroke();
      ctx.strokeStyle = rgba(AMBER, 0.45);
      ctx.beginPath();
      ctx.moveTo(-6.4, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();
      if (p.st === 'fly') {
        ctx.fillStyle = rgba(SILVER, 0.2);
        ctx.beginPath();
        ctx.ellipse(-2, -5 - flap * 2, 6, 2.2, -0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'dragonfly':
      ctx.fillStyle = rgba(SILVER, 0.22 + flap * 0.12);
      for (const [y, s] of [[-2.5, 1], [-1.5, 0.85]]) {
        ctx.beginPath();
        ctx.ellipse(1, y - 5 * flap, 14 * s, 2.2, -0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#1d4a4a';
      ctx.fillRect(-20, -0.9, 18, 1.8);
      ctx.fillStyle = '#2a6b66';
      ctx.beginPath();
      ctx.ellipse(1, 0, 4, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#62b3a6';
      ctx.beginPath();
      ctx.arc(5.4, -0.4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
  // Wrapping in progress: silk bands across it.
  if (p.st === 'stuck' && p.wrap > 0) {
    ctx.strokeStyle = rgba(SILVER, 0.85);
    ctx.lineWidth = 0.8;
    const n = Math.ceil(p.wrap * 6);
    for (let k = 0; k < n; k++) {
      const a = k * 1.1 + t;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, def.size * 0.7 + 1, def.size * 0.35 + 1, a, 0, Math.PI);
      ctx.stroke();
    }
  }
  if (q === 'high' && p.big) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12;
    ctx.drawImage(glowSprite(), p.x - 26, p.y - 26, 52, 52);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function cocoon(ctx, p, def, t) {
  const len = Math.max(4, def.size * 0.9) * (p.big ? 1.4 : 1);
  ctx.save();
  ctx.translate(p.x, p.y + len * 0.3);
  ctx.rotate(Math.sin(t * 1.3 + p.id) * 0.15);
  ctx.fillStyle = '#d9e0d8';
  ctx.beginPath();
  ctx.ellipse(0, 0, len * 0.36, len * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 140, 135, 0.6)';
  ctx.lineWidth = 0.5;
  for (let k = -2; k <= 2; k++) {
    ctx.beginPath();
    ctx.moveTo(-len * 0.34, k * len * 0.2);
    ctx.lineTo(len * 0.34, k * len * 0.2 + len * 0.12);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(SILVER, 0.6);
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.62);
  ctx.lineTo(0, -len * 0.9);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- hunters
export function drawWasp(ctx, w, t) {
  const dir = w.vx >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(w.x, w.y);
  if (w.st === 'stunned' || w.st === 'dying') ctx.rotate(t * 9);
  ctx.scale(dir, 1);
  const flap = Math.abs(Math.sin(t * 70));
  ctx.fillStyle = rgba(SILVER, 0.28);
  ctx.beginPath();
  ctx.ellipse(-1, -4 - flap * 2, 6, 2 * (0.5 + flap), -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Abdomen in bands: the stripes say "wasp" even without colour.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(-6, 1, 5.4, 3.3, 0.18, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#e19a32';
  ctx.fillRect(-12, -4, 12, 9);
  ctx.fillStyle = '#111515';
  for (let k = 0; k < 3; k++) ctx.fillRect(-10 + k * 3, -4, 1.4, 9);
  ctx.restore();
  ctx.fillStyle = '#111515';
  ctx.beginPath();
  ctx.ellipse(1, 0, 3, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e19a32';
  ctx.beginPath();
  ctx.arc(4.6, -0.4, 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111515';
  ctx.beginPath();
  ctx.moveTo(-11, 1.6);
  ctx.lineTo(-13.5, 2.4);
  ctx.lineTo(-11, 2.6);
  ctx.fill();
  ctx.restore();
}

/** The wren: first its shadow and the warning band, then the bird itself crossing fast. */
export function drawWren(ctx, wr, t, view) {
  if (!wr) return;
  if (wr.st === 'warn') {
    const f = Math.min(1, wr.t / wr.warn);
    ctx.fillStyle = `rgba(4, 10, 10, ${0.12 + f * 0.22})`;
    ctx.fillRect(view.x0, wr.y - wr.band / 2, view.x1 - view.x0, wr.band);
    ctx.strokeStyle = rgba(RUST, 0.35 + 0.35 * Math.abs(Math.sin(t * 6)));
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 60 * wr.dir;
    for (const y of [wr.y - wr.band / 2, wr.y + wr.band / 2]) {
      ctx.beginPath();
      ctx.moveTo(view.x0, y);
      ctx.lineTo(view.x1, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // The shadow sweeping in ahead of it.
    const sx = wr.dir > 0 ? view.x0 + (view.x1 - view.x0) * (f * 0.5 - 0.3) : view.x1 - (view.x1 - view.x0) * (f * 0.5 - 0.3);
    ctx.fillStyle = 'rgba(2, 6, 6, 0.35)';
    ctx.beginPath();
    ctx.ellipse(sx, wr.y, 120, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const dir = wr.dir;
  for (let k = 3; k >= 0; k--) {
    ctx.globalAlpha = k === 0 ? 1 : 0.12;
    bird(ctx, wr.x - dir * k * 26, wr.y, dir, t);
  }
  ctx.globalAlpha = 1;
}

function bird(ctx, x, y, dir, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * 1.5, 1.5);
  const flap = Math.sin(t * 30);
  ctx.fillStyle = '#2b1d16';
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 24, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(28, -12, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-28, -6);
  ctx.lineTo(-52, -40);
  ctx.lineTo(-40, -2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6, -10);
  ctx.quadraticCurveTo(-20, -60 * flap, 30, -30 * flap - 10);
  ctx.lineTo(10, 0);
  ctx.fill();
  ctx.fillStyle = '#4a3324';
  ctx.beginPath();
  ctx.moveTo(40, -14);
  ctx.lineTo(54, -10);
  ctx.lineTo(40, -8);
  ctx.fill();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(32, -15, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMantis(ctx, m, t) {
  if (!m || m.st === 'gone') return;
  const dir = Math.cos(m.facing ?? 0) >= 0 ? 1 : -1;
  const raise = m.st === 'windup' ? 1 : 0;
  ctx.save();
  ctx.translate(m.x, m.y - 14);
  // The finale's beast: nearly twice a spider's length, so its strike (74 px) is a reach you can see.
  ctx.scale(dir * 1.9, 1.9);
  const col = '#8eaa9c';
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  // Walking legs.
  for (const k of [-1, 0.2, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 6, 2);
    ctx.lineTo(k * 9 + Math.sin(t * 6 + k) * 2, 8);
    ctx.lineTo(k * 12, 12);
    ctx.stroke();
  }
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(-12, 2, 13, 4.5, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(4, -2);
  ctx.rotate(-0.55 - raise * 0.35);
  ctx.fillRect(0, -2, 20, 4);
  ctx.restore();
  // The forelegs: folded, or raised to strike.
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(14, -12);
  ctx.lineTo(20 + raise * 6, -18 - raise * 12);
  ctx.lineTo(26 + raise * 10, -8 - raise * 18);
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(18, -18);
  ctx.lineTo(28, -21);
  ctx.lineTo(24, -12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(25, -18, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- lights and lures
export function drawFireflies(ctx, lights, t, q) {
  const gs = glowSprite();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    if (l.kind !== 'fireflies' && l.kind !== 'lantern') continue;
    const n = l.kind === 'lantern' ? 5 : Math.round(10 + l.power * 8);
    for (let i = 0; i < n; i++) {
      const a = t * (0.3 + (i % 5) * 0.07) + i * 2.3;
      const x = l.x + Math.cos(a) * l.r * (0.4 + ((i * 37) % 10) / 16) + Math.sin(t * 0.7 + i) * 10;
      const y = l.y + Math.sin(a * 1.3) * l.r * 0.5 + Math.cos(t * 0.5 + i * 3) * 8;
      const pulse = Math.max(0, Math.sin(t * (1.6 + (i % 3) * 0.4) + i * 1.9));
      if (pulse < 0.05) continue;
      ctx.globalAlpha = pulse * 0.85;
      if (q !== 'low') ctx.drawImage(gs, x - 9, y - 9, 18, 18);
      ctx.fillStyle = '#f7d989';
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function drawLures(ctx, lures, balls, spiders, t) {
  const gs = glowSprite();
  for (const l of lures) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 3);
    ctx.drawImage(gs, l.x - 60 * l.power, l.y - 60 * l.power, 120 * l.power, 120 * l.power);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(AMBER, 0.6);
    for (let k = 0; k < 6; k++) ctx.fillRect(l.x + Math.sin(t * 1.4 + k * 2) * 26, l.y + Math.cos(t + k * 1.3) * 16, 1.2, 1.2);
  }
  for (const b of balls) {
    const o = spiders.find((s) => s.id === b.owner);
    if (o) {
      ctx.strokeStyle = rgba(SILVER, 0.5);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ball(ctx, b.x, b.y);
  }
}

export { PAPER, N_PREY, T_SURFACE, W, GROUND };
