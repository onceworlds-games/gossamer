// A pretend browser for node: a clock you advance by hand, timers and animation frames that run on it, events you can fire, a canvas
// that throws on anything a real one would silently ignore (NaN, a missing colour, an unbalanced save), and a Web Audio that records
// every call the real one would refuse. Not a browser: it lets the game's own page code run in node, frame by frame.

export const T0 = 1_700_000_000_000;

export function installBrowser({ width = 800, height = 400, search = '', touch = false } = {}) {
  const st = {
    t: 0,
    nextId: 1,
    timers: [],
    raf: [],
    listeners: new Map(),
    canvasListeners: new Map(),
    audioErrors: [],
    audioCalls: 0,
    drawCalls: 0,
    texts: [],
    depth: 0,
  };
  const g = globalThis;
  Object.defineProperty(g, 'performance', { value: { now: () => st.t }, configurable: true, writable: true });
  Date.now = () => T0 + st.t;
  g.window = g;
  g.innerWidth = width;
  g.innerHeight = height;
  g.devicePixelRatio = 2;
  g.location = { search };
  g.addEventListener = (type, fn) => {
    if (!st.listeners.has(type)) st.listeners.set(type, new Set());
    st.listeners.get(type).add(fn);
  };
  g.removeEventListener = (type, fn) => st.listeners.get(type)?.delete(fn);
  g.requestAnimationFrame = (fn) => {
    st.raf.push(fn);
    return st.nextId++;
  };
  g.setTimeout = (fn, ms = 0) => {
    const id = st.nextId++;
    st.timers.push({ id, at: st.t + ms, every: 0, fn });
    return id;
  };
  g.setInterval = (fn, ms = 0) => {
    const id = st.nextId++;
    st.timers.push({ id, at: st.t + ms, every: Math.max(1, ms), fn });
    return id;
  };
  g.clearTimeout = g.clearInterval = (id) => {
    st.timers = st.timers.filter((x) => x.id !== id);
  };

  const canvas = {
    width: 0,
    height: 0,
    style: {},
    addEventListener(type, fn) {
      if (!st.canvasListeners.has(type)) st.canvasListeners.set(type, new Set());
      st.canvasListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      st.canvasListeners.get(type)?.delete(fn);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: g.innerWidth, height: g.innerHeight }),
    setPointerCapture() {},
    getContext: () => ctx,
  };
  const ctx = makeContext(st);
  g.document = {
    hidden: false,
    body: { dataset: {}, style: {} },
    fonts: { load: async () => [], ready: Promise.resolve() },
    getElementById: (id) => (id === 'c' ? canvas : null),
    addEventListener: g.addEventListener,
    removeEventListener: g.removeEventListener,
  };
  g.Image = class {
    constructor() {
      this.naturalWidth = 120;
      this.naturalHeight = 88;
    }
    set src(v) {
      this._src = v;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._src;
    }
  };
  g.AudioContext = makeAudio(st);
  if (touch) g.matchMedia = () => ({ matches: true });

  const api = {
    st,
    canvas,
    ctx,
    now: () => st.t,
    fire(type, ev = {}) {
      const e = { preventDefault() {}, ...ev };
      for (const fn of [...(st.listeners.get(type) ?? [])]) fn(e);
    },
    fireCanvas(type, ev = {}) {
      const e = { preventDefault() {}, pointerId: 1, pointerType: 'touch', ...ev };
      for (const fn of [...(st.canvasListeners.get(type) ?? [])]) fn(e);
    },
    key(code, down = true) {
      api.fire(down ? 'keydown' : 'keyup', { code, repeat: false });
    },
    /** Advance `n` frames of dt ms; `each(i)` runs after every frame. A throw anywhere (a frame, a timer) propagates. */
    run(n, each, dt = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        st.t += dt;
        const due = st.timers.filter((x) => x.at <= st.t).sort((a, b) => a.at - b.at);
        for (const tm of due) {
          if (!st.timers.includes(tm)) continue;
          if (tm.every) tm.at += tm.every;
          else st.timers = st.timers.filter((x) => x !== tm);
          tm.fn();
        }
        const q = st.raf;
        st.raf = [];
        for (const fn of q) fn(st.t);
        if (st.depth !== 0) throw new Error(`unbalanced ctx.save/restore after a frame: depth ${st.depth}`);
        each?.(i);
      }
    },
  };
  return api;
}

