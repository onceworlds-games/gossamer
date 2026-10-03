// The DOM screens over the garden: the title, the field notebook (the lobby between nights), and the card shown when
// the room closes. Everything players type or name is set with textContent.
import { onPlatform } from './platform.js';
import { Notebook } from './notebook.js';

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
    setTimeout(() => b.focus?.({ preventScroll: true }), 50);
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
