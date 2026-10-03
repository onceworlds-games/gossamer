// The game on this page: which screen is up, the season everyone shares, the night (run here as the host or
// mirrored), and what this player keeps in their own save. The room's match is the night; its lobby is the notebook.
import { platform, onPlatform } from './platform.js';
import { Renderer } from '../render/renderer.js';
import { Input } from './input.js';
import { NightRun } from './nightrun.js';
import { Screens } from './screens.js';
import { Audio } from '../audio/audio.js';
import { Hints } from './hints.js';
import { Coop } from '../net/coop.js';
import { makeBot, botTick } from '../sim/bots.js';
import { mix, hash } from '../sim/rng.js';
import { newSeason, parseSeason, ensureRoster, applyNight, buy, pickTrait, setSpecies, goEndless, eggsFor } from '../sim/season.js';
import { parseProfile, recordNight, recordSeason, checkUnlocks } from '../sim/profile.js';
import { tally } from '../sim/night.js';
import { packWorld, unpackWorld } from '../sim/codec.js';
import { SPECIES, GARDENS, TRAITS, T_SURFACE } from '../sim/data.js';

const DAWN_HOLD = 4.5;

export class Game {
  constructor({ room, join, test }) {
    this.room = room;
    this.joinOpts = join;
    this.test = test;
    this.screen = 'boot';
    this.run = null;
    this.attract = null;
    this.played = false;
    this.dawnT = 0;
    this.lastSave = 0;
    this.dirty = false;
    this.paused = false;
    this.handled = new Set();
  }

  get me() {
    return this.room.me?.id ?? 'local';
  }
  amHost() {
    return !!this.room.isHost && this.room.connected !== false;
  }
  solo() {
    return (this.room.online?.length ?? 1) <= 1;
  }
  season() {
    const raw = this.room.state?.season;
    if (raw !== this.seasonRaw) {
      this.seasonRaw = raw;
      this.seasonCache = parseSeason(raw);
    }
    return this.seasonCache;
  }

