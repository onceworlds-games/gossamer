// Every tuning number in one place. The balance harness (scripts/balance.mjs) measures these.

export const W = 1600;
export const H = 1000;
export const GROUND = 940;
export const DT = 1 / 60;
export const SUBSTEPS = 6;
export const GRAVITY = 420;
export const SILK_E = 1150; // stiffness per point of thread strength
export const DAMP = 2.2; // web velocity damping, per second
export const SNAP = 1.35; // strain at which a thread snaps
export const VMAX = 1600; // px/s clamp for any web node
export const MAX_NODES = 640; // garden points + up to 300 built + stuck prey
export const MAX_THREADS = 760;
export const GARDEN_IDS = 2000; // garden nodes and branches use ids below this; silk ids start here
export const PLAYER_NODES = 300; // what players may build; the rest is room for stuck prey
export const PLAYER_THREADS = 400;
export const MERGE = 6; // casts this close to a node land on the node
export const SNAP_RADIUS = 60; // aim snap, world px
export const JUNCTION_MASS = 0.03;
export const DEW_BEAD_MASS = 0.012;

// Thread kinds, stored as small ints.
export const T_FRAME = 0;
export const T_RADIAL = 1;
export const T_STICKY = 2;
export const T_ALARM = 3;
export const T_DRAG = 4;
export const T_SURFACE = 5;

export const THREADS = [
  { key: 'frame', name: 'Frame', strength: 100, cost: 0.06, taut: 0.97, width: 1.7 },
  { key: 'radial', name: 'Radial', strength: 55, cost: 0.04, taut: 0.975, width: 1.15 },
  { key: 'sticky', name: 'Sticky', strength: 20, cost: 0.025, taut: 1.0, width: 0.95 },
  { key: 'alarm', name: 'Alarm', strength: 15, cost: 0.02, taut: 0.985, width: 0.85 },
  { key: 'drag', name: 'Dragline', strength: 32, cost: 0.04, taut: 1.0, width: 0.9 },
  { key: 'surface', name: 'Branch', strength: 1e9, cost: 0, taut: 1, width: 0 },
];
export const CASTABLE = [T_FRAME, T_RADIAL, T_STICKY, T_ALARM];

// Node kinds.
export const N_ANCHOR = 0; // pinned to the garden (moves only with the plant it grows on)
export const N_JUNCTION = 1; // free silk knot
export const N_PREY = 2; // a stuck prey: a heavy free node

// ---------------------------------------------------------------- prey
// food, mass, speed (px/s), size (px), stick (base chance on sticky), tear (chance to rip through instead),
// struggle (kick px/s), escape (s stuck before it tears free), wrap (s), eat (s)
export const PREY = {
  gnat: { name: 'Gnat', food: 1, mass: 0.1, speed: 62, size: 2.2, stick: 0.96, tear: 0, struggle: 60, escape: 10, wrap: 0.35, eat: 0.4, small: true },
  midge: { name: 'Midge', food: 1.5, mass: 0.15, speed: 55, size: 2.6, stick: 0.93, tear: 0, struggle: 70, escape: 10, wrap: 0.4, eat: 0.5, small: true },
  fly: { name: 'Fly', food: 3, mass: 0.6, speed: 150, size: 5, stick: 0.8, tear: 0, struggle: 200, escape: 6, wrap: 1.1, eat: 0.9, small: true },
  moth: { name: 'Moth', food: 6, mass: 1.2, speed: 92, size: 12, stick: 0.62, tear: 0.55, struggle: 160, escape: 6.5, wrap: 1.7, eat: 1.4 },
  beetle: { name: 'Beetle', food: 8, mass: 4, speed: 82, size: 9, stick: 0.5, tear: 0, struggle: 150, escape: 9, wrap: 3, eat: 1.8, armour: true },
  dragonfly: { name: 'Dragonfly', food: 20, mass: 6, speed: 250, size: 26, stick: 0.55, tear: 0, struggle: 300, escape: 4.5, wrap: 3.6, eat: 2.4, shred: true },
};
export const PREY_KEYS = Object.keys(PREY);
export const MAX_PREY = 70;

// ---------------------------------------------------------------- hostiles
export const WASP = { speed: 150, huntSpeed: 230, sting: 25, detect: 190, patrol: 48, cutTime: 0.45, hp: 2, stun: 2.5, loot: 300, carry: 5 };
export const WREN = { warn: 2.5, band: 86, damage: 55, cross: 0.75 };
export const MANTIS = { speed: 52, reach: 74, damage: 40, windup: 0.95, climb: 12, falls: 3 };

