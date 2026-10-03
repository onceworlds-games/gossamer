// The web: silk knots (nodes) and threads between them, simulated as verlet points with soft (XPBD) distance
// constraints at a fixed 60 Hz in substeps. Threads go slack instead of pushing, and snap when they stay stretched
// past their limit. Garden branches are threads too (static, unbreakable), so walking is one graph.
// Ids are never reused within a night; slots are. Structural changes can be logged as ops for other players.
import {
  MAX_NODES, MAX_THREADS, SUBSTEPS, DT, GRAVITY, SILK_E, DAMP, SNAP, VMAX, THREADS, T_SURFACE, T_STICKY, T_ALARM,
  N_ANCHOR, N_JUNCTION, N_PREY, JUNCTION_MASS, W, H, GARDEN_IDS,
} from './data.js';
import { Writer, Reader } from './pack.js';

const MAX_DEG = 24;
const H_SUB = DT / SUBSTEPS;
const CELL = 80;
const GW = Math.ceil((W + 400) / CELL);
const GH = Math.ceil((H + 400) / CELL);
const GOX = -200;
const GOY = -200;

export class Web {
  constructor() {
    const N = MAX_NODES;
    const T = MAX_THREADS;
    this.nid = new Int32Array(N).fill(-1);
    this.x = new Float64Array(N);
    this.y = new Float64Array(N);
    this.px = new Float64Array(N);
    this.py = new Float64Array(N);
    this.ox = new Float64Array(N); // position at the start of the tick
    this.oy = new Float64Array(N);
    this.bx = new Float64Array(N); // anchors: rest position on the plant
    this.by = new Float64Array(N);
    this.sway = new Float32Array(N);
    this.phase = new Float32Array(N);
    this.mass = new Float64Array(N);
    this.load = new Float64Array(N);
    this.inv = new Float64Array(N);
    this.area = new Float64Array(N);
    this.kind = new Uint8Array(N);
    this.nplayer = new Uint8Array(N);
    this.adj = Array.from({ length: N }, () => []);
    this.tid = new Int32Array(T).fill(-1);
    this.ta = new Int16Array(T);
    this.tb = new Int16Array(T);
    this.type = new Uint8Array(T);
    this.rest = new Float64Array(T);
    this.str = new Float32Array(T);
    this.comp = new Float64Array(T);
    this.snap = new Float32Array(T);
    this.stick = new Float32Array(T);
    this.dew = new Float32Array(T);
    this.vib = new Float32Array(T);
    this.len = new Float32Array(T);
    this.over = new Uint8Array(T);
    this.born = new Float32Array(T);
    this.dry = new Float32Array(T); // seconds a shaken thread stays free of dew
    this.flag = new Uint8Array(T); // branches: 1 = casts snag on it, 2 = solid to prey (glass)
    this.gridStart = new Int32Array(GW * GH + 1);
    this.gridItems = new Int16Array(MAX_THREADS * 24);
    this.stamp = new Uint32Array(T);
    this.stampN = 1;
    this.reset();
  }

  reset() {
    this.nid.fill(-1);
    this.tid.fill(-1);
    for (const a of this.adj) a.length = 0;
    this.nodeMap = new Map();
    this.threadMap = new Map();
    this.nextNode = 1;
    this.nextThread = 1;
    this.nodeHigh = 0;
    this.threadHigh = 0;
    this.nodes = 0;
    this.threads = 0;
    this.playerNodes = 0;
    this.playerThreads = 0;
    this.time = 0;
    this.ops = null;
    this.snapped = [];
    this.gridOk = false;
    this.snapScale = 1;
  }

  ni(id) {
    const s = this.nodeMap.get(id);
    return s === undefined ? -1 : s;
  }
  ti(id) {
    const s = this.threadMap.get(id);
    return s === undefined ? -1 : s;
  }
  log(op) {
    if (this.ops) this.ops.push(op);
  }

