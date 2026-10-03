// Teaching in the moment: the first night walks you through one web and one catch, and after that a short hint
// appears the first few times something new happens. Five words at most; counts live in the save.
import { platform } from './platform.js';
import { T_FRAME, T_RADIAL } from '../sim/data.js';

const LIMIT = 3;

export class Hints {
  constructor(profile, dirty) {
    this.profile = profile;
    this.dirty = dirty;
    this.text = null;
    this.a = 0;
    this.until = 0;
    this.t = 0;
    this.step = null;
    this.moved = 0;
    this.last = null;
  }

  touch() {
    return platform.controls.touch;
  }

  /** Shows `text` for a few seconds if this hint hasn't been seen too often. */
  show(key, text, secs = 4, force = false) {
    const seen = this.profile.hints[key] ?? 0;
    if (!force && seen >= LIMIT) return false;
    if (this.text === text && this.until > this.t) return true;
    this.profile.hints[key] = seen + 1;
    this.dirty();
    this.text = text;
    this.until = this.t + secs;
    return true;
  }

  nightStart(run, season) {
    this.t = 0;
    this.text = null;
    this.step = season?.mode === 'tutorial' && !this.profile.tutorial && run.me()?.sp === 'orb' ? 'move' : null;
    this.moved = 0;
    this.last = null;
    const me = run.me();
    if (this.step) this.show('t-move', this.touch() ? 'Walk with the stick' : 'Walk the branch: WASD', 99, true);
    else if (me?.sp === 'jumper') this.show('jumper', 'Stalk, then pounce', 5);
    else if (me?.sp === 'bolas') this.show('bolas', 'Lure moths, swing the bolas', 5);
  }

  event(e, run) {
    const me = run?.me();
    if (!me) return;
    const mine = e.id === me.id;
    const step = this.step;
    if (step === 'cast' && mine && e.k === 'cast' && (e.type === T_FRAME || e.type === T_RADIAL || e.type === 0)) this.next(run, 'orb');
    if (step === 'orb' && mine && e.k === 'orbdone') {
      this.next(run, 'wait');
      // The tutorial's first visitor flies straight into the new web.
      run.command({ t: 'prey', sp: 'fly', x: e.x < 800 ? -40 : 1640, y: e.y - 40, tx: e.x, ty: e.y + 6 });
    }
    if (step === 'wait' && e.k === 'stick') {
      this.target = e.prey;
      this.next(run, 'go');
    }
    if ((step === 'go' || step === 'wrap') && mine && e.k === 'wrapstart') this.next(run, 'wrap');
    if ((step === 'go' || step === 'wrap') && mine && (e.k === 'cocoon' || e.k === 'eatstart')) this.next(run, e.k === 'cocoon' ? 'eat' : 'eating');
    if ((step === 'eat' || step === 'eating' || step === 'go' || step === 'wrap') && mine && e.k === 'eat') this.next(run, 'quota');
    if (step === 'go' && e.k === 'escape' && e.prey === this.target) {
      this.next(run, 'wait');
      run.command({ t: 'prey', sp: 'fly', x: -40, y: me.y - 40, tx: me.x + 30, ty: me.y });
    }
    // Hints for later nights.
    if (e.k === 'waspspot' && mine) this.show('wasp', 'Wasp! Hide in leaves');
    if (e.k === 'wrenwarn') this.show('wren', 'Wren! Leave the shadow');
    if (e.k === 'refuse' && mine && e.why === 'silk') this.show('silk', 'Rest to spin more');
    if (e.k === 'refuse' && mine && e.why === 'full') this.show('full', 'Cut threads to recycle');
    if (e.k === 'refuse' && mine && e.why === 'far') this.show('far', 'Too far to reach', 2);
    if (e.k === 'refuse' && mine && e.why === 'open') this.show('open', 'Needs twigs all around');
    if (e.k === 'downed' && mine) this.show('downed', 'You wake in the leaf', 4, true);
    if (e.k === 'escape' && !step) this.show('escape', 'Wrap them quicker');
    if (e.k === 'gustwarn') this.show('gust', 'Wind coming. Hold tight', 3);
    if (e.k === 'rain' && e.on) this.show('rain', 'Rain washes the glue', 4);
    if (e.k === 'mantis') this.show('mantis', 'Cut the mantis down', 5, true);
    if (e.k === 'tear') this.show('tear', 'Moths tear thin silk', 3);
    if (e.k === 'stick' && !step && me.sp === 'orb') this.show('stick', 'Something landed. Feel it', 3);
  }

  next(run, step) {
    this.step = step;
    // The Quick Orb is picked for you: on a phone it is five taps of the thread button away.
    if (step === 'orb') run.pickOrb();
    const touch = this.touch();
    const text = {
      cast: touch ? 'Tap the glowing twig' : 'Click the glowing twig',
      orb: touch ? 'Orb ready: tap the ring' : 'Orb ready: click the ring',
      wait: 'Now wait. Feel it',
      go: 'Something landed. Go!',
      wrap: touch ? 'Hold Wrap' : 'Hold E to wrap',
      eat: touch ? 'Tap Eat' : 'Tap E to eat',
      eating: 'Eating...',
      quota: `Eat ${run.world.quota} before dawn`,
    }[step];
    if (text) this.show(`t-${step}`, text, step === 'quota' ? 5 : 99, true);
    if (step === 'quota') this.step = null;
  }

  current(run) {
    this.t += 1 / 60;
    const me = run?.me();
    if (this.step === 'move' && me) {
      if (this.last) this.moved += Math.hypot(me.x - this.last.x, me.y - this.last.y);
      this.last = { x: me.x, y: me.y };
      if (this.moved > 90) this.next(run, 'cast');
    }
    if (this.step === 'go' && me) {
      const p = run.world.prey.find((q) => q.id === this.target);
      if (p && Math.hypot(p.x - me.x, p.y - me.y) < 30) this.next(run, p.sp === 'fly' || p.sp === 'gnat' ? 'eat' : 'wrap');
    }
    const on = this.text && this.t < this.until;
    this.a += ((on ? 1 : 0) - this.a) * 0.08;
    if (!on && this.a < 0.02) this.text = null;
    return this.text ? { text: this.text, a: this.a } : null;
  }
}
