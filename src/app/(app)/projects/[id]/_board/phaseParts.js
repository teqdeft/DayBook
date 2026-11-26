// The parts of the phase move (CONTRACT 28, Motion, Phase move sequence), each played after the
// commit by phaseMotion.js from what it read before: the band (the finished phase's fill and green
// layer, the ring, the check), the "Current" tags, the rail (its count, or a new tile), the fold
// and the columns' slide. The clones are inert copies placed absolutely in the board's wrapper or
// the band, removed when their fade ends (or by the cleanup). Times are from the timeline; `at`
// turns them to 0 with reduce motion, when `play` keeps only the fades.
import { DUR, EASE, duration } from '@/lib/motion/tokens';
import { play } from '@/lib/motion/animate';
import { cloneForMotion } from '@/lib/motion/clone';
import { flipFrom } from '@/lib/motion/flip';

/** When each row of the timeline starts (ms after the commit). */
export const TIMELINE = {
  fill: 0,
  ring: 200,
  check: 250,
  tags: 350,
  fold: 400,
  slide: 480,
  scroll: 700,
  toast: 760,
};
const RING_MS = 300; // the ring's slide (CONTRACT 28: 300 ms, standard)
const COME_BACK_DELAY = 300; // a column that comes back ("Go back") fades in after this
// --scale-fold and --shift-in as numbers (keyframes given to element.animate stay literal; with
// reduce motion `play` drops the transform anyway).
const FOLD_SCALE = 0.96;
const SHIFT_IN = 8;
/** What the motion reads on the board's own elements: a clone must never be found instead. */
const MARKS = [
  'data-flip',
  'data-column',
  'data-cards',
  'data-follow',
  'data-current-tag',
  'data-rail-n',
  'data-tile',
  'data-check',
];

/** The columns and the rail, as the phase move measures them before the change. */
export const LAYOUT = '[data-flip^="col:"], [data-flip="rail"]';

/** The board's scroll box (`data-board`): `root` itself or the one inside it. */
export const boardIn = (root) =>
  root?.matches?.('[data-board]') ? root : (root?.querySelector?.('[data-board]') ?? root ?? null);

/** A part's done share as its fill draws it (`--share`). */
export const shareOf = (el) => Number.parseFloat(el?.style?.getPropertyValue?.('--share')) || 0;

/**
 * An inert copy of `el` placed where it is now, absolutely inside `host`; appended by `show`.
 * @returns {{ copy: Element, host: Element } | null}
 */
export function cloneInside(el, host) {
  if (!el || !host) return null;
  const box = el.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const copy = cloneForMotion(el);
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of MARKS) node.removeAttribute(name);
  }
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${box.left - hostBox.left + (host.scrollLeft ?? 0)}px`,
    top: `${box.top - hostBox.top + (host.scrollTop ?? 0)}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0px',
    zIndex: '3',
    pointerEvents: 'none',
  });
  return { copy, host };
}

/** Puts a clone on the page and plays its way out; it goes when that ends. */
function fadeClone(clone, keyframes, options, keep) {
  if (!clone) return null;
  clone.host.append(clone.copy);
  keep.clones.push(clone.copy);
  const animation = play(clone.copy, keyframes, { ...options, fill: 'forwards' });
  if (!animation) clone.copy.remove();
  else
    animation.finished.then(
      () => clone.copy.remove(),
      () => {},
    );
  return animation;
}

/** The finished phase's fill grows (scaleX) and its green layer fades in ("Go back": out). */
function playFill(band, before) {
  const layer = band?.querySelector(`[data-done-layer="${before.part}"]`);
  const nowShare = shareOf(band?.querySelector(`[data-fill="${before.part}"]`));
  const options = { duration: duration('fill'), easing: EASE.decelerate, id: 'phase-fill' };
  const grow = [{ transform: `scaleX(${before.share})` }, { transform: `scaleX(${nowShare})` }];
  const green = before.back ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }];
  return [play(before.fill, grow, options), play(layer, green, options)];
}

/** The one ring slides from the old part (on `translate`, so its own transform stays). */
function playRing(band, before, at) {
  const ring = band?.querySelector('[data-ring]');
  const ringNow = ring?.getBoundingClientRect();
  if (!before.ring || !ringNow || Math.abs(before.ring.left - ringNow.left) <= 0.5) return [];
  const dx = before.ring.left - ringNow.left;
  const options = { duration: RING_MS, easing: EASE.standard, delay: at(TIMELINE.ring) };
  return [
    play(ring, [{ translate: `${dx}px 0` }, { translate: '0px 0' }], {
      ...options,
      fill: 'backwards',
      id: 'phase-ring',
    }),
  ];
}

