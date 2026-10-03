// The field notebook: the page between nights. What the night came to (in the naturalist's hand, with sketches of
// the catch), the egg sacs left, tomorrow's forecast and quota, your spider's moult to spend and a trait to draft,
// friends' spiders, and at a season's end the egg-point shop. The platform's Ready/Start strip sits under it.
import { platform } from './platform.js';
import { div, button } from './screens.js';
import { GARDENS, GARDEN_KEYS, SPECIES, UPGRADES, UPGRADE_KEYS, upgradeCost, TRAITS, PREY, COLD, quotaFor, HATCHLING_COST, UNLOCKS } from '../sim/data.js';
import { nightRules, makeScript } from '../sim/night.js';
import { shopItems, buyItem, buyHatchling } from '../sim/profile.js';
import { drawPrey } from '../render/creatures.js';
import { glyph } from '../render/hud.js';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const say = (n) => (n <= 12 ? WORDS[n] : String(n));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = { gnat: 'gnats', midge: 'midges', fly: 'flies', moth: 'moths', beetle: 'beetles', dragonfly: 'dragonflies' };

export class Notebook {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.page = null;
    this.key = '';
    this.tab = 'night';
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
    const key = JSON.stringify([g.room.state?.season, g.room.state?.result?.mid, [...(g.room.players?.values?.() ?? [])].map((p) => [p.id, p.name, p.ready, p.connected]), g.profile.eggs, g.room.host, this.tab, g.room.match?.phase]);
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
    if (!s) {
      this.page.append(h2('A new notebook'), note('Opening the page...'));
      return;
    }
    const res = g.room.state?.result;
    const me = s.roster[g.me];
    const host = g.amHost();
    if (s.over) this.seasonEnd(s, res, host);
    else {
      this.header(s, res);
      if (s.night === 1 && !s.history.length && host) this.setup(s);
      this.forecast(s);
      if (me) this.spider(s, me);
      this.friends(s);
    }
    if (this.standalone && !s.over) {
      const row = div('row');
      row.append(button('go', 'Begin the night', () => g.room.startMatch()));
      this.page.append(row);
    }
    this.page.scrollTop = scroll;
  }

  header(s, res) {
    const head = div('row');
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    const left = div();
    left.append(h2(s.history.length ? `Night ${s.night}` : s.mode === 'daily' ? 'The daily garden' : 'A new season'));
    head.append(left);
    const sacs = document.createElement('canvas');
    sacs.width = 160;
    sacs.height = 44;
    sacs.style.width = '160px';
    sacs.style.height = '44px';
    sacs.title = 'Egg sacs';
    drawSacs(sacs, s.lives);
    head.append(sacs);
    this.page.append(head);
    const last = s.history[s.history.length - 1];
    if (last && res?.t) {
      const st = document.createElement('span');
      st.className = 'stamp';
      st.textContent = last.met ? 'Fed' : 'Hungry';
      const line = note(naturalist(last, res.t));
      line.prepend(st, ' ');
      this.page.append(line, sketches(res.t.eaten));
      const mine = res.out?.moult?.[this.game.me];
      if (mine) this.page.append(note(`+${mine} moult`));
      if (this.game.unlockedNow?.length) this.page.append(note(`New spider: ${this.game.unlockedNow.map((k) => SPECIES[k].name).join(', ')}`));
    } else if (s.mode === 'tutorial') this.page.append(note('First night. One web, one catch.'));
  }

  setup(s) {
    const g = this.game;
    this.page.append(label('Garden'));
    const row = div('row');
    for (const id of GARDEN_KEYS) {
      const have = g.profile.unlocked.gardens.includes(id);
      const b = card(GARDENS[id].name, have ? gardenLine(id) : `${GARDENS[id].cost} eggs`, () => g.request(g.me, { t: 'garden', g: id }), s.garden === id, !have);
      row.append(b);
    }
    this.page.append(row);
    if (g.profile.cold > 0) {
      this.page.append(label('Cold snap'));
      const r2 = div('row');
      for (let v = 0; v <= g.profile.cold; v++) r2.append(card(v ? `${v}` : 'None', v ? COLD[v].note : 'A mild season', () => g.request(g.me, { t: 'cold', v }), s.cold === v));
      this.page.append(r2);
    }
  }

  forecast(s) {
    const g = this.game;
    const players = Object.entries(s.roster).map(([id, r]) => ({ id, ...r }));
    const rules = nightRules(players, s.cold);
    const night = s.mode === 'daily' ? 5 : s.night;
    const sc = makeScript(g.nightSeed(s), night, s.garden, rules, s.cold, s.mode);
    const ev = sc.events;
    const has = (k) => ev.some((e) => e.k === k);
    const count = (k) => ev.filter((e) => e.k === k).length;
    const parts = [];
    parts.push(sc.wind > 26 ? 'Breezy' : 'Still air');
    if (count('gust') >= 3) parts.push('gusty');
    if (has('rain')) parts.push('rain coming');
    if (has('mist')) parts.push('mist on the ground');
    if (has('bloom')) parts.push('fireflies gathering');
    const hunters = [];
    if (count('wasp')) hunters.push(count('wasp') > 1 ? `${say(count('wasp'))} wasps` : 'a wasp');
    if (count('wren')) hunters.push(count('wren') > 1 ? 'the wren, twice' : 'the wren');
    if (has('mantis')) hunters.push('the mantis');
    const q = s.mode === 'daily' ? 0 : Math.round(quotaFor(s.night, s.cold) * rules.quotaMul * (s.mode === 'tutorial' ? 0.75 : 1));
    this.page.append(label(`Tonight · ${GARDENS[s.garden].name}`));
    this.page.append(note(`${cap(parts.join(', '))}.${hunters.length ? ` Expect ${hunters.join(', ')}.` : ''}${q ? ` Eat ${q}.` : ' Eat all you can.'}`));
  }

  spider(s, me) {
    const g = this.game;
    this.page.append(label('Your spider'));
    if (me.nights === 0) {
      const row = div('row');
      for (const sp of Object.keys(SPECIES)) {
        const have = g.profile.unlocked.species.includes(sp);
        const how = { orb: 'Builds webs', jumper: have ? 'Stalks and pounces' : 'Finish three nights', bolas: have ? 'Fishes for moths' : 'Catch fifty moths' }[sp];
        row.append(card(SPECIES[sp].name, how, () => g.request(g.me, { t: 'species', sp }), me.sp === sp, !have));
      }
      this.page.append(row);
    } else this.page.append(note(`${SPECIES[me.sp].name}, ${say(me.nights)} night${me.nights === 1 ? '' : 's'} old.`));
    if (Array.isArray(me.draft) && me.draft.length) {
      this.page.append(label('Choose a trait'));
      const row = div('row');
      for (const t of me.draft) row.append(card(TRAITS[t].name, TRAITS[t].note, () => g.request(g.me, { t: 'trait', tr: t })));
      this.page.append(row);
    }
    if (me.tr.length) this.page.append(note(me.tr.map((t) => TRAITS[t]?.name).filter(Boolean).join(' · ')));
    this.page.append(label(`Moult · ${Math.floor(me.mp)}`));
    const row = div('row');
    for (const id of UPGRADE_KEYS) {
      const u = UPGRADES[id];
      if (!u.for.includes(me.sp)) continue;
      const tier = me.up[id] | 0;
      const cost = upgradeCost(id, tier);
      const b = card(u.name, tier >= 3 ? 'Done' : `${u.tiers[tier]} · ${cost}`, () => g.request(g.me, { t: 'buy', up: id }), false, tier >= 3 || me.mp < cost);
      b.append(pips(tier));
      row.append(b);
    }
    this.page.append(row);
  }

  friends(s) {
    const g = this.game;
    const players = [...(g.room.players?.values?.() ?? [])];
    if (players.length <= 1) {
      const row = div('row');
      if (platform.onPlatform) row.append(button('go ghost', 'Invite a friend', () => platform.invite()));
      this.page.append(row);
      return;
    }
    this.page.append(label('Friends'));
    const row = div('row');
    for (const p of players) {
      const r = s.roster[p.id];
      const c = card(String(p.name ?? 'Friend').slice(0, 24), `${r ? SPECIES[r.sp].name : '...'}${p.id === g.room.host ? ' · host' : p.ready ? ' · ready' : ''}${p.connected === false ? ' · away' : ''}`, () => {}, p.id === g.me, true);
      c.style.opacity = '1';
      avatar(c, p.id);
      row.append(c);
    }
    if (players.length < 4 && platform.onPlatform) row.append(button('go ghost', 'Invite', () => platform.invite()));
    this.page.append(row);
  }

  seasonEnd(s, res, host) {
    const g = this.game;
    const won = s.over === 'won';
    this.page.append(h2(won ? 'Ten nights' : s.over === 'done' ? 'The daily garden' : 'The garden goes quiet'));
    const last = s.history[s.history.length - 1];
    if (last && res?.t) this.page.append(note(naturalist(last, res.t)), sketches(res.t.eaten));
    this.page.append(note(`Season score ${s.score}.${g.eggsNow ? ` ${say(g.eggsNow)} egg points.` : ''}`));
    if (host) {
      const row = div('row');
      if (won) row.append(button('go', 'Keep going', () => g.request(g.me, { t: 'endless' })));
      row.append(button(won ? 'go ghost' : 'go', 'New season', () => g.request(g.me, { t: 'newseason' })));
      row.append(button('go ghost', 'Daily garden', () => g.request(g.me, { t: 'newseason', daily: dailyOf(platform.now()) })));
      this.page.append(row);
    } else this.page.append(note('The host turns the page.'));
    this.shop();
  }

  shop() {
    const g = this.game;
    const p = g.profile;
    this.page.append(label(`Egg points · ${Math.floor(p.eggs)}`));
    const row = div('row');
    for (const item of shopItems(p).slice(0, 12)) {
      row.append(card(cap(item.name), `${item.cost} eggs`, () => {
        if (buyItem(p, item.kind, item.id)) {
          if (item.kind === 'colours') p.equip.colour = item.id;
          if (item.kind === 'dews') p.equip.dew = item.id;
          g.markDirty();
          g.flush(true);
          this.render();
        }
      }, false, p.eggs < item.cost));
    }
    this.page.append(row);
    if (p.unlocked.colours.length > 1) {
      this.page.append(label('Silk'));
      const r2 = div('row');
      for (const c of p.unlocked.colours) r2.append(card(cap(c), '', () => ((p.equip.colour = c), g.markDirty(), this.render()), p.equip.colour === c));
      this.page.append(r2);
    }
    const traits = Object.keys(TRAITS).filter((t) => !p.hatchlings.includes(t)).slice(0, 6);
    if (p.eggs >= HATCHLING_COST) {
      this.page.append(label(`Hatchling · ${HATCHLING_COST} eggs`));
      const r3 = div('row');
      for (const t of traits) r3.append(card(TRAITS[t].name, TRAITS[t].note, () => buyHatchling(p, t) && (g.markDirty(), this.render())));
      this.page.append(r3);
    }
    void UNLOCKS;
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

function gardenLine(id) {
  return { cottage: 'Hedge, roses, a lit window', reed: 'Reeds, mist, dragonflies', greenhouse: 'Glass, lamps, moths', churchyard: 'Stones, yew, wind' }[id];
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
    const c = document.createElement('canvas');
    c.width = 148;
    c.height = 112;
    inkSketch(c, k);
    s.append(c, document.createTextNode(`${PREY[k].name} ×${n}`));
    box.append(s);
  }
  return box;
}

