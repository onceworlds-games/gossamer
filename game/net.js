// The room: joining, the match record, the host's ticker and bots, the messages players send the host. Follows the party template:
// one record `g` written only by the host, keyed by the match id; everyone derives what to draw from room.match.phase plus `g`;
// deadlines are match-clock values, so a pause or a change of host keeps them.

import { BotField } from './bots.js';
import { advance, applyCaught, applyFinish, beginRound, closeRound, isRoundOver, newMatch } from './flow.js';
import { FIELD_LEN, MAX_PLAYERS, SETTINGS, STEP, STEP_MS, buildRoster, clamp, hash32, hashStr, isBot, lightAt, makeSchedule, startPositions } from './rules.js';

const PHASES = ['round', 'board', 'final'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** A short number for a match id, carried in presence so a reloaded page knows which round its last position belongs to. */
export const matchTag = (mid) => hashStr(String(mid)) & 0xffff;

/** Whether a record read from room state has the shape the game relies on (it comes from the host's page: never trust it blindly). */
export function validG(g) {
  if (!isObj(g) || typeof g.mid !== 'string' || typeof g.by !== 'string' || typeof g.rid !== 'string') return false;
  if (!PHASES.includes(g.phase) || !Array.isArray(g.roster) || g.roster.length < 1 || g.roster.length > MAX_PLAYERS) return false;
  if (!g.roster.every((id) => typeof id === 'string' && id.length > 0 && id.length < 80)) return false;
  if (![g.n, g.rounds, g.at, g.t0, g.until, g.rs, g.seed].every(num)) return false;
  if (g.mode !== 'back' && g.mode !== 'out') return false;
  if (!isObj(g.bots) || !isObj(g.fin) || !isObj(g.caught) || !isObj(g.out) || !isObj(g.scores) || !isObj(g.st)) return false;
  if (g.res !== null && g.res !== undefined && !Array.isArray(g.res)) return false;
  if (g.final !== null && g.final !== undefined && !Array.isArray(g.final)) return false;
  if (g.phase === 'board' && (!Array.isArray(g.res) || !isObj(g.rp))) return false;
  if (g.phase === 'final' && !Array.isArray(g.final)) return false;
  for (const id of g.roster) {
    if (g.scores[id] !== undefined && !num(g.scores[id])) return false;
    if (g.st[id] !== undefined && !(Array.isArray(g.st[id]) && g.st[id].length === 3 && g.st[id].every(num))) return false;
  }
  return true;
}

/** What every page knows when a match is starting, before the host's record arrives: the same roster and start slots the host builds. */
export function previewOf(match) {
  const seed = (match.seed ?? 0) >>> 0;
  const { ids, bots } = buildRoster(Array.isArray(match.participants) ? match.participants : [], seed);
  return { mid: match.id ?? 'pre', roster: ids, bots, seed, n: 1, rs: hash32(seed, 1), phase: 'pre', mode: 'back', rounds: 1, t0: Infinity, at: 0, until: 0, fin: {}, out: {}, caught: {}, scores: {}, st: {} };
}

// ---------------------------------------------------------------- joining

function stubOw() {
  const quiet = () => {};
  return {
    mode: 'standalone',
    now: () => Date.now(),
    on: quiet,
    ui: { setOrientation: quiet },
    settings: { quality: 'high', reducedMotion: false, pixelRatio: (max = 2) => Math.min(window.devicePixelRatio || 1, max), on: quiet },
    controls: { set: quiet, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    player: { get: async () => ({ id: 'me', name: 'You', guest: true }), avatarUrl: async () => null },
    save: { get: async () => null, set: async () => {} },
    badges: { award: async () => false },
    leaderboards: { submit: async () => null },
  };
}

/** A tiny solo room for when the file is opened on its own (no platform): no lobby, Enter starts a match. */
function makeStubRoom() {
  const listeners = new Map();
  const me = { id: 'me', name: 'You', presence: null, team: 0 };
  const players = new Map([['me', me]]);
  const settings = { rounds: 3, mode: 'back' };
  const room = {
    stub: true,
    me,
    players,
    host: 'me',
    isHost: true,
    connected: true,
    state: {},
    kind: 'solo',
    settings,
    match: { phase: 'lobby', n: 0, min: 1 },
    get online() {
      return [me];
    },
    get participants() {
      return this.match.phase === 'lobby' ? [] : [me];
    },
    get spectators() {
      return [];
    },
    spectating: false,
    get running() {
      return this.match.phase === 'playing';
    },
    matchNow() {
      return this.match.phase === 'playing' ? Date.now() - this.match.startedAt : 0;
    },
    isParticipant() {
      return this.match.phase !== 'lobby';
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
    emit(ev, ...args) {
      for (const fn of listeners.get(ev) ?? []) fn(...args);
    },
    setPresence(d) {
      me.presence = d;
    },
    presenceAt(id) {
      return players.get(id)?.presence ?? null;
    },
    setState(k, v) {
      if (v === null || v === undefined) delete this.state[k];
      else this.state[k] = v;
    },
    send() {},
    setSetting(id, value) {
      const s = SETTINGS.find((x) => x.id === id);
      if (s && s.options.some((o) => (o.value ?? o) === value)) settings[id] = value;
    },
    setReady() {},
    hideLobby() {},
    admit() {},
    leave() {},
    endMatch() {
      const prev = this.match;
      this.match = { phase: 'lobby', n: prev.n, min: 1 };
      this.emit('matchend', this.match, prev);
    },
    /** Stands in for the platform's lobby: Enter starts the countdown. */
    beginMatch() {
      if (this.match.phase !== 'lobby') return;
      const n = this.match.n + 1;
      this.match = { phase: 'starting', n, min: 1, id: `stub${n}`, seed: (Math.random() * 4294967296) >>> 0, participants: ['me'], startsAt: Date.now() + 3000 };
      this.emit('starting', this.match);
    },
    tick() {
      const m = this.match;
      if (m.phase === 'starting' && Date.now() >= m.startsAt) {
        this.match = { ...m, phase: 'playing', startedAt: m.startsAt };
        this.emit('matchstart', this.match);
      }
    },
  };
  return room;
}

/** Joins the room before anything heavy is built. Falls back to a local stub if there's no platform (or the join fails). */
export async function connect() {
  const ow = window.onceworlds ?? null;
  if (ow) {
    try {
      const room = await ow.rooms.join({ maxPlayers: MAX_PLAYERS, minPlayers: 1, lobby: 'bar', settings: SETTINGS });
      return { ow, room };
    } catch (e) {
      console.warn('[red-light-green-light] could not join a room, playing alone', e);
    }
  }
  return { ow: ow ?? stubOw(), room: makeStubRoom() };
}

// ---------------------------------------------------------------- the match

export function createNet(ow, room) {
  const meId = room.me.id;
  const lightObj = {};
  const field = new BotField();
  let botRid = null;
  let botT = 0;
  let lastPub = 0;
  let endTry = -Infinity;
  let sched = { rs: null, s: null };
  let checked = null;
  let checkedOk = false;
  const snaps = []; // the bots' last snapshots, for pages that aren't the host

  const scheduleOf = (g) => {
    if (!sched.s || sched.rs !== g.rs) sched = { rs: g.rs, s: makeSchedule(g.rs) };
    return sched.s;
  };

  /** The match record, if it's this match's and well-formed; else null (a stale record from the last match reads as "no game"). */
  function G() {
    if (room.match.phase === 'lobby') return null;
    const g = room.state.g;
    if (!g || g.mid !== room.match.id) return null;
    if (g !== checked) {
      checked = g;
      checkedOk = validG(g);
    }
    return checkedOk ? g : null;
  }

  const commit = (g, next) => {
    if (next !== g) room.setState('g', next);
  };

  // ------------------------------------------------ the host
  function startNewMatch() {
    const seed = (room.match.seed ?? 0) >>> 0;
    const humans = Array.isArray(room.match.participants) ? room.match.participants : [];
    const { ids, bots } = buildRoster(humans, seed);
    const rounds = Number(room.settings.rounds);
    let g = newMatch({ mid: room.match.id, by: meId, ids, bots, rounds: [1, 3, 5].includes(rounds) ? rounds : 3, mode: room.settings.mode, seed });
    g = beginRound(g, room.matchNow());
    room.setState('b', null);
    room.setState('g', g);
    botRid = null;
  }

  /** Carries on as the host: from the room's copy of the record. Safe to call as often as you like. */
  function adopt() {
    if (!room.isHost || !room.running) return;
    const g = G();
    if (!g) {
      if (room.state.g && room.state.g.mid === room.match.id) return; // a record we can't read: leave it be
      return startNewMatch();
    }
    if (g.by === meId) return;
    room.setState('g', { ...g, by: meId });
    botRid = null;
  }

  function setupBots(g) {
    const ids = g.roster.filter((id) => g.bots[id] !== undefined);
    const xs = startPositions(g.roster, g.rs);
    field.setup(ids, ids.map((id) => xs[id]), g.rs);
    botRid = g.rid;
    botT = g.t0;
    const b = room.state.b;
    if (b && b.rid === g.rid && Array.isArray(b.p) && b.p.length === ids.length) {
      field.restore(b.p);
      if (num(b.t)) botT = clamp(b.t, g.t0, Math.max(g.t0, room.matchNow()));
    }
  }

  const activeIds = (g) => {
    const out = [];
    for (const id of g.roster) {
      if (isBot(id)) out.push(id);
      else {
        const p = room.players.get(id);
        if (p && p.connected !== false && !p.idle) out.push(id);
      }
    }
    return out;
  };

  /** How far everyone who didn't finish got, for ranking at the end of a round. */
  function distances(g) {
    const d = {};
    for (const id of g.roster) {
      if (g.fin[id] !== undefined || g.out[id] !== undefined) continue;
      if (isBot(id)) {
        const b = botRid === g.rid ? field.bots.find((x) => x.id === id) : null;
        d[id] = b ? b.r.y : 0;
      } else {
        const pr = room.players.get(id)?.presence;
        d[id] = isObj(pr) && pr.n === g.n && pr.m === matchTag(g.mid) && num(pr.y) ? clamp(pr.y, 0, FIELD_LEN) : 0;
      }
    }
    return d;
  }

  const ticker = setInterval(() => {
    if (!room.isHost || !room.running) return; // a paused match stands still, and so does matchNow()
    const g = G();
    if (!g || g.by !== meId) return;
    const now = room.matchNow();
    if (g.phase === 'round') {
      if (isRoundOver(g, now, activeIds(g))) commit(g, closeRound(g, now, distances(g)));
    } else if (g.phase === 'board') {
      if (now >= g.until) commit(g, advance(g, now));
    } else if (g.phase === 'final' && now >= g.until && now - endTry >= 3000) {
      endTry = now; // asked once; asked again after a few seconds only if the room is still playing (the call can fail)
      room.endMatch(); // back to the platform's lobby
    }
  }, 100);

  /**
   * Called every frame by the page: the host steps the bots up to the match clock with the same movement code the players use, and
   * shares them about 12 times a second. `humans` are { id, x, y, on } of the people on the field (the bots dodge and bump them).
   */
  function hostFrame(humans, nh) {
    if (!room.isHost || !room.running) return;
    let g = G();
    if (!g || g.by !== meId || g.phase !== 'round') return;
    const now = room.matchNow();
    if (botRid !== g.rid) setupBots(g);
    if (now < g.t0) {
      botT = g.t0;
      return;
    }
    if (botT < g.t0) botT = g.t0;
    let steps = 0;
    while (botT + STEP_MS <= now && steps < 15) {
      lightAt(scheduleOf(g), (botT - g.t0) / 1000, lightObj);
      const events = field.step(lightObj, STEP, g.mode, humans, nh);
      botT += STEP_MS;
      steps++;
      for (const e of events) {
        g = G() ?? g;
        if (e.type === 'caught') commit(g, applyCaught(g, e.id, e.y, botT));
        else if (e.type === 'finished') commit(g, applyFinish(g, e.id, botT));
      }
    }
    if (botT + STEP_MS <= now) botT = now; // far behind (a stall): skip ahead instead of racing to catch up
    if (now - lastPub >= 80 || now < lastPub) {
      lastPub = now;
      room.setState('b', { rid: g.rid, t: Math.round(botT), p: field.bots.map((b) => [r2(b.r.x), r2(b.r.y), r1(b.r.vx), r1(b.r.vy), b.r.s]) });
    }
  }

  // ------------------------------------------------ messages to the host
  room.on('message', (d, from, at, mt) => {
    if (!room.isHost || !isObj(d) || typeof d.rid !== 'string') return;
    const g = G();
    if (!g || g.by !== meId || g.phase !== 'round' || d.rid !== g.rid) return;
    const id = from?.id;
    if (typeof id !== 'string') return;
    const t = num(mt) ? mt : room.matchNow();
    if (d.t === 'caught') commit(g, applyCaught(g, id, num(d.y) ? d.y : 0, t));
    else if (d.t === 'finish') commit(g, applyFinish(g, id, t));
  });

  /** My own character was caught on red (decided on my page, from what I saw). */
  function reportCaught(y) {
    const g = G();
    if (!g || g.phase !== 'round') return;
    if (room.isHost && g.by === meId) commit(g, applyCaught(g, meId, y, room.matchNow()));
    else room.send({ t: 'caught', rid: g.rid, y: r1(y) }, { to: room.host });
  }

  function reportFinish() {
    const g = G();
    if (!g || g.phase !== 'round') return;
    if (room.isHost && g.by === meId) commit(g, applyFinish(g, meId, room.matchNow()));
    else room.send({ t: 'finish', rid: g.rid }, { to: room.host });
  }

  // ------------------------------------------------ the bots, for everyone else
  function pushSnap(v) {
    if (!isObj(v) || typeof v.rid !== 'string' || !num(v.t) || !Array.isArray(v.p) || v.p.length > MAX_PLAYERS) return;
    const rows = [];
    for (const row of v.p) {
      if (!Array.isArray(row) || row.length < 5 || !row.slice(0, 5).every(num)) return;
      rows.push([clamp(row[0], 0, 12), clamp(row[1], 0, 70), clamp(row[2], -10, 10), clamp(row[3], -10, 10), row[4] | 0]);
    }
    const last = snaps[snaps.length - 1];
    if (last && (last.rid !== v.rid || v.t < last.t - 500)) snaps.length = 0;
    snaps.push({ rid: v.rid, t: v.t, p: rows });
    if (snaps.length > 6) snaps.shift();
  }
  room.on('state', (k, v) => {
    if (k === 'b') pushSnap(v);
  });
  if (room.state.b) pushSnap(room.state.b);

  /** Where bot number `i` of the round `rid` is at match time `t` (ms): the host's own sim, or the two snapshots around it. */
  function botAt(i, rid, t, out) {
    if (room.isHost && botRid === rid && field.bots[i]) {
      const r = field.bots[i].r;
      out.x = r.x;
      out.y = r.y;
      out.vx = r.vx;
      out.vy = r.vy;
      out.s = r.s;
      return true;
    }
    let n = snaps.length;
    while (n > 0 && snaps[n - 1].rid !== rid) n--;
    if (n === 0 || !snaps[n - 1].p[i]) return false;
    let b = n - 1;
    while (b > 0 && snaps[b].t > t) b--;
    const A = snaps[b];
    const B = snaps[Math.min(b + 1, n - 1)];
    const pa = A.p[i];
    const pb = B.p[i] ?? pa;
    if (!pb) return false;
    let k = B.t > A.t ? clamp((t - A.t) / (B.t - A.t), 0, 1) : 1;
    if (Math.abs(pb[1] - pa[1]) > 15) k = 1; // a jump (a new round, a zip home) isn't slid across
    out.x = pa[0] + (pb[0] - pa[0]) * k;
    out.y = pa[1] + (pb[1] - pa[1]) * k;
    out.vx = pa[2] + (pb[2] - pa[2]) * k;
    out.vy = pa[3] + (pb[3] - pa[3]) * k;
    out.s = k < 0.5 ? pa[4] : pb[4];
    return true;
  }

  room.on('matchstart', () => {
    snaps.length = 0;
    botRid = null;
    adopt();
  });
  room.on('host', adopt);
  room.on('reconnect', adopt);
  room.on('matchend', () => {
    botRid = null;
    endTry = -Infinity;
    snaps.length = 0;
  });
  adopt();

  return {
    g: G,
    lightFor: (g, nowMs, out) => lightAt(scheduleOf(g), (nowMs - g.t0) / 1000, out),
    hostFrame,
    dispose: () => clearInterval(ticker),
    reportCaught,
    reportFinish,
    botAt,
    activeIds,
    get hostBots() {
      return botRid !== null ? field.bots : [];
    },
  };
}
