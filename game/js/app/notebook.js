// The field notebook: the page between nights, laid out like a naturalist's ledger. Left: what the night came to
// (in the hand, with ink sketches of the catch and a stamp), and tonight's forecast. Right: your spider (species
// drawn, a trait to pin, the upgrades as ledger lines), and friends. At a season's end: the score and the egg-point
// shop. The platform's Ready/Start strip sits under the page.
import { platform } from './platform.js';
import { div, button } from './screens.js';
import { GARDENS, GARDEN_KEYS, SPECIES, UPGRADES, UPGRADE_KEYS, upgradeCost, TRAITS, PREY, COLD, quotaFor, HATCHLING_COST } from '../sim/data.js';
import { nightRules, makeScript } from '../sim/night.js';
import { shopItems, buyItem, buyHatchling } from '../sim/profile.js';
import { drawPrey } from '../render/creatures.js';
import { spiderSketch, gardenSketch, upgradeGlyph, circleMark, tierDots, inkCanvas } from './ink.js';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const say = (n) => (n <= 12 ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = { gnat: 'gnats', midge: 'midges', fly: 'flies', moth: 'moths', beetle: 'beetles', dragonfly: 'dragonflies' };
const EFFECT = {
  glands: ['+20 silk, faster', '+40 silk', '+65 silk, quickest'],
  strong: ['Frames ×1.3', 'Frames ×1.6', 'Frames ×2'],
  droplets: ['Catch +12%', 'Catch +24%', 'Catch +36%'],
  shake: ['Q sheds dew', 'Wider', 'Restores glue'],
  legs: ['Faster', 'Sure on glue', 'Fastest'],
  eyes: ['Marks stuck prey', 'Marks hunters', 'Every clock'],
  venom: ['One bite', 'Two bites', 'Three bites'],
  camo: ['Harder to spot', 'Bark-coloured', 'A shadow'],
  alarm: ['Trips marked', 'Lines tangle', 'Cheap, tough'],
  templates: ['Ladder web', 'Funnel web', 'Close-woven'],
  lure: ['Stronger lure', 'Two lures', 'Draws flies'],
  eggsac: ['+1 egg sac', '+1 egg sac', '+1 egg sac'],
};

export class Notebook {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.page = null;
    this.key = '';
  }

  mount(root, standalone) {
    this.standalone = standalone;
    const book = div('book');
    this.page = div('page');
    book.append(this.page);
    root.append(book);
    this.root = book;
    this.key = '';
    this.render();
    return book;
  }

  frame() {
    // Re-render when what the page shows has changed (season, friends, ready flags, our save).
    const g = this.game;
    const key = JSON.stringify([g.room.state?.season, g.room.state?.result?.mid, [...(g.room.players?.values?.() ?? [])].map((p) => [p.id, p.name, p.ready, p.connected]), g.profile.eggs, g.profile.equip, g.room.host, g.room.match?.phase]);
    if (key !== this.key) this.render(key);
  }

  render(key) {
    if (!this.page) return;
    this.key = key ?? this.key;
    const g = this.game;
    const s = g.season();
    const scroll = this.page.scrollTop;
    this.page.replaceChildren();
    corner(this.page, 'tl');
    corner(this.page, 'br');
    if (!s) return;
    const res = g.room.state?.result;
    const me = s.roster[g.me];
    const host = g.amHost();
    if (s.over) this.seasonEnd(s, res, host);
    else {
      this.header(s);
      const cols = div('cols');
      const left = div('col');
      const right = div('col');
      this.lastNight(left, s, res);
      this.forecast(left, s);
      if (s.night === 1 && !s.history.length && host) this.setup(left, s);
      if (me) this.spider(right, s, me);
      this.friends(right, s);
      cols.append(left, right);
      this.page.append(cols);
    }
    if (this.standalone && !s.over) {
      const row = div('row');
      row.append(button('go', 'Begin the night', () => g.room.startMatch()));
      this.page.append(row);
    }
    this.page.scrollTop = scroll;
  }

  header(s) {
    const head = div('head');
    head.append(h2(s.history.length ? `Night ${s.night}` : s.mode === 'daily' ? 'The daily garden' : 'A new season'));
    const sacs = inkCanvas(150, 40, (c) => drawSacs(c, s.lives));
    sacs.setAttribute('aria-label', `${s.lives} egg sacs`);
    sacs.setAttribute('role', 'img');
    head.append(sacs);
    this.page.append(head);
  }

  lastNight(col, s, res) {
    const last = s.history[s.history.length - 1];
    if (!last || !res?.t) return;
    col.append(label('Last night'));
    const st = document.createElement('span');
    st.className = 'stamp';
    st.textContent = last.met ? 'Fed' : 'Hungry';
    const line = note(naturalist(last, res.t));
    line.prepend(st, ' ');
    col.append(line, sketches(res.t.eaten));
    const mine = res.out?.moult?.[this.game.me];
    if (mine) col.append(margin(`+${mine} moult`));
    if (this.game.unlockedNow?.length) col.append(margin(`New: ${this.game.unlockedNow.map((k) => SPECIES[k].name).join(', ')}`));
  }

  forecast(col, s) {
    const g = this.game;
    const players = Object.entries(s.roster).map(([id, r]) => ({ id, ...r }));
    const rules = nightRules(players, s.cold);
    const night = s.mode === 'daily' ? 5 : s.night;
    const sc = makeScript(g.nightSeed(s), night, s.garden, rules, s.cold, s.mode);
    const ev = sc.events;
    const has = (k) => ev.some((e) => e.k === k);
    const count = (k) => ev.filter((e) => e.k === k).length;
    const parts = [sc.wind > 26 ? 'Breezy' : 'Still air'];
    if (count('gust') >= 3) parts.push('gusty');
    if (has('rain')) parts.push('rain coming');
    if (has('mist')) parts.push('mist on the ground');
    if (has('bloom')) parts.push('fireflies gathering');
    const hunters = [];
    if (count('wasp')) hunters.push(count('wasp') > 1 ? `${say(count('wasp'))} wasps` : 'a wasp');
    if (count('wren')) hunters.push(count('wren') > 1 ? 'the wren, twice' : 'the wren');
    if (has('mantis')) hunters.push('the mantis');
    const q = s.mode === 'daily' ? 0 : Math.round(quotaFor(s.night, s.cold) * rules.quotaMul * (s.mode === 'tutorial' ? 0.75 : 1));
    col.append(label(`Tonight · ${GARDENS[s.garden].name}`));
    const line = div('tonight');
    const big = div('quota', q ? `Eat ${q}` : 'Eat all you can');
    line.append(big, note(`${cap(parts.join(', '))}.${hunters.length ? ` ${cap(hunters.join(', '))}.` : ''}`));
    col.append(line);
  }

  setup(col, s) {
    const g = this.game;
    col.append(label('This season'));
    const modes = div('specimens');
    modes.append(specimen(div('numeral', 'X'), 'Ten nights', '', s.mode !== 'daily', false, () => s.mode === 'daily' && g.request(g.me, { t: 'newseason', start: true })));
    modes.append(specimen(div('numeral', '1'), 'Daily garden', '', s.mode === 'daily', false, () => s.mode !== 'daily' && g.request(g.me, { t: 'newseason', start: true, daily: dailyOf(platform.now()) })));
    col.append(modes);
    if (s.mode === 'daily') return;
    col.append(label('Garden'));
    const row = div('specimens');
    for (const id of GARDEN_KEYS) {
      const have = g.profile.unlocked.gardens.includes(id);
      row.append(specimen(gardenSketch(id), GARDENS[id].name, have ? '' : `${GARDENS[id].cost} eggs`, s.garden === id, !have, () => g.request(g.me, { t: 'garden', g: id })));
    }
    col.append(row);
    if (g.profile.cold > 0) {
      col.append(label('Cold snap'));
      const r2 = div('specimens');
      for (let v = 0; v <= g.profile.cold; v++) {
        const b = specimen(div('numeral', v ? String(v) : '–'), v ? COLD[v].name : 'Mild', '', s.cold === v, false, () => g.request(g.me, { t: 'cold', v }));
        r2.append(b);
      }
      col.append(r2);
    }
  }

  spider(col, s, me) {
    const g = this.game;
    col.append(label('Your spider'));
    if (me.nights === 0) {
      const row = div('specimens');
      for (const sp of Object.keys(SPECIES)) {
        const have = g.profile.unlocked.species.includes(sp);
        const how = { jumper: 'Three nights', bolas: 'Fifty moths' }[sp];
        row.append(specimen(spiderSketch(sp), SPECIES[sp].name, have ? '' : how, me.sp === sp, !have, () => g.request(g.me, { t: 'species', sp })));
      }
      col.append(row);
    } else {
      const who = div('who');
      who.append(spiderSketch(me.sp), note(`${SPECIES[me.sp].name}, ${say(me.nights)} night${me.nights === 1 ? '' : 's'} old.`));
      col.append(who);
    }
    if (Array.isArray(me.draft) && me.draft.length) {
      col.append(label('Pin a trait'));
      const row = div('pins');
      me.draft.forEach((t, i) => row.append(pinLabel(TRAITS[t].name, TRAITS[t].note, i, () => g.request(g.me, { t: 'trait', tr: t }))));
      col.append(row);
    }
    if (me.tr.length) col.append(margin(me.tr.map((t) => TRAITS[t]?.name).filter(Boolean).join(' · ')));
    col.append(label(`Moult · ${Math.floor(me.mp)}`));
    const ledger = div('ledger');
    for (const id of UPGRADE_KEYS) {
      const u = UPGRADES[id];
      if (!u.for.includes(me.sp)) continue;
      const tier = me.up[id] | 0;
      const cost = upgradeCost(id, tier);
      ledger.append(ledgerRow(upgradeGlyph(id), u.name, EFFECT[id]?.[Math.min(2, tier)] ?? '', tier, tier >= 3 ? '' : String(cost), tier >= 3 || me.mp < cost, () => g.request(g.me, { t: 'buy', up: id })));
    }
    col.append(ledger);
  }

  friends(col, s) {
    const g = this.game;
    const players = [...(g.room.players?.values?.() ?? [])];
    if (players.length <= 1) {
      if (platform.onPlatform) {
        const row = div('row');
        row.append(button('go ghost', 'Invite', () => platform.invite()));
        col.append(row);
      }
      return;
    }
    col.append(label('Friends'));
    const row = div('friends');
    for (const p of players) {
      const r = s.roster[p.id];
      const f = div(`friend${p.id === g.me ? ' me' : ''}`);
      const face = div('face');
      avatar(face, p.id);
      const name = div('name', String(p.name ?? 'Friend').slice(0, 24));
      const what = div('what', `${r ? SPECIES[r.sp].name : ''}${p.id === g.room.host ? ' · host' : p.ready ? ' · ready' : ''}${p.connected === false ? ' · away' : ''}`);
      f.append(face, name, what);
      row.append(f);
    }
    if (players.length < 4 && platform.onPlatform) row.append(button('go ghost', 'Invite', () => platform.invite()));
    col.append(row);
  }

  seasonEnd(s, res, host) {
    const g = this.game;
    const won = s.over === 'won';
    const head = div('head');
    head.append(h2(won ? 'Ten nights' : s.over === 'done' ? 'The daily garden' : 'The garden goes quiet'));
    this.page.append(head);
    const last = s.history[s.history.length - 1];
    if (last && res?.t) this.page.append(note(naturalist(last, res.t)), sketches(res.t.eaten));
    const score = div('score');
    score.append(div('score-n', String(s.score)), div('score-l', 'Season'));
    if (g.eggsNow) score.append(div('score-n', `+${g.eggsNow}`), div('score-l', 'Egg points'));
    this.page.append(score);
    if (host) {
      const row = div('row');
      if (won) row.append(button('go', 'Keep going', () => g.request(g.me, { t: 'endless' })));
      row.append(button(won ? 'go ghost' : 'go', 'New season', () => g.request(g.me, { t: 'newseason' })));
      row.append(button('go ghost', 'Daily garden', () => g.request(g.me, { t: 'newseason', daily: dailyOf(platform.now()) })));
      this.page.append(row);
    }
    this.shop();
  }

  shop() {
    const g = this.game;
    const p = g.profile;
    this.page.append(label(`Egg points · ${Math.floor(p.eggs)}`));
    const ledger = div('ledger');
    for (const item of shopItems(p).slice(0, 14)) {
      const glyph = item.kind === 'gardens' ? gardenSketch(item.id) : upgradeGlyph(item.kind === 'dews' ? 'shake' : item.kind === 'colours' ? 'glands' : 'camo');
      if (item.kind === 'gardens') glyph.style.width = '48px';
      ledger.append(ledgerRow(glyph, cap(item.name), { gardens: 'A garden', colours: 'Silk colour', dews: 'Dew style', stickers: 'Sticker' }[item.kind], 0, String(item.cost), p.eggs < item.cost, () => {
        if (!buyItem(p, item.kind, item.id)) return;
        if (item.kind === 'colours') p.equip.colour = item.id;
        if (item.kind === 'dews') p.equip.dew = item.id;
        g.markDirty();
        g.flush(true);
        this.render();
      }, false));
    }
    this.page.append(ledger);
    if (p.unlocked.colours.length > 1) {
      this.page.append(label('Silk'));
      const r2 = div('specimens');
      for (const c of p.unlocked.colours) r2.append(specimen(silkSwatch(c), cap(c), '', p.equip.colour === c, false, () => ((p.equip.colour = c), g.markDirty(), this.render())));
      this.page.append(r2);
    }
    if (p.eggs >= HATCHLING_COST) {
      this.page.append(label(`Hatchling · ${HATCHLING_COST} eggs`));
      const row = div('pins');
      Object.keys(TRAITS).filter((t) => !p.hatchlings.includes(t)).slice(0, 3).forEach((t, i) => row.append(pinLabel(TRAITS[t].name, TRAITS[t].note, i, () => buyHatchling(p, t) && (g.markDirty(), this.render()))));
      this.page.append(row);
    }
  }
}

