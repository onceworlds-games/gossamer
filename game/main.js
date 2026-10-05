// Red Light Green Light: boot, the frame loop, and which screen is showing.
//
// Everything on screen is derived each frame from room.match.phase plus the host's record `g` (see net.js), never from a phase this
// page keeps: a reload, a late join or a new host heals itself. This page simulates only its own character (fixed 60 Hz) and decides
// for itself when it was caught or finished; the host decides for the bots and keeps the record.

import * as audio from './audio.js';
import { Demo } from './demo.js';
import { animChar, bump, clampCam, drawScene, getAvatar, makeVis, makeView, setAvatarSource } from './draw.js';
import { photoFinish } from './flow.js';
import { fx } from './fx.js';
import { createInput } from './input.js';
import { connect, createNet, matchTag, previewOf } from './net.js';
import { BANNER_MS, BOT_NAMES, FIELD_LEN, FIELD_W, GO_MS, PLAYER_COLORS, ROUND_LIMIT_MS, SETTINGS, STEP, clamp, colorOf, hashStr, isBot, placeLabel, practiceLight, startPositions } from './rules.js';
import { S_DONE, S_GHOST, S_RUN, S_ZAP, S_ZIP, clearEvents, makeRunner, newEvents, resetRunner, separate, stepRunner } from './sim.js';
import * as ui from './ui.js';

const params = new URLSearchParams(location.search);
const posterName = params.get('poster');
if (posterName) {
  // Store art: no room, no SDK; one staged frame drawn by the real renderer.
  const { runPoster } = await import('./poster.js');
  await runPoster(document.getElementById('c'), posterName);
} else {
  await start();
}