  async init() {
    const canvas = document.getElementById('view');
    this.ui = document.getElementById('ui');
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.screens = new Screens(this.ui, this);
    this.profile = parseProfile(await platform.save.get('profile'));
    this.savedSeason = parseSeason(await platform.save.get('season'));
    this.hints = new Hints(this.profile, () => this.markDirty());
    this.reduced = platform.settings.reducedMotion;
    document.body.classList.toggle('reduced', this.reduced);
    this.quality = this.pickQuality();
    platform.settings.on(() => {
      this.quality = this.pickQuality();
      this.reduced = platform.settings.reducedMotion;
      document.body.classList.toggle('reduced', this.reduced);
      this.resize();
    });
    addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush(true);
    });
    // Sound starts from a tap or key inside the game (iPhones insist).
    const wake = () => this.audio.unlock();
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    platform.on('pause', () => this.pause(true));
    platform.on('resume', () => this.pause(false));
    this.net = new Coop(this.room, this);
    this.bindRoom();
    this.makeAttract();
    if (this.room.match?.phase === 'playing' || this.room.match?.phase === 'starting') {
      this.played = true;
      this.enterNight();
    } else this.showTitle();
    if (this.test) this.autopilot();
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    const pr = platform.settings.pixelRatio(2) * ({ low: 0.7, medium: 0.85, high: 1 }[this.quality] ?? 1);
    this.renderer.resize(w, h, pr);
  }

  /**
   * Quality: a fixed choice in the platform menu is a ceiling; with Auto this page decides from its own frame times
   * (down quickly when frames are slow, back up slowly when they're quick).
   */
  pickQuality() {
    const choice = platform.settings.choice;
    if (choice === 'low' || choice === 'medium' || choice === 'high') return choice;
    return this.autoQ ?? 'high';
  }

  govern(dt) {
    if (platform.settings.choice !== 'auto' && platform.settings.choice) return;
    this.slowT = (this.slowT ?? 0) + (dt > 1 / 28 ? dt : -dt * 0.5);
    this.quickT = dt < 1 / 50 ? (this.quickT ?? 0) + dt : 0;
    const order = ['low', 'medium', 'high'];
    let i = order.indexOf(this.quality);
    if (this.slowT > 2 && i > 0) i--;
    else if (this.quickT > 8 && i < 2) i++;
    else return;
    this.slowT = 0;
    this.quickT = 0;
    this.autoQ = order[i];
    this.quality = order[i];
    this.resize();
  }

  bindRoom() {
    const r = this.room;
    r.on('starting', () => {
      this.screens.closeBook(true);
      this.audio.ui('start');
    });
    r.on('matchstart', () => this.enterNight());
    r.on('matchend', () => this.afterNight());
    r.on('host', () => this.net.hostChanged());
    r.on('reconnect', () => this.net.hostChanged());
    r.on('state', (key) => {
      if (key === 'season' || key === 'result') this.screens.refresh();
      if (key === 'night' && this.screen === 'night' && !this.run) this.enterNight();
    });
    r.on('join', () => this.screens.refresh());
    r.on('leave', () => this.screens.refresh());
    r.on('rename', () => this.screens.refresh());
    r.on('ready', () => this.screens.refresh());
    r.on('close', (reason) => this.closed(reason));
    r.on('match', () => {
      // Let in at dusk: a watcher becomes a player without reloading.
      if (this.screen === 'night' && this.run && !this.run.myId && r.match?.participants?.includes(this.me) && !r.spectating) this.enterNight();
    });
    r.on('matchpause', () => (this.paused = true));
    r.on('matchresume', () => (this.paused = false));
    r.on('message', (data, from, at) => this.net.message(data, from, at));
  }

  // ---------------------------------------------------------------- screens
  showTitle() {
    this.screen = 'title';
    platform.controls.set(null);
    this.room.hideLobby?.(true);
    this.input.enabled = false;
    this.screens.title(() => this.play());
  }

  play() {
    this.audio.unlock();
    this.played = true;
    if (this.room.match?.phase === 'playing') return this.enterNight();
    this.showBook();
  }

  showBook() {
    this.screen = 'book';
    this.run = null;
    platform.controls.set(null);
    this.room.hideLobby?.(false);
    this.input.enabled = false;
    if (this.amHost()) this.hostEnsureSeason();
    this.requestRoster();
    this.screens.book();
  }

  closed(reason) {
    this.screen = 'closed';
    this.run = null;
    platform.controls.set(null);
    this.input.enabled = false;
    this.screens.closed(reason, async () => {
      this.room = await platform.join(this.joinOpts);
      this.net = new Coop(this.room, this);
      this.seasonRaw = undefined;
      this.bindRoom();
      if (this.room.match?.phase === 'playing') this.enterNight();
      else this.showBook();
    });
  }

  pause(on) {
    // Alone, the platform menu pauses the night; with friends it keeps running.
    if (this.screen !== 'night' || !this.run) return;
    if (this.solo() && this.amHost() && this.room.match?.phase === 'playing') {
      this.room.pauseMatch?.(on);
      this.paused = on;
    }
  }

  // ---------------------------------------------------------------- the season (host)
  hostEnsureSeason() {
    if (!this.amHost()) return;
    let s = this.season();
    if (!s) {
      const saved = this.savedSeason && !this.savedSeason.over ? this.savedSeason : null;
      s = saved ?? newSeason({ mode: this.profile.tutorial ? 'season' : 'tutorial', seed: (Date.now() ^ hash(this.me)) >>> 0 });
      // Local checks only (?test&night=7&garden=reed&sp=jumper): start a season further on.
      const q = this.test ? new URLSearchParams(location.search) : null;
      if (q?.get('night')) {
        s.mode = 'season';
        s.night = Math.max(1, Math.min(20, Number(q.get('night')) || 1));
      }
      if (q?.get('garden') && GARDENS[q.get('garden')]) s.garden = q.get('garden');
      if (q?.get('sp') && SPECIES[q.get('sp')]) this.profile.lastSpecies = q.get('sp');
      const hatch = this.profile.hatchlings.shift();
      ensureRoster(s, this.me, this.profile.lastSpecies ?? 'orb', { trait: hatch });
      if (hatch) this.markDirty();
      this.writeSeason(s);
    }
  }

  writeSeason(s) {
    this.room.setState('season', JSON.parse(JSON.stringify(s)));
    this.seasonRaw = undefined;
    if (this.amHost()) {
      platform.save.set('season', s);
      this.savedSeason = s;
    }
    this.screens.refresh();
  }

  /** A request about the season from a player (ourselves or a friend). Only the host applies it. */
  request(from, req) {
    if (!this.amHost()) return this.net.ask(req);
    const s = this.season();
    if (!s || !req || typeof req !== 'object') return;
    const lobby = this.room.match?.phase === 'lobby';
    let changed = false;
    switch (req.t) {
      case 'join':
        if (!s.roster[from]) {
          ensureRoster(s, from, SPECIES[req.sp] ? req.sp : 'orb', { trait: typeof req.hatch === 'string' ? req.hatch : null });
          changed = true;
        }
        break;
      case 'species':
        changed = lobby && setSpecies(s, from, String(req.sp));
        break;
      case 'buy':
        changed = lobby && buy(s, from, String(req.up));
        break;
      case 'trait':
        changed = lobby && pickTrait(s, from, String(req.tr));
        break;
      case 'hatch':
        // A friend's hatchling: its trait is pinned at a fresh season's start.
        if (lobby && s.night === 1 && !s.history.length && s.roster[from] && !s.roster[from].tr.length && TRAITS[req.tr]) {
          s.roster[from].tr = [String(req.tr)];
          changed = true;
        }
        break;
      case 'garden':
        if (from === this.me && lobby && s.night === 1 && !s.history.length && GARDENS[req.g] && this.profile.unlocked.gardens.includes(req.g)) {
          s.garden = req.g;
          changed = true;
        }
        break;
      case 'cold':
        if (from === this.me && lobby && s.night === 1 && !s.history.length) {
          s.cold = Math.max(0, Math.min(this.profile.cold, req.v | 0));
          s.lives = 3 - (s.cold >= 5 ? 1 : 0);
          changed = true;
        }
        break;
      case 'endless':
        changed = from === this.me && lobby && goEndless(s);
        break;
      case 'newseason':
        if (from === this.me && lobby && (s.over || (req.start && s.night === 1 && !s.history.length))) {
          const fresh = newSeason({ mode: req.daily ? 'daily' : 'season', garden: req.daily ? req.daily.garden : s.garden, cold: s.cold, seed: req.daily ? req.daily.seed : (Date.now() ^ hash(this.me)) >>> 0, daily: req.daily ?? null });
          for (const [id, r] of Object.entries(s.roster)) {
            if (!this.room.players.has(id)) continue;
            ensureRoster(fresh, id, r.sp, { trait: id === this.me ? this.profile.hatchlings.shift() : null });
          }
          this.room.clearReady?.();
          this.writeSeason(fresh);
          return;
        }
        break;
      default:
        break;
    }
    if (changed) {
      if (req.t === 'garden' || req.t === 'cold') this.room.clearReady?.();
      this.writeSeason(s);
    }
  }

  /** Our hatchling: ask the host to pin it when a fresh season starts without it, and use it up once it's pinned. */
  syncHatchling() {
    const s = this.season();
    const hatch = this.profile.hatchlings[0];
    if (!s || !hatch || s.night !== 1 || s.history.length) return;
    const mine = s.roster[this.me];
    if (!mine) return;
    if (mine.tr.includes(hatch)) {
      this.profile.hatchlings.shift();
      this.markDirty();
    } else if (!mine.tr.length && this.hatchAsked !== s.seed && this.room.match?.phase === 'lobby') {
      this.hatchAsked = s.seed;
      this.request(this.me, { t: 'hatch', tr: hatch });
    }
  }

  requestRoster() {
    const s = this.season();
    if (s && s.roster[this.me]) return;
    this.request(this.me, { t: 'join', sp: this.profile.lastSpecies ?? 'orb', hatch: this.profile.hatchlings[0] ?? null });
  }

  /** Seed of a season's night: known ahead, so the notebook can forecast it. */
  nightSeed(s) {
    if (s.mode === 'daily' && s.daily?.seed) return s.daily.seed;
    return mix(s.seed, s.night * 7919);
  }

  nightConfig(s, players) {
    return { seed: this.nightSeed(s), night: s.mode === 'daily' ? 5 : s.night, garden: s.garden, cold: s.cold, mode: s.mode, players };
  }

  // ---------------------------------------------------------------- the night
  enterNight() {
    this.audio.unlock();
    const m = this.room.match;
    if (!m || (m.phase !== 'playing' && m.phase !== 'starting')) return;
    this.screen = 'night';
    this.screens.closeBook(false);
    this.room.hideLobby?.(false);
    if (m.phase === 'starting') return;
    const rec = this.room.state?.night;
    if (this.amHost()) {
      if (rec && rec.mid === m.id) this.adopt(rec);
      else this.beginNight();
    } else if (rec && rec.mid === m.id) this.mirror(rec);
    else this.run = null; // the host's record is on its way
    this.input.enabled = !!this.run && !this.room.spectating;
    this.setControls();
  }

  beginNight() {
    const m = this.room.match;
    let s = this.season();
    if (!s) {
      this.hostEnsureSeason();
      s = this.season();
    }
    const players = (m.participants ?? [this.me]).map((id) => {
      const r = ensureRoster(s, id, 'orb');
      return { id, sp: r.sp, up: r.up, tr: r.tr, silk: r.silk ?? undefined };
    });
    const cfg = this.nightConfig(s, players);
    const rec = { mid: m.id, cfg, by: this.me, at: 0 };
    this.room.setState('night', rec);
    for (const k of ['ck', 'ckn', 'ckt', 'ckp', 'result']) this.room.setState(k, null);
    this.run = new NightRun(cfg, { role: 'host', myId: m.participants?.includes(this.me) || !m.participants ? this.me : null, renderer: this.renderer, audio: this.audio, onEvent: (e) => this.onNightEvent(e) });
    this.net.startHosting(this.run);
    this.audio.night(this.run.world);
    this.hints.nightStart(this.run, s);
    this.botFor(this.run);
  }

  /** ?test=bot: a bot plays our own spider (for smoke tests that need a lively night). */
  botFor(run) {
    if (this.test !== 'bot' || !run.myId) return;
    const bot = makeBot(run.world, run.myId, 'good');
    run.bots = [{ id: run.myId, tick: (w, dt) => botTick(w, bot, dt) }];
  }

  /** Taking over a night that is already under way (a reload, or the host role moved to us). */
  adopt(rec) {
    const ck = this.checkpointOf(rec.mid);
    const myId = this.room.match.participants?.includes(this.me) ? this.me : null;
    this.run = new NightRun(rec.cfg, { role: 'host', myId, renderer: this.renderer, audio: this.audio, onEvent: (e) => this.onNightEvent(e) });
    if (ck) unpackWorld(this.run.world, ck, this.net.poses());
    this.room.setState('night', { ...rec, by: this.me });
    this.net.startHosting(this.run);
    this.audio.night(this.run.world);
    this.botFor(this.run);
  }

  mirror(rec) {
    const myId = this.room.match.participants?.includes(this.me) && !this.room.spectating ? this.me : null;
    this.run = new NightRun(rec.cfg, { role: 'mirror', myId, renderer: this.renderer, audio: this.audio, send: (c) => this.net.command(c), onEvent: (e) => this.onNightEvent(e) });
    const ck = this.checkpointOf(rec.mid);
    if (ck) unpackWorld(this.run.world, ck, null, myId);
    this.net.startMirror(this.run);
    this.audio.night(this.run.world);
  }

  /** The latest checkpoint for this night, put back together from its three room-state values. */
  checkpointOf(mid) {
    const st = this.room.state ?? {};
    const a = st.ck;
    const n = st.ckn;
    const t = st.ckt;
    const p = st.ckp;
    if (!a || a.mid !== mid || !a.meta) return null;
    return { meta: { ...a.meta, prey: p?.mid === mid ? p.prey : [], swarms: p?.mid === mid ? p.swarms : [], wasps: p?.mid === mid ? p.wasps : [] }, n: n?.mid === mid ? n.n : '', t: t?.mid === mid ? t.t : '' };
  }

  onNightEvent(e) {
    this.net.share(e);
    if (e.k === 'ping') this.net.ping(e.x, e.y);
    this.hints.event(e, this.run);
    const mine = e.id === this.me;
    if (!mine) return;
    // Badges that happen in the moment.
    if (e.k === 'eat') this.award('first-catch');
    if (e.k === 'orbdone' && !e.partial) this.award('orb-complete');
    if (e.k === 'perfect') this.award('perfect-radials');
    if (e.k === 'eat' && e.sp === 'beetle' && e.clean) this.award('beetle-buster');
  }

  setControls() {
    const me = this.run?.me();
    if (!me || this.room.spectating || this.screen !== 'night') return platform.controls.set(null);
    const act = this.run.actLabel();
    const type = this.run.type === 4 ? ({ orb: 'Orb', ladder: 'Ladder', funnel: 'Funnel', dense: 'Close orb' }[this.run.pattern ?? 'orb'] ?? 'Orb') : ['Frame', 'Radial', 'Sticky', 'Alarm'][this.run.type];
    const key = `${me.sp}:${act}:${type}`;
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    const layouts = {
      orb: [{ id: 'act', label: act, key: 'e' }, { id: 'leap', label: 'Leap', key: ' ' }, { id: 'type', label: type, key: 't' }, { id: 'cut', label: 'Cut', key: 'x' }],
      jumper: [{ id: 'leap', label: 'Pounce', key: ' ' }, { id: 'bite', label: 'Bite', key: 'f' }, { id: 'act', label: act, key: 'e' }, { id: 'run', label: 'Run', key: 'Shift' }],
      bolas: [{ id: 'spin', label: 'Swing', key: 'b' }, { id: 'lure', label: 'Lure', key: 'l' }, { id: 'act', label: act, key: 'e' }, { id: 'leap', label: 'Leap', key: ' ' }],
    };
    platform.controls.set({ stick: 'analog', buttons: layouts[me.sp] ?? layouts.orb });
  }

  /** Host: dawn came. Hold the dawn a moment, then tally, update the season and end the match. */
  finishNight() {
    const run = this.run;
    const s = this.season();
    if (!run || !s || !this.amHost()) return;
    const t = tally(run.world);
    const ids = run.world.spiders.map((sp) => sp.id);
    const out = applyNight(s, t, ids, run.world.seed);
    const result = { mid: this.room.match.id, t, out, season: { night: s.night, lives: s.lives, over: s.over, score: s.score, mode: s.mode } };
    this.room.setState('result', result);
    this.writeSeason(s);
    for (const k of ['ck', 'ckn', 'ckt', 'ckp']) this.room.setState(k, null);
    this.room.endMatch();
  }

  afterNight() {
    this.net.stop();
    this.run = null;
    this.input.enabled = false;
    platform.controls.set(null);
    this.controlsKey = '';
    this.audio.dawn();
    this.takeResult();
    if (this.played) this.showBook();
    else this.showTitle();
  }

  /** Everyone: fold the night into our own save, once per night. */
  takeResult() {
    const res = this.room.state?.result;
    if (!res || this.handled.has(res.mid)) return;
    this.handled.add(res.mid);
    const per = res.t?.per?.[this.me];
    const s = this.season();
    if (!per) return;
    const sp = per.sp ?? 'orb';
    const badges = recordNight(this.profile, per, res.t, sp, s);
    if (res.t.mode === 'tutorial' || (s && s.history.length >= 1)) this.profile.tutorial = true;
    this.profile.lastSpecies = sp;
    for (const b of badges) this.award(b);
    if (res.t.mantisOff) {
      this.profile.stats.mantis++;
      this.award('mantis-off');
    }
    if (res.t.mode === 'daily') {
      this.profile.stats.dailies++;
      this.award('daily-weaver');
      const today = s?.daily?.date ?? '';
      if (this.profile.best.daily.date !== today || this.profile.best.daily.score < res.t.food) this.profile.best.daily = { date: today, score: res.t.food };
      platform.submit('daily-garden', Math.round(res.t.food));
    }
    platform.submit('biggest-catch', Math.round(per.food));
    const unlocked = checkUnlocks(this.profile);
    this.unlockedNow = unlocked;
    if (s?.over && s.over !== false) {
      const eggs = eggsFor(s);
      recordSeason(this.profile, s, sp, eggs);
      this.eggsNow = eggs;
      if (s.over === 'won') this.award('ten-nights');
      platform.submit('season-score', s.score);
      if (s.mode === 'endless') platform.submit('endless-nights', s.night - 10);
    }
    if (res.season?.mode === 'endless') platform.submit('endless-nights', Math.max(0, res.season.night - 11));
    this.markDirty();
    this.flush(true);
  }

  award(id) {
    this.awarded ??= new Set();
    if (this.awarded.has(id)) return;
    this.awarded.add(id);
    platform.award(id);
  }

  markDirty() {
    this.dirty = true;
  }

  flush(now = false) {
    const t = performance.now();
    if (!this.dirty || (!now && t - this.lastSave < 4000)) return;
    this.dirty = false;
    this.lastSave = t;
    platform.save.set('profile', this.profile);
  }

  // ---------------------------------------------------------------- per frame
  makeAttract() {
    // The title's garden is the cover's night: a full, even orb on the main lane, dewy, with a spider that lives in
    // it (a bot) while the night goes on.
    const cfg = { seed: 253408, night: 5, garden: 'cottage', mode: 'practice', players: [{ id: 'attract', sp: 'orb', up: { strong: 2 } }] };
    this.attract = new NightRun(cfg, { role: 'host', myId: null, renderer: this.renderer, audio: null });
    const w = this.attract.world;
    // Prey and weather only: no hunters on the title.
    w.script.events = w.script.events.filter((e) => !['wasp', 'wren', 'mantis', 'gust', 'gustwarn'].includes(e.k));
    const sp = w.spiders[0];
    const mods = { ...sp.mods };
    Object.assign(sp.mods, { maxSilk: 400, range: 2000 });
    sp.silk = 400;
    w.cmds.push({ id: 'attract', t: 'orb', x: 479, y: 429, r: 115, p: 'orb' });
    for (let i = 0; i < 60 * 9; i++) this.attract.update(1 / 60, { mx: 0, my: 0 });
    Object.assign(sp.mods, mods);
    sp.silk = Math.min(sp.silk, sp.mods.maxSilk);
    const web = w.web;
    for (let s = 0; s < web.threadHigh; s++) if (web.tid[s] >= 0 && web.type[s] !== T_SURFACE) web.dew[s] = Math.min(40, (web.len[s] / 7) * 0.5);
    const bot = makeBot(w, 'attract', 'good');
    this.attract.bots = [{ id: 'attract', tick: (wd, dt) => botTick(wd, bot, dt) }];
    for (let i = 0; i < 60 * 4; i++) this.attract.update(1 / 60, { mx: 0, my: 0 });
    w.out.length = 0;
  }

  frame(dt) {
    const t0 = performance.now();
    this.govern(dt);
    this.frameWork(dt);
    // Smoothed cost of a frame (ms) and the frame rate, for the autopilot hook and adaptive effects.
    this.cost = (this.cost ?? 8) * 0.95 + (performance.now() - t0) * 0.05;
    this.fps = (this.fps ?? 60) * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  }

  frameWork(dt) {
    const move = this.input.poll(dt);
    const events = this.input.take();
    const cam = this.renderer.cam;
    const toWorld = (sx, sy) => cam.toWorld(sx, sy);
    for (const e of events) if (e.t === 'zoom') cam.user = Math.max(0.55, Math.min(2.4, cam.user * (e.d > 0 ? 0.88 : 1.14)));
    // Looking around: a right-drag or two fingers move the view; it drifts back to the spider after.
    const pan = this.input.pan;
    cam.look(pan.x - (this.panSeen?.x ?? pan.x), pan.y - (this.panSeen?.y ?? pan.y), pan.active, dt);
    this.panSeen = { x: pan.x, y: pan.y };
    this.net.frame(dt);
    if (this.amHost() && this.screen === 'book') this.hostEnsureSeason();
    if (this.screen === 'book') this.syncHatchling();
    const run = this.screen === 'night' && this.run ? this.run : null;
    if (run) {
      const playing = this.room.match?.phase === 'playing' && !this.room.match?.paused && !this.paused;
      if (!this.room.spectating && run.me()) run.intents(events, toWorld);
      if (playing) run.update(dt, this.room.spectating ? { mx: 0, my: 0 } : move);
      if (this.amHost() && run.role === 'host' && run.world.done) {
        this.dawnT += dt;
        if (this.dawnT > DAWN_HOLD) {
          this.dawnT = 0;
          this.finishNight();
        }
      } else this.dawnT = 0;
      this.setControlsThrottled(dt);
      this.drawNight(run, dt);
    } else {
      this.attract?.update(dt, { mx: 0, my: 0 });
      this.drawAttract(dt);
    }
    this.audio.frame(dt, run?.world ?? this.attract?.world, run?.me(), cam, this.screen);
    this.screens.frame(dt);
    this.flush();
  }

  setControlsThrottled(dt) {
    this.ctlT = (this.ctlT ?? 0) - dt;
    if (this.ctlT > 0) return;
    this.ctlT = 0.25;
    this.setControls();
    const cam = this.renderer.cam;
    this.screens.zoom(platform.controls.touch && this.screen === 'night', () => (cam.user = Math.min(2.4, cam.user * 1.2)), () => (cam.user = Math.max(0.55, cam.user / 1.2)));
  }

  drawNight(run, dt) {
    const w = run.world;
    const touch = platform.controls.touch;
    let pointer = this.input.aiming ?? (this.input.pointer.mouse && this.input.pointer.in ? this.input.pointer : null);
    const toWorld = (sx, sy) => this.renderer.cam.toWorld(sx, sy);
    run.charge = this.input.charging ? this.input.charge : undefined;
    // Charging a pounce or swinging the bolas on touch: aim along the stick (or at the last tap).
    const me = run.me();
    if (!pointer && me && (this.input.charging || this.input.spinning)) {
      const st = platform.controls.stick;
      const s = this.renderer.cam.toScreen(me.x, me.y);
      if (Math.hypot(st.x, st.y) > 0.3) pointer = { x: s.x + st.x * 160, y: s.y + st.y * 160 };
      else if (this.input.lastTap) pointer = this.input.lastTap;
    }
    const aim = pointer ? run.aim(pointer.x, pointer.y, toWorld, !!this.input.aiming || touch || this.input.charging) : null;
    const dawn = w.phase === 'dawn' ? Math.min(1, this.dawnT / 3) : 0;
    const hint = this.hints.current(run);
    this.renderer.draw({
      world: w,
      me: run.myId,
      spiders: this.net.drawSpiders(run),
      prey: this.net.drawPrey(run),
      t: run.t,
      dt,
      q: this.quality,
      focus: run.focusPoint(),
      reduced: this.reduced,
      aim,
      hud: run.hud(touch, { watching: this.room.spectating || !run.myId, mates: this.net.mates(run), hint: hint?.text, hintA: hint?.a ?? 0 }),
      gauges: run.gauges(),
      timers: (run.me()?.mods?.eyes ?? 0) >= 3,
      sense: run.feel(),
      pings: run.pings,
      silk: this.profile.equip.colour,
      dewStyle: this.profile.equip.dew,
      mist: w.weather.mist ? 0.8 : 0,
      dawn,
      webAlpha: 1 - dawn * 0.5,
      spin: this.input.spinning ? this.input.spin : undefined,
    });
    this.drawLoupe(aim);
  }

  drawAttract(dt) {
    const run = this.attract;
    if (!run) return;
    // Frame the orb beside the title on wide screens and above it on tall ones; its spider comes and goes.
    const cam = this.renderer.cam;
    const wide = cam.sw > cam.sh;
    const ox = (wide ? -0.28 * cam.sw : 0) / cam.z;
    const oy = (wide ? -0.02 * cam.sh : -0.25 * cam.sh) / cam.z;
    this.renderer.draw({
      world: run.world,
      me: null,
      spiders: run.world.spiders,
      t: run.t,
      dt,
      q: this.quality,
      focus: { x: 479 - ox, y: 429 - oy, vx: 0, vy: 0 },
      box: null,
      reduced: this.reduced,
      hud: null,
      silk: this.profile?.equip.colour,
      dim: this.screen === 'book' ? 0.25 : 0.1,
    });
  }

  /** On touch, a held finger shows a magnified circle above it with the target, so threads land true. */
  drawLoupe(aim) {
    const a = this.input.aiming;
    if (!a || !a.touch || performance.now() - a.t0 < 220 || !aim) return;
    const ctx = this.renderer.ctx;
    const pr = this.renderer.pr;
    const R = 54;
    let lx = a.x;
    let ly = a.y - 90;
    if (ly < R + 10) ly = a.y + 90;
    lx = Math.max(R + 6, Math.min(this.renderer.cam.sw - R - 6, lx));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.arc(lx * pr, ly * pr, R * pr, 0, Math.PI * 2);
    ctx.clip();
    const src = (R / 2) * pr;
    ctx.drawImage(this.renderer.canvas, a.x * pr - src, a.y * pr - src, src * 2, src * 2, (lx - R) * pr, (ly - R) * pr, R * 2 * pr, R * 2 * pr);
    ctx.restore();
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.strokeStyle = 'rgba(230, 238, 232, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(lx, ly, R, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- the ?test autopilot (local checks only)
  autopilot() {
    window.__gossamer = this;
  }
}

export { onPlatform };
