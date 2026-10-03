// A season: ten nights in one garden, three egg sacs, a quota each night, moult to spend and a trait to draft
// between nights. Shared by everyone in the room (the host writes it); each spider keeps its own upgrades.
import { makeRng, mix, hash, shuffle } from './rng.js';
import {
  UPGRADES, UPGRADE_KEYS, upgradeCost, TRAITS, TRAIT_KEYS, traitFits, SPECIES, GARDENS, GARDEN_KEYS, SEASON_NIGHTS,
  START_LIVES, quotaFor,
} from './data.js';

export const SEASON_V = 1;

export function newSeason(o = {}) {
  const mode = ['season', 'daily', 'tutorial', 'endless'].includes(o.mode) ? o.mode : 'season';
  const cold = Math.max(0, Math.min(5, o.cold | 0));
  return {
    v: SEASON_V,
    sid: o.sid ?? `s${(o.seed ?? Date.now()).toString(36)}`,
    seed: (o.seed ?? Date.now()) >>> 0,
    mode,
    garden: GARDEN_KEYS.includes(o.garden) ? o.garden : 'cottage',
    cold,
    night: 1,
    lives: START_LIVES - (cold >= 5 ? 1 : 0),
    roster: {},
    history: [],
    over: false,
    score: 0,
    food: 0,
    daily: o.daily ?? null,
  };
}

export function rosterEntry(season, id, sp = 'orb', o = {}) {
  const others = Object.values(season.roster);
  const earned = others.length ? Math.round(others.reduce((s, r) => s + (r.earned ?? 0), 0) / others.length) : 0;
  return {
    sp: SPECIES[sp] ? sp : 'orb',
    up: {},
    tr: o.trait && TRAITS[o.trait] ? [o.trait] : [],
    mp: earned, // a friend who joins late gets what the others have earned on average
    earned,
    food: 0,
    nights: 0,
    draft: null,
    silk: null,
  };
}

export function ensureRoster(season, id, sp, o) {
  if (!season.roster[id]) season.roster[id] = rosterEntry(season, id, sp, o);
  return season.roster[id];
}

export function setSpecies(season, id, sp) {
  const r = season.roster[id];
  if (!r || !SPECIES[sp] || r.nights > 0) return false;
  r.sp = sp;
  r.up = {};
  r.tr = r.tr.filter((t) => traitFits(t, sp));
  return true;
}

export function canBuy(season, id, up) {
  const r = season.roster[id];
  const u = UPGRADES[up];
  if (!r || !u || !u.for.includes(r.sp)) return false;
  const tier = r.up[up] | 0;
  return tier < 3 && r.mp >= upgradeCost(up, tier);
}

export function buy(season, id, up) {
  if (!canBuy(season, id, up)) return false;
  const r = season.roster[id];
  const tier = r.up[up] | 0;
  r.mp -= upgradeCost(up, tier);
  r.up[up] = tier + 1;
  if (up === 'eggsac') season.lives++;
  return true;
}

export function pickTrait(season, id, trait) {
  const r = season.roster[id];
  if (!r || !Array.isArray(r.draft) || !r.draft.includes(trait) || r.tr.includes(trait)) return false;
  r.tr.push(trait);
  r.draft = null;
  return true;
}

/** Three traits this spider doesn't have and can use, from the night's seed. */
export function draftFor(season, id, sp, salt) {
  const r = season.roster[id];
  const pool = TRAIT_KEYS.filter((t) => traitFits(t, sp) && !(r?.tr ?? []).includes(t));
  const rng = makeRng(mix(season.seed ^ hash(id), salt >>> 0));
  return shuffle(rng, pool).slice(0, 3);
}

/**
 * Applies a night's tally to the season. participants: ids that played. Returns { met, moult, lifeLost, over }.
 */
export function applyNight(season, tally, participants, salt = 0) {
  const ids = participants.filter((id) => season.roster[id]);
  const met = tally.met;
  const share = ids.length ? Math.floor(tally.extra / ids.length) : 0;
  const out = { met, moult: {}, lifeLost: !met && season.mode !== 'daily', over: false };
  if (out.lifeLost) season.lives--;
  for (const id of ids) {
    const r = season.roster[id];
    const per = tally.per?.[id];
    let mp = met ? share : 2;
    if (per?.banker) mp += Math.floor((per.silkLeft ?? 0) / 8);
    r.mp += mp;
    r.earned = (r.earned ?? 0) + mp;
    r.food += per?.food ?? 0;
    r.nights++;
    r.silk = per ? Math.max(0, per.silkLeft) : null;
    out.moult[id] = mp;
  }
  season.food += tally.food;
  season.history.push({ n: season.night, food: Math.round(tally.food), quota: tally.quota, met, g: season.garden, rain: !!tally.rain, mist: !!tally.mist, swoops: tally.swoops, stolen: tally.stolen, mantis: !!tally.mantisOff, top: topCatch(tally) });
  if (season.history.length > 14) season.history.shift();
  season.score = seasonScore(season, tally.mantisOff);
  // The first night was the tutorial: the season carries on from night two either way.
  if (season.mode === 'tutorial') season.mode = 'season';
  if (season.mode === 'daily') {
    season.over = 'done';
    out.over = 'done';
  }
  if (!out.over) {
    if (season.lives <= 0) season.over = 'lost';
    else if (season.mode === 'season' && season.night >= SEASON_NIGHTS) season.over = 'won';
    out.over = season.over;
  }
  if (!season.over) {
    season.night++;
    for (const id of ids) season.roster[id].draft = draftFor(season, id, season.roster[id].sp, salt + season.night);
  }
  return out;
}

