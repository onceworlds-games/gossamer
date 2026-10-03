// Serves game/ locally (no SDK: the game runs alone with its stand-in room). npm run dev
import { serve } from './cdp.mjs';

const port = Number(process.env.PORT ?? 8090);
const { port: p } = await serve('game', port);
console.log(`Gossamer on http://127.0.0.1:${p}/  (add ?test for the autopilot hook, ?poster=thumb1 for store art)`);
