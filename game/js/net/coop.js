// Playing together. The host's page runs the night; it sends what changed in the web (ops), what the visitors and
// hunters are doing (a snapshot) and what just happened (events) ten times a second, and a full checkpoint into room
// state every two seconds so a new host carries on. Everyone moves their own spider and says where it is in
// presence; actions go to the host as commands, and the host checks them. Every message is checked for shape.
import { platform } from '../app/platform.js';
import { packWorld, snapshot, applySnapshot, applyPose } from '../sim/codec.js';
import { remapSplit, loseFooting } from '../sim/spider.js';
import { addSpider } from '../sim/world.js';

const SEND_HZ = 10;
const CK_EVERY = 2;
const POSE_HZ = 15;
const SHARE = new Set(['cast', 'spin', 'pluck', 'stick', 'struggle', 'snap', 'tear', 'shake', 'eat', 'cocoon', 'swoop', 'wrenwarn', 'gustwarn', 'alarm', 'orbdone', 'downed', 'dawn', 'nightfall', 'mantis', 'mantisoff', 'sting', 'waspbit', 'stolen', 'escape', 'lost', 'revived', 'wake', 'hurt', 'refuse', 'perfect', 'rain', 'mist', 'bloom', 'strike', 'windup', 'mantisfall', 'grab', 'bolashit', 'place', 'knock', 'caught', 'wasp', 'waspspot', 'unseen', 'lure', 'fling', 'flee', 'perch', 'kicked', 'cut', 'waspcut']);

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

export class Coop {
  constructor(room, game) {
    this.room = room;
    this.game = game;
    this.run = null;
    this.role = null;
    this.sendT = 0;
    this.ckT = 0;
    this.poseT = 0;
    this.k = 0;
    this.lastPos = new Map();
  }

  get mid() {
    return this.room.match?.id ?? null;
  }

  startHosting(run) {
    this.run = run;
    this.role = 'host';
    run.world.web.ops = [];
    this.shared = [];
    this.ckT = 0.5;
  }

  startMirror(run) {
    this.run = run;
    this.role = 'mirror';
    run.world.web.ops = null;
  }

  stop() {
    this.run = null;
    this.role = null;
  }

  // ---------------------------------------------------------------- per frame
  frame(dt) {
    const run = this.run;
    if (!run || this.game.screen !== 'night') return;
    const host = this.game.amHost();
    // The host role moved: carry on as the new host, or step back to watching the one who has it.
    if (this.role === 'host' && !host && this.room.connected !== false) return this.demote();
    if (this.role === 'mirror' && host) return this.promote();
    this.poses(dt);
    if (this.role === 'host' && host) this.hostSend(dt);
    this.sendPose(dt);
  }

  /** Other players' spiders go where their presence says (smoothed for drawing). */
  poses() {
    const run = this.run;
    const out = {};
    if (!run) return out;
    const w = run.world;
    for (const sp of w.spiders) {
      if (sp.id === run.myId) continue;
      const player = this.room.players?.get?.(sp.id);
      const raw = player?.presence;
      if (!raw || typeof raw !== 'object' || raw.mid !== this.mid) continue;
      out[sp.id] = raw;
      const at = this.room.presenceAt?.(sp.id, { angles: ['f'], snap: 60 }) ?? raw;
      sp.remote = true;
      applyPose(w, sp, { ...raw, x: num(at.x, raw.x), y: num(at.y, raw.y), f: num(at.f, raw.f) });
      if (player.connected === false) sp.away = true;
      else sp.away = false;
    }
    return out;
  }

  sendPose(dt) {
    this.poseT -= dt;
    if (this.poseT > 0) return;
    this.poseT = 1 / POSE_HZ;
    const me = this.run?.me();
    if (!me) {
      this.room.setPresence?.({ mid: this.mid, st: 'watch' });
      return;
    }
    const hang = me.hang ? (me.hang.anchor.node ? { node: me.hang.anchor.node, len: Math.round(me.hang.len) } : { th: me.hang.anchor.th, s: Math.round(me.hang.anchor.s * 1000) / 1000, len: Math.round(me.hang.len) }) : null;
    this.room.setPresence?.({ mid: this.mid, st: 'play', mode: me.mode, node: me.node, th: me.th, s: Math.round(me.s * 1000) / 1000, x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, f: Math.round(me.facing * 100) / 100, n: Math.round(me.noise * 100) / 100, vx: Math.round(me.vx), vy: Math.round(me.vy), hang });
  }

