// The bots: they run on green, stop on yellow (some a little late), and steer around whoever is ahead. The host runs them with the
// same movement code the players use.

import { FIELD_W, clamp, hash32, hashStr, mulberry32 } from './rules.js';
import { S_RUN, clearEvents, makeRunner, newEvents, separate, stepRunner } from './sim.js';

export function makeBrain(id, seed) {
  const rng = mulberry32(hash32(hashStr(id), seed));
  return {
    id,
    rng,
    brave: rng(), // waits longer before letting go
    slip: 0.04 + rng() * 0.2, // how often it zones out and stops too late
    lane: 1.5 + rng() * (FIELD_W - 3),
    dir: rng() < 0.5 ? -1 : 1,
    k: -9,
    c: -1,
    goDelay: 0.25,
    stopDelay: 0.3,
    panic: false,
    panicUntil: -1,
    run: false,
    steer: 0,
  };
}

/** A new round: fresh luck, a new lane. */
export function resetBrain(b, seed) {
  b.rng = mulberry32(hash32(hashStr(b.id), seed));
  b.lane = 1.5 + b.rng() * (FIELD_W - 3);
  b.dir = b.rng() < 0.5 ? -1 : 1;
  b.k = -9;
  b.c = -1;
  b.panic = false;
  b.panicUntil = -1;
  b.run = false;
  b.steer = 0;
}

/** Decides `b.run` and `b.steer` for this step. `others` are { id, x, y, on } of everyone on the field. */
export function think(b, r, light, others, n) {
  b.run = false;
  b.steer = 0;
  if (r.s !== S_RUN) {
    b.k = -9;
    return;
  }
  if (light.wait) return;
  if (light.k !== b.k || light.c !== b.c) {
    b.k = light.k;
    b.c = light.c;
    const g = b.rng;
    if (light.c === 0) {
      b.goDelay = 0.15 + g() * 0.25;
      b.panic = g() < 0.15;
      b.panicUntil = -1;
    } else if (light.c === 1) {
      b.stopDelay = 0.12 + g() * 0.33 + b.brave * 0.1 + (g() < b.slip ? 0.3 + g() * 0.3 : 0);
    }
  }
  const t = light.tIn;
  let run = false;
  if (light.c === 0) {
    run = t >= b.goDelay;
    if (b.panic && light.fake >= 0.15) {
      b.panic = false;
      b.panicUntil = t + 0.45 + b.rng() * 0.3;
    }
    if (t < b.panicUntil) run = false;
  } else if (light.c === 1) run = t < b.stopDelay;
  b.run = run;
  if (!run) return;
  let avoid = 0;
  let best = 99;
  for (let i = 0; i < n; i++) {
    const o = others[i];
    if (o.id === r.id || o.on === false) continue;
    const dy = o.y - r.y;
    if (dy <= 0 || dy > 2.2) continue;
    const dx = r.x - o.x;
    if (Math.abs(dx) > 1) continue;
    if (dy < best) {
      best = dy;
      avoid = Math.abs(dx) < 0.15 ? b.dir : Math.sign(dx);
    }
  }
  if (avoid !== 0) {
    if (r.x < 1 && avoid < 0) avoid = 1;
    if (r.x > FIELD_W - 1 && avoid > 0) avoid = -1;
    b.steer = avoid;
  } else if (Math.abs(b.lane - r.x) > 0.3) b.steer = clamp((b.lane - r.x) * 0.8, -0.5, 0.5);
}

/** All the bots of a match. Steps them together; the caller reads what happened from the returned list. */
export class BotField {
  constructor() {
    this.bots = [];
    this.pos = [];
    this.all = [];
    this.out = [];
    this.ev = newEvents();
  }

  /** (Re)creates the bots at their start positions (`xs` by bot) for a round seeded with `seed`. */
  setup(ids, xs, seed) {
    this.bots = ids.map((id, i) => {
      const brain = makeBrain(id, seed);
      return { id, r: makeRunner(id, xs[i], 0), brain };
    });
    this.pos = this.bots.map((b) => ({ id: b.id, x: b.r.x, y: b.r.y, on: true }));
  }

  /** Puts the bots where an old snapshot had them ([x, y, vx, vy, s] each), a new host carrying on. */
  restore(rows) {
    this.bots.forEach((b, i) => {
      const row = rows[i];
      if (!Array.isArray(row)) return;
      const [x, y, vx, vy, s] = row;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        b.r.x = clamp(x, 0, FIELD_W);
        b.r.y = clamp(y, 0, 70);
        b.r.vx = Number.isFinite(vx) ? vx : 0;
        b.r.vy = Number.isFinite(vy) ? vy : 0;
        b.r.s = s === 1 || s === 2 || s === 3 || s === 4 ? s : S_RUN;
        b.r.t = 0;
        b.r.fromY = b.r.y;
      }
      this.pos[i].x = b.r.x;
      this.pos[i].y = b.r.y;
      this.pos[i].on = b.r.s === S_RUN;
    });
  }

  /** One step. `humans` are { id, x, y, on } of the people on the field (their drawn positions). Returns [{ id, type ('caught' | 'finished' | 'buzz'), x, y }] of what happened. */
  step(light, dt, mode, humans, nh) {
    const out = this.out;
    out.length = 0;
    const all = this.all;
    all.length = 0;
    for (let i = 0; i < this.pos.length; i++) all.push(this.pos[i]);
    for (let i = 0; i < nh; i++) all.push(humans[i]);
    const ev = this.ev;
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      const r = b.r;
      think(b.brain, r, light, all, all.length);
      clearEvents(ev);
      stepRunner(r, b.brain.run, b.brain.steer, dt, light, mode, ev);
      separate(r, all, all.length);
      if (ev.caught) out.push({ id: b.id, type: 'caught', x: r.x, y: r.y });
      if (ev.finished) out.push({ id: b.id, type: 'finished', x: r.x, y: r.y });
      if (ev.buzz) out.push({ id: b.id, type: 'buzz', x: r.x, y: r.y });
    }
    for (let i = 0; i < this.bots.length; i++) {
      const r = this.bots[i].r;
      const p = this.pos[i];
      p.x = r.x;
      p.y = r.y;
      p.on = r.s === S_RUN;
    }
    return out;
  }
}
