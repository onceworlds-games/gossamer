// Sound: everything is synthesized with Web Audio (no files). A short sound for every action, and a looping little band (bass, chords,
// a pluck tune, drums) that is loud while the light is green and goes quiet and tense on red. The platform applies volume and mute.

let ac = null;
let sfxBus = null;
let musicBus = null;
let noiseBuf = null;
let timer = null;
let nextTime = 0;
let stepNo = 0;
let mood = 'menu';

const MOOD_GAIN = { menu: 0.3, green: 0.85, yellow: 0.4, red: 0.05, results: 0.6, off: 0 };
const STEP_DUR = 60 / 122 / 4; // sixteenth notes at 122 BPM
const hz = (semi) => 261.63 * Math.pow(2, semi / 12); // semitones above middle C

// C major, four bars: C, Am, F, G (semitones above middle C)
const BASS = [-12, -15, -19, -17];
const CHORDS = [
  [0, 4, 7],
  [-3, 0, 4],
  [-7, -3, 0],
  [-5, -1, 2],
];
const TUNE = [
  [12, -1, 16, -1, 19, -1, 16, -1, 21, -1, 19, -1, 16, -1, 14, -1],
  [12, -1, 16, -1, 21, -1, 19, -1, 16, -1, 12, -1, 16, -1, -1, -1],
  [17, -1, 21, -1, 24, -1, 21, -1, 19, -1, 17, -1, 14, -1, 17, -1],
  [19, -1, 23, -1, 19, -1, 14, -1, 16, -1, 19, -1, 23, -1, -1, -1],
];

export function unlock() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      sfxBus = ac.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(ac.destination);
      musicBus = ac.createGain();
      musicBus.gain.value = MOOD_GAIN[mood] ?? 0.3;
      musicBus.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 0.6);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      nextTime = ac.currentTime + 0.12;
      timer = setInterval(schedule, 30);
    }
    if (ac.state === 'suspended') ac.resume();
    return true;
  } catch {
    ac = null;
    return false;
  }
}

/** 'menu' | 'green' | 'yellow' | 'red' | 'results' | 'off': how loud the band plays. */
export function setMood(m) {
  if (m === mood) return;
  mood = m;
  try {
    if (ac && musicBus) musicBus.gain.setTargetAtTime(MOOD_GAIN[m] ?? 0.3, ac.currentTime, 0.1);
  } catch {
    // ignore
  }
}

