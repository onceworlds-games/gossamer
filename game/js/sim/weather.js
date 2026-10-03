// Wind, gusts (with a warning), rain that washes the glue, mist that thickens the dew, and the firefly bloom. Dew
// beads gather on silk with the humidity: they weigh the web down and make it easier for prey to see.
import { T_SURFACE, DT, W } from './data.js';

export function makeWeather(script) {
  return {
    base: script.wind,
    windX: 0,
    windY: 0,
    sway: 0,
    gust: null,
    rain: false,
    wet: 0,
    mist: false,
    humidity: script.humidity,
    bloom: 0,
    tick: 0,
  };
}

/** Called by the night script when a weather event begins. */
export function weatherEvent(world, e) {
  const w = world.weather;
  switch (e.k) {
    case 'gust':
      w.gust = { t: 0, dur: e.dur, dir: e.dir, power: e.power * (world.rules.windreader ? 0.7 : 1) };
      world.tally.gusts++;
      break;
    case 'gustwarn':
      world.ev.push({ k: 'gustwarn', dir: e.dir, power: e.power, lead: e.lead });
      break;
    case 'rain':
      w.rain = true;
      w.rainEnd = world.t + e.dur;
      world.tally.rain = true;
      world.ev.push({ k: 'rain', on: true });
      break;
    case 'mist':
      w.mist = true;
      w.mistEnd = world.t + e.dur;
      world.tally.mist = true;
      world.ev.push({ k: 'mist', on: true });
      break;
    case 'bloom':
      w.bloom = e.dur;
      world.ev.push({ k: 'bloom', x: e.x, y: e.y });
      for (const l of world.lights) {
        if (l.kind === 'fireflies') {
          l.tx = e.x;
          l.ty = e.y;
        }
      }
      break;
    default:
      break;
  }
}

export function updateWeather(world, dt) {
  const w = world.weather;
  const t = world.t;
  // Wind: a slow breathing base plus any gust (a quick rise, a hold, a long fall).
  let wind = w.base * (0.6 + 0.4 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1));
  if (w.gust) {
    const g = w.gust;
    g.t += dt;
    const f = g.t < 0.6 ? g.t / 0.6 : g.t < g.dur ? 1 : Math.max(0, 1 - (g.t - g.dur) / 1.6);
    wind += g.dir * g.power * f * f;
    if (g.t > g.dur + 1.6) w.gust = null;
  }
  w.windX = wind;
  w.windY = Math.sin(t * 0.9) * 6;
  // Plants lag the wind a little.
  w.sway += (Math.max(-1.2, Math.min(1.2, wind / 140)) - w.sway) * Math.min(1, dt * 2.2);
  if (w.rain && t >= w.rainEnd) {
    w.rain = false;
    w.wet = 20;
    world.ev.push({ k: 'rain', on: false });
  }
  if (!w.rain && w.wet > 0) w.wet -= dt;
  if (w.mist && t >= w.mistEnd) {
    w.mist = false;
    world.ev.push({ k: 'mist', on: false });
  }
  if (w.bloom > 0) w.bloom -= dt;
  const glue = world.rules.gluerain;
  world.stickFactor = w.rain || w.wet > 0 ? (glue ? 1.2 : 1 - world.rules.wash) : 1;
  world.web.snapScale = world.rules.brittle && (w.rain || w.wet > 0) ? 0.72 : 1;
  const progress = Math.min(1, t / (world.dusk + world.length));
  w.humidity = Math.min(1, world.script.humidity + progress * 0.25 + (w.rain ? 0.7 : 0) + (w.mist ? 0.5 : 0));
  // Fireflies drift (toward the bloom while it lasts); a lantern-bearer carries a few.
  for (const l of world.lights) {
    if (l.kind === 'fireflies') {
      const tx = w.bloom > 0 ? l.tx ?? l.x0 : l.x0;
      const ty = w.bloom > 0 ? l.ty ?? l.y0 : l.y0;
      l.x += (tx + Math.sin(t * 0.4 + l.y0) * 30 - l.x) * dt * 0.4;
      l.y += (ty + Math.cos(t * 0.33) * 20 - l.y) * dt * 0.4;
      l.power = l.p0 * (w.bloom > 0 ? 2.4 : 1) * (w.rain ? 0.3 : 1);
    } else if (l.kind === 'lantern') {
      const sp = world.spiders.find((s) => s.id === l.owner);
      if (sp) {
        l.x += (sp.x - l.x) * dt * 1.5;
        l.y += (sp.y - 30 - l.y) * dt * 1.5;
      }
    }
  }
  // Dew: every tenth tick, beads grow on silk (not on freshly shaken threads).
  if (++w.tick % 10 === 0) growDew(world, dt * 10);
}

function growDew(world, dt) {
  const web = world.web;
  const rate = 0.55 * world.weather.humidity * world.weather.humidity;
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] === T_SURFACE) continue;
    if (web.dry[s] > 0) {
      web.dry[s] -= dt;
      continue;
    }
    const cap = Math.min(40, web.len[s] / 7);
    if (web.dew[s] < cap) web.dew[s] = Math.min(cap, web.dew[s] + rate * (web.len[s] / 100) * dt);
  }
}

/** Mass the dew adds to each knot this tick (half of each thread's beads to each end). */
export function dewLoad(web, beadMass) {
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] === T_SURFACE || web.dew[s] < 0.5) continue;
    const m = web.dew[s] * beadMass * 0.5;
    web.load[web.ta[s]] += m;
    web.load[web.tb[s]] += m;
  }
}

export { DT, W };