/** After the tenth night: keep going into Endless with the same spiders. */
export function goEndless(season) {
  if (season.over !== 'won') return false;
  season.mode = 'endless';
  season.over = false;
  season.night++;
  return true;
}

function topCatch(tally) {
  let best = null;
  for (const k of ['dragonfly', 'beetle', 'moth', 'fly', 'midge', 'gnat']) if (tally.eaten?.[k]) return k;
  return best;
}

export function seasonScore(season, mantisOff = false) {
  const base = season.food * (1 + 0.15 * season.cold);
  const nights = season.history.filter((h) => h.met).length * 10;
  return Math.round(base + nights + Math.max(0, season.lives) * 20 + (season.over === 'won' ? 100 : 0) + (mantisOff ? 50 : 0));
}

export function quotaOf(season, nightRulesQuotaMul = 1) {
  return Math.round(quotaFor(season.night, season.cold) * nightRulesQuotaMul);
}

/** Egg points a finished season is worth. */
export function eggsFor(season) {
  const nights = season.history.filter((h) => h.met).length;
  return nights + (season.over === 'won' ? 10 : 0) + season.cold * 3 + Math.floor(season.score / 60);
}

/** Defensive read of a season from room state or a save. Returns null if it isn't one. */
export function parseSeason(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== SEASON_V) return null;
  const s = newSeason({ mode: raw.mode, garden: raw.garden, cold: raw.cold, seed: Number(raw.seed) >>> 0, sid: typeof raw.sid === 'string' ? raw.sid.slice(0, 40) : undefined });
  s.night = clampInt(raw.night, 1, 999, 1);
  s.lives = clampInt(raw.lives, 0, 12, s.lives);
  s.over = raw.over === 'won' || raw.over === 'lost' || raw.over === 'done' ? raw.over : false;
  s.food = clampNum(raw.food, 0, 1e7, 0);
  s.score = clampNum(raw.score, 0, 1e8, 0);
  s.daily = raw.daily && typeof raw.daily === 'object' ? { date: String(raw.daily.date ?? '').slice(0, 12), seed: Number(raw.daily.seed) >>> 0 } : null;
  s.history = Array.isArray(raw.history) ? raw.history.slice(-14).filter((h) => h && typeof h === 'object').map((h) => ({ n: clampInt(h.n, 1, 999, 1), food: clampNum(h.food, 0, 1e5, 0), quota: clampNum(h.quota, 0, 1e5, 0), met: !!h.met, g: GARDEN_KEYS.includes(h.g) ? h.g : 'cottage', rain: !!h.rain, mist: !!h.mist, swoops: clampInt(h.swoops, 0, 99, 0), stolen: clampInt(h.stolen, 0, 999, 0), mantis: !!h.mantis, top: typeof h.top === 'string' ? h.top.slice(0, 12) : null })) : [];
  if (raw.roster && typeof raw.roster === 'object') {
    for (const [id, r] of Object.entries(raw.roster).slice(0, 8)) {
      if (typeof id !== 'string' || id.length > 64 || !r || typeof r !== 'object') continue;
      const e = rosterEntry(s, id, r.sp);
      for (const k of UPGRADE_KEYS) {
        const tier = clampInt(r.up?.[k], 0, 3, 0);
        if (tier && UPGRADES[k].for.includes(e.sp)) e.up[k] = tier;
      }
      e.tr = Array.isArray(r.tr) ? [...new Set(r.tr.filter((t) => TRAITS[t] && traitFits(t, e.sp)))].slice(0, 30) : [];
      e.mp = clampNum(r.mp, 0, 1e5, 0);
      e.earned = clampNum(r.earned, 0, 1e6, 0);
      e.food = clampNum(r.food, 0, 1e7, 0);
      e.nights = clampInt(r.nights, 0, 9999, 0);
      e.draft = Array.isArray(r.draft) ? r.draft.filter((t) => TRAITS[t]).slice(0, 3) : null;
      e.silk = Number.isFinite(r.silk) ? Math.max(0, Math.min(300, r.silk)) : null;
      s.roster[id] = e;
    }
  }
  return s;
}

function clampInt(v, lo, hi, d) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
}
function clampNum(v, lo, hi, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
}

export { GARDENS, SEASON_NIGHTS };
