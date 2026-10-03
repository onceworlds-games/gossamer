# Gossamer

You are a spider in a moonlit garden. Spin a web where the night will fly, feel for what lands, and eat before dawn.

Play it at [onceworlds.com/play/gossamer](https://onceworlds.com/play/gossamer).

## How to play

Each night starts at dusk. Walk the branches and your own silk, throw threads between twigs, rails and stems, and
spin a web across the path the prey take (the notebook's forecast tells you what the night holds). Sticky silk
catches; dry frame and radial silk is strong and only bounces things. Everything that touches the web plucks it, and
you hear the note and see it run along the threads: long frame lines boom low, gnats are glitter.

Something stuck struggles and will tear free: walk to it, wrap it (hold E) and eat it (tap E) before dawn. Eat the
night's quota or lose one of your egg sacs. Wasps hunt you and rob the web, the wren's shadow sweeps a band of it
away (hide in the leaves or drop out of the band on a line), wind and rain test your knots, and on the tenth night a
mantis walks the silk. Between nights the field notebook tallies the catch, and you spend moult on upgrades and pin
one of three traits. Ten nights make a season.

### Controls

| Keyboard and mouse | Touch | |
| --- | --- | --- |
| W A S D / arrows | Stick | Walk along silk and branches; hold Down to lower yourself on a dragline |
| Click | Tap | Cast a thread to the twig or thread under the pointer (a held finger shows a loupe) |
| 1 2 3 4 | Thread button | Frame, radial, sticky, alarm silk |
| 5 (again for the next pattern) | Thread button | Quick Orb: tap a spot and the whole web is spun there |
| E (hold / tap) | Wrap / Eat button | Wrap a catch, eat a cocoon, give silk to a friend, help a friend up |
| F | Bite (hunter) | Bite: subdue a catch, fight a wasp (venom) |
| Space (hold to charge) | Leap / Pounce | Leap toward the pointer, laying a dragline |
| X / right-click | Cut | Cut a thread (some silk comes back) |
| Q | | Shake the dew off (with the Dew Shake upgrade) |
| B (hold) and L | Swing, Lure | Bolas spider: swing and throw the bolas, set a lure |
| Shift | Run (hunter) | Hurry (louder) |
| Tab, mouse wheel | Two-finger tap, drag | Ping a spot for friends; zoom / pan |

## What's in it

- **A real web.** Knots and threads are simulated (verlet points with soft distance constraints at 60 Hz). Threads
  stretch, sag under dew and weight, and snap when they stay past their limit. Prey stick where they hit, pull the
  web with their weight, and tear out the strands they hang on when they break free.
- **Three spiders.** The Orb Weaver builds. The Jumping Spider (after three nights) builds nothing: it stalks insects
  that land, out of their view, and pounces. The Bolas Spider (after fifty moths) sets a scent lure and swings a
  sticky ball at the moths it draws.
- **Four gardens**: Cottage Hedge, Reed Bed, Greenhouse, Yew Churchyard, each with its own prey, weather and
  anchors; the layout is new every night.
- **Prey**: gnats (in swarms), midges, flies, moths (drawn to lamps and fireflies; they tear thin silk), beetles
  (armoured, heavy, they thrash frames), dragonflies (late nights; they shred weak webs).
- **Hunters and weather**: wasps, the wren, the mantis on the last night; wind gusts with a warning, rain that washes
  the glue, mist, a firefly bloom.
- **Twelve upgrades** of three tiers, **twenty-four traits**, Quick Orb patterns (orb, ladder, funnel, close-woven).
- **Modes**: the ten-night season, Endless after it, the Daily Garden (one seeded night), and Cold Snap levels 1-5
  (each adds a rule) after a finished season.
- **The notebook**: egg points from each season buy gardens, silk colours, dew styles, stickers for its pages and
  hatchlings (start a season with a trait already pinned).

## Playing together

It's a friends game for up to four: everyone shares one garden, one web and one quota, and each plays their own
spider (any species). The host's page runs the night and checks every action; everyone else moves their own spider,
sends what they do, and draws a copy of the web that follows the host's. The night is the room's match and the
notebook is its lobby; friends who arrive at dusk are let in, later ones watch. A reload, a dropped connection or the
host leaving doesn't stop the night: the host writes a checkpoint every two seconds and whoever takes over carries on.

## How it's built

No build step: plain ES modules and Canvas 2D in `game/`, which is what's published.

- `game/js/sim/`: the simulation, with no DOM. The web (`web.js`), gardens (`garden.js`), spiders (`spider.js`,
  `actions.js`), prey (`prey.js`), hunters (`hostiles.js`), weather, the night's script and rules (`night.js`), the
  world tick (`world.js`), seasons and saves (`season.js`, `profile.js`), checkpoints (`codec.js`) and the bots.
  Seeded and fixed-step, so the same seed and inputs always give the same night.
- `game/js/render/`: the camera, the paper-cut backdrop, the garden, the silk, the creatures, effects, the HUD and
  the store-art scenes (`poster.js`).
- `game/js/audio/`: the web's plucked strings and everything else, all made with Web Audio.
- `game/js/net/coop.js`: playing together. `game/js/app/`: the page, input, the notebook, hints.
- `test/`: `node --test` tests for the simulation. `scripts/`: the balance harness, the store-art capture, a local
  server and test drivers.

## Running it

```
npm run dev        # http://127.0.0.1:8090 (the game alone; add ?test=bot for an autopilot night)
npm test           # unit, property and fuzz tests
npm run balance    # the balance harness (bots across seeds), about two minutes
npm run store      # recapture store/ from the game's own poster scenes
```

To try it with friends locally, deploy it to a local Onceworlds platform and open the play page in several windows
(`node scripts/coop.mjs` runs three guests through a night). Fonts (EB Garamond, Cedarville Cursive) are bundled
under their open licences in `licenses/`.

## Badges

First Catch, Orb Complete, Perfect Radials, Moth Hunter, Beetle Buster, Wren Dodge, Wasp Slayer, Ten Nights,
Daily Weaver, Silk Donor, Dew Master, Driven Off.

## Leaderboards

`season-score`, `endless-nights`, `biggest-catch` (the most eaten in one night), `daily-garden`.

## Licence

MIT. See `LICENSE`.
