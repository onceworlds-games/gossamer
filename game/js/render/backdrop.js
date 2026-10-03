// The night behind the web: sky, moon, stars, four paper-cut layers that slide at their own depth, the glow of a
// window or a lamp, mist, and the grain over everything. Layers are Path2D silhouettes made once per garden.
import { W, H, GROUND } from '../sim/data.js';
import { makeRng, range, rand, int, chance } from '../sim/rng.js';
import { LAYERS, SKY_TOP, SKY_LOW, SILVER, AMBER, rgba } from './palette.js';

const DEPTH = [0.16, 0.32, 0.55, 0.8];

export function makeBackdrop(gardenId, seed) {
  const r = makeRng(seed ^ 0x51ab);
  const layers = DEPTH.map((p) => ({ p, path: new Path2D(), lights: [] }));
  const kit = KITS[gardenId] ?? KITS.cottage;
  kit(layers, r);
  const stars = [];
  for (let i = 0; i < 70; i++) stars.push({ x: rand(r), y: rand(r) * 0.55, s: range(r, 0.4, 1.3), tw: range(r, 0, 6.28) });
  return { id: gardenId, layers, stars, moon: { x: range(r, 0.62, 0.84), y: range(r, 0.12, 0.2), phase: range(r, 0, 1) } };
}

// ---------------------------------------------------------------- silhouette kit
function hill(path, r, y0, amp, x0 = -500, x1 = W + 500, bottom = H + 300) {
  path.moveTo(x0, bottom);
  const a = range(r, 0, 6);
  for (let x = x0; x <= x1; x += 40) path.lineTo(x, y0 + Math.sin(x * 0.0021 + a) * amp + Math.sin(x * 0.0057 + a * 2) * amp * 0.35);
  path.lineTo(x1, bottom);
  path.closePath();
}

function blob(path, x, y, rad) {
  path.moveTo(x + rad, y);
  path.arc(x, y, rad, 0, Math.PI * 2);
}

/** A lumpy ellipse (a hedge, a canopy): bulges between points around the rim, like leaves cut from paper. */
export function scallop(path, r, cx, cy, rx, ry, bumps = 14, depth = 0.16) {
  const pts = [];
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 + range(r, -0.1, 0.1);
    const k = 1 + range(r, -depth, depth * 0.3);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let start = mid(pts[bumps - 1], pts[0]);
  path.moveTo(start[0], start[1]);
  for (let i = 0; i < bumps; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % bumps];
    const m = mid(p, q);
    // Push the corner outward a little so each lobe bulges.
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const d = Math.hypot(dx, dy) || 1;
    const bulge = Math.min(rx, ry) * range(r, 0.12, 0.24);
    path.quadraticCurveTo(p[0] + (dx / d) * bulge, p[1] + (dy / d) * bulge, m[0], m[1]);
  }
  path.closePath();
}

function tree(path, r, x, base, h, w) {
  path.moveTo(x - w * 0.06, base);
  path.lineTo(x - w * 0.035, base - h * 0.5);
  path.lineTo(x + w * 0.035, base - h * 0.5);
  path.lineTo(x + w * 0.06, base);
  path.closePath();
  scallop(path, r, x, base - h * 0.66, w * 0.5, h * 0.36, int(r, 11, 16), 0.14);
}

function poplar(path, x, base, h, w) {
  path.moveTo(x, base - h);
  path.bezierCurveTo(x + w * 0.7, base - h * 0.7, x + w * 0.6, base - h * 0.15, x + w * 0.1, base);
  path.lineTo(x - w * 0.1, base);
  path.bezierCurveTo(x - w * 0.6, base - h * 0.15, x - w * 0.7, base - h * 0.7, x, base - h);
  path.closePath();
}

function house(path, layer, x, base, w, h, windows = 2) {
  path.rect(x, base - h, w, h);
  path.moveTo(x - w * 0.08, base - h);
  path.lineTo(x + w / 2, base - h - w * 0.42);
  path.lineTo(x + w * 1.08, base - h);
  path.closePath();
  path.rect(x + w * 0.7, base - h - w * 0.4, w * 0.1, w * 0.22);
  for (let i = 0; i < windows; i++) layer.lights.push({ kind: 'window', x: x + w * (0.2 + i * 0.4), y: base - h * 0.62, w: w * 0.16, h: h * 0.22 });
}