export function dailyOf(now) {
  const d = new Date(now);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  let h = 2166136261;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const seed = h >>> 0;
  return { date, seed, garden: GARDEN_KEYS[seed % GARDEN_KEYS.length] };
}

/** The night in the naturalist's hand: weather, what came, what went wrong, how it ended. */
export function naturalist(h, t) {
  const bits = [`Night ${h.n}.`];
  if (t.rain) bits.push('Rain, and the glue ran.');
  else if (t.mist) bits.push('Mist. Dew heavy.');
  else if (t.gusts >= 3) bits.push('Wind all night.');
  else bits.push('Clear and still.');
  const eaten = Object.entries(t.eaten ?? {}).filter(([, n]) => n > 0).sort((a, b) => (PREY[b[0]]?.food ?? 0) - (PREY[a[0]]?.food ?? 0));
  if (eaten.length) bits.push(`${cap(eaten.slice(0, 4).map(([k, n]) => `${say(n)} ${n === 1 ? k : plural[k]}`).join(', '))}.`);
  else bits.push('Nothing eaten.');
  if (t.swoops) bits.push(t.swoops > 1 ? `The wren came ${say(t.swoops)} times.` : 'The wren came once.');
  if (t.stolen) bits.push(`${cap(say(t.stolen))} taken from the web.`);
  if (t.mantisOff) bits.push('The mantis was driven off.');
  if (t.lostFood > 0) bits.push('Cocoons left at dawn.');
  return bits.join(' ');
}

