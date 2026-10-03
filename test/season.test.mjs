import test from 'node:test';
import assert from 'node:assert/strict';
import { newSeason, ensureRoster, buy, canBuy, pickTrait, setSpecies, applyNight, goEndless, parseSeason, draftFor, eggsFor } from '../game/js/sim/season.js';
import { parseProfile, newProfile, checkUnlocks, buyItem, buyHatchling, recordNight, shopItems } from '../game/js/sim/profile.js';
import { upgradeCost, TRAITS, SEASON_NIGHTS, START_LIVES } from '../game/js/sim/data.js';

const tally = (food, quota, per = {}) => ({ food, quota, met: food >= quota, extra: Math.max(0, Math.floor(food - quota)), per, eaten: {}, swoops: 0, stolen: 0 });

test('a season: moult from a good night is shared, a missed quota costs an egg sac', () => {
  const s = newSeason({ seed: 1 });
  ensureRoster(s, 'a', 'orb');
  ensureRoster(s, 'b', 'jumper');
  const out = applyNight(s, tally(40, 18), ['a', 'b'], 1);
  assert.ok(out.met);
  assert.equal(out.moult.a, 11);
  assert.equal(out.moult.b, 11);
  assert.equal(s.night, 2);
  assert.equal(s.lives, START_LIVES);
  assert.ok(Array.isArray(s.roster.a.draft) && s.roster.a.draft.length === 3);
  const miss = applyNight(s, tally(5, 24), ['a', 'b'], 2);
  assert.ok(miss.lifeLost);
  assert.equal(s.lives, START_LIVES - 1);
  assert.equal(miss.moult.a, 2, 'a small consolation');
});

test('upgrades cost moult, go three tiers, and only fit the right spiders', () => {
  const s = newSeason({ seed: 2 });
  const r = ensureRoster(s, 'a', 'orb');
  r.mp = 100;
  assert.ok(buy(s, 'a', 'strong'));
  assert.equal(r.mp, 100 - upgradeCost('strong', 0));
  assert.ok(buy(s, 'a', 'strong') && buy(s, 'a', 'strong'));
  assert.ok(!buy(s, 'a', 'strong'), 'no fourth tier');
  const j = ensureRoster(s, 'j', 'jumper');
  j.mp = 100;
  assert.ok(!canBuy(s, 'j', 'strong'), 'a hunter has no frames to strengthen');
  assert.ok(buy(s, 'j', 'legs'));
  const lives = s.lives;
  r.mp = 100;
  assert.ok(buy(s, 'a', 'eggsac'));
  assert.equal(s.lives, lives + 1);
  assert.ok(!buy(s, 'a', 'nonsense'));
  r.mp = 0;
  assert.ok(!buy(s, 'a', 'glands'));
});

test('traits come from the draft only; species can change only before the first night', () => {
  const s = newSeason({ seed: 3 });
  const r = ensureRoster(s, 'a', 'orb');
  r.draft = draftFor(s, 'a', 'orb', 7);
  assert.equal(r.draft.length, 3);
  assert.ok(!pickTrait(s, 'a', 'not-a-trait'));
  const t = r.draft[1];
  assert.ok(pickTrait(s, 'a', t));
  assert.ok(r.tr.includes(t) && r.draft === null);
  assert.ok(setSpecies(s, 'a', 'jumper'));
  r.nights = 1;
  assert.ok(!setSpecies(s, 'a', 'bolas'));
  for (const id of draftFor(s, 'a', 'jumper', 9)) assert.ok(!TRAITS[id].for || TRAITS[id].for.includes('jumper'));
});

test('ten nights win a season, endless carries on, three misses end it', () => {
  const s = newSeason({ seed: 4 });
  ensureRoster(s, 'a', 'orb');
  for (let n = 1; n <= SEASON_NIGHTS; n++) applyNight(s, tally(200, 10), ['a'], n);
  assert.equal(s.over, 'won');
  assert.ok(goEndless(s));
  assert.equal(s.mode, 'endless');
  assert.equal(s.over, false);
  const t = newSeason({ seed: 5 });
  ensureRoster(t, 'a', 'orb');
  for (let n = 0; n < START_LIVES; n++) applyNight(t, tally(0, 18), ['a'], n);
  assert.equal(t.over, 'lost');
  assert.ok(eggsFor(s) > eggsFor(t));
});

