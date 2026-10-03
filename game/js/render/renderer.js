// Puts a frame together: backdrop, garden, silk, the living, effects, weather and the HUD, through one camera.
import { Camera } from './camera.js';
import { makeBackdrop, drawBackdrop, drawMist, drawFinish, drawFront } from './backdrop.js';
import { makeGardenArt, drawGardenBack, drawSurfaces, drawDecor, drawGround, drawRetreat, drawLanes, laneStrength } from './gardenart.js';
import { drawWeb, drawKnots, drawAim } from './webart.js';
import { drawSpider, drawPrey, drawWasp, drawWren, drawMantis, drawFireflies, drawLures } from './creatures.js';
import { drawFx, updateFx, rain as rainFx, setFxScale } from './fx.js';
import { drawHud } from './hud.js';
import { SILVER, AMBER, RUST, rgba } from './palette.js';
import { anchorPos } from '../sim/spider.js';
import { W, GROUND, PREY } from '../sim/data.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = new Camera();
    this.pr = 1;
    this.q = 'high';
    this.bdKey = '';
    this.bd = null;
    this.art = null;
    this.artKey = '';
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.rainAcc = 0;
  }

  resize(cssW, cssH, pr) {
    this.pr = pr;
    const w = Math.max(1, Math.round(cssW * pr));
    const h = Math.max(1, Math.round(cssH * pr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.cam.resize(cssW, cssH);
  }

  /** Silk bounds for the camera (built silk only), or null. */
  silkBox(world) {
    const web = world.web;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let n = 0;
    for (let s = 0; s < web.nodeHigh; s++) {
      if (web.nid[s] < 2000) continue;
      const x = web.x[s];
      const y = web.y[s];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      n++;
    }
    return n >= 3 ? { x0, y0, x1, y1 } : null;
  }

  draw(v) {
    const { ctx, cam, pr } = this;
    const world = v.world;
    const q = v.q ?? this.q;
    const t = v.t;
    if (!world) return;
    const key = `${world.gardenId}:${world.garden.seed}`;
    if (key !== this.bdKey) {
      this.bd = makeBackdrop(world.gardenId, world.garden.seed);
      this.art = makeGardenArt(world.garden);
      this.bdKey = key;
    }
    setFxScale(v.reduced ? 0.3 : q === 'low' ? 0.5 : q === 'medium' ? 0.8 : 1);
    if (v.focus) cam.update(v.dt, v.focus, v.box === undefined ? this.silkBox(world) : v.box, v.reduced, v.snap, !!v.hud);
    const view = this.view;
    view.x0 = cam.x - cam.sw / 2 / cam.z;
    view.x1 = cam.x + cam.sw / 2 / cam.z;
    view.y0 = cam.y - cam.sh / 2 / cam.z;
    view.y1 = cam.y + cam.sh / 2 / cam.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackdrop(ctx, this.bd, cam, pr, t, q);
    cam.apply(ctx, pr, 1);
    drawGardenBack(ctx, world, this.art, t, q);
    drawSurfaces(ctx, world, cam.z, q);
    drawDecor(ctx, world, t, q);
    if (v.lanes !== false && v.hud) drawLanes(ctx, world, t, q, laneStrength(world) * (v.lanes ?? 1), v.reduced);
    if (v.retreat !== false) drawRetreat(ctx, world, t, v.spiders, false);
    drawFireflies(ctx, world.lights, t, q);
    ctx.globalAlpha = v.webAlpha ?? 1;
    drawWeb(ctx, world, { z: cam.z, t, q, silk: v.silk, dewStyle: v.dewStyle, dawn: v.dawn ?? 0 });
    drawKnots(ctx, world, cam.z);
    ctx.globalAlpha = 1;
    // The living: prey on the web first, spiders, then fliers and hunters on top.
    const prey = v.prey ?? world.prey;
    for (const p of prey) if (p.st !== 'fly' && p.st !== 'gone' && cam.visible(p.x, p.y)) drawPrey(ctx, p, t, q);
    if (v.timers) this.timers(ctx, prey);
    drawLures(ctx, world.lures ?? [], world.balls ?? [], v.spiders, t);
    for (const sp of v.spiders) {
      if (!cam.visible(sp.x, sp.y, 80)) continue;
      const anchor = sp.mode === 'hang' && sp.hang ? anchorPos(world, sp.hang.anchor) : null;
      drawSpider(ctx, world, sp, t, v.dt, { anchor, spin: sp.id === v.me ? v.spin : sp.spin });
    }
    if (v.retreat !== false) drawRetreat(ctx, world, t, v.spiders, true);
    if (world.mantis) drawMantis(ctx, world.mantis, t);
    for (const p of prey) if (p.st === 'fly' && cam.visible(p.x, p.y)) drawPrey(ctx, p, t, q);
    for (const w of world.wasps ?? []) if (cam.visible(w.x, w.y)) drawWasp(ctx, w, t);
    const me = v.spiders.find((s) => s.id === v.me);
    if (me && me.sp === 'jumper') this.cones(ctx, me, prey, t);
    if (me && v.gauges) this.gauges(ctx, me, v.gauges, t);
    if (me && v.sense) this.sense(ctx, me, v.sense, t);
    for (const p of v.pings ?? []) this.ping(ctx, p, t);
    updateFx(v.dt);
    drawFx(ctx, cam.z);
    drawGround(ctx, world, t, q);
    drawWren(ctx, world.wren, t, view);
    if (world.weather?.rain && q !== 'low' && !v.reduced) {
      this.rainAcc += v.dt * (q === 'high' ? 160 : 80);
      const n = Math.floor(this.rainAcc);
      this.rainAcc -= n;
      rainFx(view, n);
    }
    if (v.mark) this.mark(ctx, v.mark, t);
    drawAim(ctx, v.aim, cam.z, t);
    if (q !== 'low') drawFront(ctx, this.bd, cam, pr);
    drawMist(ctx, cam, pr, t, v.mist ?? 0, q);
    if (v.dawn > 0) this.dawn(v.dawn);
    drawFinish(ctx, cam, pr, t, q, v.dim ?? 0);
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    if (v.dim > 0) {
      ctx.fillStyle = `rgba(4, 10, 11, ${v.dim * 0.6})`;
      ctx.fillRect(0, 0, cam.sw, cam.sh);
    }
    drawHud(ctx, v.hud, cam.sw, cam.sh, t);
  }

  /** Silk and health as two thin arcs around the spider; brighter when they matter. */
  gauges(ctx, sp, g, t) {
    const r = 17;
    const z = this.cam.z;
    const lw = Math.max(1.6 / z, 1.2);
    const silkF = Math.max(0, Math.min(1, g.silk / g.maxSilk));
    const hpF = Math.max(0, Math.min(1, g.hp / g.maxHp));
    const loud = g.loud;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(SILVER, 0.12 * (0.5 + loud));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, Math.PI * 0.6, Math.PI * 1.4);
    ctx.stroke();
    ctx.strokeStyle = rgba(SILVER, (silkF < 0.2 ? 0.9 : 0.35) * (0.5 + loud));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, Math.PI * 1.4 - Math.PI * 0.8 * silkF, Math.PI * 1.4);
    ctx.stroke();
    ctx.strokeStyle = rgba(SILVER, 0.12 * (0.5 + loud));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, -Math.PI * 0.4, Math.PI * 0.4);
    ctx.stroke();
    const low = hpF < 0.35;
    ctx.strokeStyle = low ? rgba(RUST, 0.6 + 0.4 * Math.sin(t * 8)) : rgba(AMBER, 0.45 * (0.5 + loud));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, Math.PI * 0.4 - Math.PI * 0.8 * hpF, Math.PI * 0.4);
    ctx.stroke();
    for (let k = 0; k < g.venom; k++) {
      ctx.fillStyle = rgba(AMBER, 0.8);
      ctx.beginPath();
      ctx.arc(sp.x - 4 + k * 4, sp.y - r - 4, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (g.progress > 0) {
      ctx.strokeStyle = rgba(SILVER, 0.9);
      ctx.lineWidth = lw * 1.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * g.progress);
      ctx.stroke();
    }
  }

  /** Eight Eyes, third tier: how long each struggling catch has before it tears free. */
  timers(ctx, prey) {
    ctx.lineWidth = 2 / this.cam.z;
    for (const p of prey) {
      if (p.st !== 'stuck' || !(p.timer > 0)) continue;
      const f = Math.min(1, p.timer / ((PREY[p.sp]?.escape ?? 6) * 1.2));
      ctx.strokeStyle = f < 0.3 ? rgba(RUST, 0.9) : rgba(AMBER, 0.75);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + (PREY[p.sp]?.size ?? 4) * 0.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.stroke();
    }
  }

  /** What a resting insect can see: a pale wedge in front of it, warming as it grows uneasy. */
  cones(ctx, me, prey, t) {
    for (const p of prey) {
      if (p.st !== 'land' || Math.hypot(p.x - me.x, p.y - me.y) > 300) continue;
      const preen = p.preen > 0;
      const half = preen ? 0.45 : 1.05;
      const reach = preen ? 55 : 120;
      const a0 = p.facing > 0 ? 0 : Math.PI;
      const alarm = Math.min(1, p.alarm ?? 0);
      ctx.fillStyle = alarm > 0.05 ? rgba(AMBER, 0.08 + alarm * 0.25) : rgba(SILVER, 0.06);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, reach, a0 - half, a0 + half);
      ctx.closePath();
      ctx.fill();
      if (alarm > 0.6) {
        ctx.fillStyle = rgba(AMBER, 0.6 + 0.4 * Math.sin(t * 20));
        ctx.font = `600 ${14 / this.cam.z}px serif`;
        ctx.textAlign = 'center';
        ctx.fillText('!', p.x, p.y - 14);
      }
    }
  }

  /** The sense ring: arcs around the spider that brighten toward whatever is shaking the web. */
  sense(ctx, sp, dirs, t) {
    const r = 28;
    const n = dirs.length;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const v = dirs[i];
      if (v < 0.05) continue;
      const a = (i / n) * Math.PI * 2;
      ctx.strokeStyle = rgba(SILVER, Math.min(0.85, v));
      ctx.lineWidth = Math.max(1, 1.2 + v * 2.2) / Math.max(0.6, this.cam.z * 0.8);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r + v * 6, a - 0.13, a + 0.13);
      ctx.stroke();
    }
    void t;
  }

  /** The first night's pointers: a ring on a twig worth a thread, a wider one where the first web should go. */
  mark(ctx, m, t) {
    const z = this.cam.z;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    ctx.lineWidth = Math.max(1.6 / z, 1.6);
    ctx.strokeStyle = rgba(AMBER, 0.45 + 0.4 * pulse);
    if (m.k === 'twig') {
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, 10 + ((t * 18 + k * 9) % 18), 0, Math.PI * 2);
        ctx.globalAlpha = 1 - ((t * 18 + k * 9) % 18) / 18;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(AMBER, 0.9);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.k === 'ghost') {
      // Where the torn web hung: a faint ring to tap, brighter as it breathes.
      ctx.setLineDash([5 / z + 3, 9 / z + 3]);
      ctx.lineDashOffset = t * 12;
      ctx.strokeStyle = rgba(SILVER, 0.3 + 0.3 * pulse);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(SILVER, 0.5);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.setLineDash([9 / z + 3, 7 / z + 3]);
      ctx.lineDashOffset = -t * 14;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(AMBER, 0.035 + 0.035 * pulse);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(AMBER, 0.9);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ping(ctx, p, t) {
    const f = Math.min(1, p.age / 3);
    ctx.strokeStyle = rgba(AMBER, 1 - f);
    ctx.lineWidth = 2 / this.cam.z;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 + ((p.age * 30 + k * 14) % 28), 0, Math.PI * 2);
      ctx.stroke();
    }
    void t;
  }

  dawn(f) {
    const { ctx, cam, pr } = this;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    const g = ctx.createLinearGradient(0, cam.sh, 0, 0);
    g.addColorStop(0, `rgba(240, 186, 120, ${0.28 * f})`);
    g.addColorStop(0.5, `rgba(170, 200, 190, ${0.16 * f})`);
    g.addColorStop(1, 'rgba(170, 200, 190, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cam.sw, cam.sh);
  }
}

export { W, GROUND };
