// Keyboard, mouse, touch, the platform's on-screen controls and gamepads, turned into one set of intents. Keys are
// cleared when the window loses focus; held mouse drags survive leaving the window (pointer capture); two fingers
// pan instead of aiming (a quick two-finger tap pings); a held finger shows a loupe so a thread lands where you meant.
import { platform } from './platform.js';

const MOVE = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.events = [];
    this.pointer = { x: 0, y: 0, in: false, mouse: true };
    this.aiming = null; // { id, x, y, t0, moved, touch }
    this.touches = new Map();
    this.pan = { x: 0, y: 0, active: false, lx: 0, ly: 0 };
    this.charge = 0;
    this.charging = false;
    this.spin = 0;
    this.spinning = false;
    this._on = false;
    this.lastTap = null;
    this.pad = { on: false, aimX: 0, aimY: 0, prev: [] };
    this.bind();
  }

  get enabled() {
    return this._on;
  }

  /** Switching the controls off (the notebook is up) lets go of every key and gesture. */
  set enabled(v) {
    if (!v && this._on) this.clear();
    this._on = !!v;
  }

  bind() {
    const c = this.canvas;
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => document.hidden && this.clear());
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e, false));
    c.addEventListener('pointercancel', (e) => this.up(e, true));
    c.addEventListener('lostpointercapture', (e) => this.touches.has(e.pointerId) && this.up(e, true));
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.pointer.in = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.events.push({ t: 'zoom', d: Math.sign(e.deltaY) });
    }, { passive: false });
    addEventListener('resize', () => this.cancelGestures());
  }

  clear() {
    this.keys.clear();
    this.cancelGestures();
    if (this.useHeld) {
      this.useHeld = false;
      this.events.push({ t: 'use', on: false });
    }
  }

  cancelGestures() {
    this.aiming = null;
    this.touches.clear();
    this.pan.active = false;
    this.charging = false;
    this.charge = 0;
    this.spinning = false;
    this.spin = 0;
  }

  key(e, down) {
    const k = (e.key || '').toLowerCase();
    // A key let go while the notebook is up must not stay held for the next night.
    if (!this.enabled) {
      if (!down) this.keys.delete(k);
      return;
    }
    if (['tab', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (down) {
      if (this.keys.has(k) && e.repeat) return;
      this.keys.add(k);
      if (e.repeat) return;
      switch (k) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          this.events.push({ t: 'type', n: Number(k) - 1 });
          break;
        case 't':
          this.events.push({ t: 'cycle' });
          break;
        case 'e':
          this.useHeld = true;
          this.events.push({ t: 'use', on: true });
          break;
        case 'f':
          this.events.push({ t: 'bite' });
          break;
        case 'x':
          this.events.push({ t: 'cut', ...this.aimPoint() });
          break;
        case 'q':
          this.events.push({ t: 'shake' });
          break;
        case 'r':
          this.events.push({ t: 'respin' });
          break;
        case 'l':
          this.events.push({ t: 'lure' });
          break;
        case 'tab':
          this.events.push({ t: 'ping', ...this.aimPoint() });
          break;
        case ' ':
          this.charging = true;
          this.charge = 0;
          break;
        case 'b':
          this.spinning = true;
          this.spin = 0;
          break;
        case '=':
        case '+':
          this.events.push({ t: 'zoom', d: -1 });
          break;
        case '-':
          this.events.push({ t: 'zoom', d: 1 });
          break;
        default:
          break;
      }
    } else {
      this.keys.delete(k);
      if (k === 'e' && this.useHeld) {
        this.useHeld = false;
        this.events.push({ t: 'use', on: false });
      }
      if (k === ' ' && this.charging) {
        this.charging = false;
        this.events.push({ t: 'leap', ...this.aimPoint(true), power: Math.max(0.35, this.charge) });
        this.charge = 0;
      }
      if (k === 'b' && this.spinning) {
        this.spinning = false;
        this.events.push({ t: 'fling', ...this.aimPoint(true), power: Math.max(0.3, this.spin) });
        this.spin = 0;
      }
    }
  }

  /** Where the player is aiming, in screen px (the game converts to world). */
  aimPoint(forLeap = false) {
    const st = platform.controls.stick;
    if (forLeap && Math.hypot(st.x, st.y) > 0.3) return { sx: null, dir: [st.x, st.y] };
    if (this.pad.on && Math.hypot(this.pad.aimX, this.pad.aimY) > 0.3) return { sx: null, dir: [this.pad.aimX, this.pad.aimY] };
    if (!this.pointer.mouse && this.lastTap) return { sx: this.lastTap.x, sy: this.lastTap.y };
    if (!this.pointer.mouse) return { sx: null, dir: null };
    return { sx: this.pointer.x, sy: this.pointer.y };
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    if (!this.enabled) return;
    const [x, y] = this.local(e);
    this.pointer.mouse = e.pointerType === 'mouse';
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.in = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}
    if (e.pointerType === 'mouse') {
      if (e.button === 2) {
        this.pan = { active: true, lx: x, ly: y, x: this.pan.x, y: this.pan.y, moved: 0, right: true };
        return;
      }
      if (e.button !== 0) return;
      this.aiming = { id: e.pointerId, x, y, t0: performance.now(), moved: 0, touch: false };
      return;
    }
    // Touch and pen: one finger aims, a second turns it into a pan.
    this.touches.set(e.pointerId, { x, y });
    if (this.touches.size >= 2) {
      this.aiming = null;
      const c = this.centroid();
      this.pan = { active: true, lx: c[0], ly: c[1], x: this.pan.x, y: this.pan.y, moved: 0, t0: performance.now() };
      return;
    }
    this.aiming = { id: e.pointerId, x, y: y - 10, t0: performance.now(), moved: 0, touch: true };
  }

  centroid() {
    let x = 0;
    let y = 0;
    for (const t of this.touches.values()) {
      x += t.x;
      y += t.y;
    }
    return [x / this.touches.size, y / this.touches.size];
  }

  move(e) {
    const [x, y] = this.local(e);
    if (e.pointerType === 'mouse') {
      this.pointer.mouse = true;
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.in = true;
    }
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x, y });
    if (this.pan.active) {
      const [cx, cy] = this.touches.size >= 2 ? this.centroid() : [x, y];
      this.pan.x += cx - this.pan.lx;
      this.pan.y += cy - this.pan.ly;
      this.pan.moved += Math.abs(cx - this.pan.lx) + Math.abs(cy - this.pan.ly);
      this.pan.lx = cx;
      this.pan.ly = cy;
      return;
    }
    if (this.aiming && this.aiming.id === e.pointerId) {
      const ty = this.aiming.touch ? y - 10 : y;
      this.aiming.moved += Math.hypot(x - this.aiming.x, ty - this.aiming.y);
      this.aiming.x = x;
      this.aiming.y = ty;
    }
  }

  up(e, cancelled) {
    const [x, y] = this.local(e);
    if (this.pan.active && (e.pointerType === 'mouse' ? this.pan.right : true)) {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2 && !(e.pointerType === 'mouse' && !this.pan.right)) {
        // A right-click that didn't move is a cut; a quick two-finger tap pings the spot between the fingers.
        if (this.pan.right && this.pan.moved < 6 && !cancelled) this.events.push({ t: 'cut', sx: x, sy: y });
        else if (!this.pan.right && this.pan.moved < 12 && !cancelled && performance.now() - (this.pan.t0 ?? 0) < 350) this.events.push({ t: 'ping', sx: this.pan.lx, sy: this.pan.ly });
        this.pan.active = false;
        this.pan.right = false;
      }
      return;
    }
    this.touches.delete(e.pointerId);
    const a = this.aiming;
    this.aiming = null;
    if (!a || a.id !== e.pointerId || cancelled || !this.enabled) return;
    const held = performance.now() - a.t0;
    // A quick swipe is not a tap (a held finger that moves is aiming with the loupe, and does cast).
    if (a.touch && a.moved > 24 && held < 220) return;
    if (a.touch) this.lastTap = { x: a.x, y: a.y };
    this.events.push({ t: 'tap', sx: a.x, sy: a.y, held, touch: a.touch });
  }

  /** Per frame: the stick (keyboard, platform stick or gamepad), held keys, and charge/spin timers. */
  poll(dt) {
    let mx = 0;
    let my = 0;
    for (const k of this.keys) {
      const m = MOVE[k];
      if (m) {
        mx += m[0];
        my += m[1];
      }
    }
    const st = platform.controls.stick;
    if (Math.hypot(st.x, st.y) > 0.15) {
      mx = st.x;
      my = st.y;
    }
    this.gamepad();
    if (this.pad.on && Math.hypot(this.pad.mx, this.pad.my) > 0.2) {
      mx = this.pad.mx;
      my = this.pad.my;
    }
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    if (this.charging) this.charge = Math.min(1, this.charge + dt / 0.7);
    if (this.spinning) this.spin = Math.min(1, this.spin + dt / 1.1);
    return { mx, my, hurry: this.keys.has('shift') };
  }

  gamepad() {
    let pads = null;
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : null;
    } catch {
      this.gamepad = () => {};
      return;
    }
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    if (!gp) {
      this.pad.on = false;
      return;
    }
    this.pad.on = true;
    const ax = (i) => (Math.abs(gp.axes[i] ?? 0) > 0.15 ? gp.axes[i] : 0);
    this.pad.mx = ax(0);
    this.pad.my = ax(1);
    this.pad.aimX = ax(2);
    this.pad.aimY = ax(3);
    const pressed = gp.buttons.map((b) => !!b?.pressed);
    const edge = (i) => pressed[i] && !this.pad.prev[i];
    const rel = (i) => !pressed[i] && this.pad.prev[i];
    if (edge(0)) {
      this.charging = true;
      this.charge = 0;
    }
    if (rel(0) && this.charging) {
      this.charging = false;
      this.events.push({ t: 'leap', ...this.aimPoint(true), power: Math.max(0.35, this.charge) });
    }
    if (edge(2)) this.events.push({ t: 'use', on: true });
    if (rel(2)) this.events.push({ t: 'use', on: false });
    if (edge(1)) this.events.push({ t: 'cut', ...this.aimPoint() });
    if (edge(3)) this.events.push({ t: 'cycle' });
    if (edge(7)) this.events.push({ t: 'padcast' });
    if (edge(5)) this.events.push({ t: 'bite' });
    this.pad.prev = pressed;
  }

  take() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
