// The title screen's arena: a few bots running up the last stretch of the field on the slow practice lights, forever.
// Local to each page (nobody needs to agree on it), with the same bots and movement code as a real match.

import { BotField } from './bots.js';
import { STEP, startX } from './rules.js';
import { S_DONE, resetRunner } from './sim.js';

const COUNT = 8;
const IDS = Array.from({ length: COUNT }, (_, i) => `bot${i + 1}`);

export class Demo {
  constructor() {
    this.field = new BotField();
    this.field.setup(IDS, IDS.map((_, i) => startX(i, COUNT)), 777);
    this.field.bots.forEach((b, i) => this.respawn(b, i, true));
    this.buzzes = [];
  }

  respawn(b, i, first = false) {
    const slot = (i * 3 + (first ? 0 : Math.floor(Math.random() * COUNT))) % COUNT;
    resetRunner(b.r, startX(slot, COUNT), 40 + Math.random() * (first ? 14 : 5));
  }

  /** One step with the lobby's practice light. Fills `this.buzzes` with the bots that would have been caught (x, y). */
  step(light) {
    this.buzzes.length = 0;
    const events = this.field.step(light, STEP, 'practice', [], 0);
    for (const e of events) if (e.type === 'buzz') this.buzzes.push(e);
    this.field.bots.forEach((b, i) => {
      if (b.r.s === S_DONE && b.r.t > 1.6) this.respawn(b, i);
    });
  }

  get bots() {
    return this.field.bots;
  }
}