function sketches(eaten) {
  const box = div('sketches');
  for (const [k, n] of Object.entries(eaten ?? {})) {
    if (!n || !PREY[k]) continue;
    const s = div('sketch');
    s.append(inkCanvas(92, 68, (c, w, h) => inkPrey(c, w, h, k)), document.createTextNode(`${PREY[k].name} ×${n}`));
    box.append(s);
  }
  return box;
}

/** A prey drawn in ink: its silhouette in pen colour, hatched with the paper showing through. */
function inkPrey(c, w, h, sp) {
  c.save();
  c.translate(w / 2, h / 2 + 4);
  const size = PREY[sp].size;
  const k = Math.min(6.5, 34 / Math.max(5, size * 1.45));
  c.scale(k, k);
  drawPrey(c, { sp, st: sp === 'moth' || sp === 'dragonfly' ? 'fly' : 'land', x: 0, y: 0, vx: 1, vy: 0, facing: 1, id: 3, wrap: 0 }, 0.05, 'low');
  c.restore();
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#2b2620';
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'source-atop';
  c.strokeStyle = 'rgba(239, 228, 203, 0.55)';
  c.lineWidth = 0.8;
  for (let x = -h; x < w; x += 3.5) {
    c.beginPath();
    c.moveTo(x, h);
    c.lineTo(x + h, 0);
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
}

function drawSacs(c, lives) {
  for (let i = 0; i < Math.max(lives, 3); i++) {
    const x = 132 - i * 28;
    c.save();
    c.translate(x, 20);
    const full = i < lives;
    c.fillStyle = full ? '#e9dfc4' : 'transparent';
    c.strokeStyle = full ? '#5a4a36' : 'rgba(90, 74, 54, 0.35)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.ellipse(0, 0, 10, 13, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    if (full) {
      c.strokeStyle = 'rgba(90, 74, 54, 0.5)';
      for (let k = -7; k <= 7; k += 4) {
        c.beginPath();
        c.moveTo(-9, k);
        c.quadraticCurveTo(0, k - 4, 9, k);
        c.stroke();
      }
    } else {
      c.strokeStyle = 'rgba(169, 68, 44, 0.6)';
      c.beginPath();
      c.moveTo(-11, -11);
      c.lineTo(11, 11);
      c.stroke();
    }
    c.restore();
  }
}

