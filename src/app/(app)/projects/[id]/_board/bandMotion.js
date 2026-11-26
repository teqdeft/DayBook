// The band's progress moment (CONTRACT 28, Motion, Moments: Band progress; motion.md 3.6): after the
// viewer's own tick, move or delete the changed parts' fills grow (or shrink) with scaleX and the
// percent counts up on its aria-hidden copy, while its hidden twin holds the final number. Played
// after the commit that draws the change (useBandMotion), so both end on what React drew; with
// reduce motion nothing moves. A phase move plays the band itself (phaseParts.js).
import { countUp, play } from '@/lib/motion/animate';
import { EASE, duration } from '@/lib/motion/tokens';

/** Whether the band draws these two apart (its percent or some part's fill). */
export const bandDiffers = (before, now) =>
  before.pct !== now.pct ||
  Object.keys(now.shares).some((key) => before.shares[key] !== now.shares[key]);

/** The percent's count-up; its last step writes what the hidden twin holds by then. */
function countPct(band, from, to) {
  const el = band?.querySelector('[data-pct]');
  const twin = band?.querySelector('[data-pct-final]');
  if (!el || from === to) return () => {};
  const format = (n) => (n === to ? (twin?.textContent ?? `${n}%`) : `${n}%`);
  return countUp(el, from, to, duration('fill'), { format });
}

/**
 * @param {Element | null} band
 * @param {ReturnType<typeof import('./bandView').bandValues>} before as drawn before the change
 * @param {ReturnType<typeof import('./bandView').bandValues>} now as drawn now
 * @returns {() => void} ends a count still running (on the final number)
 */
export function playBandChange(band, before, now) {
  if (before.currentPhase !== now.currentPhase) return () => {};
  for (const [key, share] of Object.entries(now.shares)) {
    const from = before.shares[key];
    if (from === share) continue;
    play(
      band?.querySelector(`[data-fill="${key}"]`),
      [{ transform: `scaleX(${from})` }, { transform: `scaleX(${share})` }],
      { duration: duration('fill'), easing: EASE.decelerate, id: 'band-fill' },
    );
  }
  return countPct(band, before.pct, now.pct);
}
