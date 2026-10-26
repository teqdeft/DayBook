// Swipe left to delete a notification on touch screens (CONTRACT 20): the numbers behind the
// gesture, kept pure so they can be tested without a browser.

/** Pixels the finger moves before the gesture counts as a swipe or a scroll. */
export const SWIPE_SLOP = 10;
/** Past this share of the row's width (and at least MIN_SWIPE px) letting go deletes. */
export const SWIPE_SHARE = 0.35;
export const MIN_SWIPE = 80;
/** How long the row takes to slide out or snap back (matches the CSS transition). */
export const SWIPE_SETTLE_MS = 180;

/**
 * What a touch is doing once it has moved: a horizontal swipe, a vertical scroll, or not yet known.
 * @param {{ dx: number, dy: number }} move from where the finger went down
 * @returns {'swipe' | 'scroll' | null}
 */
export function swipeIntent({ dx, dy }) {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x < SWIPE_SLOP && y < SWIPE_SLOP) return null;
  return x > y ? 'swipe' : 'scroll';
}

/** Where the row sits while swiping: it follows the finger to the left and never to the right. */
export function swipeOffset(dx) {
  return Math.min(0, Math.round(dx));
}

/** The distance (px) a swipe has to cover on a row this wide. */
export function swipeThreshold(width) {
  return Math.max(MIN_SWIPE, (Number(width) || 0) * SWIPE_SHARE);
}

/** True when letting go at this offset deletes the row; below the threshold it snaps back. */
export function swipeDeletes({ offset, width }) {
  return -offset >= swipeThreshold(width);
}
