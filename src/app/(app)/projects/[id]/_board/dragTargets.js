// The columns a dragged card can go to (CONTRACT 28, Motion, Pointer drag): measured once at the
// lift and again only after a scroll or resize; the one under the card is tinted and opens a gap at
// the card's sorted place, its later cards and every `[data-follow]` item after the list sliding
// down by the card's height plus the row gap (CSS transitions, so a quick change of column
// retargets smoothly). Plain DOM on the data attributes C1 and C3 render; the motion code always
// takes off what it put on.
import { DUR } from '@/lib/motion/tokens';
import { canDropOn } from './boardMoves';
import { gapIndex, gapTop } from './sortedGap';

const ROOM_TRANSITION = 'transform var(--dur-room) var(--ease-standard)';
const CARD = '[data-flip^="card:"]';

/** The open cards of a column's list, in order (its `<li data-flip="card:…">` children). */
export const cardsOf = (list) =>
  list ? [...list.children].filter((el) => el.matches?.(CARD) ?? true) : [];

/** The column's body: the box around its list that scrolls with `data-fill` (or null). */
const bodyOf = (section, list) => {
  const marked = section.querySelector?.('[data-column-body]');
  if (marked) return marked;
  const parent = list?.parentElement;
  return parent && parent !== section ? parent : null;
};

/**
 * Every column on the board with its box clipped to the board's, and whether it takes the card
 * (a column folded into the rail is still in the page, `hidden`: it never takes one).
 * @param {HTMLElement} board
 * @param {object} task the dragged card
 * @param {Array<{ key: string, open: object[] }>} [columns] the board's columns (their open cards
 *   decide the sorted place)
 * @returns {{ board: DOMRect, columns: object[] }}
 */
export function measureColumns(board, task, columns = []) {
  const box = board.getBoundingClientRect();
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const found = [];
  for (const section of board.querySelectorAll('[data-column]')) {
    const key = section.dataset.column;
    const list =
      section.querySelector(`[data-cards="${key}"]`) ?? section.querySelector('[data-cards]');
    const rect = section.getBoundingClientRect();
    const hidden = section.hasAttribute?.('hidden') || !(rect.width > 0); // folded into the rail
    found.push({
      key,
      hidden,
      accepts: Boolean(list) && !hidden && canDropOn(task, key),
      rect: {
        left: Math.max(rect.left, box.left),
        right: Math.min(rect.right, box.right),
        top: rect.top,
        bottom: rect.bottom,
      },
      el: section,
      list,
      body: bodyOf(section, list),
      follow: [...section.querySelectorAll('[data-follow]')],
      open: byKey.get(key)?.open ?? [],
    });
  }
  return { board: box, columns: found };
}

/** Shifts one element down (or back with 0) by a transition; motion owns this transform. */
function shift(el, px) {
  el.style.transition = ROOM_TRANSITION;
  el.style.transform = px ? `translateY(${px}px)` : '';
}

/**
 * Clears a list's room: its cards and its column's `[data-follow]` items slide back (or jump with
 * `instant`, at the drop, together with the commit), and `data-room` goes after `--dur-room`.
 * @param {HTMLElement | null} list
 * @param {{ instant?: boolean, later?: (fn: () => void, ms: number) => unknown }} [options]
 */
export function clearRoom(list, { instant = false, later = setTimeout } = {}) {
  if (!list) return;
  const column = list.closest?.('[data-column]');
  const moved = [...cardsOf(list), ...(column ? column.querySelectorAll('[data-follow]') : [])];
  const reset = () => {
    for (const el of moved) {
      if (el.style.transform) continue; // shifted again meanwhile
      el.style.transition = '';
    }
    if (!list.querySelector?.('[style*="translateY"]')) list.removeAttribute('data-room');
  };
  for (const el of moved) {
    if (instant) {
      el.style.transition = '';
      el.style.transform = '';
    } else if (el.style.transform) shift(el, 0);
  }
  if (instant) list.removeAttribute('data-room');
  else later(reset, DUR.room);
}

/**
 * Moves the tint and the room from one column to another (either may be null).
 * @param {{ column: object } | null} prev the current target
 * @param {object | null} next the column now under the card
 * @param {{ task: object, height: number, rowGap: number, dropClass?: string,
 *   later?: Function }} room
 * @returns {{ column: object, index: number, cards: HTMLElement[], count: number } | null} the
 *   new target
 */
export function applyTarget(prev, next, room) {
  if (prev?.column === next && next) return prev;
  if (prev) {
    prev.column.el.removeAttribute('data-drop');
    if (room.dropClass) prev.column.el.classList.remove(room.dropClass);
    clearRoom(prev.column.list, { later: room.later });
  }
  if (!next) return null;
  const cards = cardsOf(next.list);
  const index = Math.min(gapIndex(next.open, room.task), cards.length);
  next.el.setAttribute('data-drop', 'on');
  if (room.dropClass) next.el.classList.add(room.dropClass);
  next.list.setAttribute('data-room', '');
  const px = room.height + room.rowGap;
  cards.forEach((el, at) => shift(el, at >= index ? px : 0));
  for (const el of next.follow) shift(el, px);
  return { column: next, index, cards, count: next.open.length };
}

/** Takes the tint off a target's column at once (the drop or a cancel). */
export function clearTint(target, dropClass) {
  if (!target) return;
  target.column.el.removeAttribute('data-drop');
  if (dropClass) target.column.el.classList.remove(dropClass);
}

/**
 * The gap's box in viewport px (where the preview settles): the list's left, the gap's top.
 * @param {{ column: { list: HTMLElement }, index: number, cards: HTMLElement[] }} target
 * @param {number} rowGap
 */
export function gapRect(target, rowGap = 12) {
  const listRect = target.column.list.getBoundingClientRect();
  return {
    left: listRect.left,
    top: gapTop(listRect, target.cards, target.index, rowGap),
    width: listRect.width,
  };
}

/**
 * Scrolls the target's column body at once so the gap is in sight (only a `data-fill` body
 * scrolls), and gives the gap's box after it.
 * @param {object} target
 * @param {number} rowGap
 * @param {number} height the card's height
 */
export function visibleGapRect(target, rowGap, height) {
  let gap = gapRect(target, rowGap);
  const body = target.column.body;
  if (!body || !(body.scrollHeight > body.clientHeight + 1)) return gap;
  const box = body.getBoundingClientRect();
  if (gap.top < box.top || gap.top + height > box.bottom) {
    body.scrollTop += gap.top - box.top - 8;
    gap = gapRect(target, rowGap);
  }
  return gap;
}