async function start() {
  const { ow, room } = await connect(); // join first: a reload must not miss its seat
  try {
    ow.ui?.setOrientation?.('landscape');
  } catch {
    // desktop ignores it
  }
  try {
    await Promise.race([document.fonts.load('700 24px Fredoka'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    // the fallback font is fine
  }
  runSession(ow, room, true);
}

/** One visit to one room: everything below belongs to it. If the room closes, the page starts over in a new one (`rejoin`). */
function runSession(ow, room, withTitle) {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const meId = room.me.id;
  let stopped = false;
  setAvatarSource((id) => ow.player.avatarUrl(id, 'head'));
  const touch = () => Boolean(ow.controls?.touch);
  const reduced = () => Boolean(ow.settings?.reducedMotion);
  const configureFx = () => fx.configure(ow.settings?.quality ?? 'high', reduced());
  configureFx();

  // ------------------------------------------------ canvas
  let W = 1;
  let H = 1;
  let pr = 1;
  const resize = () => {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    pr = ow.settings?.pixelRatio?.(2) ?? Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * pr);
    canvas.height = Math.round(H * pr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  };
  resize();
  window.addEventListener('resize', resize);
  try {
    ow.settings?.on?.('change', () => {
      if (stopped) return;
      configureFx();
      resize();
    });
  } catch {
    // ignore
  }
  // iPhones only start sound from a tap in the game: try on every kind of gesture
  const wake = () => audio.unlock();
  const WAKE = ['pointerup', 'touchend', 'click', 'keydown'];
  for (const t of WAKE) window.addEventListener(t, wake, { passive: true });

  // ------------------------------------------------ state this page keeps
  const net = createNet(ow, room);
  const input = createInput(canvas, ow);
  input.setWidth(() => W);
  const demo = new Demo();
  const me = makeRunner(meId, FIELD_W / 2, 1.5);
  const ev = newEvents();
  const L = {}; // this frame's light
  const IDLE = { c: 0, k: -1, tIn: 0, left: 0, fake: -1, turn: 0, wait: true };
  const tmp = { x: 0, y: 0, vx: 0, vy: 0, s: 0 };
  const shk = { x: 0, y: 0 };
  const cam = { y: 6 };
  const vises = new Map();
  const names = new Map();
  const pool = [];
  const chars = [];
  const others = [];
  const humans = [];
  const dots = [];
  const sc = { light: L, t: 0, ribbon: -1, chars, n: 0, tagOptions: { names: true } };
  const hud = { c: 0, lightAge: 1, turn: 0, round: 1, rounds: 1, secs: 0, place: 0, dots, watcherVisible: false, t: 0, spectating: false, lobby: false };

  let screen = withTitle ? 'title' : 'game';
  let prevMode = withTitle ? 'title' : 'lobby';
  let mode = prevMode;
  let closed = null; // why the room closed, once it has
  let rejoining = false;
  let clock = 0;
  let acc = 0;
  let lastTs = 0;
  let view = makeView(1, 1);
  let roster = null;
  let botsMap = {};
  let curRid = null;
  let lobbyEnter = 0;
  let ribbonAt = -1;
  let placePop = null;
  let finSeen = new Set();
  let boardSeen = null;
  let finalSeen = null;
  let savedMid = null;
  let lastFinalG = null;
  let results = null; // { g, at }
  let lastCountN = 0;
  let goPlayed = null;
  let bannerPlayed = null;
  let lightKey = '';
  let lightChangeAt = -9;
  let prevFake = -1;
  let prevMeS = S_RUN;
  let ranYet = false;
  let hadControls = null;
  let chipPress = null;
  let playPress = 0;
  let stats = { matches: 0, wins: 0, podiums: 0, catches: 0, best: 0 };
  let lastPresence = '';
  let lastPresenceAt = 0;
  let reported = new Set();

  Promise.resolve()
    .then(() => ow.save.get('stats'))
    .then((v) => {
      if (v && typeof v === 'object') for (const k of Object.keys(stats)) if (Number.isFinite(v[k])) stats[k] = v[k];
    })
    .catch(() => {});

  // ------------------------------------------------ who is who
  const info = {
    me: meId,
    name(id) {
      if (isBot(id)) return BOT_NAMES[botsMap[id]] ?? 'Bot';
      const p = room.players.get(id);
      if (p && typeof p.name === 'string' && p.name) names.set(id, p.name);
      return names.get(id) ?? 'Player';
    },
    color: (id) => colorOf(roster, id),
    face: (id) => hashStr(id),
    bot: isBot,
    avatar: (id) => (isBot(id) ? null : getAvatar(id)),
  };
  const visOf = (id) => {
    let v = vises.get(id);
    if (!v) {
      v = makeVis(id);
      v.prevS = S_RUN;
      v.dust = 0;
      v.stride = 0;
      vises.set(id, v);
    }
    return v;
  };
  function entry(i, id) {
    let e = pool[i];
    if (!e) e = pool[i] = { id: '', x: 0, y: 0, vx: 0, vy: 0, s: 0, color: '#fff', bot: false, avatar: null, mood: 'ok', away: false, alpha: 1, isMe: false, showYou: false, ready: false, name: '', face: 0, vis: null, hop: 0 };
    e.id = id;
    e.vis = visOf(id);
    e.bot = isBot(id);
    e.color = info.color(id);
    e.avatar = info.avatar(id);
    e.face = info.face(id);
    e.name = info.name(id);
    e.isMe = false;
    e.showYou = false;
    e.ready = false;
    e.away = false;
    e.hop = 0;
    e.alpha = 1;
    return e;
  }

  // ------------------------------------------------ helpers for this page's own character
  function spawnLobby() {
    const h = hashStr(meId);
    resetRunner(me, 1.5 + ((h % 1000) / 1000) * (FIELD_W - 3), 1.2 + (((h >>> 10) % 100) / 100) * 2);
    ribbonAt = -1;
    cam.y = me.y + 1.5;
  }

  function placeAtSlot(pv) {
    const xs = startPositions(pv.roster, pv.rs);
    if (xs[meId] === undefined) return;
    resetRunner(me, xs[meId], 0);
    fx.dust(me.x, 0.2, 4, 0.8);
    fx.ring(me.x, 0.2, '#ffffff', 1.4);
    cam.y = me.y + 1.5;
  }

  /** A new round: back on the line, unless this page reloaded mid-round and the room remembers where it was. */
  function enterRound(g) {
    curRid = g.rid;
    const xs = startPositions(g.roster, g.rs);
    resetRunner(me, xs[meId] ?? FIELD_W / 2, 0);
    const p = room.me.presence;
    const now = room.matchNow();
    if (p && typeof p === 'object' && p.n === g.n && p.m === matchTag(g.mid) && Number.isFinite(p.x) && Number.isFinite(p.y) && now > g.t0 + 400) {
      me.x = clamp(p.x, 0.4, FIELD_W - 0.4);
      me.y = clamp(p.y, 0, FIELD_LEN);
      const s = Math.round(p.s / 30);
      if (s === S_ZAP || s === S_ZIP) {
        me.s = S_ZIP;
        me.fromY = me.y;
        me.t = 0;
      }
    }
    if (g.fin[meId] !== undefined) {
      me.s = S_DONE;
      me.y = FIELD_LEN + 1.5;
      me.t = 5;
    } else if (g.out[meId] !== undefined) {
      me.s = S_GHOST;
      me.y = clamp(g.out[meId], 0, FIELD_LEN - 1.5);
    }
    finSeen = new Set(Object.keys(g.fin));
    ribbonAt = finSeen.size > 0 ? clock - 5 : -1;
    placePop = null;
    ranYet = false;
    fx.clear();
    for (const v of vises.values()) {
      v.prevS = S_RUN;
      v.q = 0;
      v.qv = 0;
    }
    cam.y = me.y + 1.5;
  }

  // ------------------------------------------------ the light for this frame
  /** The title and the closed card show the arena alive with the demo bots. */
  const attract = () => mode === 'title' || mode === 'closed';

  function computeLight(g, nowMs) {
    if (attract() || mode === 'lobby') return practiceLight(ow.now(), L);
    if (mode === 'round' && g) return net.lightFor(g, nowMs, L);
    Object.assign(L, IDLE);
    return L;
  }

  function lightEffects(live) {
    if (!live || L.wait) {
      lightKey = '';
      prevFake = -1;
      return;
    }
    const key = `${L.k}.${L.c}`;
    if (key !== lightKey) {
      lightKey = key;
      lightChangeAt = clock;
      if (!attract()) [audio.sfx.green, audio.sfx.yellow, audio.sfx.red][L.c]();
      if (L.c === 2 && mode === 'round') fx.shake(0.12);
    }
    if (L.fake >= 0 && prevFake < 0 && !attract()) audio.sfx.fake();
    prevFake = L.fake;
  }

  // ------------------------------------------------ building the scene
  /** Fills chars[0..n) with everyone except this page's own character, and `others` (for soft collisions) alike. Returns n. */
  function buildRemote(g, pv, nowMs) {
    let n = 0;
    let no = 0;
    const addOther = (e) => {
      let o = others[no];
      if (!o) o = others[no] = { id: '', x: 0, y: 0, on: true };
      o.id = e.id;
      o.x = e.x;
      o.y = e.y;
      o.on = e.s === S_RUN;
      no++;
    };
    if (attract()) {
      demo.bots.forEach((b, i) => {
        const e = entry(n++, b.id);
        e.x = b.r.x;
        e.y = b.r.y;
        e.vx = b.r.vx;
        e.vy = b.r.vy;
        e.s = b.r.s;
        e.color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        e.name = '';
        e.mood = L.c >= 1 ? 'scared' : 'ok';
      });
      others.length = 0;
      return n;
    }
    if (mode === 'lobby') {
      for (const p of room.players.values()) {
        if (p.id === meId) continue;
        const d = room.presenceAt(p.id, { snap: 20 });
        if (!d || typeof d !== 'object' || !Number.isFinite(d.x) || !Number.isFinite(d.y)) continue;
        const e = entry(n++, p.id);
        e.x = clamp(d.x, 0, FIELD_W);
        e.y = clamp(d.y, 0, 70);
        e.vx = Number.isFinite(d.vx) ? clamp(d.vx, -4, 4) : 0;
        e.vy = Number.isFinite(d.vy) ? clamp(d.vy, 0, 8) : 0;
        e.s = clamp(Math.round((Number.isFinite(d.s) ? d.s : 0) / 30), 0, 4);
        e.ready = Boolean(p.ready);
        e.away = p.connected === false;
        e.color = info.color(p.id);
        addOther(e);
      }
      others.length = no;
      return n;
    }
    // a match is starting or playing: the roster, from the record (or the preview until it arrives)
    const ros = pv.roster;
    const tag = matchTag(pv.mid);
    const xs = startPositions(ros, pv.rs);
    let bi = 0;
    for (const id of ros) {
      const bot = isBot(id);
      const idx = bot ? bi++ : -1;
      if (id === meId) continue;
      const e = entry(n, id);
      let ok = false;
      if (mode === 'countdown' || mode === 'wait') {
        e.x = xs[id] ?? FIELD_W / 2;
        e.y = 0;
        e.vx = 0;
        e.vy = 0;
        e.s = S_RUN;
        ok = true;
      } else if (bot) {
        ok = net.botAt(idx, pv.rid, nowMs - 140, tmp);
        if (ok) {
          e.x = clamp(tmp.x, 0, FIELD_W);
          e.y = clamp(tmp.y, 0, 70);
          e.vx = tmp.vx;
          e.vy = clamp(tmp.vy, 0, 8);
          e.s = clamp(tmp.s | 0, 0, 4);
        } else {
          e.x = xs[id] ?? FIELD_W / 2;
          e.y = 0;
          e.vx = 0;
          e.vy = 0;
          e.s = S_RUN;
          ok = true;
        }
      } else {
        const p = room.players.get(id);
        if (!p) continue; // left the room: nobody to draw
        const d = room.presenceAt(id, { snap: 20 });
        if (d && typeof d === 'object' && Math.round(d.n) === pv.n && Math.round(d.m) === tag && Number.isFinite(d.x) && Number.isFinite(d.y)) {
          e.x = clamp(d.x, 0, FIELD_W);
          e.y = clamp(d.y, 0, 70);
          e.vx = Number.isFinite(d.vx) ? clamp(d.vx, -4, 4) : 0;
          e.vy = Number.isFinite(d.vy) ? clamp(d.vy, 0, 8) : 0;
          e.s = clamp(Math.round((Number.isFinite(d.s) ? d.s : 0) / 30), 0, 4);
        } else {
          e.x = xs[id] ?? FIELD_W / 2;
          e.y = 0;
          e.vx = 0;
          e.vy = 0;
          e.s = S_RUN;
        }
        e.away = p.connected === false;
        ok = true;
      }
      if (!ok) continue;
      // finished and out, from the record, win over what the presence says
      if (pv.fin[id] !== undefined) {
        e.s = S_DONE;
        if (e.y < FIELD_LEN) e.y = FIELD_LEN + 1;
      } else if (pv.out[id] !== undefined && e.s === S_RUN) {
        e.s = S_GHOST;
      }
      n++;
      addOther(e);
    }
    others.length = no;
    return n;
  }

  /** The look of everyone: mood, remote reactions (zap, landing, finish), dust, stride. */
  function polish(n, dt, g, nowMs) {
    const live = (mode === 'round' && g && nowMs >= g.t0) || mode === 'lobby' || attract();
    for (let i = 0; i < n; i++) {
      const e = chars[i];
      const v = e.vis;
      e.mood = e.s === S_ZAP ? 'zap' : e.s === S_DONE ? 'happy' : e.s === S_GHOST ? 'ghost' : live && L.c >= 1 && !L.wait ? 'scared' : 'ok';
      if (!e.isMe && v.prevS !== e.s) {
        if (e.s === S_ZAP) {
          fx.sparks(e.x, e.y + 0.9, 8, '#ffe14a', 5);
          fx.text(e.x, e.y + 2.3, 'BZZT!', '#ff5b5b', Math.max(16, view.S * 0.6));
          if (!attract()) audio.sfx.zap(0.45);
        } else if (e.s === S_DONE) {
          fx.confetti(e.x, FIELD_LEN + 0.4, 18, 5);
          if (mode === 'round') audio.sfx.other();
        } else if (v.prevS === S_ZIP && e.s === S_RUN) {
          fx.smoke(e.x, 0.3, 3);
          bump(v, 0.3);
        } else if (e.s === S_GHOST && mode === 'round') audio.sfx.ghost();
        else if (e.s === S_ZIP && mode === 'round' && onScreen(e)) audio.sfx.zip();
      }
      v.prevS = e.s;
      animChar(v, e, dt);
      // dust while running, a big puff while skidding
      v.dust -= dt;
      if (e.s === S_RUN && v.dust <= 0) {
        if (v.skid > 0.4 && e.vy > 1.5) {
          fx.dust(e.x, e.y + 0.05, 3, 0.8);
          v.dust = 0.04;
        } else if (e.vy > 3) {
          fx.dust(e.x, e.y + 0.05, 1, 0.4);
          v.dust = 0.09;
        }
      }
      if (e.isMe && e.s === S_RUN && e.vy > 2) {
        const k = Math.floor(v.ph / Math.PI);
        if (k !== v.stride) {
          v.stride = k;
          audio.sfx.step();
        }
      }
    }
  }

  const onScreen = (e) => {
    const sy = view.base - (e.y - view.camY) * view.S;
    return sy > -view.S && sy < H + view.S;
  };

  // ------------------------------------------------ this page's own character
  function addMe(n, g, nowMs) {
    const e = entry(n, meId);
    e.isMe = true;
    e.x = me.x;
    e.y = me.y;
    e.vx = me.vx;
    e.vy = me.vy;
    e.s = me.s;
    e.color = info.color(meId);
    e.name = info.name(meId);
    e.ready = mode === 'lobby' && Boolean(room.me.ready);
    e.showYou = mode === 'lobby' ? clock - lobbyEnter < 3 : mode === 'round' && g ? nowMs - g.at < 3000 : false;
    return n + 1;
  }

  function onMeCaught() {
    net.reportCaught(me.y);
    audio.sfx.zap(1);
    fx.shake(0.4);
    fx.freeze(70);
    fx.flash('#ff3b3b', 0.35);
    fx.sparks(me.x, me.y + 0.9, 16, '#ffe14a', 6);
    fx.text(me.x, me.y + 2.3, 'BZZT!', '#ff5b5b', Math.max(20, view.S * 0.9));
    bump(visOf(meId), -0.25);
  }

  function onMeFinished(inLobby) {
    if (!inLobby) net.reportFinish();
    audio.sfx.finish();
    fx.confetti(me.x, FIELD_LEN + 0.4, 50);
    fx.shake(inLobby ? 0.1 : 0.25);
    fx.stars(me.x, FIELD_LEN + 0.6, 6);
    if (ribbonAt < 0) ribbonAt = clock;
  }

  function stepMe(dt, g, nowMs) {
    if (screen === 'title' || closed || room.spectating) return;
    let light = null;
    let simMode = 'back';
    let run = false;
    let steer = 0;
    if (mode === 'lobby') {
      light = L;
      simMode = 'practice';
      run = input.run();
      steer = input.steer();
    } else if (mode === 'round' && g && room.running && nowMs >= g.t0) {
      light = L;
      simMode = g.mode;
      run = input.run();
      steer = input.steer();
    }
    if (run) ranYet = true;
    clearEvents(ev);
    stepRunner(me, run, steer, dt, light, simMode, ev);
    separate(me, others, others.length);
    if (ev.buzz) {
      audio.sfx.buzz();
      fx.shake(0.12);
      fx.sparks(me.x, me.y + 0.9, 8, '#ffe14a', 4);
      fx.text(me.x, me.y + 2.2, 'BZZT!', '#ff5b5b', Math.max(18, view.S * 0.7));
    }
    if (ev.caught) onMeCaught();
    if (ev.finished) onMeFinished(mode === 'lobby');
    if (ev.returned) {
      audio.sfx.land();
      fx.smoke(me.x, 0.3, 5);
      bump(visOf(meId), 0.35);
    }
    if (ev.ghosted) audio.sfx.ghost();
    if (prevMeS === S_ZAP && me.s === S_ZIP) audio.sfx.zip();
    prevMeS = me.s;
    if (mode === 'lobby' && me.s === S_DONE && me.t > 1.6) {
      spawnLobby();
      fx.smoke(me.x, me.y, 4);
    }
  }

  function publish(g) {
    if (screen === 'title' || closed || room.spectating || mode === 'wait') return; // 'wait': keep the room's last word on where this page was
    const inMatch = g && (mode === 'round' || mode === 'board' || mode === 'final');
    const n = inMatch ? g.n : 0;
    const m = inMatch ? matchTag(g.mid) : 0;
    const x = Math.round(me.x * 100) / 100;
    const y = Math.round(me.y * 100) / 100;
    const vx = Math.round(me.vx * 10) / 10;
    const vy = Math.round(me.vy * 10) / 10;
    const key = `${x}|${y}|${vx}|${vy}|${me.s}|${n}|${m}`;
    const t = performance.now();
    if (key === lastPresence && t - lastPresenceAt < 1000) return;
    lastPresence = key;
    lastPresenceAt = t;
    room.setPresence({ x, y, vx, vy, s: me.s * 30, n, m });
  }

  // ------------------------------------------------ what happens when the record or the mode changes
  const idxIn = (g, id) => g.roster.indexOf(id);
  const myPlaceFin = (g) =>
    g.roster
      .filter((id) => g.fin[id] !== undefined)
      .sort((a, b) => g.fin[a] - g.fin[b] || idxIn(g, a) - idxIn(g, b))
      .indexOf(meId) + 1;

  function onRecord(g) {
    if (g.phase === 'round') {
      for (const id of Object.keys(g.fin)) {
        if (finSeen.has(id)) continue;
        finSeen.add(id);
        if (ribbonAt < 0) ribbonAt = clock;
        if (id === meId) {
          const place = myPlaceFin(g);
          placePop = { label: `${placeLabel(place)}!`, at: clock, place };
          audio.sfx.place(place);
          if (place === 1) {
            fx.shake(0.3);
            fx.flash('#ffd42a', 0.3);
          }
        }
      }
    } else if (g.phase === 'board' && boardSeen !== g.rid) {
      boardSeen = g.rid;
      audio.sfx.whoosh();
      reported.clear();
      if (g.roster.includes(meId)) {
        try {
          if (g.fin[meId] !== undefined && !(g.caught[meId] > 0)) ow.badges.award('statue')?.catch?.(() => {});
          if (photoFinish(g, meId)) ow.badges.award('photo-finish')?.catch?.(() => {});
        } catch {
          // badges are a bonus
        }
      }
    } else if (g.phase === 'final' && finalSeen !== g.mid) {
      finalSeen = g.mid;
      recordMatch(g);
    }
  }

  function recordMatch(g) {
    if (savedMid === g.mid || !g.roster.includes(meId) || !Array.isArray(g.final)) return;
    savedMid = g.mid;
    const place = g.final.indexOf(meId);
    const won = place === 0;
    const st = g.st[meId] ?? [0, 0, 0];
    stats = {
      matches: stats.matches + 1,
      wins: stats.wins + (won ? 1 : 0),
      podiums: stats.podiums + (place >= 0 && place < 3 ? 1 : 0),
      catches: stats.catches + (st[1] | 0),
      best: st[2] > 0 ? (stats.best > 0 ? Math.min(stats.best, st[2]) : st[2]) : stats.best,
    };
    try {
      Promise.resolve(ow.save.set('stats', stats)).catch(() => {});
      if (won) {
        ow.badges.award('first-win')?.catch?.(() => {});
        Promise.resolve(ow.leaderboards.submit('wins', stats.wins)).catch(() => {});
      }
      if (stats.matches >= 10) ow.badges.award('marathon')?.catch?.(() => {});
    } catch {
      // saving is a bonus too
    }
  }

  function onModeChange(from, to) {
    if (to === 'lobby') {
      spawnLobby();
      lobbyEnter = clock;
      fx.clear();
      curRid = null;
      if ((from === 'final' || from === 'board' || from === 'round') && lastFinalG) {
        results = { g: lastFinalG, at: clock };
        lastFinalG = null;
      }
      audio.setMood('menu');
    } else if (to === 'countdown' || to === 'wait') {
      if (from !== 'countdown' && from !== 'wait') {
        placeAtSlot(previewOf(room.match));
        lastCountN = 0;
        fx.clear();
        results = null;
        curRid = null;
      }
    } else if (to === 'final') {
      audio.setMood('results');
      fx.clear();
    } else if (to === 'title') {
      audio.setMood('menu');
    }
  }

  // ------------------------------------------------ controls and the lobby strip
  const LAYOUT = { stick: 'analog', buttons: [{ id: 'run', label: 'Run', key: ' ' }] };
  function applyControls() {
    const want = screen === 'game' && !closed && !room.spectating && (mode === 'lobby' || mode === 'countdown' || mode === 'wait' || mode === 'round');
    if (want === hadControls) return;
    hadControls = want;
    try {
      ow.controls.set(want ? LAYOUT : null);
    } catch {
      // ignore
    }
  }

  function enterGame() {
    if (screen !== 'title') return;
    audio.unlock();
    audio.sfx.click();
    screen = 'game';
    try {
      room.hideLobby(false);
    } catch {
      // ignore
    }
    lobbyEnter = clock;
    input.release();
  }

  function cycleSetting(id) {
    const s = SETTINGS.find((x) => x.id === id);
    if (!s) return;
    const values = s.options.map((o) => (typeof o === 'object' ? o.value : o));
    const cur = room.settings[id];
    const next = values[(Math.max(0, values.indexOf(cur)) + 1) % values.length];
    room.setSetting(id, next);
    chipPress = { id: id === 'rounds' ? 'set-rounds' : 'set-mode', at: clock };
    audio.sfx.click();
  }

  input.onTap((x, y) => {
    audio.unlock();
    const id = ui.hitTest(x, y);
    if (closed) {
      if (id === 'rejoin') rejoin();
      return true;
    }
    if (screen === 'title') {
      if (id === 'play' || room.match.phase !== 'lobby') {
        playPress = 1;
        enterGame();
      }
      return true;
    }
    if (id === 'set-rounds') cycleSetting('rounds');
    else if (id === 'set-mode') cycleSetting('mode');
    else return false;
    return true;
  });
  input.onKey((code) => {
    audio.unlock();
    if (closed) {
      if (code === 'Space' || code === 'Enter') rejoin();
    } else if (screen === 'title' && (code === 'Space' || code === 'Enter')) {
      playPress = 1;
      enterGame();
    } else if (screen === 'game' && code === 'Enter' && room.stub && room.match.phase === 'lobby') room.beginMatch();
  });
  try {
    ow.on?.('pause', () => !stopped && input.release());
  } catch {
    // ignore
  }
  const hideStrip = () => {
    try {
      room.hideLobby(true); // the title is up: no Ready strip yet
    } catch {
      // ignore
    }
  };
  if (screen === 'title') hideStrip();
  room.on('matchend', () => screen === 'title' && hideStrip()); // the strip comes back by itself when a match changes
  room.on('close', (reason) => {
    closed = typeof reason === 'string' ? reason : 'disconnected';
    hadControls = null;
    try {
      ow.controls.set(null);
    } catch {
      // ignore
    }
    input.release();
  });
  room.on('starting', () => {
    // a private server closes to newcomers while it plays: leave the door open for friends (who then watch until the next match)
    try {
      if (room.isHost && room.kind === 'private') room.setOpen(true);
    } catch {
      // ignore
    }
  });
  audio.setMood('menu');

  // ------------------------------------------------ the frame
  function frame(ts) {
    if (stopped) return;
    requestAnimationFrame(frame);
    try {
      tick(ts);
    } catch (e) {
      if (!frame.failed) {
        frame.failed = true;
        console.error(e);
        setTimeout(() => {
          throw e; // reported once, and the loop keeps running
        }, 0);
        setTimeout(() => (frame.failed = false), 5000);
      }
    }
  }

  function tick(ts) {
    const dtReal = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;
    clock += dtReal;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.globalAlpha = 1;
    ui.beginFrame();
    room.tick?.(); // only the local stand-in room has a clock to move along
    const phase = room.match.phase;
    const nowMs = room.matchNow();
    const g = closed ? null : net.g();
    mode = closed ? 'closed' : screen === 'title' ? 'title' : phase === 'lobby' ? 'lobby' : phase === 'starting' ? 'countdown' : g ? g.phase : 'wait';
    if (mode !== prevMode) {
      onModeChange(prevMode, mode);
      prevMode = mode;
    }
    if (mode === 'final') lastFinalG = g;

    // the record
    let pv = g;
    if (!g && (mode === 'countdown' || mode === 'wait')) pv = previewOf(room.match);
    if (attract() || mode === 'lobby') pv = null;
    if (g) {
      roster = g.roster;
      botsMap = g.bots;
      if (g.rid !== curRid) {
        if (g.roster.includes(meId) && !room.spectating) enterRound(g);
        else {
          curRid = g.rid;
          finSeen = new Set(Object.keys(g.fin));
          ribbonAt = finSeen.size > 0 ? clock - 5 : -1;
          fx.clear();
        }
      }
      onRecord(g);
    } else if (pv) {
      roster = pv.roster;
      botsMap = pv.bots;
    } else if (!attract() && mode !== 'lobby') {
      roster = null;
      botsMap = {};
    } else {
      roster = null;
      botsMap = {};
    }
    const iPlay = screen === 'game' && !closed && !room.spectating;

    // the light
    computeLight(g, nowMs);
    const lightLive = mode === 'lobby' || (mode === 'round' && nowMs >= g.t0 && room.running);
    lightEffects(lightLive);
    hud.c = L.c;
    hud.turn = L.turn;
    hud.lightAge = clock - lightChangeAt;
    sc.t = clock;
    audio.setMood(mood(g, nowMs));

    // everyone else, then this page's own character
    let n = 0;
    if (pv) n = buildRemote(g ?? pv, pv, nowMs);
    else if (attract() || mode === 'lobby') n = buildRemote(null, null, nowMs);

    if (iPlay) {
      if (fx.freezeT > 0) fx.freezeT -= dtReal;
      else {
        acc += dtReal;
        let steps = 0;
        while (acc >= STEP && steps < 8) {
          stepMe(STEP, g, nowMs);
          acc -= STEP;
          steps++;
        }
        if (steps === 8) acc = 0;
      }
    } else if (attract()) {
      acc += dtReal;
      let steps = 0;
      while (acc >= STEP && steps < 8) {
        demo.step(L);
        acc -= STEP;
        steps++;
      }
      if (steps === 8) acc = 0;
      for (const b of demo.buzzes) fx.sparks(b.x, b.y + 0.9, 6, '#ffe14a', 4);
    }
    if (iPlay) n = addMe(n, g, nowMs);
    sc.n = n;

    // the host steps the bots and shares them
    let nh = 0;
    for (let i = 0; i < n; i++) {
      const e = pool[i];
      chars[i] = e;
      if (!e.bot) {
        let h = humans[nh];
        if (!h) h = humans[nh] = { id: '', x: 0, y: 0, on: true };
        h.id = e.id;
        h.x = e.x;
        h.y = e.y;
        h.on = e.s === S_RUN;
        nh++;
      }
    }
    chars.length = n;
    if (!closed) net.hostFrame(humans, nh); // whoever is the host keeps the bots running, whatever screen it's on

    publish(g);
    polish(n, dtReal, g, nowMs);
    fx.update(dtReal);
    applyControls();

    // camera
    updateCamera(dtReal, n);
    render(g, pv, nowMs, dtReal);
  }

  function mood(g, nowMs) {
    if (mode === 'round' && g) return nowMs >= g.t0 && room.running && !L.wait ? ['green', 'yellow', 'red'][L.c] : 'green';
    if (mode === 'final') return 'results';
    return 'menu';
  }

  function updateCamera(dt, n) {
    let target = cam.y;
    if (attract()) {
      view = makeView(W, H, 0, 20);
      cam.y = clampCam(view, 999);
      view.camY = cam.y;
      return;
    }
    if (room.spectating) {
      let lead = 0;
      for (let i = 0; i < n; i++) if (chars[i].s !== S_GHOST) lead = Math.max(lead, chars[i].y);
      target = lead + 1.5;
    } else if (mode === 'board' || mode === 'final') target = cam.y;
    else target = me.y + 1.5;
    cam.y += (target - cam.y) * (1 - Math.exp(-7 * dt));
    view = makeView(W, H, 0, 14);
    view.camY = clampCam(view, cam.y);
  }

  // ------------------------------------------------ drawing
  function render(g, pv, nowMs, dt) {
    const o = fx.shakeOffset(shk);
    sc.ribbon = ribbonAt >= 0 ? clock - ribbonAt : -1;
    sc.tagOptions.names = !attract();
    sc.skipFx = mode === 'final';
    ctx.save();
    ctx.translate(o.x, o.y);
    drawScene(ctx, view, sc);
    ctx.restore();
    fx.drawFlash(ctx, W, H);

    const t = clock;
    const calm = reduced();
    switch (mode) {
      case 'title': {
        playPress = Math.max(0, playPress - dt * 6);
        ui.drawTitle(ctx, W, H, t, playPress, touch());
        break;
      }
      case 'closed': {
        ui.drawClosed(ctx, W, H, closed, t);
        break;
      }
      case 'lobby': {
        drawHud(g, nowMs, true);
        ui.drawLightWord(ctx, W, H, L.c, clock - lightChangeAt);
        ui.drawLobbyTop(ctx, W, H, t, {
          rounds: room.settings.rounds,
          mode: room.settings.mode,
          host: room.isHost,
          hint: true,
          pressed: chipPress && clock - chipPress.at < 0.15 ? chipPress.id : null,
        });
        if (room.stub) hudStubHint();
        if (results) {
          const age = clock - results.at;
          if (age > 9) results = null;
          else ui.drawResultsCard(ctx, W, H, results.g, age, 9, info);
        }
        break;
      }
      case 'countdown': {
        const left = Number.isFinite(room.match.startsAt) ? room.match.startsAt - ow.now() : 0;
        if (left > 0) {
          const nn = Math.max(1, Math.ceil(left / 1000));
          if (nn !== lastCountN) {
            lastCountN = nn;
            audio.sfx.count(nn);
          }
          ui.drawCountdown(ctx, W, H, left);
        }
        break;
      }
      case 'round': {
        if (!g) break;
        const sinceAt = nowMs - g.at;
        if (g.n === 1 && sinceAt >= 0 && sinceAt < GO_MS) {
          if (goPlayed !== g.rid) {
            goPlayed = g.rid;
            audio.sfx.go();
            fx.shake(0.1);
          }
          ui.drawGo(ctx, W, H, sinceAt / 1000);
        }
        if (nowMs >= g.t0 - BANNER_MS && nowMs < g.t0) {
          if (bannerPlayed !== g.rid) {
            bannerPlayed = g.rid;
            audio.sfx.banner();
          }
          ui.drawBanner(ctx, W, H, (nowMs - (g.t0 - BANNER_MS)) / 1000, BANNER_MS / 1000, g.n, g.rounds, g.mode);
        }
        const running = nowMs >= g.t0;
        if (running) {
          ui.drawLightFrame(ctx, W, H, L.c, t, calm);
          ui.drawLightWord(ctx, W, H, L.c, clock - lightChangeAt);
        }
        drawHud(g, nowMs, false);
        if (placePop) {
          const age = clock - placePop.at;
          if (age > 1.6) placePop = null;
          else ui.drawPlacePop(ctx, W, H, placePop.label, age, placePop.place);
        }
        if (!touch() && g.n === 1 && !ranYet && running && nowMs < g.t0 + 8000 && !room.spectating) ui.drawKeyHint(ctx, W, H, t);
        if (room.spectating) ui.drawWatching(ctx, W, H);
        break;
      }
      case 'board': {
        if (!g) break;
        ui.drawBoard(ctx, W, H, g, nowMs - g.at, info);
        triggerBoardSounds(g, nowMs - g.at);
        if (room.spectating) ui.drawWatching(ctx, W, H);
        break;
      }
      case 'final': {
        if (!g) break;
        podiumFx(g, nowMs - g.at);
        ui.drawPodium(ctx, W, H, g, nowMs - g.at, info, t);
        fx.draw(ctx, podiumView());
        break;
      }
      default:
        if (room.spectating) ui.drawWatching(ctx, W, H);
    }
  }

  function hudStubHint() {
    const s = ui.uiScale(W, H);
    ctx.font = `700 ${Math.round(15 * s)}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('Enter: start', W / 2, H - 96 * s);
  }

  function drawHud(g, nowMs, lobby) {
    hud.lobby = lobby;
    hud.t = clock;
    hud.spectating = room.spectating;
    const top = view.camY + view.base / view.S;
    hud.watcherVisible = top > 62;
    if (g && !lobby) {
      hud.round = g.n;
      hud.rounds = g.rounds;
      hud.secs = g.phase === 'round' ? (nowMs < g.t0 ? ROUND_LIMIT_MS / 1000 : (g.until - nowMs) / 1000) : 0;
      let k = 0;
      for (let i = 0; i < chars.length; i++) {
        const e = chars[i];
        let d = dots[k];
        if (!d) d = dots[k] = { y: 0, color: '#fff', me: false, dim: false };
        d.y = g.fin[e.id] !== undefined ? FIELD_LEN : e.y;
        d.color = e.color;
        d.me = e.isMe;
        d.dim = e.s === S_GHOST || e.away;
        k++;
      }
      dots.length = k;
      hud.place = room.spectating || g.phase !== 'round' || nowMs < g.t0 + 1500 ? 0 : placeOf(g);
    }
    ui.drawHUD(ctx, W, H, hud);
  }

  /** Where this page's character stands right now: finishers by time, then everyone else by how far they got. */
  function placeOf(g) {
    const prog = (e) => (g.fin[e.id] !== undefined ? 2000 - g.fin[e.id] / 1000 : g.out[e.id] !== undefined ? g.out[e.id] - 100 : e.s === S_DONE ? 1000 : e.y);
    let mine = null;
    for (const e of chars) if (e.isMe) mine = e;
    if (!mine) return 0;
    const mp = prog(mine);
    let better = 0;
    for (const e of chars) if (e !== mine && prog(e) > mp) better++;
    return better + 1;
  }

  function triggerBoardSounds(g, tms) {
    const marks = [1300, 1450, 1600, 1750];
    const key = g.rid;
    marks.forEach((m, i) => {
      const id = `${key}.${i}`;
      if (tms >= m && !reported.has(id)) {
        reported.add(id);
        audio.sfx.points(i);
      }
    });
    if (tms >= 2200 && !reported.has(`${key}.sort`)) {
      reported.add(`${key}.sort`);
      audio.sfx.whoosh();
    }
  }

  const podiumView = () => ({ W, H, S: 30, ox: 0, base: H, camY: 0 });
  function podiumFx(g, tms) {
    const key = `${g.mid}.final`;
    const at = (id, ms, fn) => {
      if (tms >= ms && !reported.has(`${key}.${id}`)) {
        reported.add(`${key}.${id}`);
        fn();
      }
    };
    const burst = (px, py, n) => fx.confetti(px / 30, (H - py) / 30, n, 9);
    at('r3', 200, () => audio.sfx.rise(0));
    at('r2', 700, () => audio.sfx.rise(1));
    at('r1', 1200, () => {
      audio.sfx.rise(2);
      audio.sfx.fanfare();
      fx.flash('#ffd42a', 0.3);
      burst(W * 0.2, H * 0.9, 50);
      burst(W * 0.8, H * 0.9, 50);
      burst(W * 0.5, H * 0.6, 40);
    });
    at('c2', 2300, () => {
      burst(W * 0.3, H * 0.9, 40);
      burst(W * 0.7, H * 0.9, 40);
    });
    at('c3', 3600, () => burst(W * 0.5, H * 0.9, 50));
  }

  /** The room closed: ask the platform for a new one and start over in it. */
  async function rejoin() {
    if (rejoining) return;
    rejoining = true;
    try {
      const next = await connect();
      if (next.room.stub) {
        rejoining = false; // the platform couldn't be reached: stay on the card, try again on the next tap
        return;
      }
      stopped = true;
      input.dispose();
      net.dispose();
      window.removeEventListener('resize', resize);
      for (const t of WAKE) window.removeEventListener(t, wake);
      runSession(next.ow, next.room, false);
    } catch {
      rejoining = false;
    }
  }

  requestAnimationFrame(frame);
}