function church(path, layer, x, base) {
  path.rect(x, base - 240, 90, 240);
  path.moveTo(x - 6, base - 240);
  path.lineTo(x + 45, base - 420);
  path.lineTo(x + 96, base - 240);
  path.closePath();
  path.rect(x + 90, base - 150, 260, 150);
  path.moveTo(x + 84, base - 150);
  path.lineTo(x + 220, base - 230);
  path.lineTo(x + 356, base - 150);
  path.closePath();
  layer.lights.push({ kind: 'arch', x: x + 160, y: base - 110, w: 22, h: 46 });
  layer.lights.push({ kind: 'clock', x: x + 45, y: base - 205, w: 14, h: 14 });
}

function blades(path, r, x0, x1, base, h, gap = 9, lean = 0.2) {
  for (let x = x0; x < x1; x += gap * range(r, 0.6, 1.4)) {
    const hh = h * range(r, 0.5, 1.1);
    const l = range(r, -lean, lean) * hh;
    path.moveTo(x - 3, base);
    path.quadraticCurveTo(x + l * 0.3, base - hh * 0.6, x + l, base - hh);
    path.quadraticCurveTo(x + l * 0.3 + 2, base - hh * 0.55, x + 3, base);
    path.closePath();
  }
}

function headstones(path, r, x0, x1, base) {
  for (let x = x0; x < x1; x += range(r, 60, 140)) {
    const w = range(r, 26, 44);
    const h = range(r, 40, 80);
    if (chance(r, 0.3)) {
      path.rect(x + w * 0.4, base - h * 1.3, w * 0.2, h * 1.3);
      path.rect(x, base - h, w, h * 0.18);
    } else {
      path.moveTo(x, base);
      path.lineTo(x, base - h);
      path.arc(x + w / 2, base - h, w / 2, Math.PI, 0);
      path.lineTo(x + w, base);
      path.closePath();
    }
  }
}

function bareTree(path, r, x, base, h) {
  const branch = (bx, by, a, len, w, depth) => {
    const ex = bx + Math.cos(a) * len;
    const ey = by + Math.sin(a) * len;
    path.moveTo(bx - w, by);
    path.lineTo(ex, ey);
    path.lineTo(bx + w, by);
    path.closePath();
    if (depth > 0) {
      branch(ex, ey, a - range(r, 0.2, 0.6), len * 0.68, w * 0.62, depth - 1);
      branch(ex, ey, a + range(r, 0.2, 0.6), len * 0.68, w * 0.62, depth - 1);
    }
  };
  branch(x, base, -Math.PI / 2 + range(r, -0.1, 0.1), h * 0.42, h * 0.035, 5);
}

