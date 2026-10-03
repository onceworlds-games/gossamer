// The play plane's garden: branches, stems, rails and glass (drawn on the anchors, so they sway), leaves and
// flowers at their tips, the hedge masses that hide a spider, and each garden's own props.
import { W, H, GROUND } from '../sim/data.js';
import { makeRng, range, rand } from '../sim/rng.js';
import { INK, TEAL, LEAF, SILVER, AMBER, RUST, BRANCH, BRANCH_RIM, rgba } from './palette.js';
import { glowSprite, scallop } from './backdrop.js';

const STYLE = {
  ground: { c: '#0a1d1d', rim: '#24524c' },
  trunk: { c: '#14302c', rim: '#2f5a52' },
  stem: { c: BRANCH, rim: BRANCH_RIM },
  reed: { c: '#1d4a43', rim: '#4b8a7d' },
  twig: { c: '#16352f', rim: '#3a6a60' },
  cane: { c: '#1a3b33', rim: '#42766a' },
  blade: { c: '#1f4e46', rim: '#4f8c7f' },
  bough: { c: '#122c28', rim: '#2e5a51' },
  willow: { c: '#1d4842', rim: '#4a8378' },
  yew: { c: '#0d2422', rim: '#27504a' },
  vine: { c: '#1d4a41', rim: '#4a8678' },
  grass: { c: '#1d4a43', rim: '#477f73' },
  post: { c: '#2b241d', rim: '#5a4c3c', wood: true },
  rail: { c: '#2b241d', rim: '#5d4f3e', wood: true },
  pole: { c: '#1d1d18', rim: '#3d3a30', wood: true },
  bench: { c: '#2b241d', rim: '#5d4f3e', wood: true },
  stake: { c: '#2f271e', rim: '#5d4f3e', wood: true },
  bar: { c: '#2a2a24', rim: '#6a6a5c', wood: true },
  line: { c: '#8fa29c', rim: '#c8d4cf' },
  chain: { c: '#5a5f56', rim: '#9aa096' },
  glass: { c: 'rgba(170, 214, 206, 0.55)', rim: 'rgba(230, 240, 236, 0.8)' },
  iron: { c: '#0b1213', rim: '#4b5d5a' },
  stone: { c: '#27403d', rim: '#6d8a84' },
};

export function makeGardenArt(g) {
  const r = makeRng(g.seed ^ 0xa11);
  // Foliage masses: clumps of leaf-circles inside each cover ellipse.
  const masses = g.cover.map((c) => {
    const p = new Path2D();
    scallop(p, r, c.x, c.y, c.rx, c.ry, Math.round((c.rx + c.ry) / 9), 0.12);
    // A few inner lobes so it reads as many bushes grown together.
    for (let i = 0; i < 3; i++) scallop(p, r, c.x + range(r, -0.4, 0.4) * c.rx, c.y + range(r, -0.5, 0.1) * c.ry, c.rx * range(r, 0.35, 0.55), c.ry * range(r, 0.35, 0.55), 12, 0.14);
    return { p, c };
  });
  const flecks = [];
  for (const c of g.cover) {
    for (let i = 0; i < (c.rx * c.ry) / 260; i++) {
      const a = rand(r) * Math.PI * 2;
      const d = Math.sqrt(rand(r));
      const y = c.y + Math.sin(a) * c.ry * d - 6;
      // More leaves catch the moon near the top.
      if (rand(r) < (y - (c.y - c.ry)) / (c.ry * 2) * 0.6) continue;
      flecks.push({ x: c.x + Math.cos(a) * c.rx * d, y, a: range(r, -0.9, 0.9) - 0.6, s: range(r, 0.7, 1.2) });
    }
  }
  return { masses, flecks, r };
}

