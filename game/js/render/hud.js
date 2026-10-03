// What the spider knows, drawn on the glass: the night's clock (a moon crossing an arc), food against the quota,
// the thread in the spinnerets, warnings at the screen edge, and a hint when one is due. Labels, not sentences.
import { SILVER, AMBER, RUST, PAPER, rgba } from './palette.js';

export const SERIF = '"EB Garamond", "Iowan Old Style", Georgia, serif';
export const SCRIPT = '"Cedarville Cursive", "Segoe Script", cursive';
const TYPES = ['Frame', 'Radial', 'Sticky', 'Alarm', 'Orb'];

function text(ctx, s, x, y, size, color, align = 'center', weight = 600, font = SERIF) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(2, 8, 9, 0.55)';
  ctx.fillText(s, x + 1, y + 1.5);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** h: the HUD state from the game (see main.js). */
export function drawHud(ctx, h, w, ht, t) {
  if (!h) return;
  const touch = h.touch;
  // ---- the night's clock, top centre
  const cx = w / 2;
  const cw = Math.min(220, w * 0.42);
  const top = 22;
  ctx.strokeStyle = rgba(SILVER, 0.28);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const f = i / 24;
    const x = cx - cw / 2 + cw * f;
    const y = top + 16 - Math.sin(f * Math.PI) * 12;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const duskF = h.dusk / (h.dusk + h.length);
  ctx.strokeStyle = rgba(AMBER, 0.55);
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const f = (i / 8) * duskF;
    const x = cx - cw / 2 + cw * f;
    const y = top + 16 - Math.sin(f * Math.PI) * 12;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const f = Math.max(0, Math.min(1, h.clock));
  const mx = cx - cw / 2 + cw * f;
  const my = top + 16 - Math.sin(f * Math.PI) * 12;
  ctx.fillStyle = f >= 1 ? AMBER : SILVER;
  ctx.beginPath();
  ctx.arc(mx, my, 5.5, 0, Math.PI * 2);
  ctx.fill();
  if (f < 1) {
    ctx.fillStyle = 'rgba(8, 23, 26, 0.9)';
    ctx.beginPath();
    ctx.arc(mx + 2.4, my - 1.6, 4.6, 0, Math.PI * 2);
    ctx.fill();
  }
  text(ctx, h.label, cx, top + 34, 15, rgba(SILVER, 0.9));
  // ---- food and quota, top right
  const rx = w - 18;
  if (h.quota > 0) {
    const met = h.food >= h.quota;
    text(ctx, `${Math.floor(h.food)} / ${h.quota}`, rx, 26, 22, met ? AMBER : SILVER, 'right', 600);
    const bw = 96;
    ctx.fillStyle = rgba(SILVER, 0.18);
    ctx.fillRect(rx - bw, 42, bw, 3);
    ctx.fillStyle = met ? AMBER : SILVER;
    ctx.fillRect(rx - bw, 42, bw * Math.min(1, h.food / h.quota), 3);
    if (met) text(ctx, 'Fed', rx - bw - 10, 26, 15, AMBER, 'right');
  } else text(ctx, `${Math.floor(h.food)}`, rx, 26, 22, SILVER, 'right', 600);
  // Friends, under the food: name and what's wrong.
  let ly = 62;
  for (const m of h.mates ?? []) {
    text(ctx, m.name, rx - 14, ly, 14, m.downed ? RUST : rgba(SILVER, m.away ? 0.4 : 0.8), 'right', 400);
    ctx.fillStyle = m.downed ? RUST : rgba(SILVER, 0.6);
    ctx.fillRect(rx - 8, ly - 4, 7, 7 * Math.max(0.05, m.hp / 100));
    ly += 20;
  }
  // ---- thread in hand (orb weaver): a row of glyphs with their keys, bottom centre
  if (h.types) {
    const n = TYPES.length;
    const gap = touch ? 0 : 46;
    const by = ht - (touch ? 132 : 34);
    // Keyboard and mouse: the row lives in the lower left, out of the middle of the night.
    const rowX = touch ? cx : 36 + ((n - 1) / 2) * gap;
    if (touch) {
      glyph(ctx, h.type, cx, by, 1.3, SILVER);
      text(ctx, h.pattern ?? TYPES[h.type], cx, by + 22, 15, rgba(SILVER, 0.85));
    } else {
      for (let i = 0; i < n; i++) {
        const x = rowX + (i - (n - 1) / 2) * gap;
        const on = i === h.type;
        if (on) {
          ctx.fillStyle = rgba(SILVER, 0.12);
          ctx.beginPath();
          ctx.arc(x, by - 4, 21, 0, Math.PI * 2);
          ctx.fill();
        }
        glyph(ctx, i, x, by - 6, 1, on ? SILVER : rgba(SILVER, 0.45));
        text(ctx, `${i + 1}`, x, by + 13, 12, on ? AMBER : rgba(SILVER, 0.45), 'center', 600);
      }
      text(ctx, h.pattern ?? TYPES[h.type], rowX, by - 34, 15, rgba(SILVER, 0.75));
    }
  }
  // ---- warnings at the edges
  for (const e of h.edges ?? []) edgeMark(ctx, e, w, ht, t);
  // ---- a hint, low and centred, in the notebook hand
  if (h.hint && h.hintA > 0.01) {
    ctx.globalAlpha = h.hintA;
    text(ctx, h.hint, cx, ht * (touch ? 0.62 : 0.7), Math.max(22, Math.min(30, w / 22)), PAPER, 'center', 400, SCRIPT);
    ctx.globalAlpha = 1;
  }
  if (h.big) {
    ctx.globalAlpha = Math.min(1, h.bigA);
    text(ctx, h.big, cx, ht * 0.4, Math.max(30, Math.min(52, w / 14)), h.bigColor ?? SILVER, 'center', 400, SERIF);
    if (h.bigSub) text(ctx, h.bigSub, cx, ht * 0.4 + 40, 18, rgba(SILVER, 0.8), 'center', 400, SERIF);
    ctx.globalAlpha = 1;
  }
  for (const n of h.notes ?? []) {
    ctx.globalAlpha = Math.min(1, n.a);
    text(ctx, n.s, n.x, n.y, 16, n.c ?? SILVER, 'center', 600);
    ctx.globalAlpha = 1;
  }
}