function silkSwatch(id) {
  const rgb = { silver: '230,238,232', moon: '214,232,246', amber: '246,206,140', verdigris: '150,220,196', rust: '236,168,140' }[id] ?? '230,238,232';
  return inkCanvas(60, 40, (c) => {
    c.fillStyle = '#163032';
    c.fillRect(4, 4, 52, 32);
    c.strokeStyle = `rgb(${rgb})`;
    c.lineWidth = 1.2;
    for (let k = 0; k < 6; k++) {
      c.beginPath();
      c.moveTo(30, 20);
      c.lineTo(30 + Math.cos(k) * 22, 20 + Math.sin(k) * 14);
      c.stroke();
    }
  });
}

/** Pressed leaves in the page corners, drawn in faded green ink. */
function corner(page, where) {
  const c = document.createElement('canvas');
  c.className = 'corner';
  c.width = 240;
  c.height = 240;
  if (where === 'tl') {
    c.style.left = '-10px';
    c.style.top = '-12px';
  } else {
    c.style.right = '-10px';
    c.style.bottom = '-12px';
    c.style.transform = 'rotate(180deg)';
  }
  const ctx = c.getContext('2d');
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#4f6e4a';
  ctx.strokeStyle = '#3b5236';
  for (const [x, y, a, s] of [[60, 70, 0.6, 1], [90, 40, 1.1, 0.8], [40, 110, 0.2, 0.7]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(30 * s, -22 * s, 80 * s, 0);
    ctx.quadraticCurveTo(30 * s, 22 * s, 0, 0);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(80 * s, 0);
    for (let k = 1; k < 5; k++) {
      ctx.moveTo(k * 16 * s, 0);
      ctx.lineTo(k * 16 * s + 8 * s, -9 * s);
      ctx.moveTo(k * 16 * s, 0);
      ctx.lineTo(k * 16 * s + 8 * s, 9 * s);
    }
    ctx.stroke();
    ctx.restore();
  }
  page.append(c);
}

function avatar(el, id) {
  platform.avatar(id).then((url) => {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.alt = '';
    img.src = url;
    el.append(img);
  });
}

function h2(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}
function note(text) {
  return div('note', text);
}
function margin(text) {
  return div('margin', text);
}
function label(text) {
  return div('label', text);
}

/** A drawn thing to choose (a spider, a garden): circled in rust when chosen. */
function specimen(art, name, sub, chosen, disabled, onClick) {
  const b = button(`specimen${chosen ? ' on' : ''}`, '', onClick);
  b.disabled = disabled;
  b.append(art);
  const n = document.createElement('span');
  n.className = 'sname';
  n.textContent = name;
  b.append(n);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'ssub';
    s.textContent = sub;
    b.append(s);
  }
  if (chosen) b.append(circleMark(118, 104));
  return b;
}

/** A paper label pinned to the page (a trait to take). */
function pinLabel(name, text, i, onClick) {
  const b = button('pin', '', onClick);
  b.style.setProperty('--tilt', `${[-2.2, 1.4, -0.8][i % 3]}deg`);
  const t = document.createElement('b');
  t.textContent = name;
  const s = document.createElement('small');
  s.textContent = text;
  b.append(t, s);
  return b;
}

/** One line of the ledger: drawing, name and what it does, how far it's gone, what it costs. */
function ledgerRow(glyph, name, effect, tier, cost, disabled, onClick, dots = true) {
  const b = button('entry', '', onClick);
  b.disabled = disabled;
  const n = document.createElement('span');
  n.className = 'ename';
  n.textContent = name;
  const e = document.createElement('span');
  e.className = 'eeffect';
  e.textContent = effect;
  const text = document.createElement('span');
  text.className = 'etext';
  text.append(n, e);
  const c = document.createElement('span');
  c.className = 'ecost';
  c.textContent = cost;
  b.append(glyph, text);
  if (dots) b.append(tierDots(tier));
  b.append(c);
  return b;
}
