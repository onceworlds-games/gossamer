// One night on this page: the world (run here if we are the host, mirrored if not), the local spider's controls,
// what the HUD shows, and every sim event turned into something seen and heard.
import { DT, PREY, T_STICKY, SPECIES, W, GROUND } from '../sim/data.js';
import { createWorld, stepWorld, spiderById, timeLeft } from '../sim/world.js';
import { moveSpider, upkeep, anchorPos } from '../sim/spider.js';
import { resolveTarget, useTarget, threadCost, catchOnBranch } from '../sim/actions.js';
import { planOrb, patternsFor } from '../sim/quickorb.js';
import { pulseFrom, clearPulses } from '../render/webart.js';
import * as fx from '../render/fx.js';
import { TYPES } from '../render/hud.js';

const TYPE_TO_THREAD = [0, 1, 2, 3];
const REFUSE = { far: 'Too far', near: 'Too close', silk: 'No silk', full: 'Web full', nothing: 'Nothing there', same: 'Already joined', busy: 'Busy', open: 'Too open', species: 'Not this spider' };

export class NightRun {
  constructor(cfg, o) {
    this.cfg = cfg;
    this.role = o.role ?? 'host';
    this.myId = o.myId ?? null;
    this.audio = o.audio;
    this.renderer = o.renderer;
    this.send = o.send ?? null; // client: (command) => void
    this.onEvent = o.onEvent ?? null;
    this.world = createWorld({ ...cfg, role: this.role });
    this.acc = 0;
    this.type = 0;
    this.notes = [];
    this.big = null;
    this.edges = [];
    this.t = 0;
    this.useOn = false;
    this.ctxLabel = 'Act';
    this.lastSilk = 0;
    this.loud = 0;
    this.pings = [];
    this.watch = !this.myId || !spiderById(this.world, this.myId);
    this.focus = { x: 0, y: 0, vx: 0, vy: 0 };
    this.sense = new Float32Array(16);
    this.alarms = [];
    this.gustWarn = null;
    this.bots = o.bots ?? null;
    clearPulses();
    fx.clearFx();
    const me = this.me();
    if (me) {
      this.focus.x = me.x;
      this.focus.y = me.y;
    } else {
      const s = this.world.garden.sites[0];
      this.focus.x = s?.x ?? W / 2;
      this.focus.y = s?.y ?? 500;
    }
  }

  me() {
    return this.myId ? spiderById(this.world, this.myId) : null;
  }

  /** Converts input intents into commands for this spider. ctx: { toWorld, held aim } */
  intents(events, toWorld) {
    const me = this.me();
    if (!me || me.mode === 'downed') return;
    for (const e of events) {
      const at = (ev) => {
        if (ev.sx !== null && ev.sx !== undefined) return toWorld(ev.sx, ev.sy);
        if (ev.dir) return { x: me.x + ev.dir[0] * 200, y: me.y + ev.dir[1] * 200 };
        return null;
      };
      switch (e.t) {
        case 'type':
          if (me.sp === 'orb') this.setType(Math.max(0, Math.min(4, e.n)));
          break;
        case 'cycle':
          if (me.sp === 'orb') this.setType((this.type + 1) % 5);
          break;
        case 'tap': {
          const p = toWorld(e.sx, e.sy);
          if (me.sp === 'orb') {
            if (this.type === 4) this.command({ t: 'orb', x: p.x, y: p.y, r: this.orbR(p), p: this.pattern ?? 'orb' });
            else this.command({ t: 'cast', type: TYPE_TO_THREAD[this.type], x: p.x, y: p.y });
          } else if (me.sp === 'jumper') {
            const d = Math.hypot(p.x - me.x, p.y - me.y);
            this.leap(p.x, p.y, Math.min(1, d / me.mods.leap + 0.1));
          } else this.command({ t: 'fling', x: p.x, y: p.y, power: Math.min(1, Math.hypot(p.x - me.x, p.y - me.y) / 200) });
          break;
        }
        case 'padcast': {
          const p = { x: me.x + Math.cos(me.facing) * 160, y: me.y + Math.sin(me.facing) * 160 };
          this.command({ t: 'cast', type: TYPE_TO_THREAD[Math.min(3, this.type)], x: p.x, y: p.y });
          break;
        }
        case 'leap': {
          const p = at(e) ?? { x: me.x + Math.cos(me.facing) * 220, y: me.y + Math.sin(me.facing) * 220 - 60 };
          this.leap(p.x, p.y, me.sp === 'jumper' ? e.power : 1);
          break;
        }
        case 'fling': {
          const p = at(e) ?? { x: me.x + Math.cos(me.facing) * 150, y: me.y + Math.sin(me.facing) * 150 };
          this.command({ t: 'fling', x: p.x, y: p.y, power: e.power });
          break;
        }
        case 'cut': {
          const p = at(e);
          this.command({ t: 'cut', x: p ? p.x : NaN, y: p ? p.y : NaN });
          break;
        }
        case 'use':
          this.useOn = e.on;
          this.command({ t: 'use', on: e.on });
          break;
        case 'bite':
        case 'shake':
        case 'lure':
          this.command({ t: e.t });
          break;
        case 'ping': {
          const p = at(e);
          if (p) this.ping(p.x, p.y, true);
          break;
        }
        default:
          break;
      }
    }
  }