/** Behind the silk: props and foliage masses. */
export function drawGardenBack(ctx, world, art, t, q) {
  const g = world.garden;
  if (g.id === 'cottage') {
    // The house wall at the right edge, its kitchen window lit.
    const win = world.lights.find((l) => l.kind === 'window');
    ctx.fillStyle = '#0c1d1e';
    ctx.fillRect(W - 120, -50, 220, GROUND + 60);
    ctx.fillStyle = '#132a2a';
    for (let y = 0; y < GROUND; y += 26) ctx.fillRect(W - 120, y, 220, 1.5);
    if (win) {
      ctx.fillStyle = rgba(AMBER, 0.82);
      ctx.fillRect(win.x - 34, win.y - 40, 68, 80);
      ctx.fillStyle = '#0c1d1e';
      ctx.fillRect(win.x - 2, win.y - 40, 4, 80);
      ctx.fillRect(win.x - 34, win.y - 2, 68, 4);
      if (q !== 'low') glow(ctx, win.x, win.y, 190, AMBER, 0.22);
    }
  }
  if (g.id === 'greenhouse') {
    for (const l of world.lights) if (l.kind === 'lamp' && q !== 'low') glow(ctx, l.x, l.y, 260, AMBER, 0.2);
  }
  for (const m of art.masses) {
    ctx.save();
    ctx.translate(4, 6);
    ctx.fillStyle = 'rgba(2, 8, 9, 0.4)';
    ctx.fill(m.p);
    ctx.restore();
    ctx.save();
    ctx.translate(0, -2);
    ctx.fillStyle = 'rgba(120, 170, 160, 0.22)';
    ctx.fill(m.p);
    ctx.restore();
    ctx.fillStyle = '#0d2624';
    ctx.fill(m.p);
  }
  for (const f of art.flecks) {
    ctx.fillStyle = 'rgba(64, 118, 106, 0.42)';
    leafShape(ctx, f.x, f.y, f.a, 6.5 * f.s, true);
  }
  // Gravestone slabs.
  for (const d of g.decor) {
    if (d.k !== 'grave') continue;
    ctx.fillStyle = '#1f3634';
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x, d.y - d.h);
    ctx.quadraticCurveTo(d.x + d.w / 2, d.y - d.h - d.w * 0.5, d.x + d.w, d.y - d.h);
    ctx.lineTo(d.x + d.w, d.y);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 150, 144, 0.28)';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(d.x + d.w * 0.25, d.y - d.h * (0.68 - k * 0.12));
      ctx.lineTo(d.x + d.w * 0.75, d.y - d.h * (0.68 - k * 0.12));
      ctx.stroke();
    }
    if (d.s) {
      ctx.fillStyle = 'rgba(80, 130, 110, 0.35)';
      ctx.fillRect(d.x + 4, d.y - d.h * 0.3, d.w * 0.5, d.h * 0.3);
    }
  }
}

function glow(ctx, x, y, rad, hex, a) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  const gs = glowSprite();
  ctx.filter = 'none';
  ctx.drawImage(gs, x - rad, y - rad, rad * 2, rad * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  void hex;
}

function leafShape(ctx, x, y, a, s, fillOnly = false) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const px = (u, v) => [x + u * c - v * sn, y + u * sn + v * c];
  ctx.beginPath();
  let p = px(0, 0);
  ctx.moveTo(p[0], p[1]);
  const q1 = px(s * 0.5, -s * 0.42);
  const e = px(s * 1.6, 0);
  const q2 = px(s * 0.5, s * 0.42);
  ctx.quadraticCurveTo(q1[0], q1[1], e[0], e[1]);
  ctx.quadraticCurveTo(q2[0], q2[1], p[0], p[1]);
  ctx.fill();
  if (!fillOnly) {
    p = px(s * 0.1, 0);
    ctx.strokeStyle = 'rgba(140, 190, 176, 0.35)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.stroke();
  }
}