// ---------------------------------------------------------------- the canvas

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%-]+\)|hsla?\([\d.,\s%-]+\)|[a-z]+)$/i;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function makeContext(st) {
  const check = (name, args, n) => {
    for (let i = 0; i < n; i++) if (!finite(args[i])) throw new Error(`ctx.${name}: argument ${i} is ${args[i]} (${[...args].join(', ')})`);
  };
  const props = {};
  const guard = (name, test) => ({
    get: () => props[name],
    set: (v) => {
      if (!test(v)) throw new Error(`ctx.${name} = ${String(v)}`);
      props[name] = v;
    },
  });
  const ctx = {};
  Object.defineProperties(ctx, {
    fillStyle: guard('fillStyle', (v) => (typeof v === 'string' && COLOR.test(v) && !/NaN|undefined/.test(v)) || (v && typeof v === 'object')),
    strokeStyle: guard('strokeStyle', (v) => (typeof v === 'string' && COLOR.test(v) && !/NaN|undefined/.test(v)) || (v && typeof v === 'object')),
    lineWidth: guard('lineWidth', (v) => finite(v) && v > 0),
    globalAlpha: guard('globalAlpha', (v) => finite(v) && v >= 0 && v <= 1.0001),
    font: guard('font', (v) => typeof v === 'string' && /^\d+ \d+px /.test(v) && !/NaN|undefined|Infinity/.test(v)),
    textAlign: guard('textAlign', (v) => ['left', 'right', 'center', 'start', 'end'].includes(v)),
    textBaseline: guard('textBaseline', (v) => ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'].includes(v)),
    lineCap: guard('lineCap', (v) => ['butt', 'round', 'square'].includes(v)),
    lineJoin: guard('lineJoin', (v) => ['bevel', 'round', 'miter'].includes(v)),
    miterLimit: guard('miterLimit', (v) => finite(v) && v > 0),
  });
  props.globalAlpha = 1;
  props.lineWidth = 1;
  const nums = { translate: 2, scale: 2, rotate: 1, moveTo: 2, lineTo: 2, arcTo: 5, rect: 4, quadraticCurveTo: 4, bezierCurveTo: 6, fillRect: 4, strokeRect: 4, clearRect: 4, setTransform: 6 };
  for (const [name, n] of Object.entries(nums)) {
    ctx[name] = (...a) => {
      st.drawCalls++;
      check(name, a, n);
    };
  }
  ctx.arc = (...a) => {
    st.drawCalls++;
    check('arc', a, 5);
    if (a[2] < 0) throw new Error(`ctx.arc: negative radius ${a[2]}`);
  };
  ctx.ellipse = (...a) => {
    st.drawCalls++;
    check('ellipse', a, 7);
    if (a[2] < 0 || a[3] < 0) throw new Error(`ctx.ellipse: negative radius ${a[2]}, ${a[3]}`);
  };
  for (const name of ['beginPath', 'closePath', 'fill', 'stroke', 'clip']) ctx[name] = () => void st.drawCalls++;
  ctx.save = () => void st.depth++;
  ctx.restore = () => {
    st.depth--;
    if (st.depth < 0) throw new Error('ctx.restore without save');
  };
  ctx.setLineDash = (a) => {
    if (!Array.isArray(a) || !a.every((v) => finite(v) && v >= 0)) throw new Error(`ctx.setLineDash(${a})`);
  };
  ctx.measureText = (s) => {
    if (typeof s !== 'string') throw new Error(`ctx.measureText(${s})`);
    return { width: s.length * 9 };
  };
  for (const name of ['fillText', 'strokeText']) {
    ctx[name] = (s, x, y, max) => {
      st.drawCalls++;
      if (typeof s !== 'string' || s.includes('undefined') || s.includes('NaN')) throw new Error(`ctx.${name}(${s})`);
      check(name, [x, y], 2);
      if (max !== undefined) check(name, [max], 1);
      if (name === 'fillText') st.texts.push(s);
    };
  }
  ctx.drawImage = (img, ...a) => {
    st.drawCalls++;
    if (!img) throw new Error('ctx.drawImage(no image)');
    check('drawImage', a, a.length);
  };
  const gradient = () => ({ addColorStop() {} });
  ctx.createLinearGradient = (...a) => (check('createLinearGradient', a, 4), gradient());
  ctx.createRadialGradient = (...a) => (check('createRadialGradient', a, 6), gradient());
  return new Proxy(ctx, {
    get(target, prop) {
      if (!(prop in target)) throw new Error(`ctx.${String(prop)} is not part of the canvas API (or was never defined)`);
      return target[prop];
    },
    set(target, prop, value) {
      if (!(prop in target)) throw new Error(`setting ctx.${String(prop)}: not a canvas property`);
      target[prop] = value;
      return true;
    },
  });
}

// ---------------------------------------------------------------- Web Audio

function makeAudio(st) {
  const bad = (what) => {
    st.audioErrors.push(what);
    throw new Error(`Web Audio would refuse: ${what}`);
  };
  class Param {
    constructor(v = 1) {
      this.value = v;
    }
    setValueAtTime(v, t) {
      if (!finite(v) || !finite(t)) bad(`setValueAtTime(${v}, ${t})`);
    }
    linearRampToValueAtTime(v, t) {
      if (!finite(v) || !finite(t)) bad(`linearRamp(${v}, ${t})`);
    }
    exponentialRampToValueAtTime(v, t) {
      if (!finite(v) || v <= 0 || !finite(t)) bad(`exponentialRamp(${v}, ${t})`);
    }
    setTargetAtTime(v, t, k) {
      if (!finite(v) || !finite(t) || !finite(k) || k <= 0) bad(`setTarget(${v}, ${t}, ${k})`);
    }
  }
  class Node {
    connect(n) {
      if (!n) bad('connect(nothing)');
      return n;
    }
    disconnect() {}
  }
  return class AudioContext {
    constructor() {
      this.sampleRate = 44100;
      this.state = 'running';
      this.destination = new Node();
    }
    get currentTime() {
      return st.t / 1000;
    }
    resume() {}
    createGain() {
      st.audioCalls++;
      const n = new Node();
      n.gain = new Param(1);
      return n;
    }
    createOscillator() {
      st.audioCalls++;
      const n = new Node();
      n.frequency = new Param(440);
      n.type = 'sine';
      n.start = (t) => finite(t) || bad(`start(${t})`);
      n.stop = (t) => finite(t) || bad(`stop(${t})`);
      return n;
    }
    createBiquadFilter() {
      st.audioCalls++;
      const n = new Node();
      n.frequency = new Param(350);
      n.type = 'lowpass';
      return n;
    }
    createBufferSource() {
      st.audioCalls++;
      const n = new Node();
      n.start = (t) => finite(t) || bad(`start(${t})`);
      n.stop = (t) => finite(t) || bad(`stop(${t})`);
      return n;
    }
    createBuffer(ch, len, rate) {
      if (!finite(len) || len < 1 || !finite(rate)) bad(`createBuffer(${ch}, ${len}, ${rate})`);
      const data = new Float32Array(len);
      return { getChannelData: () => data };
    }
  };
}
