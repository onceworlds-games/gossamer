// Stand-ins for the other people in a page test: a headless player who runs the field with the real movement code and the real net
// code (so it can be the host), and the keyboard of a good or a sloppy player for the page under test.

import { createNet, matchTag } from '../game/net.js';
import { STEP, lightAt, makeSchedule, startPositions } from '../game/rules.js';
import { S_RUN, clearEvents, makeRunner, newEvents, separate, stepRunner } from '../game/sim.js';

/** A human with no screen. `policy(light)` says whether to hold run. Call `drive()` once per frame. */
export function headlessPlayer(platform, room, policy = goodRunner) {
  const net = createNet({}, room);
  const me = makeRunner(room.me.id);
  const ev = newEvents();
  const L = {};
  let rid = null;
  return {
    net,
    me,
    drive() {
      const g = net.g();
      const now = room.matchNow();
      const humans = [{ id: me.id, x: me.x, y: me.y, on: me.s === S_RUN }];
      for (const p of platform.players.values()) {
        const pr = p.presence;
        if (p.id !== me.id && pr && Number.isFinite(pr.x)) humans.push({ id: p.id, x: pr.x, y: pr.y, on: Math.round(pr.s / 30) === S_RUN });
      }
      if (g && g.phase === 'round' && room.running) {
        if (g.rid !== rid) {
          rid = g.rid;
          const xs = startPositions(g.roster, g.rs);
          me.x = xs[me.id] ?? 6;
          me.y = 0;
          me.vx = me.vy = 0;
          me.s = S_RUN;
          me.t = 0;
        }
        if (now >= g.t0 && g.roster.includes(me.id)) {
          net.lightFor(g, now, L);
          clearEvents(ev);
          stepRunner(me, policy(L), 0, STEP, L, g.mode, ev);
          separate(me, humans.filter((x) => x.id !== me.id), humans.length - 1);
          if (ev.caught) net.reportCaught(me.y);
          if (ev.finished) net.reportFinish();
        }
        if (g.roster.includes(me.id)) room.setPresence({ x: me.x, y: me.y, vx: me.vx, vy: me.vy, s: me.s * 30, n: g.n, m: matchTag(g.mid) });
      }
      net.hostFrame(humans, humans.length);
    },
  };
}

/** Holds run on green and lets go the moment it turns yellow. */
export const goodRunner = (L) => L.c === 0 || (L.c === 1 && L.tIn < 0.1);

/** The keyboard of a player for the page under test: calls `h.key('Space', down)` when `want(g, now)` changes. */
export function keyboard(h, room, want) {
  let holding = false;
  const sched = { rs: null, s: null };
  const L = {};
  return () => {
    const g = room.state.g;
    const now = room.matchNow();
    let run = false;
    if (g && g.mid === room.match.id && g.phase === 'round' && now >= g.t0) {
      if (sched.rs !== g.rs) {
        sched.rs = g.rs;
        sched.s = makeSchedule(g.rs);
      }
      lightAt(sched.s, (now - g.t0) / 1000, L);
      run = want(L, now - g.t0);
    }
    if (run && !holding) h.key('Space');
    if (!run && holding) h.key('Space', false);
    holding = run;
  };
}