function edgeMark(ctx, e, w, h, t) {
  // A chevron on the edge pointing at something off screen (or at a band for the wren).
  const m = 26;
  const x = Math.max(m, Math.min(w - m, e.x));
  const y = Math.max(m + 40, Math.min(h - m - (e.low ? 110 : 0), e.y));
  const a = Math.atan2(e.y - y + (e.dy ?? 0), e.x - x + (e.dx ?? 0));
  const pulse = 0.65 + 0.35 * Math.sin(t * (e.urgent ? 10 : 4));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = e.urgent ? rgba(RUST, pulse) : rgba(e.warm ? AMBER : SILVER, 0.75 * pulse);
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-6, -8);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (e.label) text(ctx, e.label, x - Math.cos(a) * 26, y - Math.sin(a) * 18, 14, e.urgent ? RUST : rgba(SILVER, 0.85));
}

/** Small drawings of each thread kind (and the Quick Orb), used in the HUD and the notebook. */
export function glyph(ctx, i, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  if (i === 0) {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-12, 6);
    ctx.lineTo(12, -6);
    ctx.stroke();
  } else if (i === 1) {
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos((k / 6) * Math.PI * 2) * 11, Math.sin((k / 6) * Math.PI * 2) * 11);
    }
    ctx.stroke();
  } else if (i === 2) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.arc(k * 5, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (i === 3) {
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(-12, 3);
    ctx.lineTo(12, 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-5, -1);
    ctx.lineTo(0, -9);
    ctx.lineTo(5, -1);
    ctx.stroke();
  } else {
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos((k / 8) * Math.PI * 2) * 12, Math.sin((k / 8) * Math.PI * 2) * 12);
    }
    ctx.stroke();
    for (const r of [4, 7.5, 11]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export { TYPES };
