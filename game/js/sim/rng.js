// Seeded randomness. The state is one 32-bit number, so it serializes with the world.

export function makeRng(seed) {
  return { s: seed >>> 0 };
}

/** Uniform in [0, 1). mulberry32. */
export function rand(r) {
  let t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (r, a, b) => a + (b - a) * rand(r);
export const int = (r, a, b) => a + Math.floor(rand(r) * (b - a + 1));
export const chance = (r, p) => rand(r) < p;
export const pick = (r, list) => list[Math.floor(rand(r) * list.length)];
export const sign = (r) => (rand(r) < 0.5 ? -1 : 1);

/** Roughly normal, mean 0, sd 1 (sum of uniforms: cheap and bounded). */
export function gauss(r) {
  return (rand(r) + rand(r) + rand(r) + rand(r) - 2) * 1.7320508;
}

/** Picks a key of `weights` ({ key: weight }) in proportion to its weight. */
export function weighted(r, weights) {
  let total = 0;
  for (const k in weights) total += Math.max(0, weights[k]);
  let x = rand(r) * total;
  let last = null;
  for (const k in weights) {
    const w = Math.max(0, weights[k]);
    if (w <= 0) continue;
    last = k;
    if ((x -= w) < 0) return k;
  }
  return last;
}

/** FNV-1a over a string, for seeds made from ids and dates. */
export function hash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mixes two numbers into a new seed. */
export function mix(a, b) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ (b >>> 0);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function shuffle(r, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(r) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