/** A check that draws (`stroke-dashoffset` 1 → 0 on its `pathLength="1"` path). */
function drawCheck(check, delay) {
  if (!check) return null;
  const path = check.querySelector?.('path') ?? check;
  return play(path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: duration('tick'),
    easing: EASE.standard,
    delay,
    fill: 'backwards',
    id: 'phase-check',
  });
}

/**
 * The band: the fill, the green layer, the ring sliding, the finished phase's check drawing.
 * @returns {Array<Animation | null>}
 */
export function playBand(band, before, at) {
  const check = before.back ? null : band?.querySelector(`[data-check="${before.part}"]`);
  return [
    ...playFill(band, before),
    ...playRing(band, before, at),
    drawCheck(check, at(TIMELINE.check)),
  ];
}

/**
 * The "Current" tags swap: the old ones (clones) fade out, the new ones (in the band and the
 * column headers) fade in.
 * @param {Array<Element | null>} roots the band and the board
 * @returns {Array<Animation | null>}
 */
export function playTags(roots, before, at, keep) {
  const options = { duration: duration('tag'), easing: EASE.out, delay: at(TIMELINE.tags) };
  const out = before.oldTags.map((clone) =>
    fadeClone(clone, [{ opacity: 1 }, { opacity: 0 }], { ...options, id: 'phase-tag-out' }, keep),
  );
  const tags = new Set(
    roots.flatMap((root) => [...(root?.querySelectorAll?.('[data-current-tag]') ?? [])]),
  );
  for (const tag of tags) {
    const fadeIn = { ...options, fill: 'backwards', id: 'phase-tag-in' };
    out.push(play(tag, [{ opacity: 0 }, { opacity: 1 }], fadeIn));
  }
  return out;
}

/** A fold with the rail already there: a new tile rises in (open rail), else the count changes. */
function playRail(board, before, at, keep) {
  if (!before.folds.length || before.railIsNew) return [];
  const delay = at(TIMELINE.fold);
  const rise = [
    { opacity: 0, transform: `translateY(${SHIFT_IN}px)` },
    { opacity: 1, transform: 'none' },
  ];
  const enter = { duration: duration('tag'), easing: EASE.decelerate, delay, fill: 'backwards' };
  const tiles = before.folds
    .map((key) => board?.querySelector?.(`[data-tile="${key}"]`))
    .filter(Boolean);
  if (tiles.length) return tiles.map((tile) => play(tile, rise, { ...enter, id: 'phase-tile' }));
  const count = board?.querySelector?.('[data-rail-n]');
  if (!count || !before.railCount) return [];
  const out = { duration: duration('tag'), easing: EASE.out, delay, id: 'phase-count-out' };
  return [
    fadeClone(before.railCount, [{ opacity: 1 }, { opacity: 0 }], out, keep),
    play(count, rise, { ...enter, id: 'phase-count-in' }),
    drawCheck(board.querySelector('[data-check="rail"]'), delay),
  ];
}

/**
 * The finished phases fold away (their clones), the rail's count or tile changes, the columns to
 * their right slide, a new rail and a column that comes back fade in.
 * @returns {Array<Animation | null>}
 */
export function playLayout(board, before, at, keep) {
  const fold = {
    duration: duration('fold'),
    easing: EASE.standard,
    delay: at(TIMELINE.fold),
    id: 'phase-fold',
  };
  const out = before.ghosts.map((ghost) =>
    fadeClone(
      ghost,
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: `scale(${FOLD_SCALE})`, opacity: 0 },
      ],
      fold,
      keep,
    ),
  );
  out.push(...playRail(board, before, at, keep));
  const comeBack = (el) =>
    play(el, [{ opacity: 0 }, { opacity: 1 }], {
      duration: duration('in'),
      easing: EASE.decelerate,
      delay: at(el.dataset?.flip === 'rail' ? TIMELINE.fold : COME_BACK_DELAY),
      fill: 'backwards',
      id: 'phase-in',
    });
  const slide = { duration: DUR.fold, easing: EASE.standard, onEnter: comeBack };
  const delay = before.folds.length ? at(TIMELINE.slide) : 0;
  out.push(
    ...flipFrom(before.layout, board?.querySelectorAll?.(LAYOUT) ?? [], { ...slide, delay }),
  );
  return out;
}
