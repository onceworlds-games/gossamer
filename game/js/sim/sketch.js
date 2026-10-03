// The night's web, kept small enough to ride along with the result (about 2 KB): one entry per strand, its ends
// scaled to the web's own box. The notebook redraws it in ink. Pure data in and out.
import { Writer, Reader } from './pack.js';
import { T_ALARM } from './data.js';

export const SKETCH_MAX = 420;

/** The silk a web holds (frame, radial, sticky and alarm threads), as a base64 string, or '' if there is none worth drawing. */
export function encodeSketch(web) {
  let segs = [];
  for (let s = 0; s < web.threadHigh; s++) {
    if (web.tid[s] < 0 || web.type[s] > T_ALARM) continue;
    const a = web.ta[s];
    const b = web.tb[s];
    if (web.kind[a] === 2 || web.kind[b] === 2) continue; // a catch hanging on it
    segs.push([web.type[s], web.x[a], web.y[a], web.x[b], web.y[b]]);
  }
  if (segs.length < 4) return '';
  if (segs.length > SKETCH_MAX) {
    // Frames and radials first, then as many of the glue lines as fit, evenly.
    const keep = segs.filter((q) => q[0] !== 2);
    const sticky = segs.filter((q) => q[0] === 2);
    const room = Math.max(0, SKETCH_MAX - keep.length);
    const step = sticky.length / Math.max(1, room);
    for (let i = 0; i < room && i * step < sticky.length; i++) keep.push(sticky[Math.floor(i * step)]);
    segs = keep.slice(0, SKETCH_MAX);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of segs) {
    x0 = Math.min(x0, q[1], q[3]);
    x1 = Math.max(x1, q[1], q[3]);
    y0 = Math.min(y0, q[2], q[4]);
    y1 = Math.max(y1, q[2], q[4]);
  }
  const bw = Math.max(16, x1 - x0);
  const bh = Math.max(16, y1 - y0);
  const k = 255 / Math.max(bw, bh);
  const w = new Writer(segs.length * 5 + 8);
  w.u8(Math.round(bw / 8));
  w.u8(Math.round(bh / 8));
  w.u16(segs.length);
  for (const q of segs) {
    w.u8(q[0]);
    w.u8((q[1] - x0) * k);
    w.u8((q[2] - y0) * k);
    w.u8((q[3] - x0) * k);
    w.u8((q[4] - y0) * k);
  }
  return w.base64();
}

/** Back to { w, h, segs: [{ t, x0, y0, x1, y1 }] } in a 0..255 box (w and h are the web's own extent in it), or null. */
export function decodeSketch(str) {
  if (typeof str !== 'string' || str.length < 8 || str.length > 6000) return null;
  const r = new Reader(str);
  const bw = r.u8();
  const bh = r.u8();
  const n = Math.min(SKETCH_MAX, r.u16());
  if (!bw || !bh || n < 4 || r.left < n * 5) return null;
  const k = 255 / Math.max(bw, bh);
  const segs = [];
  for (let i = 0; i < n; i++) segs.push({ t: Math.min(3, r.u8()), x0: r.u8(), y0: r.u8(), x1: r.u8(), y1: r.u8() });
  return { w: bw * k, h: bh * k, segs };
}
