// Store art. With ?poster=<name> the game skips the room and the SDK and draws ONE staged, frozen frame with the real renderer
// (fixed seed, nothing random), then sets document.body.dataset.ready = '1' for whoever captures it.
//   cover (1280x720), action (1280x720), win (1280x720), icon (512x512), badge-<id> (256x256)

import { drawScene, drawWatcher, makeVis, makeView } from './draw.js';
import { fx } from './fx.js';
import { FIELD_W, PLAYER_COLORS, hashStr, mulberry32 } from './rules.js';
import { S_DONE, S_RUN, S_ZAP } from './sim.js';
import { FONT, GREEN, INK, RED, YELLOW, circle, outlined, plate, rr, star } from './style.js';
import { crown, drawLightFrame } from './ui.js';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };
const BADGES = ['first-win', 'statue', 'photo-finish', 'marathon'];

export async function runPoster(canvas, name) {
  const badge = name.startsWith('badge-') ? name.slice(6) : null;
  const size = badge ? [256, 256] : SIZES[name];
  if (!size || (badge && !BADGES.includes(badge))) {
    document.body.dataset.ready = 'error';
    return;
  }
  const [w, h] = size;
  Object.assign(document.body.style, { margin: '0', overflow: 'hidden' });
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px`;
  Math.random = mulberry32(hashStr(name)); // every particle and wobble comes out the same each time
  fx.configure('high', false);
  fx.clear();
  try {
    await Promise.race([document.fonts.load(`700 80px Fredoka`), new Promise((r) => setTimeout(r, 4000))]);
  } catch {
    // the fallback font will do
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (name === 'cover') cover(ctx, w, h);
  else if (name === 'action') action(ctx, w, h);
  else if (name === 'win') win(ctx, w, h);
  else if (name === 'icon') icon(ctx, w, h);
  else badgeArt(ctx, w, h, badge);
  try {
    await document.fonts.ready;
  } catch {
    // ignore
  }
  document.body.dataset.ready = '1';
}

// ---------------------------------------------------------------- helpers

/** A staged character: a bot's face, a pose frozen at stride phase `ph`. */
function actor(id, x, y, o = {}) {
  const vis = makeVis(id);
  vis.ph = o.ph ?? 0;
  vis.q = o.q ?? 0;
  vis.skid = o.skid ?? 0;
  return {
    id,
    x,
    y,
    vx: o.vx ?? 0,
    vy: o.vy ?? 0,
    s: o.s ?? S_RUN,
    color: PLAYER_COLORS[o.c ?? 0],
    bot: true,
    avatar: null,
    mood: o.mood ?? 'ok',
    face: hashStr(id),
    vis,
    isMe: false,
    name: '',
    alpha: 1,
    hop: 0,
    away: false,
  };
}

const RED_LIGHT = { c: 2, k: 3, tIn: 1, left: 1, fake: -1, turn: 1, wait: false };
const GREEN_LIGHT = { c: 0, k: 3, tIn: 1, left: 1, fake: -1, turn: 0, wait: false };

function scene(light, t, ribbon, chars) {
  return { light, t, ribbon, chars, n: chars.length, tagOptions: { names: false } };
}

function titleText(ctx, w, y, px) {
  const a = 'RED LIGHT ';
  const b = 'GREEN LIGHT';
  ctx.font = `700 ${px}px ${FONT}`;
  const wa = ctx.measureText(a).width;
  const wb = ctx.measureText(b).width;
  let x = w / 2 - (wa + wb) / 2;
  for (const [str, fill, width] of [
    [a, RED, wa],
    [b, GREEN, wb],
  ]) {
    outlined(ctx, str, x + px * 0.04, y + px * 0.07, px, 'rgba(30,20,50,0.4)', 'rgba(30,20,50,0.4)', 'left', 'middle', px * 0.22);
    outlined(ctx, str, x, y, px, fill, INK, 'left', 'middle', px * 0.2);
    x += width;
  }
}

function numberStar(ctx, x, y, r, n, fill) {
  star(ctx, x, y, r, 5, 0.55, -Math.PI / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(3, r * 0.14);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  outlined(ctx, String(n), x, y + r * 0.08, r * 1.0, '#ffffff', INK);
}

// ---------------------------------------------------------------- the posters

function cover(ctx, w, h) {
  const v = makeView(w, h, 61.4, 14);
  const chars = [
    actor('bot1', 1.3, 59.0, { vy: 5.6, ph: 0.4, c: 0, mood: 'scared' }),
    actor('bot2', 3.3, 58.0, { vy: 3.2, ph: 1.7, c: 2, skid: 1, mood: 'scared' }),
    actor('bot3', 5.1, 59.7, { vy: 5.9, ph: 2.6, c: 6, mood: 'scared' }),
    actor('bot4', 7.0, 57.7, { s: S_ZAP, c: 8, mood: 'zap' }),
    actor('bot5', 8.7, 59.2, { vy: 5.7, ph: 4.4, c: 1, mood: 'scared' }),
    actor('bot6', 10.5, 58.1, { vy: 3.6, ph: 5.6, c: 5, skid: 1, mood: 'scared' }),
    actor('bot7', 2.3, 57.2, { vy: 5.2, ph: 3.3, c: 9, mood: 'scared' }),
    actor('bot8', 11.1, 59.8, { vy: 5.5, ph: 0.9, c: 4, mood: 'scared' }),
  ];
  fx.sparks(7.0, 58.6, 16, '#ffe14a', 6);
  fx.sparks(7.0, 58.6, 10, '#ffffff', 4);
  for (let i = 0; i < 4; i++) fx.dust(3.3, 58.0, 4, 0.8);
  for (let i = 0; i < 3; i++) fx.dust(10.5, 58.1, 4, 0.8);
  fx.update(0.1);
  drawScene(ctx, v, scene(RED_LIGHT, -0.172, -1, chars));
  drawLightFrame(ctx, w, h, 2, 0, true);
  titleText(ctx, w, 78, 96);
}

function action(ctx, w, h) {
  const S = 70;
  const v = { W: w, H: h, S, ox: w / 2 - (FIELD_W / 2) * S, base: 576, camY: 20.5 };
  const hero = actor('bot3', 6.7, 19.6, { vy: 3.4, ph: 1.2, c: 3, skid: 1, q: 0.1, mood: 'scared', vx: 0.4 });
  const chars = [hero, actor('bot6', 3.7, 21.7, { c: 7, mood: 'scared' }), actor('bot1', 9.3, 21.2, { c: 1, mood: 'scared' })];
  for (let i = 0; i < 5; i++) fx.dust(hero.x + (i % 2 ? 0.4 : -0.2), hero.y, 5, 1.2);
  fx.update(0.12);
  for (let i = 0; i < 3; i++) fx.dust(hero.x - 0.3, hero.y + 0.05, 5, 1.4);
  fx.update(0.1);
  drawScene(ctx, v, scene({ c: 2, k: 2, tIn: 0.3, left: 2, fake: -1, turn: 1, wait: false }, -0.9, -1, chars));
  drawLightFrame(ctx, w, h, 2, 0, true);
  // the Watcher far up the field, turned around: the lamp is red
  drawWatcher(ctx, w / 2, 92, 26, RED_LIGHT, 0);
}

function win(ctx, w, h) {
  const S = 60;
  const v = { W: w, H: h, S, ox: w / 2 - (FIELD_W / 2) * S, base: 504, camY: 57.1 };
  const hero = actor('bot2', 6.0, 60.9, { s: S_DONE, c: 2, mood: 'happy' });
  const chars = [
    hero,
    actor('bot4', 3.4, 58.7, { vy: 5.8, ph: 0.8, c: 6, mood: 'happy' }),
    actor('bot7', 8.7, 58.2, { vy: 5.9, ph: 2.9, c: 0, mood: 'happy' }),
    actor('bot1', 5.0, 57.3, { vy: 5.7, ph: 4.2, c: 9, mood: 'happy' }),
    actor('bot5', 10.2, 57.0, { vy: 5.6, ph: 1.9, c: 4, mood: 'happy' }),
  ];
  fx.confetti(6.0, 61.0, 90, 9);
  fx.update(0.3);
  fx.confetti(5.0, 60.4, 50, 8);
  fx.update(0.25);
  fx.stars(6.0, 62.2, 6, 4);
  fx.update(0.1);
  drawScene(ctx, v, scene(GREEN_LIGHT, 0.6, 0.5, chars));
  const sx = (x) => v.ox + x * S;
  const sy = (y) => v.base - (y - v.camY) * S;
  numberStar(ctx, sx(6.0), sy(60.9) - 2.5 * S, 0.9 * S, 1, '#ffd42a');
  numberStar(ctx, sx(3.4), sy(58.7) - 2.0 * S, 0.5 * S, 2, '#c9d0e0');
  numberStar(ctx, sx(8.7), sy(58.2) - 2.0 * S, 0.5 * S, 3, '#e0a070');
  numberStar(ctx, sx(5.0), sy(57.3) - 2.0 * S, 0.45 * S, 4, '#9be04a');
}

function icon(ctx, w, h) {
  ctx.fillStyle = '#8ae05c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#7fd554';
  for (let i = 0; i < 8; i += 2) ctx.fillRect(0, i * 64, w, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.56, 215, 0, Math.PI * 2);
  ctx.fill();
  drawWatcher(ctx, w / 2, 292, 72, null, 0, { turn: 1, c: 2, lamp: 'split' });
}

function badgeArt(ctx, w, h, kind) {
  const bg = { 'first-win': '#ffb830', statue: '#4aa8ff', 'photo-finish': '#9d5cff', marathon: '#22c768' }[kind];
  const cx = w / 2;
  const cy = h / 2;
  circle(ctx, cx + 4, cy + 7, 118, 'rgba(30,20,50,0.35)');
  circle(ctx, cx, cy, 118, bg, 10, INK);
  circle(ctx, cx, cy, 98, null, 4, 'rgba(255,255,255,0.45)');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'first-win') {
    crown(ctx, cx, cy + 4, 150, '#ffe14a');
  } else if (kind === 'statue') {
    // a figure frozen mid-stride, arms out
    ctx.fillStyle = '#e8edf7';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    rr(ctx, cx - 26, cy - 20, 52, 64, 16);
    ctx.fill();
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 26, cy - 8);
      ctx.lineTo(cx + s * 64, cy - 30 + (s < 0 ? 10 : 0));
      ctx.lineWidth = 20;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#e8edf7';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + s * 14, cy + 42);
      ctx.lineTo(cx + s * 30 + (s > 0 ? 14 : -4), cy + 78);
      ctx.lineWidth = 22;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = 11;
      ctx.strokeStyle = '#e8edf7';
      ctx.stroke();
    }
    circle(ctx, cx, cy - 46, 25, '#e8edf7', 8, INK);
    circle(ctx, cx - 9, cy - 48, 3.5, INK);
    circle(ctx, cx + 9, cy - 48, 3.5, INK);
    ctx.beginPath();
    ctx.ellipse(cx, cy - 36, 6, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  } else if (kind === 'photo-finish') {
    plate(ctx, cx - 70, cy - 36, 140, 100, 20, '#f4f4f4', 8, 0);
    rr(ctx, cx - 70, cy - 36, 140, 28, 12);
    ctx.fillStyle = '#ff4d4d';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = INK;
    ctx.stroke();
    rr(ctx, cx - 30, cy - 58, 60, 26, 8);
    ctx.fillStyle = '#c9d0e0';
    ctx.fill();
    ctx.stroke();
    circle(ctx, cx, cy + 16, 36, '#2b2f3a', 8, INK);
    circle(ctx, cx, cy + 16, 22, '#38b6ff', 5, INK);
    circle(ctx, cx - 8, cy + 8, 7, 'rgba(255,255,255,0.85)');
    circle(ctx, cx + 50, cy - 20, 6, YELLOW, 3, INK);
  } else {
    // a running shoe
    ctx.beginPath();
    ctx.moveTo(cx - 82, cy + 38);
    ctx.lineTo(cx - 82, cy - 40);
    ctx.quadraticCurveTo(cx - 80, cy - 52, cx - 62, cy - 52);
    ctx.lineTo(cx - 30, cy - 52);
    ctx.quadraticCurveTo(cx - 22, cy - 20, cx + 6, cy - 6);
    ctx.lineTo(cx + 58, cy + 8);
    ctx.quadraticCurveTo(cx + 88, cy + 16, cx + 84, cy + 38);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = INK;
    ctx.stroke();
    rr(ctx, cx - 90, cy + 34, 182, 24, 12);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 52, cy - 28);
    ctx.lineTo(cx - 8, cy + 6);
    ctx.moveTo(cx - 70, cy - 4);
    ctx.lineTo(cx - 28, cy + 24);
    ctx.lineWidth = 7;
    ctx.stroke();
    for (const [x, y] of [
      [-112, 14],
      [-122, 34],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx + x, cy + y);
      ctx.lineTo(cx + x - 30, cy + y);
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
    }
  }
}
