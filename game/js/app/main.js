// Boot: join the room first (so a reload keeps its seat), then build the scene, then run the frame loop.
import { platform } from './platform.js';

const JOIN = { private: true, maxPlayers: 4, minPlayers: 1, lobby: 'bar' };

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('poster')) {
    const { runPoster } = await import('../render/poster.js');
    return runPoster(params.get('poster'));
  }
  const roomP = platform.join(JOIN);
  const [{ Game }, room] = await Promise.all([import('./game.js'), roomP]);
  const game = new Game({ room, join: JOIN, test: params.has('test') ? params.get('test') || 'night' : null });
  await game.init();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
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

boot();
