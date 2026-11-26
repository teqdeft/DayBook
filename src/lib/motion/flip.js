// FLIP (CONTRACT 28, Motion, Modules and signatures): measure the boxes before a change, then play
// each element from where it was to where it is now. DOM only, no React. Reads all, then writes
// all; nothing under 0.5 px moves; no FLIP with reduce motion, in a hidden tab or past 150 cards
// or rows (rule 6): the change simply shows. A card that changes column flies as a fixed clone,
// because translating the real one back would be clipped by its new column's scroll box.
import { DUR, EASE, LIMITS } from './tokens';
import { cancelById, done, flash, play } from './animate';
import { cloneForMotion } from './clone';
import { prefersReducedMotion } from './reducedMotion';

const defaultKey = (el) => el?.dataset?.flip;
const SCROLLER = '[data-flip-scroll]';
const MIN_MOVE = 0.5;

const hiddenTab = () => typeof document !== 'undefined' && Boolean(document.hidden);

// The scroll box a relative box was measured in, kept on the box as a hidden key.
const WITHIN = Symbol('within');
const withinOf = (box) => box?.[WITHIN] ?? null;

/**
 * Rects by key, read in one pass; an element that isn't drawn (no box: `hidden`) is left out.
 * @param {Iterable<Element>} elements
 * @param {{ keyOf?: (el: Element) => string, relative?: boolean }} [options] `relative` keeps
 *   each box inside its nearest `[data-flip-scroll]`, so a later play survives a scroll
 * @returns {Map<string, { left: number, top: number, width: number, height: number }>}
 */
export function measure(elements, { keyOf = defaultKey, relative = false } = {}) {
  const boxes = new Map();
  for (const el of elements ?? []) {
    const key = keyOf(el);
    if (!key) continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) continue; // not drawn (hidden): it enters later, never slides
    const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const scroller = relative ? el.closest?.(SCROLLER) : null;
    if (scroller) {
      const outer = scroller.getBoundingClientRect();
      box.left = rect.left - outer.left + scroller.scrollLeft;
      box.top = rect.top - outer.top + scroller.scrollTop;
      Object.defineProperty(box, WITHIN, { value: scroller });
    }
    boxes.set(key, box);
  }
  return boxes;
}

/** A measured box in viewport px now (a relative one follows its scroll box). */
function inViewport(box) {
  const scroller = withinOf(box);
  if (!scroller) return box;
  const outer = scroller.getBoundingClientRect();
  return {
    left: box.left + outer.left - scroller.scrollLeft,
    top: box.top + outer.top - scroller.scrollTop,
    width: box.width,
    height: box.height,
  };
}

const countOf = (list, prefix) =>
  list.reduce((n, el) => n + (String(defaultKey(el) ?? '').startsWith(prefix) ? 1 : 0), 0);

/**
 * True when FLIP is skipped: more than 150 cards or rows in `root`, a hidden tab, or reduce
 * motion. The change then shows at once (plus the flash where the moment has one).
 * @param {Element | null} root
 * @returns {boolean}
 */
export function tooManyToFlip(root) {
  if (!root || hiddenTab() || prefersReducedMotion()) return true;
  const cards = root.querySelectorAll?.('[data-flip^="card:"]')?.length ?? 0;
  const rows = root.querySelectorAll?.('[data-flip^="row:"]')?.length ?? 0;
  return Math.max(cards, rows) > LIMITS.flipCards;
}

/**
 * Plays First to Last on the elements now on the page: (1) cancels their running 'flip'
 * animations, (2) reads every rect, (3) writes every animation. An element that moved under
 * 0.5 px gets none, a key in `skip` gets none, a new key that is drawn calls `onEnter(el)` (also
 * when the FLIP itself is skipped, so an entrance keeps its fade), and `moved` flies as a clone.
 * @param {Map<string, { left: number, top: number, width: number, height: number }>} first
 * @param {Iterable<Element>} elements
 * @param {{ duration?: number, easing?: string, keyOf?: (el: Element) => string,
 *   skip?: Set<string>, moved?: string | null, onEnter?: ((el: Element) => void) | null,
 *   flyMs?: number, delay?: number }} [options] delay: a later start (the phase move's columns)
 * @returns {Animation[]}
 */
