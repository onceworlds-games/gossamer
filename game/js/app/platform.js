// Every call to the platform goes through here. Outside Onceworlds (posters, local files) there is no SDK, so a
// small stand-in plays the part: a room of one that keeps a match the way the platform's rooms do. Nothing in here
// throws into the game.

const sdk = typeof window !== 'undefined' ? window.onceworlds : undefined;
export const onPlatform = !!sdk && sdk.mode !== 'standalone';

const safe = (fn, fallback) => {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};
const safeAsync = async (fn, fallback) => {
  try {
    const v = await fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------- the stand-in room
class LocalRoom {
  constructor(opts) {
    this.opts = opts;
    this.me = { id: 'local', name: 'You', presence: null, team: 0 };
    this.players = new Map([[this.me.id, this.me]]);
    this.state = {};
    this.kind = 'solo';
    this.host = this.me.id;
    this.connected = true;
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.handlers = {};
    this.private = {};
    this.budget = { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 128000 };
    this.leftOut = [];
  }
  get isHost() {
    return true;
  }
  get online() {
    return [this.me];
  }
  get participants() {
    return this.match.phase === 'playing' || this.match.phase === 'starting' ? [this.me] : [];
  }
  get spectators() {
    return [];
  }
  get spectating() {
    return false;
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  get canStart() {
    return true;
  }
  get allReady() {
    return true;
  }
  get notReady() {
    return [];
  }
  isParticipant(id) {
    return id === this.me.id && this.match.phase !== 'lobby';
  }
  matchNow() {
    const m = this.match;
    if (m.phase !== 'playing') return 0;
    const paused = m.paused ? Date.now() - m.paused.since : 0;
    return Math.max(0, Date.now() - m.startedAt - (m.pausedMs ?? 0) - paused);
  }
  on(ev, fn) {
    (this.handlers[ev] ??= []).push(fn);
  }
  emit(ev, ...args) {
    for (const fn of this.handlers[ev] ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }
  publish(match) {
    const prev = this.match;
    this.match = match;
    this.emit('match', match, prev);
    if (match.phase === 'starting' && prev.phase === 'lobby') this.emit('starting', match);
    if (match.phase === 'playing' && prev.phase !== 'playing') this.emit('matchstart', match);
    if (match.phase === 'lobby' && prev.phase !== 'lobby') this.emit('matchend', match, prev);
    if (match.paused && !prev.paused) this.emit('matchpause', match);
    if (!match.paused && prev.paused && match.phase === 'playing') this.emit('matchresume', match);
  }
  startMatch() {
    if (this.match.phase !== 'lobby') return;
    const n = this.match.n + 1;
    const wait = this.opts.countdown ?? 3000;
    this.publish({ phase: 'starting', n, min: 1, id: `local${n}.${Date.now().toString(36)}`, seed: Math.floor(Math.random() * 2 ** 32), participants: [this.me.id], startsAt: Date.now() + wait });
    this.timer = setTimeout(() => {
      const { startsAt: _, ...rest } = this.match;
      if (this.match.phase === 'starting') this.publish({ ...rest, phase: 'playing', startedAt: Date.now(), pausedMs: 0 });
    }, wait);
  }
  endMatch() {
    clearTimeout(this.timer);
    if (this.match.phase !== 'lobby') this.publish({ phase: 'lobby', n: this.match.n, min: 1 });
  }
  pauseMatch(paused = true) {
    const m = this.match;
    if (m.phase !== 'playing') return;
    if (paused && !m.paused) this.publish({ ...m, paused: { since: Date.now(), reason: 'host' } });
    else if (!paused && m.paused) {
      const { paused: held, ...rest } = m;
      this.publish({ ...rest, pausedMs: (m.pausedMs ?? 0) + Date.now() - held.since });
    }
  }
  setState(k, v) {
    if (v === null) delete this.state[k];
    else this.state[k] = v;
    this.emit('state', k, v, this.me.id);
  }
  setPresence(p) {
    this.me.presence = p;
  }
  presenceAt(id) {
    return this.players.get(id)?.presence ?? null;
  }
  setReady() {}
  clearReady() {}
  admit() {}
  setOpen() {}
  hideLobby() {}
  send() {}
  setPrivate(k, v) {
    this.private[k] = v;
  }
  privateOf() {
    return this.private;
  }
  leave() {}
}

// ---------------------------------------------------------------- the adapter
const memSave = new Map();

export const platform = {
  onPlatform,
  sdk,
  async join(opts) {
    if (sdk?.rooms?.join) {
      const room = await safeAsync(() => sdk.rooms.join(opts), null);
      if (room) return room;
    }
    return new LocalRoom(opts);
  },
  onRooms(ev, fn) {
    safe(() => sdk?.rooms?.on?.(ev, fn));
  },
  now() {
    return safe(() => (sdk?.now ? sdk.now() : Date.now()), Date.now());
  },
  async player() {
    return safeAsync(() => sdk?.player?.get?.(), null);
  },
  async avatar(id) {
    return safeAsync(() => sdk?.player?.avatarUrl?.(id, 'head'), null);
  },
  save: {
    async get(key) {
      if (sdk?.save) return safeAsync(() => sdk.save.get(key), null);
      try {
        const raw = localStorage.getItem(`gossamer.${key}`);
        return raw ? JSON.parse(raw) : (memSave.get(key) ?? null);
      } catch {
        return memSave.get(key) ?? null;
      }
    },
    async set(key, value) {
      if (sdk?.save) return safeAsync(() => sdk.save.set(key, value), null);
      memSave.set(key, value);
      try {
        localStorage.setItem(`gossamer.${key}`, JSON.stringify(value));
      } catch {}
      return null;
    },
  },
  award(id) {
    return safeAsync(() => sdk?.badges?.award?.(id), false);
  },
  submit(board, score) {
    if (!Number.isFinite(score) || score <= 0) return Promise.resolve(null);
    return safeAsync(() => sdk?.leaderboards?.submit?.(board, Math.round(score)), null);
  },
  controls: {
    set(layout) {
      safe(() => sdk?.controls?.set?.(layout));
    },
    get stick() {
      return safe(() => sdk?.controls?.stick, null) ?? { x: 0, y: 0 };
    },
    pressed(id) {
      return safe(() => !!sdk?.controls?.pressed?.(id), false);
    },
    get touch() {
      return safe(() => !!sdk?.controls?.touch, false);
    },
  },
  settings: {
    get quality() {
      return safe(() => sdk?.settings?.quality, 'high') ?? 'high';
    },
    get choice() {
      return safe(() => sdk?.settings?.choice, 'auto') ?? 'auto';
    },
    get reducedMotion() {
      const v = safe(() => sdk?.settings?.reducedMotion, undefined);
      if (typeof v === 'boolean') return v;
      return safe(() => matchMedia('(prefers-reduced-motion: reduce)').matches, false);
    },
    pixelRatio(max = 2) {
      const v = safe(() => sdk?.settings?.pixelRatio?.(max), undefined);
      return Number.isFinite(v) && v > 0 ? v : Math.min(max, window.devicePixelRatio || 1);
    },
    on(fn) {
      safe(() => sdk?.settings?.on?.('change', fn));
    },
  },
  on(ev, fn) {
    safe(() => sdk?.on?.(ev, fn));
  },
  invite() {
    safe(() => sdk?.ui?.showInvite?.());
  },
  orientation(o) {
    safe(() => sdk?.ui?.setOrientation?.(o));
  },
};
