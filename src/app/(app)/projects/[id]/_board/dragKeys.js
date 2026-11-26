// The keyboard move of a held card (CONTRACT 28, Motion, Keyboard move and the live region): Left
// and Right walk the phase columns on the board (its own included, as "back where it was"; the Done
// phases rail and No phase yet skipped, except a card in No phase yet, whose walk ends on its own
// column); the picture glides to the gap; Up and Down only say how cards are sorted; Space or Enter
// drops; Escape or Tab cancels. While a card is held the keys are taken (stopPropagation), so no
// window or menu reacts. With a pointer drag only Escape is taken.
import { duration } from '@/lib/motion/tokens';
import { isPhase } from '@/modules/projectPlan/phases';
import { visibleGapRect } from './dragTargets';
import { backText, overText, sortedText } from './moveWords';
// Circular on purpose: dragSession.js imports this file and these are only called later.
import { cancelSession, dropSession } from './dragEnd';
import { remeasure, setTarget } from './dragSession';

const OFFSET = { x: 10, y: -6 }; // the picture sits a little off the gap, so the gap shows
const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter']);

/**
 * The columns Left and Right walk, in board order (the ones folded into the rail are skipped).
 * @param {Array<{ key: string, hidden?: boolean }>} columns measured columns
 * @param {string} fromKey the card's column ('none': No phase yet)
 */
export function walkOf(columns, fromKey) {
  const phases = (columns ?? []).filter(
    (column) => !column.hidden && column.key !== 'none' && isPhase(column.key),
  );
  if (fromKey !== 'none') return phases;
  const own = columns.find((column) => column.key === 'none');
  return own ? [...phases, own] : phases;
}

/** Puts the picture on the gap (or back on its outline), gliding for a keyboard step. */
export function placeOnGap(s, { animate }) {
  const to = s.target
    ? visibleGapRect(s.target, s.rowGap, s.size.height)
    : s.card.getBoundingClientRect();
  const x = to.left + OFFSET.x;
  const y = to.top + OFFSET.y;
  if (animate) s.preview.glideTo(x, y, duration('room', s.env.reduced()));
  else s.preview.moveTo(x, y);
}

/** Scrolls the board at once so the column is in view. */
function showColumn(s, column) {
  const box = s.board.getBoundingClientRect();
  const rect = column.el.getBoundingClientRect();
  if (rect.left < box.left + 4) s.board.scrollLeft += rect.left - box.left - 8;
  else if (rect.right > box.right - 4) s.board.scrollLeft += rect.right - box.right + 8;
}

/** One step left (-1) or right (1). */
export function walkStep(s, direction) {
  const walk = walkOf(s.measured.columns, s.fromKey);
  const at = s.walkAt ?? walk.findIndex((column) => column.key === s.fromKey);
  const next = Math.max(0, Math.min(walk.length - 1, at + direction));
  if (next === at || !walk[next]) return;
  s.walkAt = next;
  const key = walk[next].key;
  showColumn(s, walk[next]);
  remeasure(s);
  const own = key === s.fromKey;
  setTarget(s, own ? null : (s.measured.columns.find((column) => column.key === key) ?? null));
  placeOnGap(s, { animate: true });
  if (own || !s.target) s.say(backText(s.fromKey));
  else s.say(overText(key, s.target.index, s.target.count, 'keyboard'));
}

/** Escape during a pointer drag. */
function pointerKey(s, event) {
  if (event.key !== 'Escape' || s.state !== 'lifted') return;
  event.preventDefault();
  event.stopPropagation();
  cancelSession(s);
}

/**
 * The document's capture-phase keydown while a card is held.
 * @param {object} s the session
 * @param {KeyboardEvent} event
 */
export function keyLifted(s, event) {
  if (s.state === 'idle') return;
  if (s.mode !== 'keyboard') {
    pointerKey(s, event);
    return;
  }
  const { key } = event;
  event.stopPropagation();
  if (s.state !== 'lifted' || event.repeat) {
    if (STEP_KEYS.has(key) || key === 'Escape' || key === 'Tab') event.preventDefault();
    return;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    event.preventDefault();
    walkStep(s, key === 'ArrowLeft' ? -1 : 1);
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    event.preventDefault();
    if (!s.saidSorted) s.say(sortedText());
    s.saidSorted = true;
  } else if (key === ' ' || key === 'Enter') {
    event.preventDefault();
    s.env.flagKey?.();
    dropSession(s);
  } else if (key === 'Escape' || key === 'Tab') {
    event.preventDefault();
    cancelSession(s);
  }
}
