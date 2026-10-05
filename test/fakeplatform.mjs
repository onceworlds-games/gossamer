// A pretend Onceworlds room for the page tests: a few pages (rooms) sharing one match, one clock, messages and shared state delivered
// after a little latency, as the SDK's Room does for the parts this game uses. Whoever joined first is the host.

export class FakePlatform {
  constructor({ latency = 60 } = {}) {
    this.latency = latency;
    this.rooms = [];
    this.players = new Map();
    this.queue = [];
    this.hostId = null;
    this.settings = { rounds: 3, mode: 'back' };
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.matches = 0;
    this.ended = 0;
  }

  join(id, name = id) {
    const player = this.players.get(id) ?? { id, name, presence: null, team: 0 }; // coming back (a reload) keeps the last presence
    this.players.set(id, player);
    const room = new FakeRoom(this, player);
    if (this.rooms.length > 0) room.state = JSON.parse(JSON.stringify(this.rooms[0].state)); // the welcome carries the room's state
    this.rooms.push(room);
    if (this.hostId === null) this.hostId = id;
    return room;
  }

  /** A page goes away (closed, reloaded): the room hears nothing more. */
  drop(room) {
    this.rooms = this.rooms.filter((r) => r !== room);
    room.connected = false;
  }

  later(fn, delay = this.latency) {
    this.queue.push({ at: Date.now() + delay, fn });
  }

  /** Delivers what is due and moves the countdown along. Call once per frame. */
  tick() {
    const now = Date.now();
    const due = this.queue.filter((q) => q.at <= now);
    this.queue = this.queue.filter((q) => q.at > now);
    for (const q of due) q.fn();
    const m = this.match;
    if (m.phase === 'starting' && now >= m.startsAt) {
      this.match = { ...m, phase: 'playing', startedAt: m.startsAt };
      for (const r of this.rooms) r.emit('matchstart', this.match);
    }
  }

  /** The countdown begins with these players (the room freezes the settings and the seed). */
  startMatch(ids, seed = 123456789) {
    this.matches++;
    this.frozen = { ...this.settings };
    this.match = { phase: 'starting', n: this.matches, min: 1, id: `m${this.matches}`, seed, participants: [...ids], startsAt: Date.now() + 3000 };
    for (const r of this.rooms) r.emit('starting', this.match);
  }

  endMatch() {
    this.ended++;
    const prev = this.match;
    this.match = { phase: 'lobby', n: prev.n, min: 1 };
    this.frozen = null;
    for (const r of this.rooms) r.emit('matchend', this.match, prev);
  }

  setHost(id) {
    this.hostId = id;
    for (const r of this.rooms) r.emit('host', id);
  }
}

class FakeRoom {
  constructor(platform, me) {
    this.platform = platform;
    this.me = me;
    this.players = platform.players;
    this.state = {};
    this.kind = 'public';
    this.connected = true;
    this.listeners = new Map();
    this.hidden = null;
    this.errors = [];
  }

  get host() {
    return this.platform.hostId;
  }
  get isHost() {
    return this.connected && this.platform.hostId === this.me.id;
  }
  get match() {
    return this.platform.match;
  }
  get settings() {
    return this.platform.frozen ?? this.platform.settings;
  }
  get online() {
    return [...this.players.values()].filter((p) => p.connected !== false);
  }
  get participants() {
    const m = this.match;
    if (m.phase === 'lobby') return [];
    return (m.participants ?? []).map((id) => this.players.get(id)).filter(Boolean);
  }
  isParticipant(id = this.me.id) {
    return this.match.phase !== 'lobby' && Boolean(this.match.participants?.includes(id));
  }
  get spectating() {
    return this.match.phase !== 'lobby' && !this.isParticipant();
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  matchNow() {
    const m = this.match;
    return m.phase === 'playing' ? Math.max(0, Date.now() - m.startedAt) : 0;
  }

  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev).add(fn);
    return () => this.listeners.get(ev).delete(fn);
  }
  emit(ev, ...args) {
    for (const fn of [...(this.listeners.get(ev) ?? [])]) fn(...args);
  }

  setPresence(d) {
    this.me.presence = d;
  }
  presenceAt(id) {
    const p = this.players.get(id);
    return p ? p.presence : null;
  }

  setState(k, v) {
    if (v === null || v === undefined) delete this.state[k];
    else this.state[k] = v;
    const copy = v === null || v === undefined ? null : JSON.parse(JSON.stringify(v));
    for (const r of this.platform.rooms) {
      if (r === this) continue;
      this.platform.later(() => {
        if (copy === null) delete r.state[k];
        else r.state[k] = copy;
        r.emit('state', k, copy, this.me.id);
      });
    }
  }

  send(data, { to } = {}) {
    const at = Date.now();
    const mt = this.matchNow();
    const copy = JSON.parse(JSON.stringify(data));
    for (const r of this.platform.rooms) {
      if (r === this || (to !== undefined && r.me.id !== to)) continue;
      this.platform.later(() => r.emit('message', copy, this.me, at, mt));
    }
  }

  setSetting(id, value) {
    if (!this.isHost || this.match.phase !== 'lobby') return;
    this.platform.settings = { ...this.platform.settings, [id]: value };
  }
  endMatch() {
    if (this.isHost && this.match.phase === 'playing') this.platform.endMatch();
  }
  hideLobby(h = true) {
    this.hidden = h;
  }
  setReady() {}
  setOpen() {}
  admit() {}
  leave() {}
}

/** The bits of `window.onceworlds` the page uses, backed by a FakePlatform room. */
export function fakeOw(platform, room) {
  const saved = {};
  const out = { awarded: [], boards: [], saved, controls: null, pressed: {}, orientation: null, room };
  const ow = {
    mode: 'platform',
    now: () => Date.now(),
    on() {},
    rooms: { join: async () => out.room },
    ui: { setOrientation: (o) => (out.orientation = o) },
    settings: { quality: 'high', reducedMotion: false, scale: 1, pixelRatio: () => 1, on() {} },
    controls: {
      touch: false,
      stick: { x: 0, y: 0 },
      pressed: (id) => Boolean(out.pressed[id]),
      set: (layout) => (out.controls = layout),
    },
    player: {
      get: async () => ({ id: room.me.id, name: room.me.name, guest: false }),
      avatarUrl: async (id) => (id.startsWith('bot') ? null : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="88"/>'),
    },
    save: { get: async (k) => saved[k] ?? null, set: async (k, v) => void (saved[k] = JSON.parse(JSON.stringify(v))) },
    badges: { award: async (id) => (out.awarded.push(id), true) },
    leaderboards: { submit: async (b, v) => (out.boards.push([b, v]), { best: v, rank: 1 }) },
  };
  return { ow, out };
}
