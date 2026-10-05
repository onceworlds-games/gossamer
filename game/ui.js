// Screens and HUD drawn on the canvas: title, lobby chips, countdown, banners, the HUD, the scoreboard, the podium. Every button is
// registered each frame (id + rectangle) so a tap can be matched to it. Few words: labels, numbers and icons.

import { FIELD_LEN, easeInOut, easeOutBack, easeOutCubic, clamp, lerp, placeLabel } from './rules.js';
import { rankMatch } from './flow.js';
import { drawChar, drawFace, drawWatcher, makeVis } from './draw.js';
import { S_DONE, S_RUN } from './sim.js';
import { popScale } from './fx.js';
import { GREEN, GREEN_DIM, INK, PAPER, RED, RED_DIM, YELLOW, YELLOW_DIM, circle, ellipse, fitted, font, outlined, plate, rr, shade } from './style.js';

export const uiScale = (W, H) => clamp(Math.min(W / 640, H / 360), 0.75, 2.4);

// ---------------------------------------------------------------- buttons

const buttons = [];
export function beginFrame() {
  buttons.length = 0;
}
function register(id, x, y, w, h) {
  buttons.push({ id, x, y, w, h });
}
/** The id of the button under a tap, or null. Later buttons are on top. */
export function hitTest(x, y) {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
  }
  return null;
}

// ---------------------------------------------------------------- pieces

/** A head: the player's avatar, or a cute face. info: { avatar(id), color(id), face(id), bot(id) }. */
export function head(ctx, info, id, x, y, r, mood = 'ok') {
  const av = info.avatar(id);
  const col = info.color(id);
  const lw = clamp(r * 0.14, 2, 4.5);
  circle(ctx, x, y, r + lw * 0.9, null, lw * 1.3, col);
  if (av) {
    circle(ctx, x, y, r, shade(col, 0.6), lw, INK);
    const nw = av.naturalWidth || 1;
    const nh = av.naturalHeight || 1;
    const k = Math.min((2.4 * r) / nw, (2.4 * r) / nh);
    try {
      ctx.drawImage(av, x - (nw * k) / 2, y - (nh * k) / 2 + r * 0.08, nw * k, nh * k);
    } catch {
      // the plain head shows
    }
  } else drawFace(ctx, x, y, r, info.face(id) >>> 0, mood, false, col);
}

function lampTrio(ctx, cx, cy, d, c, age, t) {
  const gap = d * 0.28;
  const w = d * 3 + gap * 4;
  const h = d + gap * 2;
  plate(ctx, cx - w / 2, cy - h / 2, w, h, h / 2, '#2b2f3a', 4, 4);
  const cols = [RED, YELLOW, GREEN];
  const dims = [RED_DIM, YELLOW_DIM, GREEN_DIM];
  const order = [2, 1, 0]; // red, yellow, green from the left
  for (let i = 0; i < 3; i++) {
    const lamp = order[i];
    const x = cx - w / 2 + gap + d / 2 + i * (d + gap);
    const lit = lamp === c;
    const pop = lit ? 1 + 0.25 * Math.max(0, 1 - age / 0.3) + (c === 2 ? 0.03 * Math.sin(t * 9) : 0) : 1;
    if (lit) {
      ctx.globalAlpha = 0.35;
      circle(ctx, x, cy, d * 0.95 * pop, cols[lamp]);
      ctx.globalAlpha = 1;
    }
    circle(ctx, x, cy, (d / 2) * pop, lit ? cols[lamp] : dims[lamp], 3, INK);
    if (lit) circle(ctx, x - d * 0.14, cy - d * 0.16, d * 0.1, 'rgba(255,255,255,0.75)');
  }
  return { w, h };
}

function flagIcon(ctx, x, y, s) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2.5, s * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.35, y + s * 0.5);
  ctx.lineTo(x - s * 0.35, y - s * 0.5);
  ctx.stroke();
  ctx.lineCap = 'butt';
  const cell = s * 0.25;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : INK;
      ctx.fillRect(x - s * 0.3 + i * cell, y - s * 0.5 + j * cell, cell, cell);
    }
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.strokeRect(x - s * 0.3, y - s * 0.5, cell * 4, cell * 3);
}

function backIcon(ctx, x, y, s) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(3, s * 0.2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(x, y + s * 0.05, s * 0.34, -0.2 * Math.PI, 1.3 * Math.PI, true);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.3, y - s * 0.38);
  ctx.lineTo(x + s * 0.46, y - s * 0.08);
  ctx.lineTo(x + s * 0.12, y - s * 0.1);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function ghostIcon(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - s * 0.34, y + s * 0.4);
  ctx.lineTo(x - s * 0.34, y - s * 0.05);
  ctx.arc(x, y - s * 0.05, s * 0.34, Math.PI, 0);
  ctx.lineTo(x + s * 0.34, y + s * 0.4);
  ctx.lineTo(x + s * 0.17, y + s * 0.28);
  ctx.lineTo(x, y + s * 0.4);
  ctx.lineTo(x - s * 0.17, y + s * 0.28);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, s * 0.1);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  circle(ctx, x - s * 0.12, y - s * 0.08, s * 0.06, INK);
  circle(ctx, x + s * 0.12, y - s * 0.08, s * 0.06, INK);
}

