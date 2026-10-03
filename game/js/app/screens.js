// The DOM screens over the garden: the title, the field notebook (the lobby between nights), and the card shown when
// the room closes. Everything players type or name is set with textContent.
import { onPlatform } from './platform.js';
import { Notebook } from './notebook.js';
import { spiderSketch } from './ink.js';
import { SPECIES } from '../sim/data.js';

export class Screens {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.el = null;
    this.notebook = new Notebook(game);
    this.mode = null;
  }

  clear() {
    this.root.replaceChildren();
    this.el = null;
    this.zoomEl = null;
    this.joinEl = null;
    this.joinKey = '';
    this.mode = null;
  }

  title(onPlay) {
    this.clear();
    this.mode = 'title';
    const box = div('title');
    const h = document.createElement('h1');
    h.textContent = 'Gossamer';
    const b = button('play', 'Play', () => onPlay());
    box.append(h, b);
    this.root.append(box);
    this.el = box;
  }

  book() {
    this.clear();
    this.mode = 'book';
    this.el = this.notebook.mount(this.root, !onPlatform);
  }

  refresh() {
    if (this.mode === 'book') this.notebook.render();
  }

  closeBook(animate) {
    if (this.mode !== 'book') return;
    if (animate && this.el) {
      this.el.style.transition = 'opacity 0.6s ease';
      this.el.style.opacity = '0';
      setTimeout(() => this.mode !== 'book' || this.clear(), 650);
      this.mode = 'closing';
      setTimeout(() => {
        if (this.mode === 'closing') this.clear();
      }, 650);
    } else this.clear();
  }

  closed(reason, rejoin) {
    this.clear();
    this.mode = 'closed';
    const card = div('card-over');
    const h = document.createElement('h3');
    const words = { kicked: ['You were removed', 'Play'], disconnected: ['Connection lost', 'Rejoin'], replaced: ['Playing in another tab', 'Play here'] }[reason] ?? ['The garden closed', 'Play'];
    h.textContent = words[0];
    const b = button('go', words[1], async () => {
      b.disabled = true;
      try {
        await rejoin();
      } catch {
        b.disabled = false;
      }
    });
    card.append(h, b);
    this.root.append(card);
  }

  frame(dt) {
    if (this.mode === 'book') this.notebook.frame(dt);
  }

  /**
   * A friend arriving at dusk picks a spider to join the night with (the host lets them in). `kinds`: species they own;
   * `picked`: the one asked for, or null. Pass kinds = null to take the card away.
   */
  join(kinds, picked, onPick) {
    const key = kinds ? `${kinds.join()}|${picked ?? ''}` : '';
    if (key === this.joinKey) return;
    this.joinKey = key;
    this.joinEl?.remove();
    this.joinEl = null;
    if (!kinds) return;
    const card = div('join');
    card.append(div('jlabel', picked ? 'Joining' : 'Join tonight'));
    const row = div('jrow');
    for (const k of kinds) {
      const b = button(`jbtn${picked === k ? ' on' : ''}`, '', () => onPick(k));
      b.disabled = !!picked;
      b.append(spiderSketch(k));
      const n = document.createElement('span');
      n.textContent = SPECIES[k]?.name ?? k;
      b.append(n);
      row.append(b);
    }
    card.append(row);
    this.root.append(card);
    this.joinEl = card;
  }

  /** On touch screens, two small buttons zoom (the frame doesn't allow pinching). */
  zoom(show, onIn, onOut) {
    if (show && !this.zoomEl) {
      const box = div('zoom');
      box.append(button('', '+', onIn), button('', '−', onOut));
      box.firstChild.setAttribute('aria-label', 'Zoom in');
      box.lastChild.setAttribute('aria-label', 'Zoom out');
      this.root.append(box);
      this.zoomEl = box;
    } else if (!show && this.zoomEl) {
      this.zoomEl.remove();
      this.zoomEl = null;
    }
  }
}

export function div(cls, text) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function button(cls, label, onClick, key) {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  b.textContent = label;
  if (key) {
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = key;
    b.append(k);
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}