  setType(n) {
    if (n === this.type) return;
    this.type = n;
    this.audio?.ui('type');
  }

  orbR(p) {
    // Size the orb to its site: the median spoke, a bit inside.
    void p;
    return 95;
  }

  /** Leaps are run by the page that owns the spider: here. */
  leap(x, y, power) {
    this.pendingLeap = { x, y, power };
  }

  command(c) {
    const me = this.me();
    if (!me) return;
    if (this.role === 'host') this.world.cmds.push({ ...c, id: me.id });
    else this.send?.(c);
  }

  ping(x, y, mine) {
    this.pings.push({ x, y, age: 0 });
    if (this.pings.length > 6) this.pings.shift();
    this.audio?.ping(x);
    if (mine) this.onEvent?.({ k: 'ping', x, y });
  }

  /** Advances the night by real time dt (clamped). Returns the number of sim ticks run. */
  update(dt, move) {
    dt = Math.min(dt, 0.25);
    this.t += dt;
    this.acc += dt;
    let ticks = 0;
    const me = this.me();
    while (this.acc >= DT && ticks < 30) {
      this.acc -= DT;
      ticks++;
      const inp = { mx: move.mx, my: move.my, hurry: move.hurry, leap: this.pendingLeap ?? null };
      this.pendingLeap = null;
      if (this.role === 'host') {
        const inputs = {};
        if (me) inputs[me.id] = inp;
        if (this.bots) for (const b of this.bots) inputs[b.id] = b.tick(this.world, DT);
        stepWorld(this.world, inputs);
      } else this.mirrorStep(inp);
    }
    // Far behind (a stall, a hidden tab): let the time go rather than race to catch up.
    if (this.acc > DT * 30) this.acc = 0;
    this.react();
    for (const p of this.pings) p.age += dt;
    this.pings = this.pings.filter((p) => p.age < 3);
    return ticks;
  }

  /** A client's tick: our own spider moves here; the web jiggles here; the rest comes from the host. */
  mirrorStep(inp) {
    const w = this.world;
    w.ev = [];
    w.t += DT;
    w.tick++;
    const me = this.me();
    if (me && !this.watch) {
      moveSpider(w, me, inp, DT);
      if (me.lost) {
        me.lost = false;
      }
    }
    const web = w.web;
    web.load.fill(0, 0, web.nodeHigh);
    web.step({ sway: w.weather.sway, windX: w.weather.windX, windY: w.weather.windY });
    for (const e of w.ev) w.out.push(e);
  }

