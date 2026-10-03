// A player's own record, kept in ow.save: egg points and what they bought, stats for badges, personal bests, the
// specimens noted in the notebook, which hints have been shown. Any save loads: missing, empty, corrupt, older or
// newer versions all come back as a usable profile.
import { UNLOCKS, GARDEN_KEYS, SPECIES_KEYS, TRAIT_KEYS, PREY_KEYS, HATCHLING_COST, GARDENS } from './data.js';

export const PROFILE_V = 1;
const STATS = ['nights', 'seasons', 'wins', 'moths', 'catches', 'eaten', 'food', 'wasps', 'dodges', 'dew', 'given', 'orbs', 'dailies', 'beetles', 'mantis'];

export function newProfile() {
  return {
    v: PROFILE_V,
    eggs: 0,
    unlocked: { species: ['orb'], gardens: ['cottage'], colours: ['silver'], dews: ['round'], stickers: [] },
    equip: { colour: 'silver', dew: 'round' },
    stats: Object.fromEntries(STATS.map((k) => [k, 0])),
    best: { season: { orb: 0, jumper: 0, bolas: 0 }, nights: { orb: 0, jumper: 0, bolas: 0 }, endless: 0, night: 0, daily: { date: '', score: 0 } },
    seen: {},
    hints: {},
    tutorial: false,
    hatchlings: [],
    cold: 0,
  };
}

export function parseProfile(raw) {
  const p = newProfile();
  if (!raw || typeof raw !== 'object') return p;
  // Newer saves keep what this version understands; older ones fill in the rest.
  const num = (v, max = 1e9) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Number(v))) : 0);
  p.eggs = num(raw.eggs, 1e6);
  const list = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter((x) => allowed.includes(x)))] : []);
  const u = raw.unlocked ?? {};
  p.unlocked.species = [...new Set(['orb', ...list(u.species, SPECIES_KEYS)])];
  p.unlocked.gardens = [...new Set(['cottage', ...list(u.gardens, GARDEN_KEYS)])];
  p.unlocked.colours = [...new Set(['silver', ...list(u.colours, Object.keys(UNLOCKS.colours))])];
  p.unlocked.dews = [...new Set(['round', ...list(u.dews, Object.keys(UNLOCKS.dews))])];
  p.unlocked.stickers = list(u.stickers, Object.keys(UNLOCKS.stickers));
  const e = raw.equip ?? {};
  p.equip.colour = p.unlocked.colours.includes(e.colour) ? e.colour : 'silver';
  p.equip.dew = p.unlocked.dews.includes(e.dew) ? e.dew : 'round';
  for (const k of STATS) p.stats[k] = num(raw.stats?.[k]);
  const b = raw.best ?? {};
  for (const sp of SPECIES_KEYS) {
    p.best.season[sp] = num(b.season?.[sp]);
    p.best.nights[sp] = num(b.nights?.[sp], 9999);
  }
  p.best.endless = num(b.endless, 9999);
  p.best.night = num(b.night);
  p.best.daily = { date: typeof b.daily?.date === 'string' ? b.daily.date.slice(0, 12) : '', score: num(b.daily?.score) };
  for (const k of PREY_KEYS) if (raw.seen?.[k]) p.seen[k] = num(raw.seen[k]);
  if (raw.hints && typeof raw.hints === 'object') for (const [k, v] of Object.entries(raw.hints).slice(0, 60)) if (typeof k === 'string' && k.length < 24) p.hints[k] = num(v, 99);
  p.tutorial = !!raw.tutorial;
  p.hatchlings = list(raw.hatchlings, TRAIT_KEYS);
  p.cold = Math.round(num(raw.cold, 5));
  return p;
}

/** Things that unlock by playing (not bought): the jumper after three nights, the bolas after fifty moths. */
export function checkUnlocks(p) {
  const got = [];
  if (p.stats.nights >= 3 && !p.unlocked.species.includes('jumper')) {
    p.unlocked.species.push('jumper');
    got.push('jumper');
  }
  if (p.stats.moths >= 50 && !p.unlocked.species.includes('bolas')) {
    p.unlocked.species.push('bolas');
    got.push('bolas');
  }
  return got;
}

export function shopItems(p) {
  const items = [];
  for (const g of GARDEN_KEYS) if (!p.unlocked.gardens.includes(g)) items.push({ kind: 'gardens', id: g, cost: GARDENS[g].cost, name: GARDENS[g].name });
  for (const [id, cost] of Object.entries(UNLOCKS.colours)) if (!p.unlocked.colours.includes(id)) items.push({ kind: 'colours', id, cost, name: id });
  for (const [id, cost] of Object.entries(UNLOCKS.dews)) if (!p.unlocked.dews.includes(id)) items.push({ kind: 'dews', id, cost, name: id });
  for (const [id, cost] of Object.entries(UNLOCKS.stickers)) if (!p.unlocked.stickers.includes(id)) items.push({ kind: 'stickers', id, cost, name: id });
  return items;
}

export function buyItem(p, kind, id) {
  const item = shopItems(p).find((i) => i.kind === kind && i.id === id);
  if (!item || p.eggs < item.cost) return false;
  p.eggs -= item.cost;
  p.unlocked[kind].push(id);
  return true;
}

/** A hatchling: next season starts with this trait already chosen. */
export function buyHatchling(p, trait) {
  if (!TRAIT_KEYS.includes(trait) || p.hatchlings.includes(trait) || p.eggs < HATCHLING_COST) return false;
  p.eggs -= HATCHLING_COST;
  p.hatchlings.push(trait);
  return true;
}

/** Folds a finished night into the profile. Returns badge ids earned by it. */
export function recordNight(p, per, tally, sp, season) {
  const badges = [];
  if (!per) return badges;
  p.stats.nights++;
  p.stats.food += per.food;
  p.stats.eaten += per.eaten;
  p.stats.catches += per.catches;
  p.stats.moths += per.moths;
  p.stats.wasps += per.wasps;
  p.stats.dodges += per.dodges;
  p.stats.dew += per.dew;
  p.stats.given += per.given;
  for (const [k, n] of Object.entries(tally.eaten ?? {})) p.seen[k] = (p.seen[k] ?? 0) + n;
  p.best.night = Math.max(p.best.night, per.food);
  if (season) p.best.nights[sp] = Math.max(p.best.nights[sp] ?? 0, season.night - (season.over ? 0 : 1));
  if (per.eaten > 0) badges.push('first-catch');
  if (p.stats.moths >= 50) badges.push('moth-hunter');
  if (p.stats.dodges >= 5) badges.push('wren-dodge');
  if (p.stats.wasps >= 3) badges.push('wasp-slayer');
  if (p.stats.given >= 100) badges.push('silk-donor');
  if (p.stats.dew >= 20) badges.push('dew-master');
  return badges;
}

export function recordSeason(p, season, sp, eggs) {
  p.stats.seasons++;
  p.eggs += eggs;
  if (season.over === 'won') {
    p.stats.wins++;
    p.cold = Math.min(5, Math.max(p.cold, season.cold + 1));
  }
  p.best.season[sp] = Math.max(p.best.season[sp] ?? 0, season.score);
  if (season.mode === 'endless') p.best.endless = Math.max(p.best.endless, season.night - 10);
}

export { STATS };