/** A prey drawn in ink: its silhouette in pen colour, hatched. */
function inkSketch(c, sp) {
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2 + 6);
  const size = PREY[sp].size;
  const k = Math.min(9, 52 / Math.max(6, size * 1.4));
  ctx.scale(k, k);
  drawPrey(ctx, { sp, st: 'land', x: 0, y: 0, vx: 1, vy: 0, facing: 1, id: 3, wrap: 0 }, 0.3, 'low');
  ctx.restore();
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#2b2620';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = 'rgba(239, 228, 203, 0.5)';
  ctx.lineWidth = 1.4;
  for (let x = -c.height; x < c.width; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, c.height);
    ctx.lineTo(x + c.height, 0);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawSacs(c, lives) {
  const ctx = c.getContext('2d');
  ctx.scale(c.width / 160, c.height / 44);
  for (let i = 0; i < Math.max(lives, 3); i++) {
    const x = 140 - i * 30;
    ctx.save();
    ctx.translate(x, 22);
    const full = i < lives;
    ctx.fillStyle = full ? '#e9dfc4' : 'transparent';
    ctx.strokeStyle = full ? '#5a4a36' : 'rgba(90, 74, 54, 0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (full) {
      ctx.strokeStyle = 'rgba(90, 74, 54, 0.5)';
      for (let k = -8; k <= 8; k += 4) {
        ctx.beginPath();
        ctx.moveTo(-10, k);
        ctx.quadraticCurveTo(0, k - 4, 10, k);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = 'rgba(169, 68, 44, 0.6)';
      ctx.beginPath();
      ctx.moveTo(-12, -12);
      ctx.lineTo(12, 12);
      ctx.stroke();
    }
    ctx.restore();
  }
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

function avatar(cardEl, id) {
  platform.avatar(id).then((url) => {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.alt = '';
    img.width = 34;
    img.height = 34;
    img.style.cssText = 'float:left;margin:0 8px 0 0;border-radius:50%;background:#d8ccb0';
    img.src = url;
    cardEl.prepend(img);
  });
}

/** Three small drawn dots: how far an upgrade has gone. */
function pips(tier) {
  const c = document.createElement('canvas');
  c.className = 'tiers';
  c.width = 66;
  c.height = 18;
  c.style.width = '33px';
  c.style.height = '9px';
  const ctx = c.getContext('2d');
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(9 + i * 22, 9, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#a9442c';
    if (i < tier) {
      ctx.fillStyle = '#a9442c';
      ctx.fill();
    } else ctx.stroke();
  }
  return c;
}

function h2(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}
function note(text) {
  return div('note', text);
}
function label(text) {
  return div('label', text);
}
function card(title, sub, onClick, on = false, disabled = false) {
  const b = button(`card${on ? ' on' : ''}`, '', onClick);
  b.disabled = disabled;
  const t = document.createElement('b');
  t.textContent = title;
  b.append(t);
  if (sub) {
    const sm = document.createElement('small');
    sm.textContent = sub;
    b.append(sm);
  }
  return b;
}

export { glyph };