// ---------------------------------------------------------------- spiders
// The three species. Speeds in px/s; silk regen per second while not spinning.
export const SPECIES = {
  orb: { name: 'Orb Weaver', hp: 100, silk: 100, regen: 1.8, speed: 220, range: 520, leap: 260, castTime: 0.25 },
  jumper: { name: 'Jumping Spider', hp: 100, silk: 40, regen: 2, speed: 165, run: 245, leap: 235, charge: 0.7, range: 0 },
  bolas: { name: 'Bolas Spider', hp: 90, silk: 60, regen: 2.2, speed: 150, line: 72, fling: 190, range: 0 },
};
export const SPECIES_KEYS = Object.keys(SPECIES);
export const STICKY_SLOW = 0.4;
export const HURRY = 1.45;
export const REGEN_DELAY = 1.5;
export const DRAGLINE_MIN = 5;
export const LEAP_COST = 2;
export const FALL_DAMAGE = 10;
export const DROP_SPEED = 120;
export const CUT_REFUND = 0.4;
export const SILK_PER_FOOD = 1;
export const HP_PER_FOOD = 2;
export const REACH = 28; // wrap/eat/bite distance
export const DOWNED_SOLO = 6;
export const DOWNED_COOP = 20;
export const REVIVE_TIME = 1.2;
export const RETREAT_HEAL = 4; // hp per second

// ---------------------------------------------------------------- the night
export const DUSK = 25;
export const NIGHT = 120;
export const DAWN_RECYCLE = 0.6;
export const REST_SILK = 0.25; // of max, regained over the day
export const QUOTAS = [9, 14, 20, 25, 30, 33, 35, 37, 39, 46]; // tuned with scripts/balance.mjs
export const SEASON_NIGHTS = 10;
export const START_LIVES = 3;
export const ENDLESS_GROWTH = 1.08;

export function quotaFor(night, cold = 0, extra = 1) {
  const base = night <= SEASON_NIGHTS ? QUOTAS[night - 1] : QUOTAS[SEASON_NIGHTS - 1] * ENDLESS_GROWTH ** (night - SEASON_NIGHTS);
  return Math.round(base * (cold >= 1 ? 1.1 : 1) * extra);
}

// ---------------------------------------------------------------- upgrades (three tiers each)
export const UPGRADE_COST = [10, 18, 28];
export const UPGRADES = {
  glands: { name: 'Silk Glands', for: ['orb', 'jumper', 'bolas'], tiers: ['More silk, faster', 'Deeper reserves', 'A full spinneret'] },
  strong: { name: 'Strong Silk', for: ['orb'], tiers: ['Frames hold a third more', 'Frames hold half again', 'Frames hold double'] },
  droplets: { name: 'Sticky Droplets', for: ['orb', 'bolas'], tiers: ['Catch more', 'Catch more, wash less', 'Glue that rain forgets'] },
  shake: { name: 'Dew Shake', for: ['orb'], tiers: ['Shake off dew (Q)', 'Wider shake', 'Shaking restores glue'] },
  legs: { name: 'Quick Legs', for: ['orb', 'jumper', 'bolas'], tiers: ['Faster feet', 'Sure on glue', 'Longest leaps'] },
  eyes: { name: 'Eight Eyes', for: ['orb', 'jumper', 'bolas'], tiers: ['Mark stuck prey', 'Mark hunters early', 'See every clock'] },
  venom: { name: 'Venom', for: ['orb', 'jumper', 'bolas'], tiers: ['One venom bite', 'Two bites', 'Three bites'] },
  camo: { name: 'Camouflage', for: ['orb', 'jumper', 'bolas'], tiers: ['Harder to spot', 'Bark-coloured', 'A shadow among shadows'] },
  alarm: { name: 'Alarm Lines', for: ['orb'], tiers: ['Trips show at the edge', 'Lines tangle hunters', 'Cheap, tough tripwires'] },
  templates: { name: 'Web Patterns', for: ['orb'], tiers: ['Ladder web', 'Funnel web', 'Close-woven spiral'] },
  lure: { name: 'Scent Glands', for: ['bolas'], tiers: ['Stronger lure', 'Two lures', 'Lure draws flies'] },
  eggsac: { name: 'Egg Sac', for: ['orb', 'jumper', 'bolas'], tiers: ['One more egg sac', 'Another', 'And another'], cost: [16, 24, 32] },
};
export const UPGRADE_KEYS = Object.keys(UPGRADES);

export function upgradeCost(id, tier) {
  const u = UPGRADES[id];
  return (u?.cost ?? UPGRADE_COST)[tier] ?? Infinity;
}