export function crown(ctx, x, y, s, fill = '#ffd42a') {
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y + s * 0.3);
  ctx.lineTo(x - s * 0.55, y - s * 0.3);
  ctx.lineTo(x - s * 0.25, y);
  ctx.lineTo(x, y - s * 0.42);
  ctx.lineTo(x + s * 0.25, y);
  ctx.lineTo(x + s * 0.55, y - s * 0.3);
  ctx.lineTo(x + s * 0.5, y + s * 0.3);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, s * 0.1);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  circle(ctx, x, y + s * 0.08, s * 0.08, '#ff4d4d', 1.5);
}

function bolt(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.1, y - s * 0.5);
  ctx.lineTo(x - s * 0.3, y + s * 0.08);
  ctx.lineTo(x - s * 0.02, y + s * 0.08);
  ctx.lineTo(x - s * 0.12, y + s * 0.5);
  ctx.lineTo(x + s * 0.3, y - s * 0.12);
  ctx.lineTo(x + s * 0.02, y - s * 0.12);
  ctx.closePath();
  ctx.fillStyle = '#ffd42a';
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, s * 0.1);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function statueIcon(ctx, x, y, s) {
  ctx.fillStyle = '#cfd6e6';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2.5, s * 0.1);
  ctx.lineJoin = 'round';
  rr(ctx, x - s * 0.3, y + s * 0.3, s * 0.6, s * 0.18, s * 0.05);
  ctx.fill();
  ctx.stroke();
  rr(ctx, x - s * 0.18, y - s * 0.1, s * 0.36, s * 0.42, s * 0.1);
  ctx.fill();
  ctx.stroke();
  circle(ctx, x, y - s * 0.28, s * 0.17, '#cfd6e6', ctx.lineWidth);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.18, y - s * 0.05);
  ctx.lineTo(x + s * 0.4, y - s * 0.36);
  ctx.stroke();
}

function pill(ctx, x, y, w, h, fill) {
  plate(ctx, x, y, w, h, h / 2, fill, 3.5, 3);
}

// ---------------------------------------------------------------- title

/** The logo and the one PLAY button. `press` is 0..1 while the button is held down. */
export function drawTitle(ctx, W, H, t, press, touch, calm = false) {
  const ui = uiScale(W, H);
  ctx.fillStyle = 'rgba(20,12,40,0.28)';
  ctx.fillRect(0, 0, W, H);
  const px = Math.min(W * 0.115, H * 0.17);
  const lines = [
    ['RED LIGHT', RED],
    ['GREEN LIGHT', GREEN],
  ];
  const lineH = px * 1.02;
  const top = H * 0.5 - lineH * 1.55 - 14 * ui;
  ctx.save();
  ctx.translate(W / 2, 0);
  ctx.rotate(-0.025);
  lines.forEach(([text, fill], li) => {
    ctx.font = font(px);
    const total = ctx.measureText(text).width;
    let x = -total / 2;
    const y = top + lineH * (li + 0.5);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const cw = ctx.measureText(ch).width;
      const wave = calm ? 0 : Math.sin(t * 3.2 + i * 0.5 + li) * px * 0.04;
      // a solid shadow, then the outlined letter
      outlined(ctx, ch, x + cw / 2 + px * 0.04, y + px * 0.06 + wave, px, 'rgba(30,20,50,0.4)', 'rgba(30,20,50,0.4)', 'center', 'middle', px * 0.22);
      outlined(ctx, ch, x + cw / 2, y + wave, px, fill, INK, 'center', 'middle', px * 0.2);
      x += cw;
    }
  });
  ctx.restore();
  // the button
  const bw = clamp(W * 0.32, 190, 340);
  const bh = clamp(H * 0.2, 66, 100);
  const bx = W / 2 - bw / 2;
  const by = top + lineH * 2 + 26 * ui;
  const pulse = 1 + (calm ? 0 : 0.035 * Math.sin(t * 4)) - press * 0.06;
  ctx.save();
  ctx.translate(W / 2, by + bh / 2);
  ctx.scale(pulse, pulse);
  plate(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, GREEN, 5, press > 0 ? 2 : 7);
  ctx.beginPath();
  const ts = bh * 0.3;
  ctx.moveTo(-bw * 0.27 - ts * 0.5, -ts);
  ctx.lineTo(-bw * 0.27 + ts, 0);
  ctx.lineTo(-bw * 0.27 - ts * 0.5, ts);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  outlined(ctx, 'PLAY', bw * 0.06, touch ? 0 : -bh * 0.06, bh * 0.52, '#ffffff', INK);
  if (!touch) outlined(ctx, 'SPACE', bw * 0.06, bh * 0.3, bh * 0.2, '#ffffff', INK);
  ctx.restore();
  register('play', bx, by, bw, bh);
}

