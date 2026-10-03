import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, command } from '../game/js/sim/world.js';
import { snapRadiusFor } from '../game/js/sim/actions.js';
import { placeAt } from '../game/js/sim/spider.js';
import { removeThread } from '../game/js/sim/actions.js';
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

test('a tab hidden for a minute (or a 400 ms frame) comes back to a calm night, not a minute of simulation', async () => {
  const { NightRun } = await import('../game/js/app/nightrun.js');
  const run = new NightRun({ seed: 9, night: 3, garden: 'cottage', mode: 'season', players: [{ id: 'a', sp: 'orb' }] }, { role: 'host', myId: 'a' });
  const t0 = run.world.t;
  const ticks = run.update(60, { mx: 0, my: 0 });
  assert.ok(ticks <= 30, `ran ${ticks} ticks`);
  assert.ok(run.world.t - t0 < 0.55, 'the world moved half a second at most');
  assert.ok(run.acc < 1 / 60 + 1e-9, 'no backlog is kept');
  assert.equal(run.update(0.4, { mx: 0, my: 0 }) <= 16, true);
  for (const sp of run.world.spiders) assert.ok(Number.isFinite(sp.x) && Number.isFinite(sp.y));
});

test('the last Quick Orb is offered back once the wren has taken it', async () => {
  const { NightRun } = await import('../game/js/app/nightrun.js');
  const w0 = createWorld({ seed: 31, night: 4, garden: 'cottage', players: [{ id: 'a', sp: 'orb' }] });
  const site = w0.garden.sites.find((s) => s.lane === 0) ?? w0.garden.sites[0];
  const run = new NightRun({ seed: 31, night: 4, garden: 'cottage', mode: 'season', players: [{ id: 'a', sp: 'orb' }] }, { role: 'host', myId: 'a' });
  const w = run.world;
  w.script.events = [];
  const sp = w.spiders[0];
  sp.silk = sp.mods.maxSilk = 400;
  const from = w.web.nearestNode(site.x, site.y, 500, (s) => w.web.adj[s].length > 0 && w.web.kind[s] === 0);
  if (from) placeAt(w, sp, from.id);
  const heard = [];
  run.onEvent = (e) => heard.push(e.k);
  run.command({ t: 'orb', x: site.x, y: site.y, r: 95, p: 'orb' });
  for (let i = 0; i < 60 * 9; i++) run.update(1 / 60, { mx: 0, my: 0 });
  assert.ok(run.lastOrb && run.lastOrb.n0 > 10, 'the orb is remembered with its strands counted');
  assert.equal(run.ghost, null);
  // The wren takes everything.
  for (let s = 0; s < w.web.threadHigh; s++) if (w.web.tid[s] >= 2000 && w.web.type[s] !== 5) removeThread(w, w.web.tid[s], 4); // silk, not the branches it hung from
  for (let i = 0; i < 60 * 4; i++) run.update(1 / 60, { mx: 0, my: 0 });
  assert.ok(run.ghost, 'the torn web is ringed');
  // Back on a branch (the spider fell with the web).
  const back = w.web.nearestNode(site.x, site.y, 500, (s) => w.web.adj[s].length > 0 && w.web.kind[s] === 0);
  placeAt(w, run.me(), back.id);
  assert.equal(run.type, 4, 'and the orb is in hand');
  assert.ok(heard.includes('ghost'));
  // R spins it again where it hung.
  run.respin(run.me());
  for (let i = 0; i < 60 * 9; i++) run.update(1 / 60, { mx: 0, my: 0 });
  assert.equal(run.ghost, null);
  assert.ok(run.silkAround(run.lastOrb) > run.lastOrb.n0 * 0.5, 'the web is back');
});

test('a key held when the notebook comes up is let go, and browser shortcuts are not moves', async () => {
  globalThis.addEventListener = () => {};
  globalThis.document = { addEventListener() {}, hidden: false };
  const { Input } = await import('../game/js/app/input.js');
  const input = new Input({ addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} });
  const press = (key, extra = {}) => input.key({ key, repeat: false, preventDefault() {}, ...extra }, true);
  const release = (key) => input.key({ key, preventDefault() {} }, false);
  press('d');
  assert.equal(input.keys.size, 0, 'nothing is read while the controls are off');
  input.enabled = true;
  press('d');
  press('e');
  assert.ok(input.keys.has('d'));
  input.take();
  input.enabled = false; // the night ended with D and E down
  assert.equal(input.keys.size, 0, 'switching off lets go of every key');
  release('d'); // and the late key-up changes nothing
  input.enabled = true;
  assert.equal(input.keys.size, 0, 'the next night starts standing still');
  input.take();
  press('r', { ctrlKey: true });
  press('f', { metaKey: true });
  assert.deepEqual(input.take(), [], 'Ctrl+R and Cmd+F do nothing in the garden');
  press('r');
  assert.deepEqual(input.take().map((e) => e.t), ['respin']);
});
