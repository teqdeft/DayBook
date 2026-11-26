// Where a dragged card would land (CONTRACT 28, Motion, Pointer drag: "Target" and "Gap at the sorted
// place"): the column under the card, the card's sorted place in it (P1, P2, P3, then due date, then
// title; there is no hand ordering), the top of that gap, which cards make room and the "2 of 6" the
// keyboard move says. Pure.
import { landingIndex } from './boardMoves';

/** Whether a height on the screen is inside a box. */
const within = (y, rect) => y >= rect.top && y <= rect.bottom;

/**
 * The column under the card that takes it, or null. Across, the preview's centre decides; up and
 * down, its centre or the pointer: a tall card held by its top has its centre below the column
 * while the pointer is still in it (over "+ Add task"), and a release there lands. Columns that
 * don't take the card (its own, the Done phases rail, No phase yet) never react.
 * @param {Array<{ key: string, accepts: boolean,
 *   rect: { left: number, right: number, top: number, bottom: number } }>} columns their rects
 *   already clipped to the board's box
 * @param {{ x: number, y: number }} centre the preview's centre
 * @param {{ x: number, y: number } | null} [point] the pointer
 * @returns {object | null} the column
 */
export function hitColumn(columns, centre, point = null) {
  if (!centre) return null;
  const under = (columns ?? []).find(
    ({ rect }) =>
      rect &&
      rect.right > rect.left &&
      centre.x >= rect.left &&
      centre.x <= rect.right &&
      (within(centre.y, rect) || (point !== null && within(point.y, rect))),
  );
  return under?.accepts ? under : null;
}

/**
 * The gap's place among the target's open cards (from 0): the card's sorted place.
 * @param {object[]} openCards the column's open cards, in order
 * @param {object} task the dragged card
 */
export function gapIndex(openCards, task) {
  return landingIndex(openCards ?? [], task);
}

/**
 * The gap's top in viewport px: the top of the card it goes before, else one row gap after the
 * last card, else the empty list's top. `offsetTop` ignores the room's transforms, and the list
 * is `position: relative`, so it is the list's own.
 * @param {{ top: number }} listRect
 * @param {Array<{ offsetTop: number, offsetHeight: number }>} cards the list's cards
 * @param {number} index
 * @param {number} rowGap
 * @returns {number}
 */
export function gapTop(listRect, cards, index, rowGap) {
  const list = cards ?? [];
  if (index < list.length) return listRect.top + list[index].offsetTop;
  if (list.length === 0) return listRect.top;
  const last = list[list.length - 1];
  return listRect.top + last.offsetTop + last.offsetHeight + rowGap;
}

/**
 * How far a card at `index` slides down to make room: the dragged card's height plus the row
 * gap, for the cards at and after the gap only.
 * @param {number} index
 * @param {number} gap
 * @param {number} height
 * @param {number} rowGap
 * @returns {number} px
 */
export function roomShift(index, gap, height, rowGap) {
  return index >= gap ? height + rowGap : 0;
}

/**
 * "2 of 6": the gap's place counted from 1, of the target's open cards plus the dragged one.
 * @param {number} index from 0
 * @param {number} count the target's open cards
 */
export function positionText(index, count) {
  return `${index + 1} of ${count + 1}`;
}