// ---------------------------------------------------------------- lobby

const MODE_LABEL = { back: 'Back to start', out: 'Out' };

/** The settings as big readable chips at the top (the host taps them), and the one-line hint above the platform's strip. */
export function drawLobbyTop(ctx, W, H, t, st) {
  const ui = uiScale(W, H);
  const cw = 150 * ui;
  const ch = 58 * ui;
  const gap = 12 * ui;
  const x0 = W / 2 - cw - gap / 2;
  const y0 = Math.max(64 * ui, 60);
  const chips = [
    { id: 'set-rounds', label: 'ROUNDS', value: String(st.rounds), icon: flagIcon },
    { id: 'set-mode', label: 'CAUGHT', value: MODE_LABEL[st.mode] ?? 'Back to start', icon: st.mode === 'out' ? ghostIcon : backIcon },
  ];
  chips.forEach((c, i) => {
    const x = x0 + i * (cw + gap);
    const press = st.pressed === c.id ? 3 * ui : 0;
    plate(ctx, x, y0 + press, cw, ch, 16 * ui, st.host ? PAPER : '#e8e0d0', 4, st.host ? 5 : 3);
    c.icon(ctx, x + 26 * ui, y0 + ch / 2 + press, 30 * ui);
    outlined(ctx, c.label, x + 52 * ui, y0 + 15 * ui + press, 11.5 * ui, '#ffffff', INK, 'left', 'middle', 3);
    fitted(ctx, c.value, x + 52 * ui, y0 + 38 * ui + press, 24 * ui, cw - 62 * ui, '#ffffff', INK, 'left', 'middle');
    if (st.host) {
      // a small "tap to change" mark
      const ax = x + cw - 14 * ui;
      const ay = y0 + 14 * ui + press;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ax, ay, 5.5 * ui, 0.3 * Math.PI, 1.8 * Math.PI);
      ctx.stroke();
      register(c.id, x, y0, cw, ch);
    }
  });
  if (st.hint) {
    const text = 'Hold to run, let go on red!';
    ctx.font = font(20 * ui);
    const w = ctx.measureText(text).width + 36 * ui;
    const h = 38 * ui;
    pill(ctx, W / 2 - w / 2, H - 112 * ui - h, w, h, PAPER);
    outlined(ctx, text, W / 2, H - 112 * ui - h / 2, 20 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle', 0);
  }
}

// ---------------------------------------------------------------- countdown, GO, banners, light words

/** 3, 2, 1 in traffic-light colours, timed to the clock. `left` is ms until play begins. */
export function drawCountdown(ctx, W, H, left) {
  const n = Math.max(1, Math.ceil(left / 1000));
  const f = 1 - (left - (n - 1) * 1000) / 1000; // 0 as the number appears, 1 as it ends
  const size = Math.min(W, H) * 0.62;
  const grow = f < 0.18 ? 1.5 - 0.5 * easeOutCubic(f / 0.18) : 1 - (f - 0.18) * 0.18;
  bigText(ctx, String(n), W / 2, H * 0.46, size * grow, [GREEN, YELLOW, RED][Math.min(2, n - 1)] ?? RED, f > 0.85 ? 1 - (f - 0.85) / 0.15 : 1);
}

function bigText(ctx, str, x, y, px, fill, alpha = 1) {
  ctx.globalAlpha = alpha;
  outlined(ctx, str, x + px * 0.03, y + px * 0.05, px, 'rgba(30,20,50,0.4)', 'rgba(30,20,50,0.4)', 'center', 'middle', px * 0.16);
  outlined(ctx, str, x, y, px, fill, INK, 'center', 'middle', px * 0.15);
  ctx.globalAlpha = 1;
}

/** GO! with rays behind it, for the first moment of a match. `age` is seconds since play began. */
export function drawGo(ctx, W, H, age) {
  if (age < 0 || age > 0.9) return;
  const size = Math.min(W, H) * 0.5;
  const s = popScale(age, 0.3);
  const fade = age > 0.65 ? 1 - (age - 0.65) / 0.25 : 1;
  ctx.save();
  ctx.globalAlpha = 0.28 * fade;
  ctx.translate(W / 2, H * 0.44);
  ctx.rotate(age * 0.8);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.max(W, H), -40);
    ctx.lineTo(Math.max(W, H), 40);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  bigText(ctx, 'GO!', W / 2, H * 0.44, size * Math.max(0.01, s), GREEN, fade);
}