  /** Sim events become sound, effects, notes and pulses. */
  react() {
    const w = this.world;
    const out = w.out;
    w.out = [];
    const me = this.me();
    for (const e of out) {
      this.onEvent?.(e);
      this.audio?.event(e, w, me);
      const mine = me && e.id === me.id;
      switch (e.k) {
        case 'cast':
        case 'spin':
          fx.silk(e.x, e.y, e.tx, e.ty, 4);
          pulseFrom(w.web, e.th, 160, this.t + 0.2);
          break;
        case 'pluck':
          pulseFrom(w.web, e.th, e.amp, this.t);
          fx.ring(e.x, e.y, Math.min(1, e.amp / 300));
          break;
        case 'stick':
          fx.ring(e.x, e.y, 1, true);
          fx.dew(e.x, e.y, 4, 0.5);
          if (e.th) pulseFrom(w.web, e.th, 420, this.t);
          if (PREY[e.sp]?.mass >= 4) this.renderer?.cam.kick(0.35);
          break;
        case 'struggle':
          fx.ring(e.x, e.y, Math.min(1, e.amp / 400), true);
          break;
        case 'snap':
          fx.whip(e.ax, e.ay, e.bx, e.by, e.type);
          fx.dew(e.x, e.y, 6, 1);
          if (e.type <= 1) this.renderer?.cam.kick(0.25);
          break;
        case 'tear':
          fx.dew(e.x, e.y, 5, 0.8);
          break;
        case 'shake':
          fx.dew(e.x, e.y, Math.min(40, 6 + e.beads), 1.6);
          if (mine && e.beads) this.note(`${e.beads} beads`, e.x, e.y - 30);
          break;
        case 'eat':
          fx.sparks(e.x, e.y, 5);
          if (mine) this.note(`+${Math.round(e.food * 10) / 10}`, e.x, e.y - 24, '#f0a33c');
          break;
        case 'cocoon':
          fx.silk(e.x - 6, e.y, e.x + 6, e.y, 6);
          break;
        case 'refuse':
          if (mine) this.note(REFUSE[e.why] ?? 'No', e.x, e.y - 34, '#a9442c');
          break;
        case 'hurt':
          if (mine) {
            this.renderer?.cam.kick(e.why === 'wren' ? 0.8 : 0.4);
            this.flash = 0.4;
          }
          break;
        case 'swoop':
          fx.feathers(w.wren?.x ?? W / 2, e.y, 8);
          this.renderer?.cam.kick(0.45);
          break;
        case 'wrenwarn':
          this.big = null;
          break;
        case 'gustwarn':
          this.gustWarn = { dir: e.dir, until: this.t + e.lead + 1 };
          break;
        case 'gust':
          break;
        case 'land':
          if (mine) fx.dust(e.x, e.y, 3);
          break;
        case 'splash':
          fx.dew(e.x, e.y, 14, 1.4);
          break;
        case 'alarm':
          this.alarms.push({ x: e.x, y: e.y, until: this.t + 2.5 });
          break;
        case 'orbdone':
          if (mine && !e.partial) this.note(e.quick ? 'Spun' : 'Orb complete', e.x, e.y - 50, '#e6eee8');
          break;
        case 'perfect':
          if (mine) this.note('Perfect radials', e.x, e.y - 60, '#f0a33c');
          break;
        case 'downed':
          if (mine) this.bigText('Down', '', 2.5, '#a9442c');
          break;
        case 'dawn':
          this.bigText('Dawn', '', 3, '#f0a33c');
          break;
        case 'nightfall':
          break;
        case 'mantis':
          this.bigText('The mantis', '', 3, '#e6eee8');
          break;
        case 'mantisoff':
          this.bigText('Driven off', '', 3, '#f0a33c');
          break;
        default:
          break;
      }
    }
    this.alarms = this.alarms.filter((a) => a.until > this.t);
    for (const n of this.notes) {
      n.a -= 1 / 60 / 1.4;
      n.y -= 0.35;
    }
    this.notes = this.notes.filter((n) => n.a > 0);
    if (this.big) {
      this.big.a -= 1 / 60 / this.big.dur;
      if (this.big.a <= 0) this.big = null;
    }
  }

  note(s, x, y, c) {
    if (this.notes.length > 8) this.notes.shift();
    this.notes.push({ s, wx: x, wy: y, a: 1.4, c, y: 0 });
  }

  bigText(s, sub, dur, color) {
    this.big = { s, sub, a: 1.6, dur, color };
  }