// ---------------------------------------------------------------- traits (one drafted from three each night)
// scope 'night' rules apply to the whole web once anyone holds them; 'self' rules to the holder.
export const TRAITS = {
  nightowl: { name: 'Night Owl', note: 'Dusk lingers ten seconds more.', scope: 'night' },
  dewharp: { name: 'Dew Harp', note: 'A trembling thread holds any gnat.', scope: 'night', for: ['orb'] },
  heavyheart: { name: 'Heavy Hearted', note: 'Beetles stick twice as well.', scope: 'night', for: ['orb'] },
  whisper: { name: 'Silk Whisper', note: 'Casting makes no sound for wasps.', scope: 'self', for: ['orb'] },
  taut: { name: 'Taut', note: 'Frames hold to 145% before snapping.', scope: 'night', for: ['orb'] },
  luckymoth: { name: 'Lucky Moth', note: 'The first moth of the night is a great one.', scope: 'night' },
  spinneret: { name: 'Spinneret', note: 'Sticky silk costs less; radials more.', scope: 'self', for: ['orb'] },
  gourmand: { name: 'Gourmand', note: 'Eat in half the time. Wrapping costs more.', scope: 'self' },
  patient: { name: 'Patient Heart', note: 'Silk returns twice as fast when still.', scope: 'self' },
  recycler: { name: 'Recycler', note: 'Cutting returns most of the silk.', scope: 'self', for: ['orb'] },
  huntersmoon: { name: "Hunter's Moon", note: 'A fifth more prey. The wren comes twice.', scope: 'night' },
  lantern: { name: 'Lantern', note: 'Fireflies follow you; moths follow them.', scope: 'self' },
  thickskin: { name: 'Thick Skin', note: 'Stings and kicks hurt less.', scope: 'self' },
  dancer: { name: 'Dragline Dancer', note: 'Leaps reach further and cost nothing.', scope: 'self' },
  balloon: { name: 'Ballooning', note: 'Falls drift down gently.', scope: 'self' },
  banker: { name: 'Silk Banker', note: 'Silk left at dawn becomes moult.', scope: 'self' },
  ironframe: { name: 'Iron Frame', note: 'Wasps cannot cut frame threads.', scope: 'night', for: ['orb'] },
  keeper: { name: 'Cocoon Keeper', note: 'Cocoons left at dawn count for half.', scope: 'night', for: ['orb'] },
  feast: { name: 'Night Feast', note: 'Moths and beetles feed more; gnats less.', scope: 'night' },
  quickwrap: { name: 'Quick Wrap', note: 'Wrapping takes much less time.', scope: 'self', for: ['orb'] },
  windreader: { name: 'Wind Reader', note: 'Gusts are seen early and blow softer.', scope: 'night' },
  gluerain: { name: 'Glue Rain', note: 'Rain makes sticky silk stickier.', scope: 'night', for: ['orb', 'bolas'] },
  fierce: { name: 'Fierce', note: 'A bite stuns a wasp, venom or not.', scope: 'self' },
  longnight: { name: 'Long Night', note: 'Dawn comes later. The quota grows.', scope: 'night' },
};
export const TRAIT_KEYS = Object.keys(TRAITS);

export function traitFits(id, species) {
  const t = TRAITS[id];
  return !!t && (!t.for || t.for.includes(species));
}

// ---------------------------------------------------------------- gardens
// prey: weight multipliers per species; weather: chances per night; cover/anchors come from garden.js.
export const GARDENS = {
  cottage: { name: 'Cottage Hedge', cost: 0, prey: { gnat: 1, midge: 0, fly: 1, moth: 1, beetle: 1, dragonfly: 0.6 }, rain: 0.3, mist: 0.15, bloom: 0.45, wind: 1 },
  reed: { name: 'Reed Bed', cost: 12, prey: { gnat: 0.6, midge: 1.6, fly: 0.7, moth: 0.8, beetle: 0.6, dragonfly: 1.6 }, rain: 0.3, mist: 0.55, bloom: 0.3, wind: 1.15 },
  greenhouse: { name: 'Greenhouse', cost: 18, prey: { gnat: 1, midge: 0.3, fly: 1.2, moth: 1.9, beetle: 0.8, dragonfly: 0.4 }, rain: 0.15, mist: 0.1, bloom: 0, wind: 0.6 },
  churchyard: { name: 'Yew Churchyard', cost: 24, prey: { gnat: 0.9, midge: 0.4, fly: 1, moth: 1.2, beetle: 1.4, dragonfly: 0.7 }, rain: 0.35, mist: 0.4, bloom: 0.2, wind: 1.35 },
};
export const GARDEN_KEYS = Object.keys(GARDENS);

// ---------------------------------------------------------------- Cold Snap (ascension), cumulative
export const COLD = [
  null,
  { name: 'Thin Frost', note: 'Quotas a tenth higher.' },
  { name: 'Lean Nights', note: 'Quiet spells run longer.' },
  { name: 'Brittle Silk', note: 'Wet threads snap sooner.' },
  { name: 'Hungry Birds', note: 'The wren comes from night two.' },
  { name: 'Last Brood', note: 'Begin with two egg sacs.' },
];

// ---------------------------------------------------------------- meta (egg points)
export const UNLOCKS = {
  species: { jumper: { name: 'Jumping Spider', how: 'Finish three nights' }, bolas: { name: 'Bolas Spider', how: 'Catch fifty moths' } },
  colours: { silver: 0, moon: 4, amber: 6, verdigris: 6, rust: 8 },
  dews: { round: 0, star: 5, prism: 8 },
  stickers: { fern: 2, beetle: 3, moon: 3, feather: 4, key: 5 },
};
export const HATCHLING_COST = 6;