/** The round banner: a ribbon sliding across with the goal in a few words. `age` and `dur` in seconds. */
export function drawBanner(ctx, W, H, age, dur, round, rounds, mode) {
  if (age < 0 || age > dur) return;
  const ui = uiScale(W, H);
  const inT = clamp(age / 0.3, 0, 1);
  const outT = clamp((age - (dur - 0.25)) / 0.25, 0, 1);
  const slide = (1 - easeOutBack(inT)) * -H * 0.5 + outT * -H * 0.5;
  const bh = 92 * ui;
  const y = H * 0.38 - bh / 2 + slide;
  ctx.fillStyle = 'rgba(30,20,50,0.4)';
  ctx.fillRect(0, y + 8, W, bh);
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(0, y, W, bh);
  ctx.fillStyle = INK;
  ctx.fillRect(0, y, W, 4);
  ctx.fillRect(0, y + bh - 4, W, 4);
  // Round n / total chip
  const label = rounds > 1 ? `ROUND ${round}/${rounds}` : 'GET READY';
  ctx.font = font(15 * ui);
  const cw = ctx.measureText(label).width + 26 * ui;
  pill(ctx, W / 2 - cw / 2, y - 14 * ui, cw, 28 * ui, YELLOW);
  outlined(ctx, label, W / 2, y, 15 * ui, '#ffffff', INK, 'center', 'middle', 3.5);
  // the goal
  const px = 44 * ui;
  const a = 'FREEZE ON ';
  const b = 'RED!';
  ctx.font = font(px);
  const wa = ctx.measureText(a).width;
  const wb = ctx.measureText(b).width;
  const x0 = W / 2 - (wa + wb) / 2;
  outlined(ctx, a, x0, y + bh * 0.55, px, '#ffffff', INK, 'left', 'middle');
  outlined(ctx, b, x0 + wa, y + bh * 0.55, px, RED, INK, 'left', 'middle');
  if (mode === 'out') {
    ghostIcon(ctx, W - 54 * ui, y + bh / 2, 40 * ui);
    ghostIcon(ctx, 54 * ui, y + bh / 2, 40 * ui);
  }
}

const WORDS = [
  ['GO!', GREEN],
  ['STOP!', YELLOW],
  ['FREEZE!', RED],
];

/** The big word that pops when the light changes (c: 0 green, 1 yellow, 2 red; age in seconds). */
export function drawLightWord(ctx, W, H, c, age) {
  if (age < 0 || age > 0.8) return;
  const [word, fill] = WORDS[c] ?? WORDS[0];
  const size = Math.min(W, H) * 0.2;
  const s = popScale(age, 0.22);
  const fade = age > 0.55 ? 1 - (age - 0.55) / 0.25 : 1;
  bigText(ctx, word, W / 2, H * 0.36, size * Math.max(0.01, s), fill, fade * 0.95);
}

