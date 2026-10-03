import test from 'node:test';
import assert from 'node:assert/strict';
import { Web } from '../game/js/sim/web.js';
import { N_ANCHOR, N_JUNCTION, N_PREY, T_FRAME, T_RADIAL, T_STICKY, T_SURFACE, GARDEN_IDS, MAX_NODES, MAX_THREADS, W, H } from '../game/js/sim/data.js';
import { makeRng, rand, range } from '../game/js/sim/rng.js';

function hanging() {
  const web = new Web();
  const a = web.addNode(100, 100, N_ANCHOR, { id: 1 });
  const b = web.addNode(300, 100, N_ANCHOR, { id: 2 });
  web.nextNode = GARDEN_IDS;
  web.nextThread = GARDEN_IDS;
  const j = web.addNode(200, 100, N_JUNCTION, { player: true });
  const t1 = web.addThread(a, j, T_FRAME);
  const t2 = web.addThread(j, b, T_FRAME);
  return { web, a, b, j, t1, t2 };
}

const env = { sway: 0, windX: 0, windY: 0 };
const finite = (web) => {
  for (let s = 0; s < web.nodeHigh; s++) if (web.nid[s] >= 0 && (!Number.isFinite(web.x[s]) || !Number.isFinite(web.y[s]))) return false;
  return true;
};

test('a knot hung between two anchors settles a little below them and stays finite', () => {
  const { web, j } = hanging();
  for (let i = 0; i < 600; i++) web.step(env);
  const p = web.pos(j);
  assert.ok(finite(web));
  assert.ok(p.y > 100 && p.y < 110, `sag ${p.y}`);
  assert.ok(Math.abs(p.x - 200) < 1);
});

test('an overloaded sticky thread snaps after staying past its limit', () => {
  const web = new Web();
  const a = web.addNode(100, 100, N_ANCHOR, { id: 1 });
  web.nextNode = GARDEN_IDS;
  const j = web.addNode(100, 140, N_JUNCTION, { mass: 0.05 });
  const t = web.addThread(a, j, T_STICKY);
  let snapped = false;
  for (let i = 0; i < 120 && !snapped; i++) {
    web.load.fill(0);
    web.load[web.ni(j)] = 80; // something very heavy hanging on it
    snapped = web.step(env).includes(t);
  }
  assert.ok(snapped);
});

test('splitting keeps the rest length and moves a spider reference onto the right half', () => {
  const { web, t1 } = hanging();
  const rest = web.rest[web.ti(t1)];
  const r = web.splitThread(t1, 0.25, { player: true });
  assert.ok(r);
  assert.equal(web.ti(t1), -1);
  const total = web.rest[web.ti(r.a)] + web.rest[web.ti(r.b)];
  assert.ok(Math.abs(total - rest) < 1e-6);
  const p = web.pos(r.node);
  assert.ok(Math.abs(p.x - 125) < 0.5);
});

test('removing a thread prunes knots left hanging free, but not stuck prey', () => {
  const { web, t1, t2, j } = hanging();
  web.removeThread(t1);
  assert.ok(web.ni(j) >= 0, 'still held by the other thread');
  web.removeThread(t2);
  assert.equal(web.ni(j), -1, 'a free knot with no threads is gone');
  const w2 = hanging();
  w2.web.setKind(w2.j, N_PREY);
  w2.web.removeThread(w2.t1);
  w2.web.removeThread(w2.t2);
  assert.ok(w2.web.ni(w2.j) >= 0, 'a prey knot stays to fall');
});

test('another page following the ops ends up with the same web', () => {
  const host = new Web();
  const mirror = new Web();
  for (const w of [host, mirror]) {
    w.addNode(0, 0, N_ANCHOR, { id: 1 });
    w.addNode(400, 0, N_ANCHOR, { id: 2 });
    w.addNode(200, 300, N_ANCHOR, { id: 3 });
    w.addThread(1, 2, T_SURFACE, { id: 1, flag: 1 });
    w.nextNode = GARDEN_IDS;
    w.nextThread = GARDEN_IDS;
  }
  host.ops = [];
  const j = host.addNode(200, 100, N_JUNCTION, { player: true });
  host.addThread(1, j, T_FRAME);
  host.addThread(j, 3, T_RADIAL);
  const t = host.addThread(j, 2, T_STICKY);
  host.splitThread(t, 0.5, { kind: N_PREY, mass: 1 });
  host.splitThread(1, 0.4); // a cast onto the branch
  mirror.applyOps(host.ops);
  const sig = (w) => {
    const out = [];
    for (let s = 0; s < w.threadHigh; s++) if (w.tid[s] >= 0) out.push([w.tid[s], w.nid[w.ta[s]], w.nid[w.tb[s]], w.type[s], w.rest[s].toFixed(1), w.flag[s]].join(':'));
    return out.sort().join(',');
  };
  assert.equal(sig(mirror), sig(host));
});