  // ---------------------------------------------------------------- nodes
  addNode(x, y, kind, o = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    let s = -1;
    for (let i = 0; i < MAX_NODES; i++) {
      if (this.nid[i] < 0) {
        s = i;
        break;
      }
    }
    if (s < 0) return -1;
    const id = o.id ?? this.nextNode++;
    if (o.id && o.id >= this.nextNode) this.nextNode = o.id + 1;
    this.nid[s] = id;
    this.nodeMap.set(id, s);
    this.x[s] = this.px[s] = this.ox[s] = x;
    this.y[s] = this.py[s] = this.oy[s] = y;
    this.bx[s] = o.bx ?? x;
    this.by[s] = o.by ?? y;
    this.kind[s] = kind;
    this.sway[s] = o.sway ?? 0;
    this.phase[s] = o.phase ?? 0;
    this.mass[s] = o.mass ?? JUNCTION_MASS;
    this.load[s] = 0;
    this.inv[s] = kind === N_ANCHOR ? 0 : 1 / this.mass[s];
    this.nplayer[s] = o.player ? 1 : 0;
    this.adj[s].length = 0;
    if (o.vx) this.px[s] = x - o.vx * H_SUB;
    if (o.vy) this.py[s] = y - o.vy * H_SUB;
    this.nodes++;
    if (this.nplayer[s]) this.playerNodes++;
    if (s >= this.nodeHigh) this.nodeHigh = s + 1;
    this.log(['n', id, r1(x), r1(y), kind, r1(this.bx[s]), r1(this.by[s]), r2(this.sway[s]), r2(this.phase[s]), r3(this.mass[s]), this.nplayer[s]]);
    return id;
  }

  removeNode(id) {
    const s = this.ni(id);
    if (s < 0) return false;
    const list = this.adj[s].slice();
    for (const t of list) this.removeThread(this.tid[t], 0, false);
    this.nid[s] = -1;
    this.nodeMap.delete(id);
    this.nodes--;
    if (this.nplayer[s]) this.playerNodes--;
    this.adj[s].length = 0;
    this.log(['N', id]);
    return true;
  }

  setMass(id, mass) {
    const s = this.ni(id);
    if (s < 0) return;
    this.mass[s] = Math.max(0.005, Number(mass) || JUNCTION_MASS);
    this.log(['m', id, r3(this.mass[s])]);
  }

  setKind(id, kind) {
    const s = this.ni(id);
    if (s < 0) return;
    this.kind[s] = kind;
    this.log(['k', id, kind]);
  }

  // ---------------------------------------------------------------- threads
  addThread(aId, bId, type, o = {}) {
    const a = this.ni(aId);
    const b = this.ni(bId);
    if (a < 0 || b < 0 || a === b) return -1;
    if (this.adj[a].length >= MAX_DEG || this.adj[b].length >= MAX_DEG) return -1;
    let s = -1;
    for (let i = 0; i < MAX_THREADS; i++) {
      if (this.tid[i] < 0) {
        s = i;
        break;
      }
    }
    if (s < 0) return -1;
    const id = o.id ?? this.nextThread++;
    if (o.id && o.id >= this.nextThread) this.nextThread = o.id + 1;
    const d = Math.hypot(this.x[b] - this.x[a], this.y[b] - this.y[a]);
    const def = THREADS[type] ?? THREADS[0];
    this.tid[s] = id;
    this.threadMap.set(id, s);
    this.ta[s] = a;
    this.tb[s] = b;
    this.type[s] = type;
    this.rest[s] = Math.max(1, o.rest ?? d * def.taut);
    this.str[s] = o.strength ?? def.strength;
    this.comp[s] = this.rest[s] / (Math.max(1, this.str[s]) * SILK_E);
    this.snap[s] = o.snap ?? SNAP;
    this.stick[s] = o.stick ?? (type === T_STICKY ? 1 : 0);
    this.dew[s] = o.dew ?? 0;
    this.dry[s] = 0;
    this.flag[s] = o.flag ?? 0;
    this.vib[s] = o.vib ?? 0;
    this.len[s] = d;
    this.over[s] = 0;
    this.born[s] = o.born ?? this.time;
    this.adj[a].push(s);
    this.adj[b].push(s);
    this.threads++;
    if (type !== T_SURFACE) this.playerThreads++;
    if (s >= this.threadHigh) this.threadHigh = s + 1;
    this.gridOk = false;
    this.log(['t', id, aId, bId, type, r2(this.rest[s]), r1(this.str[s]), r3(this.snap[s]), r2(this.stick[s]), r2(this.dew[s]), r2(this.born[s]), this.flag[s]]);
    return id;
  }