/** Branches, stems and rails on their current (swaying) anchor positions. */
export function drawSurfaces(ctx, world, z, q) {
  const g = world.garden;
  const web = world.web;
  const ids = g.nodeIds;
  if (!ids) return;
  const minW = 1 / z;
  for (let si = 0; si < g.surfaces.length; si++) {
    const s = g.surfaces[si];
    if (s.kind === 'stone' || s.kind === 'ground') continue;
    const st = STYLE[s.kind] ?? STYLE.stem;
    const row = ids[si];
    const n = row.length;
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? st.c : st.rim;
      ctx.lineCap = st.wood ? 'butt' : 'round';
      for (let i = 1; i < n; i++) {
        const a = web.ni(row[i - 1]);
        const b = web.ni(row[i]);
        if (a < 0 || b < 0) continue;
        const f = (i - 0.5) / Math.max(1, n - 1);
        const w = Math.max(minW, s.w0 + (s.w1 - s.w0) * f);
        if (pass === 1 && (w * z < 2.2 || q === 'low')) continue;
        ctx.lineWidth = pass === 0 ? w : Math.max(minW * 0.8, w * 0.28);
        ctx.beginPath();
        const off = pass === 1 ? -w * 0.32 : 0;
        ctx.moveTo(web.x[a], web.y[a] + off);
        ctx.lineTo(web.x[b], web.y[b] + off);
        ctx.stroke();
      }
    }
  }
}