test('a checkpoint carries the silk and the split branches, and nothing else', () => {
  const build = () => {
    const w = new Web();
    w.addNode(0, 0, N_ANCHOR, { id: 1 });
    w.addNode(400, 0, N_ANCHOR, { id: 2 });
    w.addNode(400, 400, N_ANCHOR, { id: 3 });
    w.addThread(1, 2, T_SURFACE, { id: 1 });
    w.addThread(2, 3, T_SURFACE, { id: 2 });
    w.nextNode = GARDEN_IDS;
    w.nextThread = GARDEN_IDS;
    return w;
  };
  const a = build();
  const r = a.splitThread(2, 0.5);
  const j = a.addNode(150, 120, N_JUNCTION, { player: true });
  a.addThread(1, j, T_FRAME);
  a.addThread(j, r.node, T_STICKY);
  for (let i = 0; i < 30; i++) a.step(env);
  const ck = a.pack(2);
  const b = build();
  b.unpack(ck);
  assert.equal(b.threads, a.threads);
  assert.equal(b.nodes, a.nodes);
  assert.equal(b.ti(2), -1, 'the split branch is gone in the copy too');
  const pa = a.pos(j);
  const pb = b.pos(j);
  assert.ok(Math.abs(pa.x - pb.x) < 0.2 && Math.abs(pa.y - pb.y) < 0.2);
});

test('fuzz: random building, cutting, splitting and kicking never goes non-finite or out of bounds', () => {
  const r = makeRng(99);
  const web = new Web();
  const anchors = [];
  for (let i = 0; i < 12; i++) anchors.push(web.addNode(range(r, 100, 1500), range(r, 100, 900), N_ANCHOR, { id: i + 1, sway: range(r, 0, 20) }));
  web.nextNode = GARDEN_IDS;
  web.nextThread = GARDEN_IDS;
  const nodes = [...anchors];
  for (let tick = 0; tick < 4000; tick++) {
    const op = rand(r);
    if (op < 0.1) {
      const a = nodes[Math.floor(rand(r) * nodes.length)];
      const b = nodes[Math.floor(rand(r) * nodes.length)];
      if (a !== b && web.ni(a) >= 0 && web.ni(b) >= 0) web.addThread(a, b, Math.floor(rand(r) * 4));
    } else if (op < 0.14 && web.threads) {
      const s = Math.floor(rand(r) * web.threadHigh);
      if (web.tid[s] >= 0) {
        const res = web.splitThread(web.tid[s], rand(r), { kind: rand(r) < 0.3 ? N_PREY : N_JUNCTION, mass: range(r, 0.05, 6) });
        if (res) nodes.push(res.node);
      }
    } else if (op < 0.17) {
      const s = Math.floor(rand(r) * web.threadHigh);
      if (web.tid[s] >= 0) web.removeThread(web.tid[s]);
    } else if (op < 0.25) {
      const s = Math.floor(rand(r) * web.threadHigh);
      if (web.tid[s] >= 0) web.pluck(s, range(r, 0, 3000), range(r, 0, 5000), range(r, -1, 1), range(r, -1, 1));
    }
    web.load.fill(0, 0, web.nodeHigh);
    for (let s = 0; s < web.nodeHigh; s++) if (web.nid[s] >= 0 && rand(r) < 0.02) web.load[s] = range(r, 0, 10);
    const snapped = web.step({ sway: Math.sin(tick * 0.01), windX: range(r, -200, 200), windY: 0 });
    for (const id of snapped) web.removeThread(id, 2);
    assert.ok(web.nodes <= MAX_NODES && web.threads <= MAX_THREADS);
  }
  assert.ok(finite(web));
  for (let s = 0; s < web.nodeHigh; s++) {
    if (web.nid[s] < 0) continue;
    assert.ok(web.x[s] >= -300 && web.x[s] <= W + 300 && web.y[s] >= -300 && web.y[s] <= H + 200, `node in bounds ${web.x[s]},${web.y[s]}`);
  }
});
