import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, command } from '../game/js/sim/world.js';
import { encodeSketch, decodeSketch, SKETCH_MAX } from '../game/js/sim/sketch.js';
import { placeAt } from '../game/js/sim/spider.js';

function webAfterOrbs(n) {
  const w = createWorld({ seed: 31, night: 3, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  w.script.events = [];
  const sp = w.spiders[0];
  sp.silk = sp.mods.maxSilk = 1000;
  for (let i = 0; i < n; i++) {
    const site = w.garden.sites[i % w.garden.sites.length];
    const from = w.web.nearestNode(site.x, site.y, 500, (s) => w.web.adj[s].length > 0 && w.web.kind[s] === 0);
    if (from) placeAt(w, sp, from.id);
    command(w, { id: 'a', t: 'orb', x: site.x, y: site.y, r: 95, p: 'orb' });
    for (let k = 0; k < 60 * 9 && (sp.act || k < 2); k++) stepWorld(w, {});
  }
  return w;
}

test("the night's web survives the trip into a result and back, and stays small", () => {
  const w = webAfterOrbs(3);
  const str = encodeSketch(w.web);
  assert.ok(str.length > 100 && str.length < 3600, `size ${str.length}`);
  const sk = decodeSketch(str);
  assert.ok(sk && sk.segs.length >= 20 && sk.segs.length <= SKETCH_MAX);
  assert.ok(sk.w > 20 && sk.h > 20 && sk.w <= 255.01 && sk.h <= 255.01);
  for (const q of sk.segs) for (const v of [q.x0, q.y0, q.x1, q.y1]) assert.ok(v >= 0 && v <= 255);
});

test('an empty web makes no sketch, and a result full of junk draws none', () => {
  const w = createWorld({ seed: 31, night: 3, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  assert.equal(encodeSketch(w.web), '');
  for (const junk of [undefined, null, 5, {}, '', 'AAAA', 'not base64!!', 'A'.repeat(7000), btoa('\u0010\u0010\u0000\u0005xx')]) assert.equal(decodeSketch(junk), null, String(junk).slice(0, 20));
});