  /** Removes a thread; junctions left hanging free are removed too (prey nodes stay: they fall). */
  removeThread(id, reason = 0, prune = true) {
    const s = this.ti(id);
    if (s < 0) return false;
    const a = this.ta[s];
    const b = this.tb[s];
    this.tid[s] = -1;
    this.threadMap.delete(id);
    dropFrom(this.adj[a], s);
    dropFrom(this.adj[b], s);
    this.threads--;
    if (this.type[s] !== T_SURFACE) this.playerThreads--;
    this.gridOk = false;
    this.log(['T', id, reason]);
    if (prune) {
      for (const n of [a, b]) {
        if (this.nid[n] >= 0 && this.adj[n].length === 0 && this.kind[n] === N_JUNCTION) this.removeNode(this.nid[n]);
      }
    }
    return true;
  }

  /**
   * Splits thread `id` at parameter t (0..1) with a new node there. Returns { node, a, b } (new ids: a is the half that
   * keeps the old start) or null. A split surface makes a pinned anchor.
   */
  splitThread(id, t, o = {}) {
    const s = this.ti(id);
    if (s < 0) return null;
    t = Math.min(0.98, Math.max(0.02, t));
    const a = this.ta[s];
    const b = this.tb[s];
    const type = this.type[s];
    const surface = type === T_SURFACE;
    const x = this.x[a] + (this.x[b] - this.x[a]) * t;
    const y = this.y[a] + (this.y[b] - this.y[a]) * t;
    const kind = surface ? N_ANCHOR : (o.kind ?? N_JUNCTION);
    const vx = ((this.x[a] - this.px[a]) * (1 - t) + (this.x[b] - this.px[b]) * t) / H_SUB;
    const vy = ((this.y[a] - this.py[a]) * (1 - t) + (this.y[b] - this.py[b]) * t) / H_SUB;
    const nodeOpts = {
      id: o.nodeId,
      mass: o.mass,
      player: o.player ?? true,
      bx: surface ? this.bx[a] + (this.bx[b] - this.bx[a]) * t : x,
      by: surface ? this.by[a] + (this.by[b] - this.by[a]) * t : y,
      sway: surface ? this.sway[a] + (this.sway[b] - this.sway[a]) * t : 0,
      phase: surface ? this.phase[a] + (this.phase[b] - this.phase[a]) * t : 0,
      vx: surface ? 0 : o.vx ?? vx,
      vy: surface ? 0 : o.vy ?? vy,
    };
    const keep = { rest: this.rest[s], str: this.str[s], snap: this.snap[s], stick: this.stick[s], dew: this.dew[s], vib: this.vib[s], born: this.born[s], flag: this.flag[s] };
    const aId = this.nid[a];
    const bId = this.nid[b];
    const ops = this.ops;
    this.ops = null; // logged as one split op
    this.removeThread(id, 0, false);
    const node = this.addNode(x, y, kind, nodeOpts);
    if (node < 0) {
      // No room for a node: put the thread back as it was.
      this.addThread(aId, bId, type, { id, rest: keep.rest, strength: keep.str, snap: keep.snap, stick: keep.stick, dew: keep.dew, born: keep.born, flag: keep.flag });
      this.ops = ops;
      return null;
    }
    const common = { strength: keep.str, snap: keep.snap, stick: keep.stick, vib: keep.vib, born: keep.born, flag: keep.flag };
    const t1 = this.addThread(aId, node, type, { ...common, id: o.aId, rest: surface ? undefined : keep.rest * t, dew: keep.dew * t });
    const t2 = this.addThread(node, bId, type, { ...common, id: o.bId, rest: surface ? undefined : keep.rest * (1 - t), dew: keep.dew * (1 - t) });
    this.ops = ops;
    this.log(['x', id, r4(t), node, t1, t2, kind, o.mass === undefined ? -1 : r3(o.mass), r1(x), r1(y)]);
    return { node, a: t1, b: t2, t };
  }

  // ---------------------------------------------------------------- queries
  pos(nodeId) {
    const s = this.ni(nodeId);
    return s < 0 ? null : { x: this.x[s], y: this.y[s] };
  }

  /** Point at parameter t along thread slot s. */
  at(s, t, out = {}) {
    const a = this.ta[s];
    const b = this.tb[s];
    out.x = this.x[a] + (this.x[b] - this.x[a]) * t;
    out.y = this.y[a] + (this.y[b] - this.y[a]) * t;
    return out;
  }

  /** Closest point on thread slot s to (x, y). */
  closest(s, x, y, out = {}) {
    const a = this.ta[s];
    const b = this.tb[s];
    const ax = this.x[a];
    const ay = this.y[a];
    const dx = this.x[b] - ax;
    const dy = this.y[b] - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 1e-9 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    out.t = t;
    out.x = ax + dx * t;
    out.y = ay + dy * t;
    out.d2 = (out.x - x) ** 2 + (out.y - y) ** 2;
    return out;
  }

