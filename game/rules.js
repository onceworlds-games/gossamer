// Red Light Green Light: the numbers and the pure rules. No DOM and no SDK in here: the tests import this file.
//
// The field: x runs across (0..12), y runs from the START line (0) up to the FINISH ribbon (60).

export const FIELD_W = 12;
export const FIELD_LEN = 60;
export const WATCHER_Y = 64.5;
export const R = 0.4; // collision radius of a character
export const TOP_SPEED = 6;
export const ACCEL = 9;
export const DECEL = 14;
export const STEER_SPEED = 3;
export const CATCH_SPEED = 0.4; // moving faster than this on red is caught
export const CATCH_GRACE = 0.15; // seconds into red before it counts
export const ZAP_TIME = 0.35; // frozen and flashing
export const ZIP_TIME = 0.8; // carried back to the start line
export const STEP = 1 / 60;
export const STEP_MS = 1000 / 60;

export const MAX_PLAYERS = 12;
export const TABLE_SIZE = 8;
export const ROUND_LIMIT_MS = 70000;
export const BANNER_MS = 1500;
export const GO_MS = 900; // round 1 only: the countdown's GO! shows before the banner
export const BOARD_MS = 4000;
export const FINAL_MS = 9000;
export const POINTS = [10, 7, 5, 4, 3, 2, 1];

export const FAKE_LEN = 0.45;
export const TURN_BACK = 0.35;

/** What the host picks in the lobby (rooms.join({ settings })). */
export const SETTINGS = [
  { id: 'rounds', label: 'Rounds', options: [1, 3, 5], default: 3 },
  {
    id: 'mode',
    label: 'Caught',
    options: [
      { value: 'back', label: 'Back to start' },
      { value: 'out', label: 'Out' },
    ],
    default: 'back',
  },
];

export const BOT_NAMES = ['Pip', 'Ziggy', 'Bubbles', 'Noodle', 'Pickles', 'Mochi', 'Sprout', 'Bean', 'Waffles', 'Taco', 'Biscuit', 'Peanut', 'Jelly', 'Nugget'];

export const PLAYER_COLORS = ['#ff4d4d', '#ff9a1f', '#ffd42a', '#9be04a', '#22c768', '#1ccfc0', '#38b6ff', '#4f6bff', '#9d5cff', '#ff5ec4', '#c98a52', '#f4f4f4'];

