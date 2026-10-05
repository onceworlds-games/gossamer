// The host's rules on the match record `g` (the one record the host writes to room state). Pure: each function takes a record and
// returns a new one (or the same one when nothing changed), so the network code only decides when to call them.
//
// g = {
//   mid, by, rounds, mode ('back' | 'out'), seed (the match's), roster [ids], bots { botId: nameIndex },
//   n, rid, phase ('round' | 'board' | 'final'), at (match ms the phase began), t0 (the lights start), until,
//   rs (the round's light seed), fin { id: ms after t0 }, caught { id: n }, out { id: y }, scores { id: points },
//   st { id: [roundWins, catches, bestFinishMs] }, res [ids in the round's order], nFin, rp { id: points of the round },
//   final [ids in the match's order], aw { statue, speedy }
// }

import { BANNER_MS, BOARD_MS, FIELD_LEN, FINAL_MS, GO_MS, POINTS, ROUND_LIMIT_MS, clamp, hash32 } from './rules.js';

export function newMatch({ mid, by, ids, bots, rounds, mode, seed }) {
  const scores = {};
  const st = {};
  for (const id of ids) {
    scores[id] = 0;
    st[id] = [0, 0, 0];
  }
  return {
    mid,
    by,
    rounds,
    mode: mode === 'out' ? 'out' : 'back',
    seed: seed >>> 0,
    roster: ids,
    bots,
    n: 0,
    rid: `${mid}.0`,
    phase: 'board',
    at: 0,
    t0: 0,
    until: 0,
    rs: 0,
    fin: {},
    caught: {},
    out: {},
    scores,
    st,
    res: null,
    nFin: 0,
    rp: null,
    final: null,
    aw: null,
  };
}

/** The next round starts at `now` (match ms): a banner, then the lights. */
export function beginRound(g, now) {
  const n = g.n + 1;
  const at = Math.round(now);
  const t0 = at + BANNER_MS + (n === 1 ? GO_MS : 0);
  return { ...g, n, rid: `${g.mid}.${n}`, phase: 'round', at, t0, until: t0 + ROUND_LIMIT_MS, rs: hash32(g.seed, n), fin: {}, caught: {}, out: {}, res: null, nFin: 0, rp: null };
}

const alive = (g, id) => g.phase === 'round' && g.roster.includes(id) && g.fin[id] === undefined && g.out[id] === undefined;

/** `id` crossed the ribbon at match time `mt`. */
export function applyFinish(g, id, mt) {
  if (!alive(g, id) || !Number.isFinite(mt) || mt < g.t0 - 200 || mt > g.until + 1000) return g;
  return { ...g, fin: { ...g.fin, [id]: Math.max(1, Math.round(mt - g.t0)) } };
}

/** `id` was caught moving on red at height `y`, at match time `mt`. In Out mode they're out of the round. */
export function applyCaught(g, id, y, mt) {
  if (!alive(g, id) || !Number.isFinite(mt) || mt < g.t0 - 200) return g;
  const prev = g.st[id] ?? [0, 0, 0];
  const out = g.mode === 'out' ? { ...g.out, [id]: Math.round(clamp(Number.isFinite(y) ? y : 0, 0, FIELD_LEN) * 10) / 10 } : g.out;
  return { ...g, out, caught: { ...g.caught, [id]: (g.caught[id] ?? 0) + 1 }, st: { ...g.st, [id]: [prev[0], prev[1] + 1, prev[2]] } };
}

/** The round is over when time is up, or when everyone who can still finish has (or is out). `active` are the ids to wait for. */
export function isRoundOver(g, now, active) {
  if (g.phase !== 'round' || now < g.t0) return false;
  if (now >= g.until) return true;
  for (const id of active) if (g.fin[id] === undefined && g.out[id] === undefined) return false;
  return true;
}

/** The round's order: finishers by time, then the ones still running by distance, then the ones who are out by where they were caught. */
export function roundOrder(g, dist = {}) {
  const idx = (id) => g.roster.indexOf(id);
  const fin = g.roster.filter((id) => g.fin[id] !== undefined).sort((a, b) => g.fin[a] - g.fin[b] || idx(a) - idx(b));
  const running = g.roster.filter((id) => g.fin[id] === undefined && g.out[id] === undefined).sort((a, b) => (dist[b] ?? 0) - (dist[a] ?? 0) || idx(a) - idx(b));
  const outs = g.roster.filter((id) => g.fin[id] === undefined && g.out[id] !== undefined).sort((a, b) => g.out[b] - g.out[a] || idx(a) - idx(b));
  return { order: [...fin, ...running, ...outs], nFin: fin.length };
}

export const pointsFor = (place, finished) => (finished ? (POINTS[place] ?? 1) : 0);

/** Scores the round and starts the scoreboard. `dist` is { id: y } for everyone who didn't finish. */
export function closeRound(g, now, dist = {}) {
  const { order, nFin } = roundOrder(g, dist);
  const rp = {};
  const scores = { ...g.scores };
  const st = { ...g.st };
  order.forEach((id, i) => {
    const p = pointsFor(i, i < nFin);
    rp[id] = p;
    scores[id] = (scores[id] ?? 0) + p;
  });
  if (nFin > 0) {
    const s = st[order[0]] ?? [0, 0, 0];
    st[order[0]] = [s[0] + 1, s[1], s[2]];
  }
  for (let i = 0; i < nFin; i++) {
    const id = order[i];
    const s = st[id] ?? [0, 0, 0];
    st[id] = [s[0], s[1], s[2] > 0 ? Math.min(s[2], g.fin[id]) : g.fin[id]];
  }
  const at = Math.round(now);
  return { ...g, phase: 'board', at, until: at + BOARD_MS, res: order, nFin, rp, scores, st };
}

/** The match's order: points, then round wins, then fewer catches, then seat. */
export function rankMatch(g) {
  const idx = (id) => g.roster.indexOf(id);
  const s = (id) => g.st[id] ?? [0, 0, 0];
  return [...g.roster].sort((a, b) => (g.scores[b] ?? 0) - (g.scores[a] ?? 0) || s(b)[0] - s(a)[0] || s(a)[1] - s(b)[1] || idx(a) - idx(b));
}

/** "Statue" (fewest catches, if anyone was caught more) and "Speedy" (the fastest finish of any round). */
export function awardsOf(g) {
  const s = (id) => g.st[id] ?? [0, 0, 0];
  const order = rankMatch(g);
  let statue = null;
  const counts = order.map((id) => s(id)[1]);
  if (order.length > 1 && Math.max(...counts) > Math.min(...counts)) statue = order[counts.indexOf(Math.min(...counts))];
  let speedy = null;
  for (const id of order) if (s(id)[2] > 0 && (speedy === null || s(id)[2] < s(speedy)[2])) speedy = id;
  return { statue, speedy };
}

export function finishMatch(g, now) {
  const at = Math.round(now);
  return { ...g, phase: 'final', at, until: at + FINAL_MS, final: rankMatch(g), aw: awardsOf(g) };
}

/** The scoreboard is done: the next round, or the podium. */
export function advance(g, now) {
  return g.n >= g.rounds ? finishMatch(g, now) : beginRound(g, now);
}

/** Won a round by less than half a second (for the photo-finish badge). */
export function photoFinish(g, id) {
  if (!g.res || g.res[0] !== id || g.nFin < 2) return false;
  return g.fin[g.res[1]] - g.fin[id] < 500;
}
