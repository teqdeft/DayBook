// Web Animations helpers (CONTRACT 28, Motion, Modules and signatures): play, done, cancel,
// finish, the flash, count-up and the Board and Table crossfade. Every animation here is started
// by an action (a handler, an animation or timer callback, or a queued commit request), never in
// render. With reduce motion `play` keeps only what doesn't move (opacity, colours), and a running
// movement jumps to its end the moment the setting turns on (rule 7).
import { flushSync } from 'react-dom';
import { DUR, EASE, duration } from './tokens';
import { prefersReducedMotion, subscribeReducedMotion } from './reducedMotion';

// Keyframe properties that move (taken out with reduce motion); offset, easing and composite are
// keyframe settings, not properties.
const MOVING = new Set(['transform', 'translate', 'scale', 'rotate', 'strokeDashoffset']);
const SETTINGS = new Set(['offset', 'easing', 'composite']);

const running = new Set();
let watching = false;

function watchSetting() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  subscribeReducedMotion(() => {
    if (prefersReducedMotion()) finishAll();
  });
}

const hasProperty = (frame) => Object.keys(frame).some((name) => !SETTINGS.has(name));

/** The keyframes without movement, or null when nothing would be left to play. */
export function stillKeyframes(keyframes) {
  const strip = (frame) =>
    Object.fromEntries(Object.entries(frame ?? {}).filter(([name]) => !MOVING.has(name)));
  if (!Array.isArray(keyframes)) {
    const left = strip(keyframes);
    return hasProperty(left) ? left : null;
  }
  const left = keyframes.map(strip).filter(hasProperty);
  return left.length ? left : null;
}

/**
 * One Web Animation on `el`, or null when there is nothing to play: no `el.animate`, 0 ms, or
 * only movement with reduce motion (a mixed fade-and-move keeps its fade).
 * @param {Element | null} el
 * @param {Keyframe[] | PropertyIndexedKeyframes} keyframes
 * @param {{ duration: number, easing?: string, delay?: number,
 *   fill?: 'none' | 'forwards' | 'backwards' | 'both', id?: string }} options
 * @returns {Animation | null}
 */
export function play(
  el,
  keyframes,
  { duration: ms, easing = EASE.standard, delay = 0, fill = 'none', id = 'motion' } = {},
) {
  if (!el || typeof el.animate !== 'function' || !(ms > 0)) return null;
  watchSetting();
  const frames = prefersReducedMotion() ? stillKeyframes(keyframes) : keyframes;
  if (!frames) return null;
  const animation = el.animate(frames, { duration: ms, easing, delay, fill, id });
  if (!animation) return null;
  running.add(animation);
  const forget = () => running.delete(animation);
  animation.finished?.then(forget, forget);
  return animation;
}

/**
 * Settles when the animation ends.
 * @param {Animation | null} animation
 * @returns {Promise<boolean>} true when it finished (or there was none), false when cancelled;
 *   never rejects
 */
export function done(animation) {
  if (!animation?.finished) return Promise.resolve(true);
  return animation.finished.then(
    () => true,
    () => false,
  );
}

/** Cancels the element's running animations with this id. */
export function cancelById(el, id) {
  for (const animation of el?.getAnimations?.() ?? []) {
    if (animation.id === id) animation.cancel();
  }
}

/** Jumps every running animation to its end (the reduce setting turned on). */
export function finishAll() {
  for (const animation of [...running]) {
    try {
      animation.finish();
    } catch {
      animation.cancel?.(); // an infinite or paused one can't finish
    }
  }
}

const listOf = (elOrList) => {
  if (!elOrList) return [];
  if (typeof elOrList.animate === 'function' || !elOrList[Symbol.iterator]) return [elOrList];
  return [...elOrList].filter(Boolean);
};

/** A colour token's value, read once from the page's root. */
export function rootToken(name) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * The "just added, moved, assigned" flash: `--primary-soft` fading to each element's own
 * background, 700 ms, colour only (it stays with reduce motion). A second flash restarts it.
 * One style read per call, however many elements (a bulk action flashes up to 100 rows).
 * @param {Element | Iterable<Element> | null} elOrList
 * @param {{ color?: string }} [options] another start colour (the phase move's column)
 * @returns {Animation[]}
 */
export function flash(elOrList, { color } = {}) {
  const list = listOf(elOrList);
  if (!list.length) return [];
  const soft = color ?? rootToken('--primary-soft');
  if (!soft) return [];
  const animations = [];
  for (const el of list) {
    cancelById(el, 'flash');
    const animation = play(el, [{ backgroundColor: soft, offset: 0 }], {
      duration: DUR.flash,
      easing: EASE.flash,
      id: 'flash',
    });
    if (animation) animations.push(animation);
  }
  return animations;
}

/**
 * Counts `el`'s number from `from` to `to` in `ms`, writing `textContent` only and always ending
 * on `to`. With reduce motion (or 0 ms) it writes `to` at once.
 * @param {Element} el an `aria-hidden` copy; a hidden twin holds React's number
 * @param {number} from
 * @param {number} to
 * @param {number} ms
 * @param {{ format?: (n: number) => string }} [options]
 * @returns {() => void} cancel (writes `to`)
 */
export function countUp(el, from, to, ms, { format = (n) => String(n) } = {}) {
  const end = () => {
    if (el) el.textContent = format(to);
  };
  if (
    !el ||
    !(ms > 0) ||
    from === to ||
    prefersReducedMotion() ||
    !globalThis.requestAnimationFrame
  ) {
    end();
    return () => {};
  }
  let start = null;
  let raf = 0;
  const step = (now) => {
    start ??= now;
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  el.textContent = format(from);
  raf = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(raf);
    end();
  };
}

let turns = 0;
let fading = null;

/**
 * The Board and Table switch: the old view fades out, `change` commits, the new view fades in.
 * No movement; the old view stays clickable while it fades. A second switch while one fades jumps
 * that fade to its end, and only the latest switch commits, so the view never stays at opacity 0.
 * @param {Element | (() => Element | null) | null} el the view wrapper (`data-view`), or a getter
 *   when the wrapper is drawn again by the change
 * @param {() => void} change
 * @returns {Promise<void>}
 */
export async function crossfade(el, change) {
  const target = typeof el === 'function' ? el : () => el;
  const turn = ++turns;
  let out = fading;
  if (out) {
    try {
      out.finish();
    } catch {
      out.cancel();
    }
  } else {
    cancelById(target(), 'crossfade-in');
    out = play(target(), [{ opacity: 1 }, { opacity: 0 }], {
      duration: duration('out'),
      easing: EASE.accelerate,
      fill: 'forwards',
      id: 'crossfade',
    });
  }
  fading = out;
  await done(out);
  if (turn !== turns) return; // a newer switch commits instead
  fading = null;
  flushSync(change);
  play(target(), [{ opacity: 0 }, { opacity: 1 }], {
    duration: duration('in'),
    easing: EASE.decelerate,
    id: 'crossfade-in',
  });
  out?.cancel(); // same task as the fade-in: no frame at opacity 0 after the change
}

/** Test seam: forget the running set and the crossfade turn. */
export function resetAnimateForTests() {
  running.clear();
  turns = 0;
  fading = null;
  watching = false;
}
