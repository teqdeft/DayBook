// The phase move sequence (CONTRACT 28, Motion, Phase move sequence; motion.md 3.7): after the
// confirm window's exit, the project's phase changes in one commit, then the finished phase's fill
// grows and turns green, the ring slides, the check draws, the "Current" tags swap, the new current
// column flashes, a finished phase without open tasks folds away (the rail's count changes or a
// new tile rises in), the columns to its right slide, the board scrolls to the new column, and the
// toast and the refresh come at 760 ms. Under one second; nothing blocks a click (the clones are
// inert). With reduce motion everything changes at once, the two tags crossfade in --dur-fade and
// the flash stays. The parts themselves are in phaseParts.js.
import { flushSync } from 'react-dom';
import { flash, rootToken } from '@/lib/motion/animate';
import { measure } from '@/lib/motion/flip';
import { prefersReducedMotion, scrollBehavior } from '@/lib/motion/reducedMotion';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';
import {
  LAYOUT,
  TIMELINE,
  boardIn,
  cloneInside,
  playBand,
  playLayout,
  playTags,
  shareOf,
} from './phaseParts';

export { TIMELINE };

const order = (key) => PROJECT_PHASES.findIndex((phase) => phase.key === key);

/** Everything read before the change (motion.md 3.7). */
function readBefore({ board, band, from, to, folds = [], railIsNew = false }) {
  const back = from !== null && order(to) < order(from); // "Go back to Testing"
  const part = back ? to : from;
  const fill = band?.querySelector(`[data-fill="${part}"]`) ?? null;
  const wrap = board?.parentElement ?? null; // .boardWrap: a page scroll moves the clones with it
  const columnTag = board?.querySelector(`[data-column="${from}"] [data-current-tag]`);
  return {
    back,
    part,
    fill,
    folds,
    railIsNew,
    share: shareOf(fill),
    ring: band?.querySelector('[data-ring]')?.getBoundingClientRect() ?? null,
    layout: measure(board?.querySelectorAll(LAYOUT) ?? []),
    oldTags: [
      cloneInside(band?.querySelector('[data-current-tag]'), band),
      folds.includes(from) ? null : cloneInside(columnTag, wrap),
    ].filter(Boolean),
    railCount: cloneInside(board?.querySelector('[data-rail-n]'), wrap),
    ghosts: folds
      .map((key) => cloneInside(board?.querySelector(`[data-column="${key}"]`), wrap))
      .filter(Boolean),
  };
}

/** Scrolls the board to the new current column when it is out of view. */
function showColumn(board, key) {
  const column = board?.querySelector(`[data-column="${key}"]`);
  if (!column) return;
  const view = board.getBoundingClientRect();
  const box = column.getBoundingClientRect();
  if (box.left >= view.left + 4 && box.right <= view.right - 4) return;
  board.scrollTo?.({
    left: board.scrollLeft + (box.left - view.left) - 8,
    behavior: scrollBehavior(),
  });
}

/** The commit, then every row of the timeline; returns what the cleanup must end. */
function run(options, keep) {
  const { board, band, to, commit, toast, refresh } = options;
  const reduced = prefersReducedMotion();
  const at = (ms) => (reduced ? 0 : ms);
  const before = readBefore(options);
  flushSync(commit);
  keep.committed = true;
  keep.animations.push(...playBand(band, before, at));
  keep.animations.push(...playTags([band, board], before, at, keep));
  keep.animations.push(...playLayout(board, before, at, keep));
  const later = (ms, fn) => keep.timers.push(setTimeout(fn, at(ms)));
  const soft = rootToken('--primary-soft');
  const muted = rootToken('--surface-muted');
  const color = soft && muted ? `color-mix(in srgb, ${soft} 80%, ${muted})` : undefined;
  later(TIMELINE.tags, () => flash(board?.querySelector(`[data-column="${to}"]`), { color }));
  later(TIMELINE.scroll, () => showColumn(board, to));
  later(TIMELINE.toast, () => keep.finishLast());
  keep.last = () => {
    toast?.();
    refresh?.();
  };
}

/**
 * @param {{ board: Element | null, band: Element | null, from: string | null, to: string,
 *   folds?: string[], railIsNew?: boolean, commit: () => void, toast: () => void,
 *   refresh: () => void, wait?: number }} options board: the board's scroll box (`data-board`);
 *   folds: every phase that folds into the rail; wait: ms before anything changes (0, the
 *   default, plays at once: the caller has already waited for the confirm window's exit,
 *   `duration('out')`)
 * @returns {() => void} cleanup: ends every animation, clone and timer (a toast or refresh still
 *   due runs at once)
 */
export function playPhaseMove(options) {
  const keep = { animations: [], clones: [], timers: [], committed: false, last: null };
  keep.finishLast = () => {
    const last = keep.last;
    keep.last = null;
    last?.();
  };
  const wait = options.wait ?? 0;
  if (wait > 0) keep.timers.push(setTimeout(() => run(options, keep), wait));
  else run(options, keep);
  return () => {
    for (const timer of keep.timers.splice(0)) clearTimeout(timer);
    for (const animation of keep.animations.splice(0)) animation?.cancel();
    for (const clone of keep.clones.splice(0)) clone.remove();
    if (!keep.committed) {
      options.toast?.();
      options.refresh?.();
      return;
    }
    keep.finishLast();
  };
}

/**
 * The fold on its own (the last open card of a past phase was ticked): the column folds away,
 * the columns to its right slide, as the 400 ms row of the phase move.
 * @param {{ board: Element | null, keys: string[], commit: () => void }} options board: the
 *   board or anything holding it (the Board tab)
 * @returns {Animation[]}
 */
export function playFold({ board: root, keys, commit }) {
  const board = boardIn(root);
  const wrap = board?.parentElement ?? null;
  const before = {
    folds: keys,
    railIsNew: !board?.querySelector('[data-flip="rail"]'),
    layout: measure(board?.querySelectorAll(LAYOUT) ?? []),
    railCount: cloneInside(board?.querySelector('[data-rail-n]'), wrap),
    ghosts: keys
      .map((key) => cloneInside(board?.querySelector(`[data-column="${key}"]`), wrap))
      .filter(Boolean),
  };
  flushSync(commit);
  const at = (ms) => (prefersReducedMotion() ? 0 : Math.max(0, ms - TIMELINE.fold));
  return playLayout(board, before, at, { clones: [] }).filter(Boolean);
}