  hostSend(dt) {
    const run = this.run;
    const w = run.world;
    // Events worth sharing pile up between sends.
    this.sendT -= dt;
    this.ckT -= dt;
    if (this.sendT <= 0 && this.room.online?.length > 1) {
      this.sendT = 1 / SEND_HZ;
      const ops = w.web.ops.splice(0);
      const ev = (this.shared ?? []).splice(0, 60);
      const msg = { t: 'n', mid: this.mid, o: ops, e: ev, s: snapshot(w), c: this.corrections(w) };
      const body = JSON.stringify(msg);
      if (body.length > 12000) {
        // Too much at once (a wren took half the web): ops in their own messages first.
        for (let i = 0; i < ops.length; i += 200) this.room.send({ t: 'n', mid: this.mid, o: ops.slice(i, i + 200), e: [] });
        this.room.send({ t: 'n', mid: this.mid, o: [], e: ev, s: msg.s, c: msg.c });
      } else this.room.send(msg);
    } else if (this.room.online?.length <= 1) {
      w.web.ops.length = 0;
      if (this.shared) this.shared.length = 0;
    }
    if (this.ckT <= 0) {
      this.ckT = CK_EVERY;
      this.checkpoint();
      this.admitLate();
    }
  }

  /** Called by the night's event hook (host): events other pages should hear and see. */
  share(e) {
    if (this.role !== 'host' || !SHARE.has(e.k)) return;
    this.shared ??= [];
    if (this.shared.length < 80) this.shared.push(e);
  }

  /** Free knots that have wandered from where other pages last heard (their webs settle back in line). */
  corrections(w) {
    const web = w.web;
    const out = [];
    for (let s = 0; s < web.nodeHigh && out.length < 120; s++) {
      const id = web.nid[s];
      if (id < 2000 || web.kind[s] === 0) continue;
      const last = this.lastPos.get(id);
      if (last && Math.abs(last[0] - web.x[s]) < 2.5 && Math.abs(last[1] - web.y[s]) < 2.5) continue;
      const p = [id, Math.round(web.x[s] * 10) / 10, Math.round(web.y[s] * 10) / 10];
      this.lastPos.set(id, [web.x[s], web.y[s]]);
      out.push(p);
    }
    if (this.lastPos.size > 2000) this.lastPos.clear();
    return out;
  }

  /** Four values, each under the 16 KB limit: the night, the knots, the threads, the living. */
  checkpoint() {
    const run = this.run;
    if (!run) return;
    const ck = packWorld(run.world);
    this.k++;
    const { prey, swarms, wasps, ...meta } = ck.meta;
    this.room.setState('ck', { mid: this.mid, k: this.k, meta });
    this.room.setState('ckn', { mid: this.mid, k: this.k, n: ck.n });
    this.room.setState('ckt', { mid: this.mid, k: this.k, t: ck.t });
    this.room.setState('ckp', { mid: this.mid, k: this.k, prey, swarms, wasps });
  }

  // ---------------------------------------------------------------- messages
  message(data, from) {
    if (!data || typeof data !== 'object' || typeof data.t !== 'string') return;
    const run = this.run;
    const fromId = from?.id;
    switch (data.t) {
      case 'r':
        // A season request (species, upgrade, trait, joining).
        if (this.game.amHost() && data.req && typeof data.req === 'object' && fromId) this.game.request(fromId, data.req);
        break;
      case 'c':
        // A command for the night.
        if (this.role !== 'host' || !run || data.mid !== this.mid || !fromId) return;
        if (!data.c || typeof data.c !== 'object' || typeof data.c.t !== 'string') return;
        if (!run.world.spiders.some((s) => s.id === fromId)) return;
        if (run.world.cmds.length < 64) run.world.cmds.push({ ...clean(data.c), id: fromId });
        break;
      case 'n':
        if (this.role !== 'mirror' || !run || data.mid !== this.mid) return;
        this.applyNews(data);
        break;
      case 'p':
        if (run && Number.isFinite(data.x) && Number.isFinite(data.y)) run.ping(data.x, data.y, false);
        break;
      default:
        break;
    }
  }