/** Leaves, flowers, pegs, pickets: things that grow or hang on the branches. */
export function drawDecor(ctx, world, t, q) {
  const g = world.garden;
  const web = world.web;
  const ids = g.nodeIds;
  for (const d of g.decor) {
    let x = d.x;
    let y = d.y;
    if (d.si !== undefined && ids) {
      const n = web.ni(ids[d.si]?.[Math.min(d.pi, ids[d.si].length - 1)]);
      if (n < 0) continue;
      x = web.x[n];
      y = web.y[n];
    }
    switch (d.k) {
      case 'leaf':
      case 'willowleaf':
        ctx.fillStyle = d.k === 'leaf' ? '#1f5149' : '#2a5d52';
        leafShape(ctx, x, y, d.a + Math.sin(t * 1.3 + x) * 0.08, (d.k === 'leaf' ? 9 : 7) * d.s, q === 'low');
        break;
      case 'yew':
        ctx.fillStyle = '#0f2a26';
        for (let k = -2; k <= 2; k++) leafShape(ctx, x, y, d.a + k * 0.35, 6 * d.s, true);
        break;
      case 'flower': {
        // Moonflowers: pale bells that catch the light.
        ctx.fillStyle = rgba(SILVER, 0.82);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + t * 0.1;
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * 6 * d.s, y + Math.sin(a) * 6 * d.s, 5.5 * d.s, 3.6 * d.s, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(AMBER, 0.9);
        ctx.beginPath();
        ctx.arc(x, y, 2.6 * d.s, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'rose':
        ctx.fillStyle = RUST;
        ctx.beginPath();
        ctx.arc(x, y, 4.5 * d.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(240, 160, 130, 0.45)';
        ctx.beginPath();
        ctx.arc(x - 1, y - 1.5, 2 * d.s, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'peg':
        ctx.fillStyle = '#5a4c3c';
        ctx.fillRect(x - 1.5, y - 2, 3, 13);
        break;
      case 'picket':
        ctx.fillStyle = '#231e18';
        ctx.fillRect(x - 9, y, 18, GROUND - y + 10);
        ctx.beginPath();
        ctx.moveTo(x - 9, y);
        ctx.lineTo(x, y - 12);
        ctx.lineTo(x + 9, y);
        ctx.fill();
        ctx.fillStyle = 'rgba(120, 104, 84, 0.35)';
        ctx.fillRect(x - 9, y, 2, GROUND - y);
        break;
      case 'cattail':
        ctx.fillStyle = '#3a2a1e';
        ctx.beginPath();
        ctx.ellipse(x, y + 10, 4.5 * d.s, 14 * d.s, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'seedhead':
        ctx.fillStyle = rgba(SILVER, 0.5);
        for (let k = 0; k < 7; k++) {
          const a = -Math.PI / 2 + (k - 3) * 0.32;
          ctx.fillRect(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 1.6, 1.6);
        }
        break;
      case 'grasshead':
        ctx.fillStyle = 'rgba(200, 190, 150, 0.45)';
        ctx.beginPath();
        ctx.ellipse(x, y - 6, 2.4, 8, 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'tomato':
        ctx.fillStyle = RUST;
        ctx.beginPath();
        ctx.arc(x, y + 6, 5 * d.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 210, 180, 0.35)';
        ctx.fillRect(x - 2, y + 3, 1.6, 1.6);
        break;
      case 'pot':
        ctx.fillStyle = '#4a2a1f';
        ctx.beginPath();
        ctx.moveTo(x - 20, y - 34);
        ctx.lineTo(x + 20, y - 34);
        ctx.lineTo(x + 15, y);
        ctx.lineTo(x - 15, y);
        ctx.fill();
        ctx.fillStyle = '#5d3727';
        ctx.fillRect(x - 22, y - 38, 44, 6);
        break;
      case 'lamp':
        ctx.fillStyle = '#1b1712';
        ctx.beginPath();
        ctx.moveTo(x - 16, y + 12);
        ctx.lineTo(x - 7, y);
        ctx.lineTo(x + 7, y);
        ctx.lineTo(x + 16, y + 12);
        ctx.fill();
        ctx.fillStyle = rgba(AMBER, 0.95);
        ctx.beginPath();
        ctx.arc(x, y + 14, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'spike':
        ctx.fillStyle = '#0b1213';
        ctx.beginPath();
        ctx.moveTo(x - 4, y + 2);
        ctx.lineTo(x, y - 12);
        ctx.lineTo(x + 4, y + 2);
        ctx.fill();
        break;
      default:
        break;
    }
  }
}

/** The ground strip and (in the reed bed) the pond, drawn over the bottom of everything. */
export function drawGround(ctx, world, t, q) {
  const g = world.garden;
  const web = world.web;
  const row = g.nodeIds?.[0];
  if (!row) return;
  ctx.fillStyle = '#071514';
  ctx.beginPath();
  ctx.moveTo(-200, H + 300);
  for (const id of row) {
    const n = web.ni(id);
    if (n >= 0) ctx.lineTo(web.x[n], web.y[n]);
  }
  ctx.lineTo(W + 200, H + 300);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80, 140, 128, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  row.forEach((id, i) => {
    const n = web.ni(id);
    if (n < 0) return;
    if (i === 0) ctx.moveTo(web.x[n], web.y[n]);
    else ctx.lineTo(web.x[n], web.y[n]);
  });
  ctx.stroke();
  if (g.water) {
    const wtr = g.water;
    const grad = ctx.createLinearGradient(0, wtr.y, 0, H);
    grad.addColorStop(0, '#0d2a2c');
    grad.addColorStop(1, '#061214');
    ctx.fillStyle = grad;
    ctx.fillRect(wtr.x0, wtr.y, wtr.x1 - wtr.x0, H - wtr.y + 200);
    ctx.strokeStyle = rgba(SILVER, 0.25);
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const y = wtr.y + 8 + i * 9;
      const x = wtr.x0 + ((t * 14 + i * 173) % (wtr.x1 - wtr.x0 - 120));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 40 + (i % 3) * 20, y);
      ctx.stroke();
    }
    // The moon's path on the water.
    if (q !== 'low') {
      ctx.fillStyle = rgba(SILVER, 0.12);
      const mx = (wtr.x0 + wtr.x1) / 2 + 120;
      for (let k = 0; k < 6; k++) ctx.fillRect(mx - 20 + Math.sin(t * 2 + k) * 6, wtr.y + 6 + k * 12, 40 - k * 4, 3);
    }
  }
}

export { INK, TEAL, LEAF };
