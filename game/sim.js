// How a character moves, and when the Watcher catches it. Pure: players run it for themselves, the host runs it for the bots.

import { FIELD_W, FIELD_LEN, R, TOP_SPEED, ACCEL, DECEL, STEER_SPEED, CATCH_SPEED, CATCH_GRACE, ZAP_TIME, ZIP_TIME, clamp, easeInOut } from './rules.js';

export const S_RUN = 0; // free: standing, running, skidding
export const S_ZAP = 1; // caught: frozen and flashing
export const S_ZIP = 2; // carried back to the start line
export const S_DONE = 3; // crossed the ribbon
export const S_GHOST = 4; // caught in Out mode: floats about, can't finish

export const GHOST_MAX_Y = FIELD_LEN - 1.5;
export const COAST_MAX_Y = FIELD_LEN + 3;

export function makeRunner(id, x = FIELD_W / 2, y = 0) {
  return { id, x, y, vx: 0, vy: 0, s: S_RUN, t: 0, fromY: 0, k: -9 };
}

export function resetRunner(r, x, y = 0) {
  r.x = x;
  r.y = y;
  r.vx = 0;
  r.vy = 0;
  r.s = S_RUN;
  r.t = 0;
  r.fromY = 0;
  r.k = -9;
}

export function newEvents() {
  return { caught: false, finished: false, buzz: false, returned: false, ghosted: false };
}

export function clearEvents(ev) {
  ev.caught = false;
  ev.finished = false;
  ev.buzz = false;
  ev.returned = false;
  ev.ghosted = false;
}

/**
 * One 60 Hz step. `run` is true while the run button is held, `steer` is -1..1. `light` is lightAt()'s answer (or null for no lights).
 * `mode` is 'back' (caught: back to the start), 'out' (caught: a ghost) or 'practice' (the lobby: a buzz, nothing else).
 * Sets flags on `ev` (caught, finished, buzz, returned, ghosted) for the caller to react to and clear.
 */
export function stepRunner(r, run, steer, dt, light, mode, ev) {
  switch (r.s) {
    case S_RUN:
    case S_GHOST: {
      const ghost = r.s === S_GHOST;
      r.vy = run ? Math.min(TOP_SPEED, r.vy + ACCEL * dt) : Math.max(0, r.vy - DECEL * dt);
      r.vx = clamp(steer, -1, 1) * STEER_SPEED;
      r.x = clamp(r.x + r.vx * dt, R, FIELD_W - R);
      r.y += r.vy * dt;
      if (r.y < 0) r.y = 0;
      if (ghost) {
        if (r.y > GHOST_MAX_Y) {
          r.y = GHOST_MAX_Y;
          r.vy = 0;
        }
        return;
      }
      if (r.y >= FIELD_LEN) {
        r.y = FIELD_LEN;
        r.s = S_DONE;
        r.t = 0;
        ev.finished = true;
        return;
      }
      if (light && light.c === 2 && !light.wait && light.tIn >= CATCH_GRACE && Math.hypot(r.vx, r.vy) > CATCH_SPEED) {
        if (mode === 'practice') {
          if (r.k !== light.k) {
            r.k = light.k;
            ev.buzz = true;
          }
          return;
        }
        r.s = S_ZAP;
        r.t = 0;
        r.fromY = r.y;
        r.vx = 0;
        r.vy = 0;
        ev.caught = true;
      }
      return;
    }
    case S_ZAP: {
      r.vx = 0;
      r.vy = 0;
      r.t += dt;
      if (r.t >= ZAP_TIME) {
        r.t = 0;
        if (mode === 'out') {
          r.s = S_GHOST;
          ev.ghosted = true;
        } else r.s = S_ZIP;
      }
      return;
    }
    case S_ZIP: {
      r.vx = 0;
      r.vy = 0;
      r.t += dt;
      const u = Math.min(1, r.t / ZIP_TIME);
      r.y = r.fromY * (1 - easeInOut(u));
      if (u >= 1) {
        r.y = 0;
        r.s = S_RUN;
        r.t = 0;
        ev.returned = true;
      }
      return;
    }
    case S_DONE: {
      r.vx = 0;
      r.vy = Math.max(0, r.vy - DECEL * dt);
      r.y = Math.min(COAST_MAX_Y, r.y + r.vy * dt);
      r.t += dt;
      return;
    }
    default:
      r.s = S_RUN;
  }
}

export const PUSH = 0.3;

/**
 * Soft collisions: moves `r` out of the way of everyone in `list` (objects with id, x, y, on). Everyone does it for themselves,
 * so it looks mutual without anyone owning anyone else. It moves the character, not its speed: being shoved is never "moving on red".
 */
export function separate(r, list, n) {
  if (r.s !== S_RUN) return;
  const min = 2 * R;
  for (let i = 0; i < n; i++) {
    const o = list[i];
    if (o.id === r.id || o.on === false) continue;
    const dx = r.x - o.x;
    const dy = r.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    if (d2 < 1e-6) {
      r.x += (r.id < o.id ? -1 : 1) * 0.02;
      continue;
    }
    const d = Math.sqrt(d2);
    const k = ((min - d) * PUSH) / d;
    r.x += dx * k;
    r.y += dy * k;
  }
  r.x = clamp(r.x, R, FIELD_W - R);
  if (r.y < 0) r.y = 0;
}
