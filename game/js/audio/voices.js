// The web's strings, rendered once into small buffers when first needed: Karplus-Strong plucks on a D minor
// pentatonic scale (harp for dry silk, a glassier kalimba for glue), and a bell for alarm lines.
const SCALE = [0, 3, 5, 7, 10]; // D minor pentatonic, in semitones
const ROOT = 146.83; // D3
export const NOTES = 18;
const cache = new Map();

/** Frequency of scale step k (0 = D3, 5 = D4, 10 = D5 ...). */
export function noteFreq(k) {
  const oct = Math.floor(k / SCALE.length);
  const step = SCALE[((k % SCALE.length) + SCALE.length) % SCALE.length];
  return ROOT * 2 ** (oct + step / 12);
}

export function noiseBuffer(c, secs) {
  const n = Math.floor(c.sampleRate * secs);
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  let s = 0x1234567;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return b;
}

/** A pluck buffer for (timbre, scale step). */
export function voiceBuffer(c, timbre, k) {
  const key = `${timbre}:${k}`;
  let b = cache.get(key);
  if (b) return b;
  try {
    b = render(c, timbre, noteFreq(k));
  } catch {
    return null;
  }
  cache.set(key, b);
  return b;
}

function render(c, timbre, f) {
  const sr = Math.min(32000, c.sampleRate);
  const secs = timbre === 'bell' ? 1.6 : f < 250 ? 1.8 : f < 600 ? 1.3 : 0.9;
  const n = Math.floor(sr * secs);
  const b = c.createBuffer(1, n, sr);
  const out = b.getChannelData(0);
  if (timbre === 'bell') {
    // Inharmonic partials with their own decays: a small bell.
    const parts = [[1, 1, 1.4], [2.76, 0.5, 2.4], [5.4, 0.25, 4], [8.93, 0.12, 6]];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (const [m, a, d] of parts) v += a * Math.sin(2 * Math.PI * f * m * t) * Math.exp(-t * d);
      out[i] = v * 0.32 * Math.min(1, t * 400);
    }
    return b;
  }
  // Karplus-Strong: a burst of noise in a delay line, averaged as it loops.
  const N = Math.max(2, Math.round(sr / f));
  const line = new Float32Array(N);
  let s = (f * 1000) | 0;
  const glass = timbre === 'glass';
  for (let i = 0; i < N; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const noise = (s / 4294967296) * 2 - 1;
    // Glue strings start rounder (half sine), dry ones brighter.
    line[i] = glass ? Math.sin((Math.PI * i) / N) * 0.8 + noise * 0.25 : noise * 0.9;
  }
  const decay = glass ? 0.992 : 0.996 - Math.max(0, (f - 400) / 40000);
  let p = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[p];
    const next = line[(p + 1) % N];
    const v = decay * 0.5 * (cur + next);
    line[p] = v;
    p = (p + 1) % N;
    // A touch of the sine on glass gives the kalimba's bell-like top.
    out[i] = glass ? cur * 0.8 + Math.sin((2 * Math.PI * f * 2 * i) / sr) * 0.12 * Math.exp((-i / sr) * 6) : cur;
    prev = cur;
  }
  void prev;
  // Soften the very start (no click) and the very end.
  for (let i = 0; i < 64 && i < n; i++) out[i] *= i / 64;
  for (let i = 0; i < 256 && i < n; i++) out[n - 1 - i] *= i / 256;
  return b;
}