  applyNews(d) {
    const run = this.run;
    const w = run.world;
    const me = run.me();
    if (Array.isArray(d.o)) {
      const ops = d.o.slice(0, 2000).filter(Array.isArray);
      // Splits move our own spider onto the right half before the web changes under it.
      for (const op of ops) {
        if (op[0] === 'x' && me) remapSplit(me, { old: op[1], a: op[4], b: op[5], t: num(op[2], 0.5) });
      }
      w.web.applyOps(ops);
      if (me && me.mode === 'walk') {
        const ok = me.node ? w.web.ni(me.node) >= 0 : w.web.ti(me.th) >= 0;
        if (!ok) me.lost = true;
      }
    }
    if (Array.isArray(d.c)) {
      for (const c of d.c.slice(0, 300)) {
        if (!Array.isArray(c)) continue;
        const s = w.web.ni(c[0]);
        if (s < 0 || w.web.kind[s] === 0) continue;
        const x = num(c[1], w.web.x[s]);
        const y = num(c[2], w.web.y[s]);
        // Ease toward the host's knot, don't jump.
        w.web.x[s] += (x - w.web.x[s]) * 0.5;
        w.web.y[s] += (y - w.web.y[s]) * 0.5;
        w.web.px[s] = w.web.x[s];
        w.web.py[s] = w.web.y[s];
      }
    }
    if (d.s) applySnapshot(w, d.s, run.myId);
    if (Array.isArray(d.e)) {
      for (const e of d.e.slice(0, 80)) {
        if (!e || typeof e !== 'object' || typeof e.k !== 'string' || !SHARE.has(e.k)) continue;
        const ev = sanitizeEvent(e);
        if (ev.k === 'place' && me && ev.id === me.id && w.web.ni(ev.node) >= 0) {
          me.mode = 'walk';
          me.node = ev.node;
          me.th = 0;
          me.hang = null;
          me.air = null;
        }
        if (ev.k === 'knock' && me && ev.id === me.id) {
          me.node = 0;
          me.th = 0;
          me.lost = true;
        }
        w.out.push(ev);
      }
    }
    if (me?.lost) {
      me.lost = false;
      loseFooting(w, me);
    }
  }

  // ---------------------------------------------------------------- sending
  command(c) {
    if (!this.mid) return;
    this.room.send({ t: 'c', mid: this.mid, c }, { to: this.room.host });
  }

  ask(req) {
    if (this.room.host) this.room.send({ t: 'r', req }, { to: this.room.host });
  }

  ping(x, y) {
    if (this.room.online?.length > 1) this.room.send({ t: 'p', x: Math.round(x), y: Math.round(y) });
  }

  // ---------------------------------------------------------------- the host role moving
  hostChanged() {
    if (this.game.screen !== 'night') return;
    if (this.game.amHost() && this.role === 'mirror') this.promote();
  }

  promote() {
    // We are the host now: rebuild the night from the room's checkpoint and carry on.
    const rec = this.room.state?.night;
    if (!rec || rec.mid !== this.mid) return;
    this.game.adopt(rec);
  }

  demote() {
    const rec = this.room.state?.night;
    if (!rec || rec.mid !== this.mid) return;
    this.game.mirror(rec);
  }

  // ---------------------------------------------------------------- drawing helpers
  drawSpiders(run) {
    return run.world.spiders;
  }

  drawPrey(run) {
    if (run.role === 'host') return run.world.prey;
    const w = run.world;
    // Stuck prey sit on our copy of the web; fliers slide toward their latest position.
    for (const p of w.prey) {
      if (p.node) {
        const s = w.web.ni(p.node);
        if (s >= 0) {
          p.x = w.web.x[s];
          p.y = w.web.y[s];
          continue;
        }
      }
      if (p.st === 'fly' && Number.isFinite(p.vx)) {
        p.x += p.vx / 60;
        p.y += p.vy / 60;
      }
    }
    return w.prey;
  }

  mates(run) {
    const out = [];
    for (const sp of run.world.spiders) {
      if (sp.id === run.myId) continue;
      const pl = this.room.players?.get?.(sp.id);
      out.push({ name: (pl?.name ?? 'Friend').slice(0, 24), hp: sp.hp, downed: sp.mode === 'downed', away: pl?.connected === false });
    }
    return out;
  }

  /** Late arrivals are let in while it is still dusk. */
  admitLate() {
    const run = this.run;
    if (this.role !== 'host' || !run || run.world.phase !== 'dusk') return;
    const watchers = (this.room.spectators ?? []).filter((p) => p.connected !== false && !p.idle);
    if (!watchers.length) return;
    const s = this.game.season();
    for (const p of watchers) {
      if (run.world.spiders.some((sp) => sp.id === p.id)) continue;
      const r = s?.roster?.[p.id];
      if (!r) continue;
      addSpider(run.world, { id: p.id, sp: r.sp, up: r.up, tr: r.tr });
    }
    this.room.admit?.(watchers.map((p) => p.id));
  }
}

function clean(c) {
  const out = {};
  for (const [k, v] of Object.entries(c).slice(0, 12)) {
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.max(-1e5, Math.min(1e5, v)) : NaN;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 24);
  }
  return out;
}

function sanitizeEvent(e) {
  const out = {};
  for (const [k, v] of Object.entries(e).slice(0, 16)) {
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.max(-1e5, Math.min(1e5, v)) : 0;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 40);
  }
  return out;
}

export { platform };