// ---------------------------------------------------------------- small helpers

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** A small seeded random number generator (0 <= n < 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes two numbers into one 32-bit number. */
export function hash32(a, b = 0) {
  let h = (Number(a) | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (Number(b) | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export const isBot = (id) => typeof id === 'string' && /^bot\d+$/.test(id);

export function placeLabel(n) {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10 < 4 ? n % 10 : 0]}`;
}

// ---------------------------------------------------------------- the lights

// The sequence of lights is a function of a seed, so every page works out the same lights from the round's seed and start time:
// no message per light change. Green 1.5-5 s, yellow 0.6-0.9 s, red 1.5-3.5 s, then green again. From the second cycle on a quarter
// of the greens hold a fake-out: the Watcher twitches and squeaks but doesn't turn.

export function makeSchedule(seed, practice = false) {
  return { seed: seed >>> 0, practice, cyc: [], starts: [0], last: 0 };
}

function ensure(s, k) {
  while (s.cyc.length <= k) {
    const i = s.cyc.length;
    const rng = mulberry32(hash32(s.seed, i + 1));
    const a = rng();
    const b = rng();
    const c = rng();
    const d = rng();
    const e = rng();
    let green;
    let yellow;
    let red;
    let fake = -1;
    if (s.practice) {
      green = 3.4 + a * 1.4;
      yellow = 1;
      red = 2.6 + c * 0.8;
    } else {
      green = i === 0 ? 3 + a * 2 : 1.5 + a * 3.5;
      yellow = 0.6 + b * 0.3;
      red = 1.5 + c * 2;
      if (i > 0 && d < 0.25 && green >= 2.4) fake = 0.7 + e * (green - 1.1 - 0.7);
    }
    s.cyc.push({ green, yellow, red, fake });
    s.starts.push(s.starts[i] + green + yellow + red);
  }
}

/**
 * The light at `t` seconds after the lights began, written into `out`:
 * c 0 green / 1 yellow / 2 red, k the cycle, tIn seconds into this colour, left seconds until it changes,
 * fake 0..1 while the Watcher twitches (else -1), turn 0 (facing away) .. 1 (facing the field), wait true before the lights start.
 */
export function lightAt(s, t, out = {}) {
  if (!(t >= 0)) {
    out.c = 0;
    out.k = -1;
    out.tIn = Number.isFinite(t) ? t : 0;
    out.left = Number.isFinite(t) ? -t : 0;
    out.fake = -1;
    out.turn = 0;
    out.wait = true;
    return out;
  }
  out.wait = false;
  let k = s.last | 0;
  ensure(s, k);
  while (k > 0 && s.starts[k] > t) k--;
  for (;;) {
    ensure(s, k);
    if (t < s.starts[k + 1]) break;
    k++;
  }
  s.last = k;
  const cy = s.cyc[k];
  const u = t - s.starts[k];
  out.k = k;
  out.fake = -1;
  if (u < cy.green) {
    out.c = 0;
    out.tIn = u;
    out.left = cy.green - u;
    let turn = 0;
    if (k > 0 && u < TURN_BACK) turn = 1 - easeInOut(u / TURN_BACK);
    if (cy.fake >= 0 && u >= cy.fake && u <= cy.fake + FAKE_LEN) {
      const p = (u - cy.fake) / FAKE_LEN;
      out.fake = p;
      turn = Math.max(turn, 0.32 * Math.sin(Math.PI * p));
    }
    out.turn = turn;
  } else if (u < cy.green + cy.yellow) {
    out.c = 1;
    out.tIn = u - cy.green;
    out.left = cy.green + cy.yellow - u;
    out.turn = easeInOut(out.tIn / cy.yellow);
  } else {
    out.c = 2;
    out.tIn = u - cy.green - cy.yellow;
    out.left = cy.green + cy.yellow + cy.red - u;
    out.turn = 1;
  }
  return out;
}

const practiceCache = new Map();
const PRACTICE_EPOCH_MS = 600000;

/** The lobby's slow practice lights: every page agrees on them from the platform's clock (`ow.now()`), and nothing is at stake. */
export function practiceLight(nowMs, out = {}) {
  const epoch = Math.floor(nowMs / PRACTICE_EPOCH_MS);
  let s = practiceCache.get(epoch);
  if (!s) {
    if (practiceCache.size > 4) practiceCache.clear();
    s = makeSchedule(hash32(epoch, 4242), true);
    practiceCache.set(epoch, s);
  }
  return lightAt(s, (nowMs - epoch * PRACTICE_EPOCH_MS) / 1000, out);
}

// ---------------------------------------------------------------- who stands where

export function slotOrder(n, seed) {
  return shuffled(Array.from({ length: n }, (_, i) => i), mulberry32(hash32(seed, 31)));
}

/** x of a start slot (0..n-1), spread across the width. */
export function startX(slot, n) {
  const pad = R + 0.5;
  if (n <= 1) return FIELD_W / 2;
  return pad + ((FIELD_W - 2 * pad) * slot) / (n - 1);
}

/** The humans at the table plus bots up to TABLE_SIZE (more humans than that: no bots). Bot names come from the match seed. */
export function buildRoster(humanIds, seed) {
  const humans = humanIds.slice(0, MAX_PLAYERS);
  const nBots = Math.max(0, TABLE_SIZE - humans.length);
  const names = shuffled(
    BOT_NAMES.map((_, i) => i),
    mulberry32(hash32(seed, 77)),
  );
  const ids = humans.slice();
  const bots = {};
  for (let i = 0; i < nBots; i++) {
    const id = `bot${i + 1}`;
    bots[id] = names[i % names.length];
    ids.push(id);
  }
  return { ids, bots };
}

/** Where each roster member starts a round: { id: x }. */
export function startPositions(roster, roundSeed) {
  const order = slotOrder(roster.length, roundSeed);
  const out = {};
  roster.forEach((id, i) => (out[id] = startX(order[i], roster.length)));
  return out;
}

export function colorOf(roster, id) {
  const i = roster ? roster.indexOf(id) : -1;
  return PLAYER_COLORS[(i >= 0 ? i : hashStr(id)) % PLAYER_COLORS.length];
}