function tone(freq, dur, o = {}) {
  if (!ac) return;
  try {
    const { type = 'sine', vol = 0.2, slide = 0, delay = 0, attack = 0.006, bus = sfxBus, at } = o;
    const t = (at ?? ac.currentTime) + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {
    // ignore
  }
}

function noise(dur, o = {}) {
  if (!ac || !noiseBuf) return;
  try {
    const { vol = 0.2, type = 'highpass', freq = 1500, to = 0, delay = 0, bus = sfxBus, at } = o;
    const t = (at ?? ac.currentTime) + delay;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  } catch {
    // ignore
  }
}

function schedule() {
  if (!ac) return;
  try {
    if (nextTime < ac.currentTime - 0.4) nextTime = ac.currentTime + 0.05; // the tab slept: don't play the backlog in a burst
    while (nextTime < ac.currentTime + 0.14) {
      playStep(stepNo, nextTime);
      nextTime += STEP_DUR;
      stepNo++;
    }
  } catch {
    // ignore
  }
}

function playStep(n, at) {
  const s = n % 16;
  const bar = Math.floor(n / 16) % 4;
  if (mood === 'off') return;
  if (mood === 'red') {
    // a quiet heartbeat while the Watcher looks
    if (s % 8 === 0) tone(70, 0.16, { type: 'sine', vol: 0.5, slide: 0.6, at, bus: musicBus });
    return;
  }
  // drums
  if (s % 4 === 0) tone(150, 0.14, { type: 'sine', vol: 0.55, slide: 0.3, at, bus: musicBus });
  if (s === 4 || s === 12) noise(0.12, { vol: 0.22, type: 'bandpass', freq: 1900, at, bus: musicBus });
  if (s % 2 === 0) noise(0.04, { vol: s % 4 === 2 ? 0.1 : 0.05, type: 'highpass', freq: 7000, at, bus: musicBus });
  // bass: root on the beat, an octave up on the off-beat
  if (s % 4 === 0) tone(hz(BASS[bar] + 12), STEP_DUR * 3.2, { type: 'triangle', vol: 0.34, at, bus: musicBus });
  else if (s % 4 === 2) tone(hz(BASS[bar] + 24), STEP_DUR * 1.6, { type: 'triangle', vol: 0.2, at, bus: musicBus });
  // chord stabs
  if (s === 2 || s === 6 || s === 10 || s === 14) for (const semi of CHORDS[bar]) tone(hz(semi), STEP_DUR * 1.5, { type: 'square', vol: 0.045, at, bus: musicBus });
  // the tune, only while the light is green or in the menus (it makes room for the tension)
  const note = TUNE[bar][s];
  if (note >= 0 && (mood === 'green' || mood === 'menu' || mood === 'results')) tone(hz(note), STEP_DUR * 2.4, { type: 'triangle', vol: 0.16, at, bus: musicBus });
}

const play = (fn) => (...args) => {
  if (!ac) return;
  try {
    fn(...args);
  } catch {
    // ignore
  }
};

export const sfx = {
  click: play(() => tone(900, 0.05, { type: 'square', vol: 0.07 })),
  pop: play(() => tone(620, 0.09, { type: 'sine', vol: 0.18, slide: 1.9 })),
  tick: play(() => tone(1200, 0.04, { type: 'square', vol: 0.05 })),
  ready: play(() => {
    tone(660, 0.08, { type: 'triangle', vol: 0.16 });
    tone(990, 0.12, { type: 'triangle', vol: 0.16, delay: 0.07 });
  }),
  step: play(() => noise(0.035, { vol: 0.05, type: 'lowpass', freq: 900 })),
  count: play((n) => tone(n === 1 ? 560 : 440, 0.16, { type: 'square', vol: 0.14 })),
  go: play(() => {
    tone(880, 0.35, { type: 'square', vol: 0.15 });
    tone(1320, 0.4, { type: 'triangle', vol: 0.18 });
  }),
  banner: play(() => {
    tone(392, 0.12, { type: 'triangle', vol: 0.16 });
    tone(523, 0.18, { type: 'triangle', vol: 0.16, delay: 0.1 });
  }),
  green: play(() => {
    tone(523, 0.12, { type: 'triangle', vol: 0.2 });
    tone(784, 0.2, { type: 'triangle', vol: 0.2, delay: 0.09 });
  }),
  yellow: play(() => {
    tone(330, 0.55, { type: 'sine', vol: 0.2, slide: 1.8 });
    tone(332, 0.55, { type: 'triangle', vol: 0.09, slide: 1.8 });
  }),
  red: play(() => {
    tone(120, 0.4, { type: 'square', vol: 0.16, slide: 0.55 });
    noise(0.1, { vol: 0.12, type: 'lowpass', freq: 600 });
  }),
  fake: play(() => {
    tone(1250, 0.1, { type: 'sine', vol: 0.15, slide: 1.5 });
    tone(1900, 0.09, { type: 'sine', vol: 0.12, slide: 0.6, delay: 0.11 });
  }),
  zap: play((loud = 1) => {
    tone(95, 0.34, { type: 'sawtooth', vol: 0.22 * loud, slide: 0.7 });
    tone(101, 0.34, { type: 'sawtooth', vol: 0.16 * loud, slide: 0.7 });
    noise(0.28, { vol: 0.3 * loud, type: 'highpass', freq: 3000, to: 900 });
    tone(1400, 0.2, { type: 'square', vol: 0.06 * loud, slide: 0.3 });
  }),
  zip: play(() => {
    noise(0.75, { vol: 0.2, type: 'bandpass', freq: 2600, to: 260 });
    tone(700, 0.7, { type: 'sine', vol: 0.08, slide: 0.25 });
  }),
  land: play(() => {
    tone(180, 0.28, { type: 'sine', vol: 0.26, slide: 1.8 });
    tone(360, 0.2, { type: 'sine', vol: 0.1, slide: 0.7, delay: 0.05 });
  }),
  ghost: play(() => tone(520, 0.6, { type: 'sine', vol: 0.15, slide: 0.35 })),
  finish: play(() => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.07 }));
    tone(1047, 0.5, { type: 'square', vol: 0.05, delay: 0.28 });
  }),
  other: play(() => tone(700, 0.1, { type: 'triangle', vol: 0.08, slide: 1.4 })),
  place: play((n = 4) => tone(420 + Math.max(0, 6 - n) * 70, 0.2, { type: 'triangle', vol: 0.18, slide: 1.4 })),
  points: play((i = 0) => tone(880 + i * 70, 0.09, { type: 'square', vol: 0.06 })),
  whoosh: play(() => noise(0.3, { vol: 0.14, type: 'bandpass', freq: 500, to: 3000 })),
  rise: play((n = 0) => tone(300 + n * 90, 0.2, { type: 'triangle', vol: 0.2, slide: 1.5 })),
  fanfare: play(() => {
    [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.22, delay: i * 0.1 }));
    [523, 659, 784].forEach((f) => tone(f, 0.9, { type: 'square', vol: 0.06, delay: 0.42 }));
    tone(1047, 0.9, { type: 'triangle', vol: 0.2, delay: 0.42 });
  }),
  buzz: play(() => {
    tone(110, 0.22, { type: 'sawtooth', vol: 0.1, slide: 0.7 });
    noise(0.16, { vol: 0.1, type: 'highpass', freq: 3000, to: 1200 });
  }),
};
