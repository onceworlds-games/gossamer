// Routes over the silk-and-branch graph (Dijkstra on thread length; sticky silk counts extra because it's slow).
import { N_PREY, T_STICKY } from './data.js';

/** Node ids from (not including) the start slot to the goal slot, or null. */
export function route(web, start, goal, stickyCost = 2.5, maxNodes = 4000) {
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [];
  const n = web.nodeHigh;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[start] = 0;
  // A small binary heap of [dist, slot].
  const heap = [[0, start]];
  let pops = 0;
  while (heap.length && pops++ < maxNodes) {
    const [d, u] = pop(heap);
    if (done[u]) continue;
    done[u] = 1;
    if (u === goal) break;
    for (const t of web.adj[u]) {
      const v = web.other(t, u);
      if (done[v] || (web.kind[v] === N_PREY && v !== goal)) continue;
      const w = (web.len[t] || 1) * (web.type[t] === T_STICKY ? stickyCost : 1);
      if (d + w < dist[v]) {
        dist[v] = d + w;
        prev[v] = u;
        push(heap, [d + w, v]);
      }
    }
  }
  if (!done[goal]) return null;
  const out = [];
  for (let v = goal; v !== start && v >= 0; v = prev[v]) out.push(web.nid[v]);
  return out.reverse();
}

/** The slot a spider stands nearest to (its node, or the nearer end of its thread). */
export function standSlot(web, sp) {
  if (sp.node) return web.ni(sp.node);
  const t = web.ti(sp.th);
  if (t < 0) return -1;
  return sp.s < 0.5 ? web.ta[t] : web.tb[t];
}

function push(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function pop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
