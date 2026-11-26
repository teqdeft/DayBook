// How long a dropped or cancelled card takes to settle (CONTRACT 28, Motion, Moments: Drop and
// Cancel), by the distance it still has to go: min(400, 250 + distance / 1500 × 150) ms, the
// shape of hello-pangea's drop time, only shorter; a card flying back takes 0.6 of that. Pure.
import { DUR } from './tokens';

const LONGEST_AT = 1500; // px: from here on a drop takes the longest time

/**
 * @param {number} distancePx
 * @param {boolean} [reduced]
 * @returns {number} ms: 0 px → 250, 750 px → 325, 1,500 px and more → 400; reduce 0
 */
export function dropDuration(distancePx, reduced = false) {
  if (reduced) return 0;
  const distance = Math.max(0, Number(distancePx) || 0);
  const span = DUR.dropMax - DUR.dropMin;
  return Math.round(Math.min(DUR.dropMax, DUR.dropMin + (distance / LONGEST_AT) * span));
}

/**
 * 0.6 times the drop time (a card flying back): 150 to 240 ms.
 * @param {number} distancePx
 * @param {boolean} [reduced]
 * @returns {number} ms
 */
export function cancelDuration(distancePx, reduced = false) {
  return Math.round(0.6 * dropDuration(distancePx, reduced));
}

/**
 * The straight distance between two boxes' top left corners.
 * @param {{ left: number, top: number }} a
 * @param {{ left: number, top: number }} b
 * @returns {number} px
 */
export function distanceBetween(a, b) {
  return Math.hypot(b.left - a.left, b.top - a.top);
}