const KITS = {
  cottage(L, r) {
    hill(L[0].path, r, 700, 40);
    for (let x = -300; x < W + 300; x += range(r, 70, 140)) tree(L[0].path, r, x, 720 + range(r, -20, 20), range(r, 90, 160), range(r, 70, 120));
    house(L[0].path, L[0], range(r, 300, 700), 760, 150, 100, 2);
    hill(L[1].path, r, 820, 26);
    for (let x = -300; x < W + 300; x += range(r, 160, 300)) {
      if (chance(r, 0.4)) poplar(L[1].path, x, 830, range(r, 260, 380), range(r, 40, 60));
      else tree(L[1].path, r, x, 830, range(r, 240, 360), range(r, 160, 240));
    }
    hill(L[2].path, r, 880, 14);
    for (let x = -300; x < W + 300; x += range(r, 120, 220)) blob(L[2].path, x, 880, range(r, 50, 110));
    L[2].path.rect(range(r, 900, 1200), 760, 130, 130);
    hill(L[3].path, r, 950, 10);
    blades(L[3].path, r, -300, W + 300, 960, 70, 14);
  },
  reed(L, r) {
    hill(L[0].path, r, 780, 22);
    for (let x = -300; x < W + 300; x += range(r, 120, 220)) tree(L[0].path, r, x, 790, range(r, 140, 220), range(r, 120, 180));
    hill(L[1].path, r, 860, 8);
    blades(L[1].path, r, -300, W + 300, 870, 220, 7, 0.08);
    hill(L[2].path, r, 905, 6);
    blades(L[2].path, r, -300, W + 300, 915, 160, 11, 0.12);
    hill(L[3].path, r, 960, 6);
    blades(L[3].path, r, -300, 260, 990, 260, 9, 0.15);
    blades(L[3].path, r, W - 260, W + 300, 990, 260, 9, 0.15);
  },
  greenhouse(L, r) {
    hill(L[0].path, r, 740, 30);
    for (let x = -300; x < W + 300; x += range(r, 90, 160)) tree(L[0].path, r, x, 760, range(r, 120, 200), range(r, 90, 150));
    house(L[0].path, L[0], range(r, 900, 1300), 790, 170, 110, 3);
    // Back staging and shelves inside the glass.
    const p = L[2].path;
    p.rect(-300, 560, W + 600, 10);
    p.rect(-300, 420, W + 600, 8);
    for (let x = -280; x < W + 280; x += range(r, 60, 110)) {
      const w = range(r, 26, 44);
      p.moveTo(x, 560);
      p.lineTo(x + w * 0.12, 560 - w * 0.8);
      p.lineTo(x + w * 0.88, 560 - w * 0.8);
      p.lineTo(x + w, 560);
      p.closePath();
      if (chance(r, 0.6)) blades(p, r, x + 4, x + w - 4, 560 - w * 0.8, range(r, 30, 70), 6, 0.3);
    }
    for (let x = -280; x < W + 280; x += range(r, 80, 140)) p.rect(x, 420 - 26, range(r, 40, 70), 26);
    hill(L[3].path, r, 960, 4);
    for (let x = -300; x < W + 300; x += range(r, 110, 180)) {
      L[3].path.rect(x, 900, range(r, 50, 80), 70);
      blades(L[3].path, r, x, x + 60, 900, 90, 8, 0.4);
    }
  },
  churchyard(L, r) {
    hill(L[0].path, r, 760, 30);
    church(L[0].path, L[0], range(r, 700, 1000), 770);
    for (let x = -300; x < W + 300; x += range(r, 150, 260)) if (chance(r, 0.6)) tree(L[0].path, r, x, 770, range(r, 120, 200), range(r, 100, 160));
    hill(L[1].path, r, 830, 18);
    for (let x = -200; x < W + 300; x += range(r, 260, 420)) bareTree(L[1].path, r, x, 840, range(r, 380, 520));
    hill(L[2].path, r, 890, 10);
    headstones(L[2].path, r, -300, W + 300, 895);
    L[2].path.rect(-300, 880, W + 600, 30);
    hill(L[3].path, r, 958, 12);
    blades(L[3].path, r, -300, W + 300, 970, 90, 10, 0.3);
  },
};

// ---------------------------------------------------------------- drawing
let grain = null;
let glow = null;
let mistSprite = null;

function sprites() {
  if (grain) return;
  grain = document.createElement('canvas');
  grain.width = grain.height = 160;
  const g = grain.getContext('2d');
  const img = g.createImageData(160, 160);
  let s = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) >>> 0;
    const v = (s >>> 24) & 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  glow = document.createElement('canvas');
  glow.width = glow.height = 128;
  const gg = glow.getContext('2d');
  const grad = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = grad;
  gg.fillRect(0, 0, 128, 128);
  mistSprite = document.createElement('canvas');
  mistSprite.width = 256;
  mistSprite.height = 64;
  const mg = mistSprite.getContext('2d');
  const m = mg.createRadialGradient(128, 32, 0, 128, 32, 128);
  m.addColorStop(0, 'rgba(200,226,222,0.55)');
  m.addColorStop(1, 'rgba(200,226,222,0)');
  mg.fillStyle = m;
  mg.setTransform(1, 0, 0, 0.25, 0, 24);
  mg.fillRect(0, 0, 256, 256);
}

export function glowSprite() {
  sprites();
  return glow;
}