export function flipFrom(first, elements, options = {}) {
  const { keyOf = defaultKey, skip = new Set(), onEnter = null } = options;
  const list = [...(elements ?? [])].filter(Boolean);
  const entering = list.filter(
    (el) => first && !first.has(keyOf(el)) && !skip.has(keyOf(el)) && drawn(el),
  );
  if (stillFor(first, list)) {
    for (const el of entering) onEnter?.(el);
    return [];
  }
  for (const el of list) cancelById(el, 'flip');
  const plans = plansFor(first, list, keyOf, skip); // read
  const animations = plans.flatMap((plan) => playPlan(plan, options)); // write
  for (const el of entering) onEnter?.(el);
  return animations;
}

/** True when the element has a box (a `hidden` column folded into the rail has none). */
const drawn = (el) => {
  const rect = el.getBoundingClientRect();
  return Boolean(rect.width || rect.height);
};

/** No FLIP: nothing measured, reduce motion, a hidden tab, or over 150 cards or rows. */
const stillFor = (first, list) =>
  !first ||
  prefersReducedMotion() ||
  hiddenTab() ||
  Math.max(countOf(list, 'card:'), countOf(list, 'row:')) > LIMITS.flipCards;

/** Reads every element's box now, beside the box it had. */
function plansFor(first, list, keyOf, skip) {
  const plans = [];
  for (const el of list) {
    const key = keyOf(el);
    if (!key || skip.has(key) || !first.has(key)) continue;
    const to = el.getBoundingClientRect();
    if (!to.width && !to.height) continue; // hidden now: nothing to play
    plans.push({ el, key, from: inViewport(first.get(key)), to });
  }
  return plans;
}

/** Writes one element's FLIP (or its fly), or nothing when it moved under 0.5 px. */
function playPlan({ el, key, from, to }, options) {
  const { duration = DUR.room, easing = EASE.standard, moved = null, flyMs = DUR.glide } = options;
  const delay = options.delay ?? 0;
  if (key === moved) return startFly(el, from, to, flyMs).animations;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < MIN_MOVE && Math.abs(dy) < MIN_MOVE) return [];
  const frames = [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }];
  const fill = delay > 0 ? 'backwards' : 'none'; // a delayed start holds the old place
  const animation = play(el, frames, { duration, easing, delay, fill, id: 'flip' });
  return animation ? [animation] : [];
}

const CLONE_STYLE = {
  position: 'fixed',
  top: '0px',
  left: '0px',
  margin: '0px',
  boxSizing: 'border-box',
  pointerEvents: 'none',
  zIndex: '90',
};

/** Starts a clone's glide and hides the real element for the same time (its own animation). */
function startFly(el, from, to, ms) {
  const doc = el.ownerDocument ?? globalThis.document;
  if (!doc?.body || !(ms > 0) || prefersReducedMotion() || hiddenTab()) {
    flash(el);
    return { animations: [], finished: Promise.resolve() };
  }
  const clone = cloneForMotion(el);
  Object.assign(clone.style, CLONE_STYLE, { width: `${from.width}px`, height: `${from.height}px` });
  clone.dataset.flyClone = '';
  doc.body.append(clone);
  const glide = play(
    clone,
    [
      { transform: `translate(${from.left}px, ${from.top}px)` },
      { transform: `translate(${to.left}px, ${to.top}px)` },
    ],
    { duration: ms, easing: EASE.standard, fill: 'forwards', id: 'fly' },
  );
  const hide = play(el, [{ opacity: 0 }, { opacity: 0 }], { duration: ms, id: 'fly-hide' });
  const finished = done(glide).then(() => {
    clone.remove();
    hide?.cancel();
    flash(el);
  });
  return { animations: [glide, hide].filter(Boolean), finished };
}

/**
 * A fixed clone of `el` glides from `from` to `to` (viewport boxes) while the real element is
 * kept at opacity 0 by its own animation (no inline style touched); then the real one flashes.
 * With reduce motion, a hidden tab or 0 ms it only flashes.
 * @param {Element} el
 * @param {{ left: number, top: number, width: number, height: number }} from
 * @param {{ left: number, top: number, width: number, height: number }} to
 * @param {{ duration?: number }} [options]
 * @returns {Promise<void>}
 */
export function flyClone(el, from, to, { duration = DUR.glide } = {}) {
  if (!el) return Promise.resolve();
  return startFly(el, from, to, duration).finished;
}