test('the tutorial night never ends a season, even when missed', () => {
  const s = newSeason({ seed: 6, mode: 'tutorial' });
  ensureRoster(s, 'a', 'orb');
  applyNight(s, tally(0, 14), ['a'], 1);
  assert.equal(s.mode, 'season');
  assert.equal(s.over, false);
  assert.equal(s.night, 2);
});

test('a season read from room state or a save survives junk', () => {
  for (const junk of [null, undefined, 3, 'x', [], {}, { v: 99 }, { v: 1, night: 'x', lives: NaN, roster: 'no' }]) {
    const s = parseSeason(junk);
    if (s) {
      assert.ok(Number.isFinite(s.night) && s.night >= 1);
      assert.ok(Number.isFinite(s.lives));
    }
  }
  const s = newSeason({ seed: 7 });
  const r = ensureRoster(s, 'a', 'orb');
  r.up = { strong: 9, nonsense: 2, glands: -3, legs: 2 };
  r.tr = ['taut', 'taut', 'bogus'];
  r.mp = Infinity;
  const back = parseSeason(JSON.parse(JSON.stringify({ ...s, roster: { a: r, ['x'.repeat(100)]: r } })));
  assert.equal(back.roster.a.up.strong, 3);
  assert.equal(back.roster.a.up.nonsense, undefined);
  assert.equal(back.roster.a.up.glands, undefined);
  assert.deepEqual(back.roster.a.tr, ['taut']);
  assert.equal(back.roster.a.mp, 0);
  assert.equal(Object.keys(back.roster).length, 1);
});

test('a profile loads from anything: missing, empty, corrupt, older or newer', () => {
  for (const raw of [null, undefined, '', 'garbage', 42, [], {}, { v: 0 }, { v: 7, eggs: 'many', unlocked: { species: ['dragon'] }, stats: { moths: -4 } }]) {
    const p = parseProfile(raw);
    assert.equal(p.v, 1);
    assert.deepEqual(p.unlocked.species, ['orb']);
    assert.ok(p.stats.moths >= 0 && Number.isFinite(p.eggs));
  }
  const p = parseProfile({ v: 2, eggs: 30, unlocked: { gardens: ['reed', 'mars'] }, best: { night: 50 }, future: { thing: 1 } });
  assert.deepEqual(p.unlocked.gardens, ['cottage', 'reed']);
  assert.equal(p.best.night, 50);
});

test('unlocks: the hunter after three nights, the fisher after fifty moths; egg points buy things once', () => {
  const p = newProfile();
  p.stats.nights = 3;
  assert.deepEqual(checkUnlocks(p), ['jumper']);
  assert.deepEqual(checkUnlocks(p), []);
  p.stats.moths = 50;
  assert.deepEqual(checkUnlocks(p), ['bolas']);
  p.eggs = 20;
  const item = shopItems(p).find((i) => i.kind === 'gardens' && i.id === 'reed');
  assert.ok(buyItem(p, 'gardens', 'reed'));
  assert.equal(p.eggs, 20 - item.cost);
  assert.ok(!buyItem(p, 'gardens', 'reed'));
  assert.ok(buyHatchling(p, 'nightowl'));
  assert.ok(!buyHatchling(p, 'nightowl'));
  const badges = recordNight(p, { food: 30, eaten: 9, catches: 2, moths: 3, wasps: 3, dodges: 5, dew: 20, given: 100 }, { eaten: { moth: 3 } }, 'orb', null);
  for (const b of ['first-catch', 'wren-dodge', 'wasp-slayer', 'silk-donor', 'dew-master']) assert.ok(badges.includes(b), b);
});
