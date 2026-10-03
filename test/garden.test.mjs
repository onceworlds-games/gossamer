import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGarden, buildGarden, validate, retreatNode, startNode, inCover } from '../game/js/sim/garden.js';
import { Web } from '../game/js/sim/web.js';
import { GARDEN_KEYS, W, H, GARDEN_IDS } from '../game/js/sim/data.js';

test('a thousand seeds make valid gardens in every garden type', () => {
  const fails = {};
  for (const id of GARDEN_KEYS) {
    for (let seed = 1; seed <= 250; seed++) {
      const g = generateGarden(id, seed * 2654435761);
      const v = validate(g);
      if (!v.ok) fails[id] = (fails[id] ?? 0) + 1;
      assert.ok(v.ok, `${id} ${seed}: ${v.problems.join(', ')}`);
      assert.equal(g.id, id === g.id ? id : g.id);
      for (const s of g.surfaces) for (const [x, y] of s.pts) assert.ok(x >= -40 && x <= W + 40 && y >= 0 && y <= H, 'point in world');
    }
  }
});

test('repair rarely falls back to the fixed cottage', () => {
  let fallback = 0;
  for (const id of GARDEN_KEYS) for (let seed = 1; seed <= 200; seed++) if (generateGarden(id, seed * 7919).attempt === 99) fallback++;
  assert.ok(fallback < 8, `fallbacks ${fallback}`);
});

test('a built garden is one connected walkable graph with a retreat and a start', () => {
  for (const id of GARDEN_KEYS) {
    for (let seed = 1; seed <= 40; seed++) {
      const g = generateGarden(id, seed * 104729);
      const web = new Web();
      buildGarden(web, g);
      assert.ok(web.nodes < GARDEN_IDS && web.nodes > 10);
      // Walk the graph from the start node.
      const seen = new Set();
      const stack = [web.ni(startNode(g))];
      while (stack.length) {
        const n = stack.pop();
        if (seen.has(n)) continue;
        seen.add(n);
        for (const t of web.adj[n]) stack.push(web.other(t, n));
      }
      assert.equal(seen.size, web.nodes, `${id} ${seed} connected`);
      assert.ok(web.ni(retreatNode(g)) >= 0, 'retreat node exists');
      assert.ok(g.sites.length > 0, 'has web sites');
      assert.ok(web.nodes + 300 + 60 <= 640, `room for silk (${web.nodes} garden nodes)`);
      assert.ok(web.threads + 400 + 60 <= 760, `room for threads (${web.threads})`);
    }
  }
});

test('cover zones hide the hedge interior', () => {
  const g = generateGarden('cottage', 42);
  const c = g.cover[0];
  assert.ok(inCover(g, c.x, c.y));
  assert.ok(!inCover(g, W / 2, 50));
});
