// The palette. Seven colours and their shades; nothing else is drawn.
export const INK = '#08171a'; // the night
export const TEAL = '#123335'; // deep foliage, far layers
export const LEAF = '#1e5450'; // near foliage, branches
export const SILVER = '#e6eee8'; // moon, silk
export const AMBER = '#f0a33c'; // prey, eyes, lamps
export const PAPER = '#efe4cb'; // the notebook
export const RUST = '#a9442c'; // danger, stamps

/** Parallax layers from far to near, each a little darker and greener. */
export const LAYERS = ['#21504f', '#173d3d', '#0f2c2d', '#081b1c'];
export const SKY_TOP = '#051113';
export const SKY_LOW = '#133236';
export const RIM = 'rgba(160, 204, 196, 0.32)';
export const BRANCH = '#173f3c';
export const BRANCH_RIM = '#3f7a71';

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Thread tints the player can earn (silk colours). */
export const SILKS = {
  silver: [230, 238, 232],
  moon: [214, 232, 246],
  amber: [246, 206, 140],
  verdigris: [150, 220, 196],
  rust: [236, 168, 140],
};
