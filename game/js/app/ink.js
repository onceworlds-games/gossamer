// Ink drawings for the field notebook: the three spiders, the gardens in miniature, a glyph for each upgrade, and
// the hand-drawn marks (a circle round the chosen one, a tick, a pin). All drawn on small canvases in pen colour.
const PEN = '#2b2620';
const WASH = 'rgba(70, 92, 120, 0.22)';
const RUST = '#a9442c';

export function inkCanvas(w, h, draw, cls = 'ink') {
  const c = document.createElement('canvas');
  const pr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * pr);
  c.height = Math.round(h * pr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.className = cls;
  const ctx = c.getContext('2d');
  ctx.scale(pr, pr);
  ctx.strokeStyle = PEN;
  ctx.fillStyle = PEN;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  try {
    draw(ctx, w, h);
  } catch {}
  return c;
}

/** A pen line with a little wobble, so it reads as drawn. */
function pen(ctx, pts, width = 1.4, seed = 1) {
  ctx.lineWidth = width;
  ctx.beginPath();
  let s = seed * 9301;
  pts.forEach(([x, y], i) => {
    s = (s * 1103 + 12345) % 65536;
    const j = ((s / 65536) - 0.5) * 0.8;
    if (i === 0) ctx.moveTo(x + j, y - j);
    else ctx.lineTo(x + j, y + j);
  });
  ctx.stroke();
}

