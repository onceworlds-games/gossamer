// Three guests on the local platform: lobby, ready, a night together, reloads of a guest and the host, a dropped
// connection, then dawn and the next night's page. Needs the local platform running and the game deployed there.
//   node scripts/coop.mjs            (about four minutes)
import { launch } from '/Users/gowravthota/Desktop/commit/onceworlds-games/_tools/mp-lib.mjs';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fails = [];
const check = (ok, what) => {
  log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) fails.push(what);
};
const room = (p, expr) => p.frame(`(() => { const r = onceworlds.rooms.current; return ${expr}; })()`);
async function until(fn, ms = 20000, step = 400) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) return false;
    await sleep(step);
  }
}

const mp = await launch({ players: 3, base: BASE, width: 760, height: 520 });
const P = mp.players;
try {
  await P[0].open('/play/gossamer');
  const url = await P[0].top('location.href');
  log('server', url.replace(BASE, ''));
  await Promise.all([P[1].open(url.replace(BASE, '')), P[2].open(url.replace(BASE, ''))]);
  check(await until(() => room(P[0], 'r.players.size === 3')), 'three players in one room');
  for (const p of P) await p.frame("document.querySelector('.play')?.click()");
  check(await until(() => room(P[0], "r.state.season && Object.keys(r.state.season.roster).length === 3")), 'everyone has a spider in the season');
  check(await until(() => P[1].frame("!!document.querySelector('.page')")), 'the notebook is open');
  // Guests ready, the host starts.
  for (const p of [P[1], P[2]]) await p.top("document.querySelector('.ow-lobby-bar .ow-lobby-action')?.click()");
  await sleep(1200);
  await P[0].top("document.querySelector('.ow-lobby-bar .ow-lobby-action')?.click()");
  check(await until(() => room(P[0], "r.match.phase === 'playing'"), 25000), 'the night starts');
  check(await until(() => room(P[1], "r.state.night && r.state.night.mid === r.match.id")), 'the night record is shared');
  check(await until(() => room(P[2], "r.state.ck && r.state.ck.mid === r.match.id"), 8000), 'a checkpoint is written');
  // A guest walks: its presence moves.
  const x0 = await room(P[1], 'r.me.presence && r.me.presence.x');
  for (let i = 0; i < 6; i++) await P[1].key('d');
  await sleep(1500);
  const x1 = await room(P[1], 'r.me.presence && r.me.presence.x');
  log('guest x', x0, '->', x1);
  check(Number.isFinite(x1), 'a guest reports where its spider is');
  const hostBefore = await room(P[0], 'r.host');
  // Reload a guest mid-night.
  await P[2].reload();
  await P[2].waitRoom?.();
  check(await until(() => room(P[2], "r.match.phase === 'playing' && !!r.me.presence"), 25000), 'a reloaded guest is back in the night');
  // The host reloads: the role moves on, the night goes on.
  const tBefore = await room(P[1], 'r.state.ck && r.state.ck.meta.t');
  await P[0].reload();
  await P[0].waitRoom?.();
  const hostAfter = await until(() => room(P[1], 'r.host'), 10000);
  log('host', hostBefore, '->', hostAfter);
  check(await until(() => room(P[1], "r.match.phase === 'playing'"), 15000), 'the night survives the host reloading');
  await sleep(5000);
  const tAfter = await room(P[1], 'r.state.ck && r.state.ck.meta.t');
  log('night time', tBefore, '->', tAfter);
  check(tAfter > tBefore, 'the night clock goes on under the new host');
  // A dropped connection.
  await P[1].dropSocket();
  check(await until(() => room(P[1], 'r.connected === true'), 20000), 'a dropped guest reconnects');
  // Wait for dawn (the night is two and a half minutes), then the notebook again.
  check(await until(() => room(P[1], "r.match.phase === 'lobby'"), 200000, 1500), 'dawn ends the night');
  check(await until(() => room(P[1], 'r.state.result && r.state.season && r.state.season.night === 2'), 15000), 'the season moves to night two');
  check(await until(() => P[2].frame("!!document.querySelector('.page')"), 15000), 'the notebook opens again');
  for (const [i, p] of P.entries()) {
    const errs = p.errors.filter((e) => !/ResizeObserver/.test(String(e)));
    const warn = p.logs.filter((l) => /waiting|dropped/i.test(String(l)));
    check(errs.length === 0, `player ${i}: no uncaught errors${errs.length ? ` (${errs.slice(0, 3).join(' | ')})` : ''}`);
    check(warn.length === 0, `player ${i}: no budget warnings${warn.length ? ` (${warn.slice(0, 2).join(' | ')})` : ''}`);
  }
} catch (err) {
  fails.push(String(err?.stack ?? err));
  console.error(err);
} finally {
  await mp.close();
}
console.log(fails.length ? `\n${fails.length} problem(s)` : '\nall good');
process.exit(fails.length ? 1 : 0);