  /** What the camera follows. */
  focusPoint() {
    const me = this.me();
    if (me) {
      this.focus.x = me.x;
      this.focus.y = me.y;
      this.focus.vx = me.mode === 'air' ? me.vx : 0;
      this.focus.vy = me.mode === 'air' ? me.vy : 0;
    } else {
      // Watching: follow whoever has been busiest, gently.
      const s = this.world.spiders[0];
      if (s) {
        this.focus.x += (s.x - this.focus.x) * 0.05;
        this.focus.y += (s.y - this.focus.y) * 0.05;
      }
    }
    return this.focus;
  }

  /** The aim preview for the cursor / held finger. */
  aim(sx, sy, toWorld, active) {
    const me = this.me();
    if (!me || me.mode === 'downed' || sx === null) return null;
    const p = toWorld(sx, sy);
    const w = this.world;
    if (me.sp === 'orb') {
      if (this.type === 4) {
        if (!active && !this.hoverOrb) return null;
        const key = `${Math.round(p.x / 6)}:${Math.round(p.y / 6)}`;
        if (this.orbKey !== key || w.tick - (this.orbTick ?? 0) > 20) {
          this.orbKey = key;
          this.orbTick = w.tick;
          this.orbPlan = planOrb(w.web, p.x, p.y, this.orbR(p), this.pattern ?? 'orb', me.mods.range);
        }
        const far = Math.hypot(p.x - me.x, p.y - me.y) > me.mods.range;
        return { kind: 'orb', x1: p.x, y1: p.y, r: this.orbR(p), plan: far ? { ...this.orbPlan, ok: false } : this.orbPlan };
      }
      const found = resolveTarget(w, me, p.x, p.y);
      if (!found) return active ? { kind: 'cast', x0: me.x, y0: me.y, x1: p.x, y1: p.y, ok: false, range: me.mods.range } : null;
      const tgt = catchOnBranch(w, me, found);
      const len = Math.hypot(tgt.x - me.x, tgt.y - me.y);
      const ok = len <= me.mods.range && me.silk >= threadCost(me, TYPE_TO_THREAD[this.type], len);
      return { kind: 'cast', x0: me.x, y0: me.y, x1: tgt.x, y1: tgt.y, ok, range: active ? me.mods.range : 0 };
    }
    if (me.sp === 'jumper' || me.sp === 'bolas') {
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      const power = this.charge ?? 1;
      const reach = me.sp === 'jumper' ? me.mods.leap * Math.max(0.35, power) : SPECIES.bolas.fling * 1.2;
      const f = Math.min(1, reach / Math.max(1, d));
      return { kind: 'leap', arc: me.sp === 'jumper', power, x0: me.x, y0: me.y, x1: me.x + (p.x - me.x) * f, y1: me.y + (p.y - me.y) * f, ok: d <= reach };
    }
    return null;
  }

  /** The contextual action's label (the big touch button). */
  actLabel() {
    const me = this.me();
    if (!me) return 'Act';
    const t = useTarget(this.world, me);
    if (!t) return me.sp === 'bolas' ? 'Eat' : 'Wrap';
    return { eat: 'Eat', wrap: 'Wrap', give: 'Give', revive: 'Help' }[t.k] ?? 'Act';
  }

  /** The sense ring: which way the web is shaking, and how hard (silk you can feel through your feet). */
  feel() {
    const me = this.me();
    const out = this.sense;
    out.fill(0);
    if (!me || me.mode !== 'walk') return out;
    const web = this.world.web;
    for (let s = 0; s < web.threadHigh; s++) {
      if (web.tid[s] < 0 || web.type[s] === 5) continue;
      const v = web.vib[s];
      if (v < 18) continue;
      const a = web.ta[s];
      const b = web.tb[s];
      const mx = (web.x[a] + web.x[b]) / 2 - me.x;
      const my = (web.y[a] + web.y[b]) / 2 - me.y;
      const d = Math.hypot(mx, my);
      if (d < 22 || d > 520) continue;
      const k = Math.round((Math.atan2(my, mx) / (Math.PI * 2)) * 16 + 16) % 16;
      out[k] = Math.min(1, out[k] + (v / 900) * (1 - d / 600));
    }
    return out;
  }