/** Sky, moon and stars in screen space; then the layers in their own parallax. */
export function drawBackdrop(ctx, bd, cam, pr, t, q) {
  sprites();
  const w = cam.sw;
  const h = cam.sh;
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_LOW);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // Stars: few, faint, slow to twinkle.
  const drift = (cam.x / W - 0.5) * 30;
  for (const s of bd.stars) {
    const a = 0.25 + 0.2 * Math.sin(t * 0.8 + s.tw);
    ctx.fillStyle = rgba(SILVER, a);
    ctx.fillRect(s.x * w - drift, s.y * h, s.s, s.s);
  }
  // The moon: a pale disc with soft seas, and a halo you can barely see.
  const m = bd.moon;
  const mr = Math.max(18, Math.min(w, h) * 0.055);
  const mx = m.x * w - drift * 1.4;
  const my = m.y * h;
  ctx.globalAlpha = 0.16;
  ctx.drawImage(glow, mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(glow, mx - mr * 2.6, my - mr * 2.6, mr * 5.2, mr * 5.2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#e9efe6';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(170, 190, 184, 0.16)';
  ctx.beginPath();
  ctx.ellipse(mx - mr * 0.28, my - mr * 0.16, mr * 0.34, mr * 0.24, 0.4, 0, Math.PI * 2);
  ctx.ellipse(mx + mr * 0.26, my + mr * 0.32, mr * 0.22, mr * 0.15, -0.3, 0, Math.PI * 2);
  ctx.ellipse(mx + mr * 0.12, my - mr * 0.42, mr * 0.14, mr * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // Layers, far to near: a shadow, a moonlit rim, then the body.
  for (let i = 0; i < bd.layers.length; i++) {
    const L = bd.layers[i];
    if (q === 'low' && i === 0) continue;
    cam.apply(ctx, pr, L.p);
    if (q !== 'low' && i > 0) {
      ctx.save();
      ctx.translate(5, 7);
      ctx.fillStyle = 'rgba(2, 8, 9, 0.35)';
      ctx.fill(L.path);
      ctx.restore();
      ctx.save();
      ctx.translate(0, -2.2);
      ctx.fillStyle = `rgba(150, 196, 188, ${0.1 + i * 0.03})`;
      ctx.fill(L.path);
      ctx.restore();
    }
    ctx.fillStyle = LAYERS[i];
    ctx.fill(L.path);
    for (const li of L.lights) drawLight(ctx, li, t, q);
  }
}

function drawLight(ctx, li, t, q) {
  const flick = 0.85 + 0.15 * Math.sin(t * 2.3 + li.x);
  if (li.kind === 'clock') {
    ctx.fillStyle = 'rgba(214, 222, 206, 0.35)';
    ctx.beginPath();
    ctx.arc(li.x, li.y, li.w, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = rgba(AMBER, 0.75 * flick);
  if (li.kind === 'arch') {
    ctx.beginPath();
    ctx.moveTo(li.x, li.y + li.h / 2);
    ctx.lineTo(li.x, li.y - li.h / 2 + li.w / 2);
    ctx.arc(li.x + li.w / 2, li.y - li.h / 2 + li.w / 2, li.w / 2, Math.PI, 0);
    ctx.lineTo(li.x + li.w, li.y + li.h / 2);
    ctx.fill();
  } else ctx.fillRect(li.x, li.y, li.w, li.h);
  if (q !== 'low') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18 * flick;
    ctx.drawImage(glow, li.x - li.w * 2, li.y - li.h * 2, li.w * 5, li.h * 5);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** A fringe of dark grass in front of everything, lower edge only (depth without hiding the play). */
export function drawFront(ctx, bd, cam, pr) {
  if (!bd.front) {
    const r = makeRng(0xf00d);
    bd.front = new Path2D();
    blades(bd.front, r, -500, W + 500, H + 70, 120, 7, 0.25);
  }
  cam.apply(ctx, pr, 1.22);
  ctx.fillStyle = '#040e0f';
  ctx.fill(bd.front);
}

/** Mist bands drifting through the play plane. */
export function drawMist(ctx, cam, pr, t, amount, q) {
  if (amount <= 0.01) return;
  sprites();
  cam.apply(ctx, pr, 0.9);
  const n = q === 'low' ? 4 : 9;
  for (let i = 0; i < n; i++) {
    const y = 380 + i * 64 + Math.sin(t * 0.1 + i) * 30;
    const x = ((t * (12 + i * 3) + i * 397) % (W + 1200)) - 600;
    ctx.globalAlpha = amount * (0.35 + 0.25 * Math.sin(i * 1.7));
    ctx.drawImage(mistSprite, x, y - 60, 900, 140);
  }
  ctx.globalAlpha = 1;
}

/** Grain and vignette over the whole frame. */
export function drawFinish(ctx, cam, pr, t, q, dark = 0) {
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  const w = cam.sw;
  const h = cam.sh;
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(2, 8, 9, ${0.55 + dark * 0.3})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  if (q === 'high') {
    sprites();
    ctx.globalAlpha = 0.045;
    ctx.globalCompositeOperation = 'overlay';
    const ox = Math.floor((t * 977) % 160);
    const oy = Math.floor((t * 631) % 160);
    for (let y = -oy; y < h; y += 160) for (let x = -ox; x < w; x += 160) ctx.drawImage(grain, x, y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

export { GROUND, DEPTH };