export function spiderSketch(kind) {
  return inkCanvas(96, 72, (c) => {
    c.translate(48, 40);
    const legs = kind === 'jumper' ? [[-0.5, 14, 12], [-0.1, 13, 11], [0.4, 12, 10], [0.9, 13, 11]] : [[-0.7, 20, 20], [-0.2, 16, 17], [0.35, 15, 16], [0.85, 18, 19]];
    for (const side of [-1, 1]) {
      for (const [a, l1, l2] of legs) {
        const kx = side * Math.cos(a) * l1;
        const ky = Math.sin(a) * l1 - 9;
        const fx = kx + side * Math.cos(a + 0.8) * l2;
        const fy = ky + Math.sin(a + 0.8) * l2 + 6;
        pen(c, [[side * 3, 0], [kx, ky], [fx, fy]], 1.3, a * 10 + side);
      }
    }
    if (kind === 'bolas') {
      c.fillStyle = WASH;
      c.beginPath();
      c.ellipse(0, 8, 13, 12, 0, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 1.4;
      c.stroke();
      pen(c, [[0, -8], [10, 14], [14, 26]], 1, 3);
      c.beginPath();
      c.arc(14, 28, 3, 0, Math.PI * 2);
      c.stroke();
    } else {
      c.fillStyle = WASH;
      c.beginPath();
      c.ellipse(0, kind === 'jumper' ? 6 : 9, kind === 'jumper' ? 8 : 11, kind === 'jumper' ? 7 : 12, 0, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 1.4;
      c.stroke();
      if (kind === 'orb') pen(c, [[0, 1], [4, 9], [0, 19], [-4, 9], [0, 1]], 1, 7);
      else for (let k = 0; k < 3; k++) pen(c, [[-6, 3 + k * 3], [6, 3 + k * 3]], 0.9, k);
    }
    c.fillStyle = PEN;
    c.beginPath();
    c.ellipse(0, -5, kind === 'jumper' ? 7 : 5, kind === 'jumper' ? 6 : 4.5, 0, 0, Math.PI * 2);
    c.fill();
    if (kind === 'jumper') {
      c.fillStyle = '#efe4cb';
      c.beginPath();
      c.arc(-2.4, -7, 1.6, 0, Math.PI * 2);
      c.arc(2.4, -7, 1.6, 0, Math.PI * 2);
      c.fill();
    }
  });
}

export function gardenSketch(id) {
  return inkCanvas(120, 64, (c, w, h) => {
    pen(c, [[2, h - 8], [w - 2, h - 9]], 1.2, 2);
    if (id === 'cottage') {
      c.fillStyle = WASH;
      c.beginPath();
      c.ellipse(24, h - 26, 22, 20, 0, 0, Math.PI * 2);
      c.fill();
      pen(c, [[6, h - 9], [8, h - 36], [24, h - 46], [40, h - 34], [42, h - 9]], 1.1, 4);
      for (let x = 70; x < 116; x += 8) pen(c, [[x, h - 9], [x, h - 26], [x + 3, h - 30], [x + 6, h - 26], [x + 6, h - 9]], 1, x);
      pen(c, [[66, h - 22], [118, h - 22]], 1, 9);
      pen(c, [[52, h - 9], [54, h - 40]], 1, 5);
      c.beginPath();
      c.arc(54, h - 43, 3, 0, Math.PI * 2);
      c.stroke();
    } else if (id === 'reed') {
      c.fillStyle = WASH;
      c.fillRect(20, h - 14, 80, 6);
      for (let x = 14; x < 110; x += 9) pen(c, [[x, h - 9], [x + 2, h - 30 - ((x * 7) % 18)]], 1, x);
      for (const x of [30, 64, 96]) {
        c.beginPath();
        c.ellipse(x + 2, h - 36 - ((x * 7) % 18), 2, 5, 0, 0, Math.PI * 2);
        c.fill();
      }
    } else if (id === 'greenhouse') {
      pen(c, [[14, h - 9], [14, h - 34], [60, h - 52], [106, h - 34], [106, h - 9]], 1.3, 6);
      for (const x of [37, 60, 83]) pen(c, [[x, h - 9], [x, h - 44 + Math.abs(60 - x) * 0.35]], 0.9, x);
      c.fillStyle = WASH;
      c.beginPath();
      c.moveTo(14, h - 34);
      c.lineTo(60, h - 52);
      c.lineTo(106, h - 34);
      c.closePath();
      c.fill();
      c.beginPath();
      c.arc(48, h - 30, 3, 0, Math.PI * 2);
      c.stroke();
    } else {
      c.fillStyle = WASH;
      c.beginPath();
      c.ellipse(26, h - 38, 22, 22, 0, 0, Math.PI * 2);
      c.fill();
      pen(c, [[26, h - 9], [26, h - 22]], 2, 3);
      for (const [x, ht] of [[56, 22], [78, 28], [100, 18]]) pen(c, [[x, h - 9], [x, h - 9 - ht], [x + 7, h - 15 - ht], [x + 14, h - 9 - ht], [x + 14, h - 9]], 1.1, x);
    }
  });
}

const GLYPHS = {
  glands: (c) => {
    c.beginPath();
    c.ellipse(16, 16, 9, 6, 0, 0, Math.PI * 2);
    c.stroke();
    pen(c, [[7, 16], [7, 22], [25, 22], [25, 16]], 1.2, 1);
    pen(c, [[25, 19], [31, 27]], 1, 2);
  },
  strong: (c) => {
    pen(c, [[3, 26], [29, 6]], 3.2, 3);
  },
  droplets: (c) => {
    pen(c, [[3, 18], [29, 14]], 1, 4);
    for (const x of [7, 13, 19, 25]) {
      c.beginPath();
      c.arc(x, 17 - (x - 3) * 0.15, 2, 0, Math.PI * 2);
      c.fill();
    }
  },
  shake: (c) => {
    for (const [x, y] of [[9, 9], [20, 14], [12, 22], [24, 26]]) {
      c.beginPath();
      c.moveTo(x, y - 4);
      c.quadraticCurveTo(x + 3, y + 1, x, y + 2);
      c.quadraticCurveTo(x - 3, y + 1, x, y - 4);
      c.stroke();
    }
  },
  legs: (c) => {
    for (const k of [0, 1, 2]) pen(c, [[6 + k * 3, 26], [12 + k * 6, 8], [20 + k * 4, 26]], 1.2, k);
  },
  eyes: (c) => {
    for (const [x, y, r] of [[12, 13, 3.4], [20, 13, 3.4], [7, 18, 2], [25, 18, 2], [10, 22, 1.6], [22, 22, 1.6], [14, 7, 1.4], [18, 7, 1.4]]) {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  },
  venom: (c) => {
    pen(c, [[10, 5], [13, 18], [16, 22]], 1.6, 1);
    pen(c, [[22, 5], [19, 18], [16, 22]], 1.6, 2);
    c.beginPath();
    c.moveTo(16, 23);
    c.quadraticCurveTo(20, 29, 16, 30);
    c.quadraticCurveTo(12, 29, 16, 23);
    c.fill();
  },
  camo: (c) => {
    c.beginPath();
    c.moveTo(5, 26);
    c.quadraticCurveTo(10, 4, 28, 5);
    c.quadraticCurveTo(26, 24, 5, 26);
    c.stroke();
    pen(c, [[5, 26], [24, 8]], 1, 3);
  },
  alarm: (c) => {
    c.setLineDash([3, 3]);
    pen(c, [[2, 24], [30, 24]], 1.2, 1);
    c.setLineDash([]);
    pen(c, [[11, 20], [11, 13], [16, 8], [21, 13], [21, 20], [11, 20]], 1.3, 2);
  },
  templates: (c) => {
    for (let k = 0; k < 8; k++) pen(c, [[16, 16], [16 + Math.cos((k / 8) * Math.PI * 2) * 13, 16 + Math.sin((k / 8) * Math.PI * 2) * 13]], 0.9, k);
    for (const r of [5, 9, 12]) {
      c.beginPath();
      c.arc(16, 16, r, 0, Math.PI * 2);
      c.lineWidth = 0.8;
      c.stroke();
    }
  },
  lure: (c) => {
    c.beginPath();
    for (let a = 0; a < 12; a += 0.3) c.lineTo(16 + Math.cos(a) * a * 1.1, 16 + Math.sin(a) * a * 1.1);
    c.lineWidth = 1;
    c.stroke();
  },
  eggsac: (c) => {
    c.fillStyle = WASH;
    c.beginPath();
    c.ellipse(16, 17, 9, 11, 0, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 1.3;
    c.stroke();
    for (const y of [12, 17, 22]) pen(c, [[8, y], [24, y - 2]], 0.8, y);
  },
};

export function upgradeGlyph(id) {
  return inkCanvas(32, 32, (c) => (GLYPHS[id] ?? GLYPHS.templates)(c));
}

// ---------------------------------------------------------------- stickers bought with egg points, pasted in
const STICKERS = {
  fern: (c) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push([15 + t * 25 + Math.sin(t * 3) * 2, 46 - t * 36]);
    }
    c.fillStyle = 'rgba(79, 110, 74, 0.5)';
    c.strokeStyle = '#3b5236';
    for (let i = 1; i < 10; i++) {
      const [x, y] = pts[i];
      const tx = pts[i + 1][0] - pts[i - 1][0];
      const ty = pts[i + 1][1] - pts[i - 1][1];
      const d = Math.hypot(tx, ty) || 1;
      const L = 9 * (1 - (i / 10) * 0.75);
      for (const side of [-1, 1]) {
        const nx = (-ty / d) * side;
        const ny = (tx / d) * side;
        c.beginPath();
        c.ellipse(x + nx * L * 0.6, y + ny * L * 0.6 - 1, L * 0.6, 1.9, Math.atan2(ny, nx) - 0.35 * side, 0, Math.PI * 2);
        c.fill();
      }
    }
    pen(c, pts, 1.3, 3);
  },
  beetle: (c) => {
    for (const side of [-1, 1]) {
      for (const k of [-1, 0, 1]) pen(c, [[28 + side * 7, 31 + k * 6], [28 + side * 14, 29 + k * 8], [28 + side * 17, 33 + k * 9]], 1.1, 5 + k);
    }
    pen(c, [[26, 15], [22, 10], [19, 9]], 1, 2);
    pen(c, [[30, 15], [34, 10], [37, 9]], 1, 4);
    c.fillStyle = 'rgba(43, 38, 32, 0.88)';
    c.beginPath();
    c.ellipse(28, 32, 9, 12, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(28, 18, 5, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#f7efdc';
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(28, 22);
    c.lineTo(28, 43);
    c.stroke();
    c.strokeStyle = 'rgba(247, 239, 220, 0.55)';
    c.beginPath();
    c.arc(24, 29, 4.5, 3.5, 4.6);
    c.stroke();
  },
  moon: (c) => {
    c.fillStyle = 'rgba(200, 160, 70, 0.35)';
    c.beginPath();
    c.arc(28, 28, 15, -2.023, 2.023, false);
    c.arc(21, 28, 13.5, 1.537, -1.537, true);
    c.closePath();
    c.fill();
    c.lineWidth = 1.3;
    c.stroke();
    for (const [x, y] of [[13, 15], [42, 43], [11, 40]]) {
      pen(c, [[x - 2.5, y], [x + 2.5, y]], 0.8, x);
      pen(c, [[x, y - 2.5], [x, y + 2.5]], 0.8, y);
    }
  },
  feather: (c) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push([13 + t * 29, 46 - t * 35 + Math.sin(t * Math.PI) * 4]);
    }
    const side = (sgn) =>
      pts.map(([x, y], i) => {
        const a = Math.max(0, i - 1);
        const b = Math.min(12, i + 1);
        const tx = pts[b][0] - pts[a][0];
        const ty = pts[b][1] - pts[a][1];
        const d = Math.hypot(tx, ty) || 1;
        const t = i / 12;
        const w = t < 0.18 ? 0 : 7.5 * Math.sin(Math.PI * Math.min(1, (t - 0.18) / 0.86)) ** 0.7;
        return [x + (-ty / d) * w * sgn, y + (tx / d) * w * sgn];
      });
    const left = side(1);
    const right = side(-1);
    c.fillStyle = WASH;
    c.beginPath();
    [...left, ...[...right].reverse()].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.fill();
    for (let i = 3; i < 12; i++) {
      pen(c, [pts[i], left[i + 1]], 0.7, i);
      pen(c, [pts[i], right[i + 1]], 0.7, i + 20);
    }
    pen(c, pts, 1.4, 7);
  },
  key: (c) => {
    c.lineWidth = 1.6;
    c.fillStyle = 'rgba(200, 160, 70, 0.3)';
    c.beginPath();
    c.arc(18, 19, 7.5, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(18, 19, 3, 0, Math.PI * 2);
    c.stroke();
    pen(c, [[23.5, 24.5], [42, 43]], 2, 3);
    pen(c, [[37, 38], [33, 42], [35.5, 44.5], [39.5, 40.5]], 1.5, 4);
    pen(c, [[41, 42], [38, 45.5]], 1.5, 6);
  },
};

/** A pasted-in sticker: a small paper label with an ink drawing on it. */
export function stickerArt(id, size = 56) {
  return inkCanvas(size, size, (c) => {
    c.scale(size / 56, size / 56);
    c.fillStyle = '#f8f1df';
    c.strokeStyle = 'rgba(80, 60, 40, 0.35)';
    c.lineWidth = 1;
    c.beginPath();
    if (c.roundRect) c.roundRect(4, 4, 48, 48, 5);
    else c.rect(4, 4, 48, 48);
    c.fill();
    c.stroke();
    c.strokeStyle = PEN;
    c.fillStyle = PEN;
    (STICKERS[id] ?? STICKERS.fern)(c);
  }, 'sticker');
}

/** A rust circle drawn round something chosen (absolutely positioned over its parent). */
export function circleMark(w, h) {
  return inkCanvas(w, h, (c) => {
    c.strokeStyle = RUST;
    c.lineWidth = 2;
    c.beginPath();
    for (let a = 0; a <= Math.PI * 2.15; a += 0.08) {
      const r = 1 + Math.sin(a * 3) * 0.02;
      c.lineTo(w / 2 + Math.cos(a - 0.6) * (w / 2 - 4) * r, h / 2 + Math.sin(a - 0.6) * (h / 2 - 4) * r);
    }
    c.stroke();
  }, 'mark');
}

/** Tier marks: inked dots, filled as far as the upgrade has gone. */
export function tierDots(tier) {
  return inkCanvas(36, 12, (c) => {
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(6 + i * 12, 6, 3.6, 0, Math.PI * 2);
      c.strokeStyle = RUST;
      c.lineWidth = 1.4;
      if (i < tier) {
        c.fillStyle = RUST;
        c.fill();
      } else c.stroke();
    }
  }, 'dots');
}

export { PEN, RUST };

/**
 * The night's web as a field sketch: frames heavy, radials plain, glue lines fine and dotted, drawn with the pen's wobble.
 * `sk` is what decodeSketch() returns.
 */
export function webSketch(sk, w = 200, h = 130) {
  return inkCanvas(w, h, (c) => {
    const pad = 8;
    const k = Math.min((w - pad * 2) / Math.max(1, sk.w), (h - pad * 2) / Math.max(1, sk.h));
    const ox = (w - sk.w * k) / 2;
    const oy = (h - sk.h * k) / 2;
    const pt = (x, y) => [ox + x * k, oy + y * k];
    const WIDTH = [1.7, 1.1, 0.7, 0.8];
    // Frames and radials under the glue, so the spiral reads across them.
    for (const order of [[0, 1, 3], [2]]) {
      for (const q of sk.segs) {
        if (!order.includes(q.t)) continue;
        c.globalAlpha = q.t === 2 ? 0.8 : 1;
        if (q.t === 3) c.setLineDash([3, 3]);
        pen(c, [pt(q.x0, q.y0), pt(q.x1, q.y1)], WIDTH[q.t], q.x0 + q.y1);
        if (q.t === 3) c.setLineDash([]);
      }
    }
    c.globalAlpha = 1;
  });
}
