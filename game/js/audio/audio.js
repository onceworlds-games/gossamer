// Sound, all made here with Web Audio. The web is an instrument: every touch plucks a string whose pitch follows the
// thread's length and tightness, snapped to a pentatonic scale so the night always sounds like music (long frame
// threads boom low, gnats are glitter). Around it: crickets, wind in the leaves, rain, an owl far off, the wasp's
// buzz bending as it passes, the wren's alarm call, and a glass pad that darkens when something hunts you.
// One compressor on the master keeps it from clipping. The platform sets the volume and mute.
import { PREY, T_FRAME, T_RADIAL, T_STICKY, T_ALARM, T_DRAG, THREADS } from '../sim/data.js';
import { voiceBuffer, noiseBuffer, NOTES, noteFreq } from './voices.js';

const MAX_PLUCKS = 14;

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.plucks = [];
    this.lastNote = new Map();
    this.wasps = new Map();
    this.t = 0;
    this.owlT = 20;
    this.motifT = 6;
    this.danger = 0;
    this.chord = 0;
    this.chordT = 0;
    this.listener = { x: 800, y: 500, w: 800 };
  }

  /** First tap in the game: make (or wake) the context. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.ready = true;
    } catch {
      this.ctx = null;
    }
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 1;
    // Squeezed when a lot rings at once, then rounded off just under full scale: it can't clip, however many strings go.
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const round = c.createWaveShaper();
    round.curve = roundOff();
    this.master.connect(comp).connect(round).connect(c.destination);
    this.sfx = gain(c, 0.9, this.master);
    this.webBus = gain(c, 1.5, this.master);
    this.amb = gain(c, 0.55, this.master);
    this.music = gain(c, 0.0, this.master);
    // A short glassy echo on the web, so a pluck rings in the garden.
    const d = c.createDelay(1);
    d.delayTime.value = 0.19;
    const fb = gain(c, 0.28, null);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.webBus.connect(d);
    d.connect(lp).connect(fb).connect(d);
    lp.connect(gain(c, 0.35, this.master));
    this.noise = noiseBuffer(c, 2);
    this.ambience();
    this.pad();
  }

  // ---------------------------------------------------------------- ambience: crickets, wind, rain, water
  ambience() {
    const c = this.ctx;
    // Crickets: a high tone, trilled fast and chirped slow, a few at different rates and places.
    this.crickets = gain(c, 0.0, this.amb);
    for (let i = 0; i < 4; i++) {
      const o = c.createOscillator();
      o.frequency.value = 4100 + i * 230;
      const trill = c.createOscillator();
      trill.frequency.value = 24 + i * 3.3;
      const tg = gain(c, 0.5, null);
      trill.connect(tg.gain);
      const chirp = c.createOscillator();
      chirp.type = 'square';
      chirp.frequency.value = 1.1 + i * 0.37;
      const cg = c.createGain();
      cg.gain.value = 0.5;
      chirp.connect(cg.gain);
      const pan = c.createStereoPanner();
      pan.pan.value = [-0.7, 0.4, -0.2, 0.8][i];
      const v = gain(c, 0.016, this.crickets);
      o.connect(tg).connect(cg).connect(pan).connect(v);
      o.start();
      trill.start();
      chirp.start();
    }
    // Wind in the leaves: noise through a moving band.
    const wsrc = loop(c, this.noise);
    this.windBand = c.createBiquadFilter();
    this.windBand.type = 'bandpass';
    this.windBand.frequency.value = 700;
    this.windBand.Q.value = 0.7;
    this.wind = gain(c, 0.0, this.amb);
    wsrc.connect(this.windBand).connect(this.wind);
    // Rain: bright hiss plus droplets (added per frame).
    const rsrc = loop(c, this.noise);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;
    // Rolled off above 6 kHz: rain should patter on the leaves, not hiss in the ears.
    const rlp = c.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 5800;
    this.rain = gain(c, 0.0, this.amb);
    rsrc.connect(hp).connect(rlp).connect(this.rain);
    // Water lapping (the reed bed): slow, low.
    const lsrc = loop(c, this.noise);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    this.water = gain(c, 0.0, this.amb);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.21;
    const lg = gain(c, 0.5, null);
    lfo.connect(lg.gain);
    lsrc.connect(lp).connect(lg).connect(this.water);
    lfo.start();
    // The greenhouse lamps hum.
    const hum = c.createOscillator();
    hum.frequency.value = 100;
    this.hum = gain(c, 0, this.amb);
    hum.connect(this.hum);
    hum.start();
  }

  // ---------------------------------------------------------------- music: a glass pad on the scale, darker in danger
  pad() {
    const c = this.ctx;
    this.padVoices = [];
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(this.music);
    this.padFilter = lp;
    for (let i = 0; i < 4; i++) {
      const o = c.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.detune.value = (i - 1.5) * 4;
      const g = gain(c, 0.0, lp);
      o.connect(g);
      o.start();
      this.padVoices.push({ o, g });
    }
    // The danger drone: a low fifth with a slow pulse.
    const dr = c.createOscillator();
    dr.type = 'sawtooth';
    dr.frequency.value = noteFreq(0) / 2;
    const dlp = c.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 260;
    this.droneGain = gain(c, 0, this.music);
    const trem = c.createOscillator();
    trem.frequency.value = 2.2;
    const tg = gain(c, 0.35, null);
    trem.connect(tg.gain);
    dr.connect(dlp).connect(tg).connect(this.droneGain);
    dr.start();
    trem.start();
    this.setChord(0, true);
  }

  setChord(k, now = false) {
    const chords = [[0, 4, 7, 9], [3, 5, 8, 10], [1, 4, 6, 9], [2, 5, 7, 11]];
    const ch = chords[k % chords.length];
    const t = this.ctx.currentTime;
    this.padVoices.forEach((v, i) => {
      const f = noteFreq(ch[i]) / 2;
      v.o.frequency.cancelScheduledValues(t);
      if (now) v.o.frequency.setValueAtTime(f, t);
      else v.o.frequency.setTargetAtTime(f, t, 1.2);
    });
  }

  // ---------------------------------------------------------------- the web's voice
  /**
   * A pluck on thread `type` of length `len` (px) at strain s (0..1), loud by `amp`, at world x.
   */
  pluck(type, len, strain, amp, x, y = 0) {
    if (!this.ready || amp <= 0.01) return;
    const c = this.ctx;
    // Long threads low, short high; tight threads a little higher. Then snap to the scale.
    const pos = Math.log2(260 / Math.max(14, len)) * 4.2 + strain * 3 + { 0: -4, 1: 0, 2: 3, 3: 7, 4: -1 }[type];
    const idx = Math.max(0, Math.min(NOTES - 1, Math.round(pos + 7)));
    const key = `${type}:${idx}`;
    const now = c.currentTime;
    if ((this.lastNote.get(key) ?? -1) > now - 0.045) return;
    this.lastNote.set(key, now);
    const timbre = type === T_ALARM ? 'bell' : type === T_STICKY ? 'glass' : 'harp';
    const buf = voiceBuffer(c, timbre, idx);
    if (!buf) return;
    while (this.plucks.length >= MAX_PLUCKS) {
      const old = this.plucks.shift();
      try {
        old.g.gain.setTargetAtTime(0, now, 0.02);
        old.s.stop(now + 0.1);
      } catch {}
    }
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 1 + (Math.random() - 0.5) * 0.004;
    const vol = Math.min(0.9, 0.08 + Math.sqrt(amp) * 0.035) * this.near(x, y) * (type === T_FRAME ? 1.15 : 1);
    const g = gain(c, vol, null);
    const p = c.createStereoPanner();
    p.pan.value = this.pan(x);
    s.connect(g).connect(p).connect(this.webBus);
    s.start(now);
    const v = { s, g };
    this.plucks.push(v);
    s.onended = () => {
      const i = this.plucks.indexOf(v);
      if (i >= 0) this.plucks.splice(i, 1);
      try {
        p.disconnect();
      } catch {}
    };
  }

  near(x, y) {
    const L = this.listener;
    const d = Math.hypot(x - L.x, (y - L.y) * 1.2) / Math.max(300, L.w);
    return Math.max(0.15, Math.min(1, 1.25 - d));
  }

  pan(x) {
    const L = this.listener;
    return Math.max(-0.8, Math.min(0.8, ((x - L.x) / Math.max(200, L.w)) * 1.4));
  }

  threadOf(world, id) {
    const web = world?.web;
    const s = web ? web.ti(id) : -1;
    if (s < 0) return null;
    return { type: web.type[s], len: web.len[s], strain: web.strain(s) };
  }

  // ---------------------------------------------------------------- one-shot sounds
  noiseHit(o) {
    if (!this.ready) return;
    const c = this.ctx;
    const now = c.currentTime + (o.delay ?? 0);
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.f0 ?? 1000, now);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, now + (o.dur ?? 0.2));
    f.Q.value = o.q ?? 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, o.vol ?? 0.2), now + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, now + (o.dur ?? 0.2));
    const p = c.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    s.connect(f).connect(g).connect(p).connect(o.bus ?? this.sfx);
    s.start(now, Math.random() * 1.5, (o.dur ?? 0.2) + 0.05);
  }

  tone(o) {
    if (!this.ready) return;
    const c = this.ctx;
    const now = c.currentTime + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, now);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, now + (o.glide ?? o.dur ?? 0.2));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, o.vol ?? 0.15), now + (o.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, now + (o.dur ?? 0.2));
    const p = c.createStereoPanner();
    p.pan.value = o.pan ?? 0;
    osc.connect(g).connect(p).connect(o.bus ?? this.sfx);
    osc.start(now);
    osc.stop(now + (o.dur ?? 0.2) + 0.05);
  }

  ui(kind) {
    if (!this.ready) return;
    if (kind === 'type') this.tone({ f0: 1320 + Math.random() * 60, dur: 0.07, vol: 0.05 });
    else if (kind === 'page') this.noiseHit({ f0: 2400, f1: 900, dur: 0.32, vol: 0.09, q: 0.6 });
    else if (kind === 'start') {
      // Night falls: a low, slow bell.
      this.tone({ f0: noteFreq(0) / 2, dur: 3.2, vol: 0.12, attack: 0.04 });
      this.tone({ f0: noteFreq(7) / 2, dur: 2.6, vol: 0.06, attack: 0.08, delay: 0.12 });
    }
  }

  ping(x) {
    const p = this.pan(x);
    this.tone({ f0: noteFreq(12), dur: 0.35, vol: 0.09, pan: p });
    this.tone({ f0: noteFreq(16), dur: 0.45, vol: 0.07, pan: p, delay: 0.12 });
  }

  /** A sim event: what it sounds like. */
  event(e, world, me) {
    if (!this.ready || !e) return;
    const x = e.x ?? this.listener.x;
    const y = e.y ?? this.listener.y;
    const pan = this.pan(x);
    const near = this.near(x, y);
    const mine = me && e.id === me.id;
    const v = (base) => base * near;
    switch (e.k) {
      case 'cast':
      case 'spin': {
        if (e.silent && !mine) break;
        const dur = Math.min(0.32, 0.08 + (e.len ?? 100) / 900);
        this.noiseHit({ f0: 700 + Math.random() * 200, f1: 3400 + Math.random() * 600, dur, vol: v(e.k === 'spin' ? 0.05 : 0.11), q: 2.2, pan });
        const th = this.threadOf(world, e.th);
        if (th) setTimeout(() => this.pluck(th.type, th.len, th.strain, 30 + (e.len ?? 0) * 0.2, e.tx ?? x, e.ty ?? y), dur * 1000);
        break;
      }
      case 'pluck': {
        const th = this.threadOf(world, e.th);
        if (th) this.pluck(th.type, th.len, th.strain, e.amp * 0.6, x, y);
        break;
      }
      case 'stick': {
        const th = this.threadOf(world, e.th);
        const m = PREY[e.sp]?.mass ?? 0.5;
        if (th) this.pluck(th.type, th.len * (1 + m * 0.2), th.strain, 120 + m * 220, x, y);
        this.noiseHit({ type: 'lowpass', f0: 500, dur: 0.08, vol: v(0.05 + m * 0.03), pan });
        break;
      }
      case 'struggle': {
        const m = PREY[e.sp]?.mass ?? 0.5;
        this.pluck(T_STICKY, 30 + 140 * Math.min(1, m / 4), 0.4, (e.amp ?? 50) * 0.25, x, y);
        break;
      }
      case 'snap': {
        // A twang that drops, and the whip of the loose ends.
        this.tone({ f0: 900 / Math.max(0.6, (e.len ?? 100) / 120), f1: 120, dur: 0.35, vol: v(0.12), wave: 'triangle', pan, glide: 0.3 });
        this.noiseHit({ f0: 5000, f1: 600, dur: 0.22, vol: v(0.08), q: 1, pan });
        break;
      }
      case 'tear':
        this.noiseHit({ f0: 2600, f1: 400, dur: 0.16, vol: v(0.08), pan });
        break;
      case 'cut':
        this.noiseHit({ type: 'highpass', f0: 4200, dur: 0.05, vol: v(0.1), pan });
        this.tone({ f0: 700, f1: 300, dur: 0.18, vol: v(0.05), pan });
        break;
      case 'wrapstart':
      case 'cocoon':
        this.noiseHit({ type: 'lowpass', f0: 900, f1: 300, dur: 0.25, vol: v(0.07), pan, q: 3 });
        if (e.k === 'cocoon') this.tone({ f0: noteFreq(9), dur: 0.3, vol: v(0.05), pan });
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noiseHit({ type: 'bandpass', f0: 1800 + i * 500, dur: 0.04, vol: v(0.07), q: 4, pan, delay: i * 0.07 });
        if (mine) this.tone({ f0: noteFreq(12 + Math.min(4, Math.floor((e.food ?? 1) / 3))), dur: 0.5, vol: 0.06, pan, delay: 0.2 });
        break;
      case 'hurt':
        if (mine) {
          this.tone({ f0: 1900, f1: 400, dur: 0.18, vol: 0.12 });
          this.tone({ f0: 90, f1: 50, dur: 0.3, vol: 0.18 });
        }
        break;
      case 'downed':
        if (mine) this.tone({ f0: noteFreq(0), f1: noteFreq(0) / 2, dur: 1.4, vol: 0.12, wave: 'triangle' });
        break;
      case 'revived':
      case 'wake':
        this.tone({ f0: noteFreq(7), dur: 0.5, vol: v(0.08), pan });
        this.tone({ f0: noteFreq(12), dur: 0.6, vol: v(0.06), pan, delay: 0.1 });
        break;
      case 'leap':
        this.noiseHit({ f0: 500, f1: 1600, dur: 0.18, vol: v(0.05), q: 0.8, pan });
        break;
      case 'land':
        this.noiseHit({ type: 'lowpass', f0: 700, dur: 0.05, vol: v(0.05), pan });
        break;
      case 'caught':
      case 'drop':
        this.tone({ f0: 1500, f1: 900, dur: 0.12, vol: v(0.03), pan });
        break;
      case 'splash':
        this.noiseHit({ type: 'lowpass', f0: 1400, f1: 300, dur: 0.35, vol: v(0.12), pan });
        break;
      case 'shake':
        for (let i = 0; i < Math.min(12, 3 + (e.beads ?? 0) / 3); i++) this.tone({ f0: 3000 + Math.random() * 3000, dur: 0.04, vol: v(0.025), delay: i * 0.025 + Math.random() * 0.02, pan: pan + (Math.random() - 0.5) * 0.4 });
        break;
      case 'refuse':
        if (mine) this.tone({ f0: 180, f1: 150, dur: 0.12, vol: 0.08, wave: 'triangle' });
        break;
      case 'wrenwarn':
        // Its alarm: a fast run of ticks, from the side it will come from.
        for (let i = 0; i < 9; i++) this.tone({ f0: 3600 + (i % 2) * 400, f1: 2400, dur: 0.05, glide: 0.04, vol: 0.12, delay: i * 0.085, pan: -e.dir * 0.7 });
        break;
      case 'swoop':
        this.noiseHit({ f0: 300, f1: 1800, dur: 0.6, vol: 0.22, q: 0.6, pan: -e.dir * 0.4 });
        for (let i = 0; i < 4; i++) this.noiseHit({ type: 'lowpass', f0: 250, dur: 0.07, vol: 0.12, delay: 0.1 + i * 0.11, pan: e.dir * (i / 4 - 0.5) });
        break;
      case 'gustwarn':
        this.noiseHit({ f0: 400, f1: 1200, dur: 1.2, vol: 0.05, q: 0.5, pan: -e.dir * 0.6, attack: 0.5 });
        break;
      case 'sting':
        this.tone({ f0: 2400, f1: 900, dur: 0.1, vol: v(0.1), pan, wave: 'sawtooth' });
        break;
      case 'waspbit':
        this.noiseHit({ f0: 2000, dur: 0.06, vol: v(0.1), q: 3, pan });
        break;
      case 'mantis':
        this.noiseHit({ type: 'lowpass', f0: 600, dur: 1.4, vol: 0.08, attack: 0.3, pan });
        break;
      case 'windup':
        this.tone({ f0: 180, f1: 420, dur: 0.9, vol: v(0.07), wave: 'sawtooth', pan, glide: 0.85 });
        break;
      case 'strike':
        this.noiseHit({ f0: 3000, f1: 500, dur: 0.15, vol: v(0.16), pan });
        break;
      case 'mantisoff':
        for (let i = 0; i < 4; i++) this.tone({ f0: noteFreq(7 + i * 2), dur: 0.6, vol: 0.06, delay: i * 0.12 });
        break;
      case 'orbdone':
        if (!mine || e.partial) break;
        // Closing a spiral: the scale climbs to the hub.
        for (let i = 0; i < 5; i++) this.pluck(T_STICKY, 160 / (1 + i * 0.5), 0.2, 160, x, y);
        break;
      case 'perfect':
        for (let i = 0; i < 6; i++) this.tone({ f0: noteFreq(5 + i * 2), dur: 0.7, vol: 0.05, delay: i * 0.08, pan });
        break;
      case 'alarm': {
        const th = this.threadOf(world, e.th);
        this.pluck(T_ALARM, th?.len ?? 100, 0.5, 260, x, y);
        break;
      }
      case 'stolen':
        this.noiseHit({ f0: 1200, f1: 3000, dur: 0.14, vol: v(0.06), pan });
        break;
      case 'escape':
        this.noiseHit({ f0: 900, f1: 2200, dur: 0.12, vol: v(0.04), pan });
        break;
      case 'fling':
        this.noiseHit({ f0: 400, f1: 2400, dur: 0.25, vol: v(0.07), q: 1.4, pan });
        break;
      case 'bolashit':
      case 'grab':
        this.tone({ f0: noteFreq(10), dur: 0.25, vol: v(0.07), pan });
        break;
      case 'lure':
        this.tone({ f0: noteFreq(14), dur: 0.8, vol: v(0.04), attack: 0.2, pan });
        break;
      case 'dawn':
        this.dawn();
        break;
      default:
        break;
    }
  }

  night(world) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(0.5, t, 3);
    this.hum.gain.setTargetAtTime(world?.gardenId === 'greenhouse' ? 0.006 : 0, t, 1);
    this.water.gain.setTargetAtTime(world?.gardenId === 'reed' ? 0.05 : 0, t, 1);
  }

  dawn() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this.tone({ f0: noteFreq([0, 4, 7, 12][i]), dur: 3.5, vol: 0.05, attack: 0.6, delay: i * 0.18, bus: this.music });
    this.crickets.gain.setTargetAtTime(0.2, t, 2);
  }

  // ---------------------------------------------------------------- every frame
  frame(dt, world, me, cam, screen) {
    if (!this.ready || !this.ctx) return;
    this.t += dt;
    const c = this.ctx;
    const t = c.currentTime;
    if (cam) {
      this.listener.x = cam.x;
      this.listener.y = cam.y;
      this.listener.w = cam.sw / 2 / Math.max(0.1, cam.z);
    }
    const w = world;
    const garden = screen === 'night' || screen === 'title' || screen === 'book';
    this.crickets.gain.setTargetAtTime(garden ? (w?.weather?.rain ? 0.25 : 1) : 0, t, 1.5);
    const wind = Math.min(1, Math.abs(w?.weather?.windX ?? 10) / 140);
    this.wind.gain.setTargetAtTime(garden ? 0.05 + wind * 0.4 : 0, t, 0.4);
    this.windBand.frequency.setTargetAtTime(500 + wind * 1400, t, 0.4);
    const rain = garden && w?.weather?.rain;
    this.rain.gain.setTargetAtTime(rain ? 0.075 : 0, t, 1.2);
    if (rain && Math.random() < dt * 14) this.tone({ f0: 2400 + Math.random() * 3000, dur: 0.03, vol: 0.02, pan: Math.random() * 2 - 1, bus: this.amb });
    if (rain && Math.random() < dt * 0.02) this.noiseHit({ type: 'lowpass', f0: 90, dur: 3.5, vol: 0.18, attack: 0.4, bus: this.amb });
    // An owl, now and then.
    this.owlT -= dt;
    if (this.owlT <= 0 && garden) {
      this.owlT = 30 + Math.random() * 40;
      const p = Math.random() * 1.4 - 0.7;
      this.tone({ f0: 410, f1: 370, dur: 0.5, vol: 0.05, attack: 0.08, pan: p, bus: this.amb });
      this.tone({ f0: 380, f1: 330, dur: 0.9, vol: 0.05, attack: 0.1, pan: p, delay: 0.75, bus: this.amb });
      if (w?.gardenId === 'churchyard') this.tone({ f0: 196, dur: 4, vol: 0.04, attack: 0.01, delay: 2.5, bus: this.amb });
    }
    // Wasps buzz, bending in pitch as they come and go.
    const seen = new Set();
    for (const x of w?.wasps ?? []) {
      seen.add(x.id);
      let b = this.wasps.get(x.id);
      if (!b) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 1.5;
        const am = c.createOscillator();
        am.frequency.value = 31;
        const ag = gain(c, 0.3, null);
        am.connect(ag.gain);
        const g = gain(c, 0, null);
        const p = c.createStereoPanner();
        o.connect(f).connect(ag).connect(g).connect(p).connect(this.sfx);
        o.start();
        am.start();
        b = { o, am, g, p, lastD: null };
        this.wasps.set(x.id, b);
      }
      const d = Math.hypot(x.x - this.listener.x, x.y - this.listener.y);
      const vr = b.lastD === null ? 0 : (d - b.lastD) / Math.max(dt, 1e-3);
      b.lastD = d;
      const base = x.st === 'hunt' ? 235 : 190;
      b.o.frequency.setTargetAtTime(base * (1 - Math.max(-0.25, Math.min(0.25, vr / 900))), t, 0.05);
      b.g.gain.setTargetAtTime(x.st === 'dying' ? 0 : 0.15 * this.near(x.x, x.y) ** 2, t, 0.08);
      b.p.pan.setTargetAtTime(this.pan(x.x), t, 0.05);
    }
    for (const [id, b] of this.wasps) {
      if (seen.has(id)) continue;
      b.g.gain.setTargetAtTime(0, t, 0.1);
      b.o.stop(t + 0.5);
      b.am.stop(t + 0.5);
      this.wasps.delete(id);
    }
    // The pad: chords drift; danger darkens it and wakes the drone.
    let danger = 0;
    if (w?.wren) danger = 1;
    if (w?.wasps?.some((x) => x.st === 'hunt')) danger = Math.max(danger, 0.7);
    if (w?.mantis && w.mantis.st !== 'gone' && w.mantis.st !== 'leave') danger = Math.max(danger, 0.8);
    if (me && me.hp < 30) danger = Math.max(danger, 0.5);
    this.danger += (danger - this.danger) * Math.min(1, dt * 1.5);
    const night = screen === 'night';
    this.music.gain.setTargetAtTime(night ? 0.5 : garden ? 0.3 : 0, t, 2);
    for (const pv of this.padVoices) pv.g.gain.setTargetAtTime(0.035 * (1 - this.danger * 0.4), t, 1);
    this.droneGain.gain.setTargetAtTime(this.danger * 0.05, t, 0.6);
    this.padFilter.frequency.setTargetAtTime(1500 - this.danger * 900, t, 0.8);
    this.chordT -= dt;
    if (this.chordT <= 0) {
      this.chordT = 11 + Math.random() * 6;
      this.setChord(++this.chord);
    }
    // A few kalimba notes now and then, when nothing hunts.
    this.motifT -= dt;
    if (this.motifT <= 0 && garden) {
      this.motifT = 9 + Math.random() * 14;
      if (this.danger < 0.3) {
        const n = 3 + Math.floor(Math.random() * 3);
        let k = 7 + Math.floor(Math.random() * 6);
        for (let i = 0; i < n; i++) {
          const idx = Math.max(0, Math.min(NOTES - 1, k));
          const buf = voiceBuffer(c, 'glass', idx);
          if (buf) {
            const s = c.createBufferSource();
            s.buffer = buf;
            const g = gain(c, 0.05, null);
            s.connect(g).connect(this.music);
            s.start(t + i * (0.32 + Math.random() * 0.2));
          }
          k += Math.random() < 0.5 ? 1 : -1;
        }
      }
    }
  }
}

/** A transfer curve that leaves everything below 0.6 alone and eases the rest toward 1 without ever reaching past it. */
function roundOff() {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a < 0.6 ? a : 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
  }
  return curve;
}

function gain(c, v, to) {
  const g = c.createGain();
  g.gain.value = v;
  if (to) g.connect(to);
  return g;
}

function loop(c, buf) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(0, Math.random() * buf.duration);
  return s;
}

export { T_RADIAL, T_DRAG, THREADS };