  nearestThread(x, y, maxD, filter) {
    let best = null;
    let bd = maxD * maxD;
    const c = {};
    for (let s = 0; s < this.threadHigh; s++) {
      if (this.tid[s] < 0) continue;
      if (filter && !filter(s)) continue;
      this.closest(s, x, y, c);
      if (c.d2 < bd) {
        bd = c.d2;
        best = { id: this.tid[s], s, t: c.t, x: c.x, y: c.y, d: Math.sqrt(c.d2) };
      }
    }
    return best;
  }

  nearestNode(x, y, maxD, filter) {
    let best = null;
    let bd = maxD * maxD;
    for (let s = 0; s < this.nodeHigh; s++) {
      if (this.nid[s] < 0) continue;
      if (filter && !filter(s)) continue;
      const d2 = (this.x[s] - x) ** 2 + (this.y[s] - y) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = { id: this.nid[s], s, d: Math.sqrt(d2), x: this.x[s], y: this.y[s] };
      }
    }
    return best;
  }

  /** The thread joining two node slots, or -1. */
  between(a, b) {
    for (const s of this.adj[a]) if ((this.ta[s] === a && this.tb[s] === b) || (this.ta[s] === b && this.tb[s] === a)) return s;
    return -1;
  }

  other(s, n) {
    return this.ta[s] === n ? this.tb[s] : this.ta[s];
  }

  /** Adds vibration (and a little motion) to a thread: something touched it. */
  pluck(s, amount, kick = 0, dirx = 0, diry = 1) {
    if (s < 0 || this.tid[s] < 0) return;
    this.vib[s] = Math.min(4000, this.vib[s] + amount * (this.type[s] === T_ALARM ? 3 : 1));
    if (kick) {
      for (const n of [this.ta[s], this.tb[s]]) {
        if (this.kind[n] === N_ANCHOR) continue;
        const k = (kick / (this.mass[n] + this.load[n] + 0.2)) * H_SUB;
        this.px[n] -= dirx * k;
        this.py[n] -= diry * k;
      }
    }
  }

  // ---------------------------------------------------------------- physics
  /**
   * One 60 Hz tick. env: { t, sway (-1..1 plant bend), windX, windY (px/s), drag }. Loads (this.load) must be filled
   * by the caller beforehand (spiders, dew, prey on threads). Returns snapped thread ids in this.snapped.
   */
  step(env) {
    const nh = this.nodeHigh;
    const th = this.threadHigh;
    const { x, y, px, py, ox, oy, inv, kind, nid, mass, load, area } = this;
    const h = DT / SUBSTEPS;
    const h2 = h * h;
    const damp = Math.exp(-DAMP * h);
    const sway = env.sway || 0;
    const windX = env.windX || 0;
    const windY = env.windY || 0;
    const drag = env.drag ?? 0.004;
    const t0 = this.time;
    this.time += DT;
    for (let i = 0; i < nh; i++) {
      if (nid[i] < 0) continue;
      ox[i] = x[i];
      oy[i] = y[i];
      inv[i] = kind[i] === N_ANCHOR ? 0 : 1 / (mass[i] + load[i]);
    }
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      const ts = t0 + (sub + 1) * h;
      for (let i = 0; i < nh; i++) {
        if (nid[i] < 0) continue;
        if (kind[i] === N_ANCHOR) {
          const a = this.sway[i];
          if (a !== 0) {
            const idle = Math.sin(ts * 1.7 + this.phase[i]) * 0.12 + Math.sin(ts * 0.63 + this.phase[i] * 2.3) * 0.08;
            px[i] = x[i];
            py[i] = y[i];
            x[i] = this.bx[i] + a * (sway + idle);
            y[i] = this.by[i] + Math.abs(a) * 0.16 * (sway + idle) * (sway + idle);
          }
          continue;
        }
        const m = mass[i] + load[i];
        const vx = (x[i] - px[i]) * damp;
        const vy = (y[i] - py[i]) * damp;
        px[i] = x[i];
        py[i] = y[i];
        // Gravity, plus wind drag on the silk this knot holds (relative to its own motion, so it also damps).
        const fx = drag * area[i] * (windX - vx / h);
        const fy = drag * area[i] * (windY - vy / h);
        x[i] += vx + (fx / m) * h2;
        y[i] += vy + (GRAVITY + fy / m) * h2;
      }
      // Distance constraints: one XPBD pass per substep. Slack threads don't push.
      const { ta, tb, rest, comp, tid, type } = this;
      for (let s = 0; s < th; s++) {
        if (tid[s] < 0 || type[s] === T_SURFACE) continue;
        const a = ta[s];
        const b = tb[s];
        const wa = inv[a];
        const wb = inv[b];
        const w = wa + wb;
        if (w === 0) continue;
        const dx = x[b] - x[a];
        const dy = y[b] - y[a];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        const C = d - rest[s];
        if (C <= 0) continue;
        const dl = -C / (w + comp[s] / h2);
        const nx = dx / d;
        const ny = dy / d;
        x[a] -= wa * dl * nx;
        y[a] -= wa * dl * ny;
        x[b] += wb * dl * nx;
        y[b] += wb * dl * ny;
      }
    }
    // Clamp speeds, heal anything that went non-finite, keep everything in the world.
    const vmax = VMAX * DT;
    for (let i = 0; i < nh; i++) {
      if (nid[i] < 0 || kind[i] === N_ANCHOR) continue;
      if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) {
        x[i] = px[i] = Number.isFinite(ox[i]) ? ox[i] : this.bx[i];
        y[i] = py[i] = Number.isFinite(oy[i]) ? oy[i] : this.by[i];
        continue;
      }
      let dx = x[i] - ox[i];
      let dy = y[i] - oy[i];
      const d = Math.hypot(dx, dy);
      if (d > vmax) {
        const k = vmax / d;
        dx *= k;
        dy *= k;
        x[i] = ox[i] + dx;
        y[i] = oy[i] + dy;
        px[i] = x[i] - dx / SUBSTEPS;
        py[i] = y[i] - dy / SUBSTEPS;
      }
      if (x[i] < -300 || x[i] > W + 300 || y[i] < -300 || y[i] > H + 200) {
        x[i] = px[i] = Math.min(W + 300, Math.max(-300, x[i]));
        y[i] = py[i] = Math.min(H + 200, Math.max(-300, y[i]));
      }
    }
    // Strain, length, vibration and the wind area each knot catches.
    this.snapped.length = 0;
    area.fill(0, 0, nh);
    const { ta, tb, rest, tid, type, len, vib, snap, over } = this;
    for (let s = 0; s < th; s++) {
      if (tid[s] < 0) continue;
      const a = ta[s];
      const b = tb[s];
      const d = Math.hypot(x[b] - x[a], y[b] - y[a]);
      len[s] = d;
      if (type[s] === T_SURFACE) continue;
      const half = d * 0.5 * (1 + this.dew[s] * 0.02);
      area[a] += half;
      area[b] += half;
      const mvx = (x[a] - ox[a] + x[b] - ox[b]) * 0.5;
      const mvy = (y[a] - oy[a] + y[b] - oy[b]) * 0.5;
      const v = Math.sqrt(mvx * mvx + mvy * mvy) / DT;
      vib[s] = vib[s] * 0.86 + v * 0.14 * (type[s] === T_ALARM ? 2.5 : 1);
      if (d > rest[s] * (1 + (snap[s] - 1) * this.snapScale)) {
        if (++over[s] >= 2) this.snapped.push(tid[s]);
      } else over[s] = 0;
    }
    return this.snapped;
  }

  /** Thread strain as a fraction of its snapping point (0 slack, 1 about to go). */
  strain(s) {
    const r = this.len[s] / this.rest[s];
    return r <= 1 ? 0 : Math.min(1, (r - 1) / (this.snap[s] - 1));
  }

  // ---------------------------------------------------------------- grid for prey contacts
  buildGrid() {
    const start = this.gridStart;
    const count = (this.gCount ??= new Int32Array(GW * GH));
    const fill = (this.gFill ??= new Int32Array(GW * GH));
    const cells = (this.gCells ??= []);
    count.fill(0);
    for (let s = 0; s < this.threadHigh; s++) {
      if (this.tid[s] < 0 || this.type[s] === T_SURFACE) continue;
      cells.length = 0;
      this.cellsOf(this.x[this.ta[s]], this.y[this.ta[s]], this.x[this.tb[s]], this.y[this.tb[s]], cells);
      for (const c of cells) count[c]++;
    }
    let acc = 0;
    for (let c = 0; c < GW * GH; c++) {
      start[c] = acc;
      acc += count[c];
    }
    start[GW * GH] = acc;
    if (acc > this.gridItems.length) this.gridItems = new Int16Array(acc * 2);
    fill.fill(0);
    for (let s = 0; s < this.threadHigh; s++) {
      if (this.tid[s] < 0 || this.type[s] === T_SURFACE) continue;
      cells.length = 0;
      this.cellsOf(this.x[this.ta[s]], this.y[this.ta[s]], this.x[this.tb[s]], this.y[this.tb[s]], cells);
      for (const c of cells) this.gridItems[start[c] + fill[c]++] = s;
    }
    this.gridOk = true;
  }

  cellsOf(x0, y0, x1, y1, out) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL * 0.25)));
    let last = -1;
    for (let k = 0; k <= n; k++) {
      const fx = x0 + ((x1 - x0) * k) / n;
      const fy = y0 + ((y1 - y0) * k) / n;
      const i = Math.min(GW - 1, Math.max(0, Math.floor((fx - GOX) / CELL)));
      const j = Math.min(GH - 1, Math.max(0, Math.floor((fy - GOY) / CELL)));
      const c = j * GW + i;
      if (c !== last && !out.includes(c)) out.push(c);
      last = c;
    }
    return out;
  }

  /** Calls fn(slot) once for each thread near the segment (x0,y0)-(x1,y1). */
  near(x0, y0, x1, y1, fn) {
    if (!this.gridOk) this.buildGrid();
    const stamp = ++this.stampN;
    const cells = (this.qCells ??= []);
    cells.length = 0;
    this.cellsOf(x0, y0, x1, y1, cells);
    for (const c of cells) {
      for (let k = this.gridStart[c]; k < this.gridStart[c + 1]; k++) {
        const s = this.gridItems[k];
        if (this.stamp[s] === stamp || this.tid[s] < 0) continue;
        this.stamp[s] = stamp;
        fn(s);
      }
    }
  }

  // ---------------------------------------------------------------- checkpoint (fits two 16 KB values)
  // The garden is rebuilt from its seed, so only silk (ids >= GARDEN_IDS) and the list of garden branches that were
  // split by casts travel. unpack() expects the garden already built into this web.
  pack(gardenThreads = 0) {
    let nodes = 0;
    for (let s = 0; s < this.nodeHigh; s++) if (this.nid[s] >= GARDEN_IDS) nodes++;
    const n = new Writer(nodes * 20 + 16);
    n.u16(this.nextNode);
    n.u16(nodes);
    for (let s = 0; s < this.nodeHigh; s++) {
      if (this.nid[s] < GARDEN_IDS) continue;
      n.u16(this.nid[s]);
      n.i16(this.x[s] * 8);
      n.i16(this.y[s] * 8);
      n.i16((this.x[s] - this.px[s]) * 256);
      n.i16((this.y[s] - this.py[s]) * 256);
      n.i16(this.bx[s] * 8);
      n.i16(this.by[s] * 8);
      n.u8(this.kind[s] | (this.nplayer[s] << 4));
      n.i16(this.sway[s] * 100);
      n.u8((this.phase[s] / (Math.PI * 2)) * 255);
      n.u16(this.mass[s] * 1000);
    }
    let threads = 0;
    for (let s = 0; s < this.threadHigh; s++) if (this.tid[s] >= GARDEN_IDS) threads++;
    const t = new Writer(threads * 16 + 64);
    t.u16(this.nextThread);
    const gone = [];
    for (let id = 1; id <= gardenThreads; id++) if (this.ti(id) < 0) gone.push(id);
    t.u16(gone.length);
    for (const id of gone) t.u16(id);
    t.u16(threads);
    for (let s = 0; s < this.threadHigh; s++) {
      if (this.tid[s] < GARDEN_IDS) continue;
      t.u16(this.tid[s]);
      t.u16(this.nid[this.ta[s]]);
      t.u16(this.nid[this.tb[s]]);
      t.u8(this.type[s]);
      t.u16(this.rest[s] * 32);
      t.u16(Math.min(65535, this.str[s] * 100));
      t.u8((this.snap[s] - 1) * 200);
      t.u8(this.stick[s] * 150);
      t.u8(Math.min(255, this.dew[s] * 4));
      t.u8(this.flag[s]);
    }
    return { n: n.base64(), t: t.base64() };
  }

  unpack(data) {
    const saved = this.ops;
    this.ops = null;
    const t = new Reader(data?.t);
    const nextThread = t.u16();
    const gone = t.u16();
    for (let k = 0; k < gone && t.left >= 2; k++) {
      const id = t.u16();
      if (id < GARDEN_IDS) this.removeThread(id, 0, false);
    }
    const n = new Reader(data?.n);
    const nextNode = n.u16();
    const nodes = n.u16();
    for (let k = 0; k < nodes && n.left >= 18; k++) {
      const id = n.u16();
      const x = n.i16() / 8;
      const y = n.i16() / 8;
      const vx = n.i16() / 256;
      const vy = n.i16() / 256;
      const bx = n.i16() / 8;
      const by = n.i16() / 8;
      const kp = n.u8();
      const sway = n.i16() / 100;
      const phase = (n.u8() / 255) * Math.PI * 2;
      const mass = n.u16() / 1000;
      const kind = kp & 15;
      if (id < GARDEN_IDS || kind > N_PREY || this.ni(id) >= 0) continue;
      this.addNode(x, y, kind, { id, bx, by, sway, phase, mass: mass || JUNCTION_MASS, player: kp >> 4 });
      const s = this.ni(id);
      if (s >= 0) {
        this.px[s] = x - vx;
        this.py[s] = y - vy;
      }
    }
    const threads = t.u16();
    for (let k = 0; k < threads && t.left >= 16; k++) {
      const id = t.u16();
      const a = t.u16();
      const b = t.u16();
      const type = t.u8();
      const rest = t.u16() / 32;
      const strength = t.u16() / 100;
      const snap = 1 + t.u8() / 200;
      const stick = t.u8() / 150;
      const dew = t.u8() / 4;
      const flag = t.u8() & 3;
      if (id < GARDEN_IDS || type > T_SURFACE || this.ti(id) >= 0) continue;
      this.addThread(a, b, type, { id, rest, strength, snap, stick, dew, born: -10, flag });
    }
    this.nextNode = Math.max(this.nextNode, nextNode, GARDEN_IDS);
    this.nextThread = Math.max(this.nextThread, nextThread, GARDEN_IDS);
    this.ops = saved;
  }

  // ---------------------------------------------------------------- mirroring another player's web
  applyOps(ops) {
    if (!Array.isArray(ops)) return;
    const saved = this.ops;
    this.ops = null;
    for (const op of ops) {
      if (!Array.isArray(op)) continue;
      const num = (i, d = 0) => (Number.isFinite(op[i]) ? op[i] : d);
      switch (op[0]) {
        case 'n':
          if (this.ni(num(1)) < 0) this.addNode(num(2), num(3), num(4) | 0, { id: num(1), bx: num(5), by: num(6), sway: num(7), phase: num(8), mass: num(9, JUNCTION_MASS) || JUNCTION_MASS, player: num(10) });
          break;
        case 'N':
          this.removeNode(num(1));
          break;
        case 'm':
          this.setMass(num(1), num(2));
          break;
        case 'k':
          this.setKind(num(1), num(2) | 0);
          break;
        case 't':
          if (this.ti(num(1)) < 0) this.addThread(num(2), num(3), num(4) | 0, { id: num(1), rest: num(5, 1), strength: num(6, 20), snap: num(7, SNAP), stick: num(8), dew: num(9), born: this.time, flag: num(11) & 3 });
          break;
        case 'T':
          this.removeThread(num(1), num(2));
          break;
        case 'x': {
          const mass = num(7, -1);
          this.splitThread(num(1), num(2, 0.5), { nodeId: num(3), aId: num(4), bId: num(5), kind: num(6) | 0, mass: mass > 0 ? mass : undefined });
          break;
        }
        case 's': {
          const s = this.ti(num(1));
          if (s >= 0) {
            this.stick[s] = Math.max(0, Math.min(1.6, num(2)));
            this.dew[s] = Math.max(0, num(3));
          }
          break;
        }
        default:
          break;
      }
    }
    this.ops = saved;
  }
}

function dropFrom(list, v) {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
}
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

/** Segment-segment crossing. Returns the parameter along (cx,cy)-(dx,dy) where (ax,ay)-(bx,by) crosses it, or -1. */
export function crossing(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const qx = cx - ax;
  const qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return -1;
  return u;
}

export { N_ANCHOR, N_JUNCTION, N_PREY };