  hud(touch, extra = {}) {
    const w = this.world;
    const me = this.me();
    const total = w.dusk + w.length;
    const label = w.phase === 'dusk' ? 'Dusk' : w.phase === 'dawn' ? 'Dawn' : `Night ${w.night}`;
    const edges = [];
    const cam = this.renderer.cam;
    const sp = {};
    const onScreen = (x, y) => cam.toScreen(x, y, sp);
    if (w.wren && w.wren.st === 'warn') {
      const s = onScreen(0, w.wren.y);
      edges.push({ x: w.wren.dir > 0 ? 0 : cam.sw, y: s.y, dx: w.wren.dir > 0 ? -10 : 10, dy: 0, urgent: true, label: 'Wren' });
    }
    if (this.gustWarn && this.gustWarn.until > this.t) {
      edges.push({ x: this.gustWarn.dir > 0 ? 0 : cam.sw, y: cam.sh * 0.3, dx: this.gustWarn.dir > 0 ? -10 : 10, dy: 0, label: 'Wind', warm: false });
    }
    const eyes = me?.mods?.eyes ?? 0;
    if (eyes >= 1) {
      for (const p of w.prey) {
        if (p.st !== 'stuck' && p.st !== 'cocoon') continue;
        if (cam.visible(p.x, p.y, -20)) continue;
        const s = onScreen(p.x, p.y);
        edges.push({ x: s.x, y: s.y, warm: true, low: touch });
      }
    }
    if (eyes >= 2) {
      for (const h of w.wasps) {
        if (cam.visible(h.x, h.y, -20)) continue;
        const s = onScreen(h.x, h.y);
        edges.push({ x: s.x, y: s.y, urgent: h.st === 'hunt', label: h.st === 'hunt' ? 'Wasp' : '' });
      }
    }
    if ((me?.mods?.alarm ?? 0) >= 1) {
      for (const a of this.alarms) {
        if (cam.visible(a.x, a.y, -20)) continue;
        const s = onScreen(a.x, a.y);
        edges.push({ x: s.x, y: s.y, warm: true, label: 'Alarm' });
      }
    }
    for (const p of this.pings) {
      if (cam.visible(p.x, p.y, -20)) continue;
      const s = onScreen(p.x, p.y);
      edges.push({ x: s.x, y: s.y, warm: true });
    }
    const notes = this.notes.map((n) => {
      const s = onScreen(n.wx, n.wy);
      return { s: n.s, x: s.x, y: s.y + n.y, a: n.a, c: n.c };
    });
    return {
      touch,
      label: extra.watching ? 'Watching' : label,
      clock: w.t / total,
      dusk: w.dusk,
      length: w.length,
      food: w.food,
      quota: w.quota,
      types: me?.sp === 'orb' && !extra.watching,
      type: this.type,
      mates: extra.mates ?? [],
      edges,
      notes,
      hint: extra.hint,
      hintA: extra.hintA,
      big: this.big?.s,
      bigSub: this.big?.sub,
      bigA: this.big?.a,
      bigColor: this.big?.color,
    };
  }

  gauges() {
    const me = this.me();
    if (!me) return null;
    const changed = Math.abs(me.silk - this.lastSilk) > 0.05;
    this.lastSilk = me.silk;
    this.loud = Math.max(changed ? 1 : 0, this.loud - 1 / 60 / 1.5);
    let progress = 0;
    if (me.act?.k === 'wrap') {
      const p = this.world.prey.find((q) => q.id === me.act.prey);
      progress = p?.wrap ?? 0;
    } else if (me.act?.k === 'eat') progress = me.act.t / me.act.T;
    else if (me.act?.k === 'revive') progress = me.act.t / 1.2;
    return { silk: me.silk, maxSilk: me.mods.maxSilk, hp: me.hp, maxHp: SPECIES[me.sp].hp, venom: me.venom, loud: this.loud, progress };
  }

  timeLeft() {
    return timeLeft(this.world);
  }
}

export { TYPES, GROUND, T_STICKY, anchorPos, upkeep, patternsFor };
