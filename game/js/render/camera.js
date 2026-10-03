// The camera: follows the spider with a little look-ahead, widens to keep the whole web in view on small screens,
// and never shows past the edges of the garden.
import { W, H, GROUND } from '../sim/data.js';

export class Camera {
  constructor() {
    this.x = W * 0.3;
    this.y = H * 0.6;
    this.z = 1;
    this.tx = this.x;
    this.ty = this.y;
    this.view = 430; // world px across the screen's shorter side
    this.user = 1; // the player's own zoom (wheel, buttons)
    this.sw = 1;
    this.sh = 1;
    this.shake = 0;
    this.sx = 0;
    this.sy = 0;
    this.t = 0;
  }

  resize(w, h) {
    this.sw = Math.max(1, w);
    this.sh = Math.max(1, h);
  }

  /** focus: { x, y, vx, vy }, box: silk bounds { x0, y0, x1, y1 } or null. */
  update(dt, focus, box, reduced, snap = false) {
    this.t += dt;
    const short = Math.min(this.sw, this.sh);
    const long = Math.max(this.sw, this.sh);
    // How much of the garden to show: enough for the web around you, never so little that silk is a hair.
    // Phones held upright show less garden, so the silk and its visitors stay big enough to read.
    let view = short < 520 ? 360 : 430;
    if (box) {
      const span = Math.max(box.x1 - box.x0, box.y1 - box.y0) + 150;
      view = Math.max(view, Math.min(1000, span * (short / long < 0.7 ? 1.05 : 1)));
    }
    view /= this.user;
    view = Math.max(240, Math.min(1100, view));
    this.view += (view - this.view) * Math.min(1, dt * (snap ? 60 : 1.6));
    this.z = short / this.view;
    let fx = focus.x + (focus.vx || 0) * 0.25;
    let fy = focus.y + (focus.vy || 0) * 0.2 - 30;
    if (box) {
      // Lean toward the web's middle so it stays framed.
      fx = fx * 0.65 + ((box.x0 + box.x1) / 2) * 0.35;
      fy = fy * 0.65 + ((box.y0 + box.y1) / 2) * 0.35;
    }
    const k = snap ? 1 : Math.min(1, dt * 3.2);
    this.x += (fx - this.x) * k;
    this.y += (fy - this.y) * k;
    this.clamp();
    if (this.shake > 0 && !reduced) {
      this.shake = Math.max(0, this.shake - dt * 3);
      const a = this.shake * this.shake * 10;
      this.sx = (Math.sin(this.t * 61) + Math.sin(this.t * 37.3)) * a;
      this.sy = (Math.cos(this.t * 53) + Math.sin(this.t * 29.1)) * a;
    } else {
      this.shake = 0;
      this.sx = this.sy = 0;
    }
  }

  clamp() {
    const hw = this.sw / 2 / this.z;
    const hh = this.sh / 2 / this.z;
    const x0 = -80;
    const x1 = W + 80;
    const y0 = -40;
    const y1 = GROUND + 60;
    this.x = hw * 2 >= x1 - x0 ? (x0 + x1) / 2 : Math.max(x0 + hw, Math.min(x1 - hw, this.x));
    this.y = hh * 2 >= y1 - y0 ? Math.min(y1 - hh, (y0 + y1) / 2 + Math.max(0, hh * 2 - (y1 - y0)) / 2) : Math.max(y0 + hh, Math.min(y1 - hh, this.y));
  }

  kick(amount) {
    this.shake = Math.min(1, Math.max(this.shake, amount));
  }

  toScreen(x, y, out = {}) {
    out.x = (x - this.x) * this.z + this.sw / 2 + this.sx;
    out.y = (y - this.y) * this.z + this.sh / 2 + this.sy;
    return out;
  }

  toWorld(sx, sy, out = {}) {
    out.x = (sx - this.sw / 2 - this.sx) / this.z + this.x;
    out.y = (sy - this.sh / 2 - this.sy) / this.z + this.y;
    return out;
  }

  /** ctx transform for drawing in world units at parallax depth p (1 = the play plane). */
  apply(ctx, pr, p = 1) {
    const zl = this.z * (0.5 + 0.5 * p);
    const cx = this.x * p + (1 - p) * (W / 2);
    const cy = this.y * p + (1 - p) * (H * 0.62);
    ctx.setTransform(zl * pr, 0, 0, zl * pr, (this.sw / 2 - cx * zl + this.sx * p) * pr, (this.sh / 2 - cy * zl + this.sy * p) * pr);
  }

  visible(x, y, margin = 40) {
    const hw = this.sw / 2 / this.z + margin;
    const hh = this.sh / 2 / this.z + margin;
    return Math.abs(x - this.x) < hw && Math.abs(y - this.y) < hh;
  }
}