/** A screen-edge frame that says what the light is: red and yellow glow around the edge, green stays clean. */
export function drawLightFrame(ctx, W, H, c, t, calm) {
  if (c === 0) return;
  const ui = uiScale(W, H);
  const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(t * (c === 2 ? 5 : 16));
  const lw = (c === 2 ? 16 : 12) * ui;
  ctx.save();
  ctx.globalAlpha = 0.6 + 0.3 * pulse; // strong enough to read red over the grass, not brown
  ctx.strokeStyle = c === 2 ? RED : YELLOW;
  ctx.lineWidth = lw;
  ctx.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
  if (c === 2) {
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- HUD

/**
 * st: { c, lightAge, turn, round, rounds, secs, place, total, dots: [{ y, color, me, dim }], watcherVisible, t, spectating }.
 * Top centre: the light (always visible, whatever the camera shows), the round and the time. Top right: your place and a progress strip.
 */
export function drawHUD(ctx, W, H, st) {
  const ui = uiScale(W, H);
  const t = st.t;
  const y = (st.spectating ? 46 : 8) * ui;
  const d = 30 * ui;
  const cy = y + d * 0.78;
  const { w: tw, h: th } = lampTrio(ctx, W / 2, cy, d, st.c, st.lightAge, t);
  // the Watcher's bust, when the real one is far off the top of the screen
  if (!st.watcherVisible) {
    const ws = 12 * ui;
    drawWatcher(ctx, W / 2 - tw / 2 - 36 * ui, cy + 4 * ui, ws, { c: st.c, turn: st.turn }, t);
  }
  if (st.lobby) return;
  // round and time
  const rowY = cy + th / 2 + 15 * ui;
  const secs = Math.max(0, Math.ceil(st.secs));
  const label = st.rounds > 1 ? `${st.round}/${st.rounds}` : '';
  const time = `${secs}`;
  ctx.font = font(19 * ui);
  const w1 = label ? ctx.measureText(label).width + 22 * ui : 0;
  const w2 = ctx.measureText(time).width + 22 * ui;
  const total = w1 + w2 + (w1 ? 8 * ui : 0);
  let x = W / 2 - total / 2;
  if (label) {
    pill(ctx, x, rowY - 14 * ui, w1, 28 * ui, '#ffffff');
    outlined(ctx, label, x + w1 / 2, rowY, 19 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle', 0);
    x += w1 + 8 * ui;
  }
  const low = secs <= 10 && st.secs > 0;
  pill(ctx, x, rowY - 14 * ui, w2, 28 * ui, low ? RED : '#ffffff');
  outlined(ctx, time, x + w2 / 2, rowY, 19 * ui, low ? '#ffffff' : INK, low ? INK : 'rgba(255,255,255,0)', 'center', 'middle', low ? 3 : 0);

  // your place
  if (!st.spectating && st.place > 0) {
    const pw = 92 * ui;
    const ph = 50 * ui;
    plate(ctx, W - pw - 12 * ui, 10 * ui, pw, ph, 14 * ui, '#fff8e8', 4, 4);
    outlined(ctx, placeLabel(st.place), W - pw / 2 - 12 * ui, 10 * ui + ph * 0.5, 30 * ui, '#ffd42a', INK, 'center', 'middle');
  }

  // the progress strip down the right edge
  const sx = W - 24 * ui;
  const y0 = 78 * ui;
  const y1 = H - 150 * ui;
  if (y1 - y0 > 60 * ui) {
    rr(ctx, sx - 5 * ui, y0 - 4 * ui, 10 * ui, y1 - y0 + 8 * ui, 5 * ui);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    flagIcon(ctx, sx + 2 * ui, y0 - 16 * ui, 22 * ui);
    for (const dot of st.dots) {
      if (dot.me) continue;
      const dy = y1 - (y1 - y0) * clamp(dot.y / FIELD_LEN, 0, 1);
      ctx.globalAlpha = dot.dim ? 0.4 : 1;
      circle(ctx, sx, dy, 6.5 * ui, dot.color, 2.5, INK);
    }
    ctx.globalAlpha = 1;
    for (const dot of st.dots) {
      if (!dot.me) continue;
      const dy = y1 - (y1 - y0) * clamp(dot.y / FIELD_LEN, 0, 1);
      circle(ctx, sx, dy, 11 * ui, '#ffffff', 3, INK);
      circle(ctx, sx, dy, 7.5 * ui, dot.color, 2, INK);
      ctx.beginPath();
      ctx.moveTo(sx - 15 * ui, dy);
      ctx.lineTo(sx - 25 * ui, dy - 6 * ui);
      ctx.lineTo(sx - 25 * ui, dy + 6 * ui);
      ctx.closePath();
      ctx.fillStyle = '#ffd42a';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }
}

/** Your place popping up in the middle when you cross the line ("1st!"). */
export function drawPlacePop(ctx, W, H, label, age, place) {
  if (age < 0 || age > 1.6) return;
  const size = Math.min(W, H) * (place === 1 ? 0.3 : 0.22);
  const s = popScale(age, 0.3);
  const fade = age > 1.2 ? 1 - (age - 1.2) / 0.4 : 1;
  bigText(ctx, label, W / 2, H * 0.4, size * Math.max(0.01, s), place === 1 ? '#ffd42a' : '#ffffff', fade);
}

/** The room closed (removed, or playing in another tab, or the connection is gone): one message and one button. */
export function drawClosed(ctx, W, H, reason, t) {
  const ui = uiScale(W, H);
  ctx.fillStyle = 'rgba(20,12,40,0.5)';
  ctx.fillRect(0, 0, W, H);
  const message = reason === 'kicked' ? 'You were removed' : reason === 'replaced' ? 'Playing in another tab' : 'Disconnected';
  const label = reason === 'kicked' ? 'PLAY' : reason === 'replaced' ? 'PLAY HERE' : 'REJOIN';
  const w = Math.min(W - 24 * ui, 380 * ui);
  const h = 170 * ui;
  const x = W / 2 - w / 2;
  const y = H / 2 - h / 2;
  plate(ctx, x, y, w, h, 24 * ui, PAPER, 5, 7);
  fitted(ctx, message, W / 2, y + 48 * ui, 32 * ui, w - 30 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle');
  const bw = Math.min(w - 40 * ui, 230 * ui);
  const bh = 62 * ui;
  const bx = W / 2 - bw / 2;
  const by = y + h - bh - 24 * ui;
  const pulse = 1 + 0.03 * Math.sin(t * 4);
  ctx.save();
  ctx.translate(W / 2, by + bh / 2);
  ctx.scale(pulse, pulse);
  plate(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2, GREEN, 5, 6);
  outlined(ctx, label, 0, 0, bh * 0.5, '#ffffff', INK);
  ctx.restore();
  register('rejoin', bx, by, bw, bh);
}

/** A small "Watching" label for someone who joined mid-match. */
export function drawWatching(ctx, W, H) {
  const ui = uiScale(W, H);
  const w = 130 * ui;
  const h = 34 * ui;
  pill(ctx, W / 2 - w / 2, H - 56 * ui, w, h, '#fff8e8');
  // an eye
  const ex = W / 2 - w / 2 + 24 * ui;
  const ey = H - 56 * ui + h / 2;
  ellipse(ctx, ex, ey, 11 * ui, 7 * ui, '#ffffff', 2.5, INK);
  circle(ctx, ex, ey, 3.8 * ui, INK);
  outlined(ctx, 'Watching', W / 2 + 12 * ui, ey, 17 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle', 0);
}

/** A caught player in Out mode: a ghost, and a label so it's clear why nothing happens. */
export function drawOut(ctx, W, H) {
  const ui = uiScale(W, H);
  const w = 110 * ui;
  const h = 40 * ui;
  const y = H - 60 * ui;
  pill(ctx, W / 2 - w / 2, y, w, h, '#fff8e8');
  ghostIcon(ctx, W / 2 - w / 2 + 26 * ui, y + h / 2, 30 * ui);
  outlined(ctx, 'OUT', W / 2 + 16 * ui, y + h / 2, 24 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle', 0);
}

/** The first seconds of a round, for keyboards: a key cap to hold. */
export function drawKeyHint(ctx, W, H, t) {
  const ui = uiScale(W, H);
  const w = 190 * ui;
  const h = 42 * ui;
  const bounce = Math.abs(Math.sin(t * 5)) * 4 * ui;
  pill(ctx, W / 2 - w / 2, H - 70 * ui - bounce, w, h, '#fff8e8');
  outlined(ctx, 'HOLD  SPACE', W / 2, H - 70 * ui - bounce + h / 2, 21 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle', 0);
}

// ---------------------------------------------------------------- the scoreboard between rounds

function oldScores(g) {
  const o = {};
  for (const id of g.roster) o[id] = (g.scores[id] ?? 0) - (g.rp?.[id] ?? 0);
  return o;
}

/** After a round: avatars sorted by points, the round's points flying in, then the new order. `tms` is ms since the board began. */
export function drawBoard(ctx, W, H, g, tms, info) {
  const ui = uiScale(W, H);
  const T = tms / 1000;
  const n = g.roster.length;
  const cols = n <= 6 ? 1 : 2;
  const per = Math.ceil(n / cols);
  const cardW = Math.min(W - 24 * ui, cols === 1 ? 430 * ui : 720 * ui);
  const titleH = 58 * ui;
  const rowH = clamp((H - titleH - 40 * ui) / per, 30 * ui, 54 * ui);
  const cardH = titleH + per * rowH + 14 * ui;
  const pop = popScale(T, 0.35);
  const cx = W / 2;
  const cy = H / 2 + 8 * ui;
  ctx.fillStyle = `rgba(20,12,40,${0.35 * Math.min(1, T / 0.25)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(Math.max(0.01, pop), Math.max(0.01, pop));
  const x0 = -cardW / 2;
  const y0 = -cardH / 2;
  plate(ctx, x0, y0, cardW, cardH, 22 * ui, '#fff8e8', 5, 7);
  outlined(ctx, `ROUND ${g.n}`, 0, y0 + titleH * 0.5, 30 * ui, '#ffd42a', INK);

  const prev = oldScores(g);
  const idx = (id) => g.roster.indexOf(id);
  const sortBy = (sc) => [...g.roster].sort((a, b) => (sc[b] ?? 0) - (sc[a] ?? 0) || idx(a) - idx(b));
  const oldOrder = sortBy(prev);
  const newOrder = sortBy(g.scores);
  const colW = cardW / cols;
  const slotPos = (i, out) => {
    const col = Math.floor(i / per);
    out.x = x0 + col * colW;
    out.y = y0 + titleH + (i % per) * rowH;
  };
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  const e = easeInOut(clamp((T - 2.2) / 0.8, 0, 1));
  const fly = clamp((T - 1.3) / 0.6, 0, 1);
  // draw from the last slot up so a row moving up is drawn over the others
  for (const id of newOrder) {
    slotPos(oldOrder.indexOf(id), a);
    slotPos(newOrder.indexOf(id), b);
    const rx = lerp(a.x, b.x, e);
    const ry = lerp(a.y, b.y, e);
    const me = id === info.me;
    const rw = colW - 14 * ui;
    const rh = rowH - 5 * ui;
    rr(ctx, rx + 7 * ui, ry + 2 * ui, rw, rh, rh * 0.3);
    ctx.fillStyle = me ? '#ffe9a0' : id === g.res?.[0] ? '#d9f5d0' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = me ? 4 : 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    const rank = (e < 0.5 ? oldOrder.indexOf(id) : newOrder.indexOf(id)) + 1;
    outlined(ctx, String(rank), rx + 24 * ui, ry + rowH / 2, Math.min(22 * ui, rh * 0.5), '#ffffff', INK, 'center', 'middle', 3.5);
    head(ctx, info, id, rx + 58 * ui, ry + rowH / 2, Math.min(rh * 0.36, 19 * ui));
    fitted(ctx, info.name(id), rx + 84 * ui, ry + rowH / 2, Math.min(21 * ui, rh * 0.48), rw - 175 * ui, '#ffffff', INK, 'left', 'middle');
    const gain = g.rp?.[id] ?? 0;
    const shown = (prev[id] ?? 0) + Math.round(gain * easeInOut(fly));
    const scoreX = rx + rw - 8 * ui;
    outlined(ctx, String(shown), scoreX, ry + rowH / 2, Math.min(26 * ui, rh * 0.58), '#ffd42a', INK, 'right', 'middle');
    if (gain > 0 && T > 0.5 && fly < 1) {
      const appear = popScale(T - 0.5, 0.3);
      const fx = lerp(scoreX - 62 * ui, scoreX - 16 * ui, easeInOut(fly));
      ctx.globalAlpha = 1 - fly * 0.6;
      outlined(ctx, `+${gain}`, fx, ry + rowH / 2 - fly * 4 * ui, Math.min(22 * ui, rh * 0.5) * Math.max(0.01, appear), GREEN, INK, 'right', 'middle');
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the podium

function podiumSlot(rank, W, H, ui) {
  const bw = Math.min(190 * ui, W * 0.22);
  const base = H * 0.72;
  const hs = [H * 0.27, H * 0.19, H * 0.13];
  const xs = [W / 2, W / 2 - bw * 1.08, W / 2 + bw * 1.08];
  return { x: xs[rank], bw, bh: hs[rank], base };
}

/** The end of the match: the top three on a podium, you if you're lower, and the fun awards. `tms` is ms since the final began. */
export function drawPodium(ctx, W, H, g, tms, info, t) {
  const ui = uiScale(W, H);
  const T = tms / 1000;
  ctx.fillStyle = `rgba(30,18,70,${0.55 * Math.min(1, T / 0.3)})`;
  ctx.fillRect(0, 0, W, H);
  const order = g.final ?? rankMatch(g);
  const pv = { W, H, S: 50 * ui, ox: 0, base: 0, camY: 0 };
  const starts = [1.2, 0.7, 0.2];
  // light rays behind the winner
  if (T > 1.2) {
    const s0 = podiumSlot(0, W, H, ui);
    ctx.save();
    ctx.translate(s0.x, s0.base - s0.bh - 60 * ui);
    ctx.rotate(t * 0.3);
    ctx.fillStyle = 'rgba(255,230,120,0.16)';
    for (let i = 0; i < 10; i++) {
      ctx.rotate(Math.PI / 5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W, -60);
      ctx.lineTo(W, 60);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  const colors = ['#ffd42a', '#d8dde8', '#e0a070'];
  for (const rank of [2, 1, 0]) {
    const id = order[rank];
    if (id === undefined) continue;
    const slot = podiumSlot(rank, W, H, ui);
    const k = clamp((T - starts[rank]) / 0.45, 0, 1);
    if (k <= 0) continue;
    const rise = easeOutBack(k);
    const bh = slot.bh * Math.max(0.01, rise);
    const bx = slot.x - slot.bw / 2;
    const by = slot.base - bh;
    plate(ctx, bx, by, slot.bw, bh, 12 * ui, colors[rank], 5, 6);
    outlined(ctx, String(rank + 1), slot.x, by + bh / 2, Math.min(slot.bh * 0.55, 64 * ui) * Math.min(1, rise), '#ffffff', INK);
    // the character stands on it
    const ch = podiumChar(info, id);
    ch.x = slot.x / pv.S;
    ch.y = -by / pv.S;
    ch.s = rank === 0 ? S_DONE : S_RUN;
    ch.mood = rank === 0 ? 'happy' : 'ok';
    drawChar(ctx, pv, ch, t);
    if (rank === 0) crown(ctx, slot.x, by - 118 * ui - Math.abs(Math.sin(t * 5)) * 6 * ui, 46 * ui);
    // the name and the points under the block
    const a = clamp((T - starts[rank] - 0.3) / 0.3, 0, 1);
    if (a > 0) {
      ctx.globalAlpha = a;
      fitted(ctx, info.name(id), slot.x, slot.base + 18 * ui, 21 * ui, slot.bw * 1.4, '#ffffff', INK, 'center', 'middle');
      outlined(ctx, String(g.scores[id] ?? 0), slot.x, slot.base + 42 * ui, 24 * ui, '#ffd42a', INK);
      ctx.globalAlpha = 1;
    }
  }
  // you, if you're lower
  const mine = order.indexOf(info.me);
  if (mine >= 3 && T > 1.4) {
    const a = clamp((T - 1.4) / 0.3, 0, 1);
    const w = 190 * ui;
    const h = 46 * ui;
    const x = W - w - 14 * ui;
    const y = 14 * ui;
    ctx.globalAlpha = a;
    plate(ctx, x, y, w, h, h / 2, '#ffe9a0', 4, 4);
    head(ctx, info, info.me, x + 28 * ui, y + h / 2, 15 * ui);
    outlined(ctx, `You: ${placeLabel(mine + 1)}`, x + w / 2 + 20 * ui, y + h / 2, 24 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle', 0);
    ctx.globalAlpha = 1;
  }
  // awards
  const aw = isPlain(g.aw) ? g.aw : null;
  if (aw && T > 2.2) {
    const cards = [];
    if (typeof aw.statue === 'string') cards.push(['STATUE', aw.statue, statueIcon]);
    if (typeof aw.speedy === 'string') cards.push(['SPEEDY', aw.speedy, bolt]);
    const w = 150 * ui;
    const h = 56 * ui;
    cards.forEach(([label, id, icon], i) => {
      const k = popScale(T - 2.2 - i * 0.25, 0.35);
      if (k <= 0) return;
      const x = i === 0 ? 14 * ui : W - w - 14 * ui;
      const y = H - h - 14 * ui;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(k, k);
      plate(ctx, -w / 2, -h / 2, w, h, 14 * ui, '#fff8e8', 3.5, 4);
      icon(ctx, -w / 2 + 26 * ui, 0, 34 * ui);
      outlined(ctx, label, -w / 2 + 50 * ui, -h * 0.22, 13 * ui, '#ffd42a', INK, 'left', 'middle', 3);
      fitted(ctx, info.name(id), -w / 2 + 50 * ui, h * 0.2, 17 * ui, w - 58 * ui, '#ffffff', INK, 'left', 'middle');
      ctx.restore();
    });
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const podiumChars = new Map();
function podiumChar(info, id) {
  let ch = podiumChars.get(id);
  if (!ch) {
    ch = { id, x: 0, y: 0, vx: 0, vy: 0, s: 0, color: '#fff', bot: false, avatar: null, mood: 'ok', face: 0, vis: makeVis(id), isMe: false, hop: 0 };
    podiumChars.set(id, ch);
  }
  ch.color = info.color(id);
  ch.bot = info.bot(id);
  ch.avatar = info.avatar(id);
  ch.face = info.face(id);
  ch.isMe = false;
  ch.alpha = 1;
  return ch;
}

/** After the match, over the lobby for a few seconds: the top three as small heads, and where you came. `age` seconds, `dur` total. */
export function drawResultsCard(ctx, W, H, g, age, dur, info) {
  const ui = uiScale(W, H);
  const order = g.final ?? rankMatch(g);
  const out = clamp((age - (dur - 0.4)) / 0.4, 0, 1);
  const k = popScale(age, 0.35) * (1 - out);
  if (k <= 0.01) return;
  const w = 330 * ui;
  const h = 150 * ui;
  ctx.save();
  ctx.translate(W / 2, H * 0.47);
  ctx.scale(k, k);
  plate(ctx, -w / 2, -h / 2, w, h, 22 * ui, '#fff8e8', 5, 6);
  const slots = [0, -100 * ui, 100 * ui]; // 1st in the middle, 2nd left, 3rd right
  for (let i = 0; i < 3; i++) {
    const id = order[i];
    if (id === undefined) continue;
    const x = slots[i];
    const r = (i === 0 ? 27 : 21) * ui;
    const y = (i === 0 ? -14 : 0) * ui;
    head(ctx, info, id, x, y, r);
    if (i === 0) crown(ctx, x, y - r - 22 * ui, 34 * ui);
    outlined(ctx, String(i + 1), x - r * 0.95, y + r * 0.7, 18 * ui, '#ffd42a', INK);
    fitted(ctx, info.name(id), x, y + r + 22 * ui, 16 * ui, 92 * ui, '#ffffff', INK, 'center', 'middle');
  }
  const mine = order.indexOf(info.me);
  if (mine >= 3) outlined(ctx, `You: ${placeLabel(mine + 1)}`, 0, h / 2 - 14 * ui, 20 * ui, INK, 'rgba(255,255,255,0)', 'center', 'middle', 0);
  ctx.restore();
}
