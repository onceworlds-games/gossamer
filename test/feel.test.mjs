import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, command } from '../game/js/sim/world.js';
import { snapRadiusFor } from '../game/js/sim/actions.js';
import { placeAt } from '../game/js/sim/spider.js';
import { SNAP_RADIUS } from '../game/js/sim/data.js';

function anchorsNear(w, sp, lo, hi, n) {
  const web = w.web;
  const out = [];
  for (let s = 0; s < web.nodeHigh; s++) {
    if (web.nid[s] < 0 || web.nid[s] >= 2000 || web.adj[s].length === 0) continue;
    const d = Math.hypot(web.x[s] - sp.x, web.y[s] - sp.y);
    if (d >= lo && d <= hi && web.nid[s] !== sp.node) out.push({ x: web.x[s], y: web.y[s], d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}

test('a cast tapped during the last one is remembered, not refused', () => {
  const w = createWorld({ seed: 11, night: 2, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  const sp = w.spiders[0];
  const [t1, t2] = anchorsNear(w, sp, 90, 380, 2);
  assert.ok(t1 && t2, 'two anchors in reach');
  command(w, { id: 'a', t: 'cast', type: 0, x: t1.x, y: t1.y });
  assert.ok(sp.busy > 0, 'the first cast leaves the spinneret busy');
  command(w, { id: 'a', t: 'cast', type: 0, x: t2.x, y: t2.y });
  assert.ok(sp.queued, 'the second waits');
  assert.equal(w.ev.filter((e) => e.k === 'refuse').length, 0);
  for (let i = 0; i < 60; i++) stepWorld(w, {});
  assert.equal(w.web.playerThreads, 2, 'both casts happened');
  assert.ok(!sp.queued);
});

test('a queued cast that waits too long is dropped', () => {
  const w = createWorld({ seed: 11, night: 2, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  const sp = w.spiders[0];
  const [t1, t2] = anchorsNear(w, sp, 90, 380, 2);
  command(w, { id: 'a', t: 'cast', type: 0, x: t1.x, y: t1.y });
  sp.busy = 5;
  command(w, { id: 'a', t: 'cast', type: 0, x: t2.x, y: t2.y });
  assert.ok(!sp.queued, 'a long pause (a bite, a shake) is refused as before');
  assert.equal(w.ev.filter((e) => e.k === 'refuse' && e.why === 'busy').length, 1);
});

test('spinning a Quick Orb eases the spider to the hub: no jump, and it ends on the hub', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const w = createWorld({ seed: seed * 977, night: 3, garden: ['cottage', 'reed', 'greenhouse', 'churchyard'][seed % 4], players: [{ id: 'a', sp: 'orb' }] });
    const sp = w.spiders[0];
    sp.silk = sp.mods.maxSilk = 300;
    const site = w.garden.sites.find((s) => s.lane === 0) ?? w.garden.sites[0];
    // Start anywhere in reach of the site (as far as the pointer's range allows).
    const from = w.web.nearestNode(site.x + (seed % 2 ? 300 : -200), site.y + 60, 300, (s) => w.web.adj[s].length > 0 && w.web.kind[s] === 0);
    if (from) placeAt(w, sp, from.id);
    w.cmds.push({ id: 'a', t: 'orb', x: site.x, y: site.y, r: site.r, p: 'orb' });
    let last = { x: sp.x, y: sp.y };
    let worst = 0;
    let started = false;
    for (let i = 0; i < 60 * 12 && (!started || sp.act); i++) {
      stepWorld(w, {});
      if (sp.act) started = true;
      worst = Math.max(worst, Math.hypot(sp.x - last.x, sp.y - last.y));
      last = { x: sp.x, y: sp.y };
    }
    if (!started) continue; // this garden had no room for one here
    assert.ok(worst < 9, `seed ${seed}: the spider moved ${worst.toFixed(1)} px in one tick`);
    const hub = w.web.pos(sp.node);
    assert.ok(hub && Math.hypot(hub.x - sp.x, hub.y - sp.y) < 0.5, 'it ends on the hub');
    assert.equal(sp.glide, null);
  }
});

test('a command that throws is dropped and never stalls the night', () => {
  const w = createWorld({ seed: 5, night: 2, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  w.cmds.push({ id: 'a', t: 'cast', type: { toString() { throw new Error('lie'); } }, x: 1, y: 1 });
  w.cmds.push({ id: 'a', t: 'prey', sp: 'constructor', x: 10, y: 10 });
  w.cmds.push({ id: 'a', t: '__proto__', x: 10, y: 10 });
  assert.doesNotThrow(() => stepWorld(w, {}));
  assert.equal(w.cmds.length, 0);
  assert.equal(w.cmdErrors, 1);
  for (let i = 0; i < 120; i++) stepWorld(w, {});
});

test('the pointer reaches at least 48 screen px, however far out the view is zoomed', () => {
  assert.equal(snapRadiusFor(1.5), SNAP_RADIUS);
  assert.ok(snapRadiusFor(0.6) > SNAP_RADIUS && snapRadiusFor(0.6) * 0.6 >= 47.9);
  assert.ok(snapRadiusFor(0.01) <= SNAP_RADIUS * 1.8 + 1e-9);
  assert.equal(snapRadiusFor(NaN), SNAP_RADIUS);
});
