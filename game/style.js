// The look: one chunky font, thick dark outlines, flat bright colours. Shared by every drawing module.

export const FONT = "Fredoka, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";
export const INK = '#2a1f3d';
export const GREEN = '#35d05a';
export const GREEN_DIM = '#1f6b34';
export const YELLOW = '#ffd21f';
export const YELLOW_DIM = '#6e5a12';
export const RED = '#ff3b3b';
export const RED_DIM = '#6e1d22';
export const PAPER = '#fff8e8';
export const LIGHT_COLORS = [GREEN, YELLOW, RED];

export const font = (px) => `700 ${Math.max(8, Math.round(px))}px ${FONT}`;

/** White text with a thick dark outline under it. */
export function outlined(ctx, str, x, y, px, fill = '#fff', stroke = INK, align = 'center', base = 'middle', lw = 0) {
  ctx.font = font(px);
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = lw || Math.max(3, px * 0.2);
  ctx.strokeStyle = stroke;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
}

/** Text that shrinks until it fits `maxW`. */
export function fitted(ctx, str, x, y, px, maxW, fill, stroke, align, base) {
  let size = px;
  ctx.font = font(size);
  const w = ctx.measureText(str).width;
  if (w > maxW && w > 0) size = Math.max(8, Math.floor((px * maxW) / w));
  outlined(ctx, str, x, y, size, fill, stroke, align, base);
}

/** A rounded-rectangle path (no ctx.roundRect: older Safari lacks it). */
export function rr(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.arcTo(x + w, y, x + w, y + k, k);
  ctx.lineTo(x + w, y + h - k);
  ctx.arcTo(x + w, y + h, x + w - k, y + h, k);
  ctx.lineTo(x + k, y + h);
  ctx.arcTo(x, y + h, x, y + h - k, k);
  ctx.lineTo(x, y + k);
  ctx.arcTo(x, y, x + k, y, k);
  ctx.closePath();
}

/** A filled, outlined rounded rectangle with a solid drop shadow under it. */
export function plate(ctx, x, y, w, h, r, fill, lw = 4, shadow = 5) {
  if (shadow) {
    rr(ctx, x, y + shadow, w, h, r);
    ctx.fillStyle = 'rgba(30,20,50,0.35)';
    ctx.fill();
  }
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function circle(ctx, x, y, r, fill, lw = 0, stroke = INK) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

export function ellipse(ctx, x, y, rx, ry, fill, lw = 0, stroke = INK) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

const shades = new Map();

/** A colour from "#rrggbb" made lighter (amt > 0) or darker (amt < 0). Remembered, so drawing it every frame makes no garbage. */
export function shade(hex, amt) {
  const key = `${hex}|${amt}`;
  let out = shades.get(key);
  if (out === undefined) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
    out = `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
    shades.set(key, out);
  }
  return out;
}

export function star(ctx, x, y, r, points = 5, inner = 0.5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
