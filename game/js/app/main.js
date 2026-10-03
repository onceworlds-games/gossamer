// Boot: join the room first (so a reload keeps its seat), then build the scene, then run the frame loop.
import { platform } from './platform.js';

const JOIN = { private: true, maxPlayers: 4, minPlayers: 1, lobby: 'bar' };

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('poster')) {
    const { runPoster } = await import('../render/poster.js');
    return runPoster(params.get('poster'));
  }
  const gameP = import('./game.js');
  let room;
  try {
    room = await platform.join(JOIN);
  } catch (err) {
    console.warn('join failed', err);
    return joinFailed();
  }
  const { Game } = await gameP;
  const game = new Game({ room, join: JOIN, test: params.has('test') ? params.get('test') || 'night' : window.__gossamerTest === true ? 'night' : null });
  await game.init();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      game.frame(dt);
    } catch (err) {
      // Never let one bad frame stop the loop; the platform reports it.
      console.error(err);
      if (!game.reported) {
        game.reported = true;
        setTimeout(() => {
          throw err;
        });
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** The server would not take us (it was full or closed, or the connection never came): one message, one button. */
function joinFailed() {
  const ui = document.getElementById('ui');
  const card = document.createElement('div');
  card.className = 'card-over';
  const h = document.createElement('h3');
  h.textContent = 'Could not join';
  const b = document.createElement('button');
  b.className = 'go';
  b.type = 'button';
  b.textContent = 'Try again';
  b.addEventListener('click', () => {
    card.remove();
    boot();
  });
  card.append(h, b);
  ui.append(card);
}

boot();
