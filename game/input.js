// Input: hold to run (Space / W / Up, the Run button, or a finger or mouse held on the right half of the screen), steer with A D / arrows
// or the thumbstick. Everything is read each frame as plain state.

const RUN_KEYS = new Set(['Space', 'KeyW', 'ArrowUp']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const BLOCK_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function createInput(canvas, ow) {
  const keys = new Set();
  const held = new Map(); // pointer id -> true, for fingers/mouse held on the right half
  let onTap = null; // (x, y) => true when a button took the tap
  let onKey = null; // (code) => void, for Space/Enter on menus
  let width = () => window.innerWidth;

  const release = () => {
    keys.clear();
    held.clear();
  };

  const onKeyDown = (e) => {
    if (BLOCK_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) onKey?.(e.code);
    keys.add(e.code);
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onHidden = () => document.hidden && release();
  const onDown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (onTap?.(x, y)) return;
    if (x > width() / 2) {
      held.set(e.pointerId, true);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // some browsers refuse
      }
    }
  };
  const lift = (e) => held.delete(e.pointerId);
  const noMenu = (e) => e.preventDefault();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', onHidden);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('lostpointercapture', lift);
  canvas.addEventListener('contextmenu', noMenu);

  const stickX = () => {
    const x = ow?.controls?.stick?.x;
    if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) < 0.12) return 0;
    return Math.max(-1, Math.min(1, x));
  };

  return {
    setWidth(fn) {
      width = fn;
    },
    onTap(fn) {
      onTap = fn;
    },
    onKey(fn) {
      onKey = fn;
    },
    release,
    /** Takes every listener off again (the page is starting over in a new room). */
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onHidden);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', lift);
      canvas.removeEventListener('pointercancel', lift);
      canvas.removeEventListener('lostpointercapture', lift);
      canvas.removeEventListener('contextmenu', noMenu);
      keys.clear();
      held.clear();
    },
    /** True while any run control is held. */
    run() {
      for (const k of RUN_KEYS) if (keys.has(k)) return true;
      if (held.size > 0) return true;
      try {
        return Boolean(ow?.controls?.pressed?.('run'));
      } catch {
        return false;
      }
    },
    /** -1 (left) to 1 (right). */
    steer() {
      let s = stickX();
      for (const k of LEFT_KEYS) if (keys.has(k)) s -= 1;
      for (const k of RIGHT_KEYS) if (keys.has(k)) s += 1;
      return Math.max(-1, Math.min(1, s));
    },
  };
}
