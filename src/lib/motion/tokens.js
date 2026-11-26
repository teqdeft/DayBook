// The motion tokens for JavaScript (CONTRACT 28 Motion, Tokens): the same numbers as the --dur-*,
// --ease-* and --lift-* tokens in src/app/globals.css, so the motion code needs no style read per
// call and works in node tests. tests/unit/motionTokens.test.js keeps the two equal; change both
// together. The CSS stays the source for CSS; this file is the source for Web Animations.
import { prefersReducedMotion } from './reducedMotion';

/** Durations in ms, by moment (globals.css --dur-<name>, camelCase here). */
export const DUR = {
  press: 110,
  fade: 120,
  lift: 150,
  room: 200,
  tint: 200,
  tag: 200,
  tick: 250,
  dropMin: 250,
  dropMax: 400,
  fold: 300,
  glide: 350,
  fill: 500,
  flash: 700,
  in: 220,
  out: 160,
  toastIn: 200,
  toastOut: 150,
};

/** Easing curves (globals.css --ease-<name>). */
export const EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  accelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  settle: 'cubic-bezier(0.2, 1, 0.1, 1)',
  press: 'cubic-bezier(0.4, 1, 0.6, 1)',
  tint: 'cubic-bezier(0.15, 1, 0.3, 1)',
  flash: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

/** The dragged card's lift (globals.css --lift-scale, --lift-tilt, --lift-rise). */
export const LIFT = { scale: 1.02, tiltDeg: 2, risePx: -2 };

/** Limits of the motion engine (no CSS twin). */
export const LIMITS = {
  flipCards: 150,
  dragThreshold: 6,
  settleLock: 400,
  autoScrollDelay: 300,
  edgeMax: 160,
  edgeShare: 0.25,
  edgeSpeed: 20,
  tickWait: 600,
  announceDebounce: 100,
  newCardWait: 2000,
};

// Moments that move (0 with reduce) and entrances and exits (the fade with reduce), as the
// globals.css reduce block. press, fade and flash are colour or opacity and stay as they are.
const MOVING = new Set([
  'lift',
  'room',
  'tint',
  'tick',
  'dropMin',
  'dropMax',
  'fold',
  'glide',
  'fill',
]);
const FADED = new Set(['tag', 'in', 'out', 'toastIn', 'toastOut']);

/**
 * ms for this moment; with reduce motion movement is 0 and entrances and exits are the fade.
 * @param {keyof typeof DUR} name
 * @param {boolean} [reduced] the computer's setting, read at call time when not given (false on
 *   the server)
 * @returns {number}
 */
export function duration(name, reduced = prefersReducedMotion()) {
  if (!reduced) return DUR[name];
  if (MOVING.has(name)) return 0;
  return FADED.has(name) ? DUR.fade : DUR[name]; // press, fade, flash stay
}
