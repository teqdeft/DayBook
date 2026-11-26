'use client';
// Keyboard focus on a card that is drawn again (CONTRACT 27, Board tab; CONTRACT 28, Keyboard move
// and the live region): a card moves to another list as a new element when the page's refresh brings
// it back done (Mark done in the task window, often after the window has closed and given the focus
// back to the card), when a keyboard move drops it in another column, or when a failed move puts it
// back. The browser then drops the focus to the page. When the control that had it (the card's
// title, its grip, its "⋯" or its face) leaves the page that way, focus goes to the same control of
// the card's new copy (so a keyboard drop moves focus once, to the moved card's grip, and a screen
// reader announces it once), else its title, else its column's "› 6 done" button while that fold is
// closed. A card that is gone (deleted, moved by someone else out of the viewer's board) is left
// alone: the delete has its own focus rules. The places that take the focus when a column has no
// card left (its "› 6 done", a Done phases tile, the rail's button) can go away too, when a task of
// it is opened again (the toast's Undo): the focus then goes to that card.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { TASK_REOPENED } from '../taskEvents';
import { RAIL_BUTTON_ID, addTaskId, cardId, cardTitleId, foldButtonId } from './boardView';

const CARD = /^board-card-(\d+)$/;
const PLACE = /^board-(?:tile-(.+)|(.+)-done|rail)$/; // a tile, a fold's button, the rail's button

const hasAttr = (element, name) => Boolean(element?.hasAttribute?.(name));

/**
 * Which card control had the focus: `{ taskId, menu, grip, face, node }` (all three false: the
 * title or another control), or null outside a card.
 * @param {Element | null} element
 */
export function focusedCardControl(element) {
  const match = element?.closest?.('li[id^="board-card-"]')?.id.match(CARD);
  if (!match) return null;
  const menu = element.getAttribute?.('aria-haspopup') === 'menu';
  const grip = hasAttr(element, 'data-grip');
  const face = hasAttr(element, 'data-face-button');
  return { taskId: Number(match[1]), menu, grip, face, node: element };
}

/**
 * Which place outside a card had the focus: a column's "› 6 done", a Done phases tile or the rail's
 * button: `{ column, node }` (the rail's has no column), or null.
 * @param {Element | null} element
 */
export function focusedPlace(element) {
  const match = element?.id?.match?.(PLACE);
  return match ? { column: match[1] ?? match[2] ?? null, node: element } : null;
}

/** The same control on a card's copy: its "⋯", grip or face, else null (then its title). */
function sameControl(seen, card) {
  if (seen.menu) return card?.querySelector('[aria-haspopup="menu"]') ?? null;
  if (seen.grip) return card?.querySelector('[data-grip]') ?? null;
  if (seen.face) return card?.querySelector('[data-face-button]') ?? null;
  return null;
}

/**
 * Where focus goes when that control has left the page: the same control on the card's new
 * copy (a done copy has no grip: its title then), else its column's done fold button; null when
 * the card isn't on the board any more.
 * @param {{ taskId: number, menu?: boolean, grip?: boolean, face?: boolean } | null} seen
 * @param {object[]} columns boardColumns' columns
 * @param {(id: string) => HTMLElement | null} byId
 * @returns {HTMLElement | null}
 */
export function refocusTarget(seen, columns, byId) {
  if (!seen) return null;
  const has = (list) => list.some((task) => task.id === seen.taskId);
  const column = columns.find((one) => has(one.open) || has(one.done));
  if (!column) return null;
  const card = byId(cardId(seen.taskId));
  const control = sameControl(seen, card) ?? byId(cardTitleId(seen.taskId));
  return control ?? byId(foldButtonId(column.key));
}

/**
 * Where focus goes when such a place has left the page: the card of the task just opened again,
 * else its column's first open card, else the rail's button, else the column's "+ Add task".
 * @param {{ column: string | null } | null} place
 * @param {object[]} columns boardColumns' columns
 * @param {(id: string) => HTMLElement | null} byId
 * @param {number | null} [reopened] the task opened again since the place took the focus
 * @returns {HTMLElement | null}
 */
export function placeTarget(place, columns, byId, reopened = null) {
  if (!place) return null;
  const open = columns.find((one) => one.key === place.column)?.open ?? [];
  const card = [reopened, open[0]?.id].map((id) => (id ? byId(cardTitleId(id)) : null));
  return (
    card.find(Boolean) ??
    byId(RAIL_BUTTON_ID) ??
    (place.column ? byId(addTaskId(place.column)) : null)
  );
}

/** @param {object[]} columns the Board's columns, as drawn */
export function useCardFocusKeeper(columns) {
  const seen = useRef({ card: null, place: null, reopened: null });
  useEffect(() => {
    const onFocus = ({ target }) => {
      const card = focusedCardControl(target);
      seen.current = { card, place: card ? null : focusedPlace(target), reopened: null };
    };
    const onReopened = (event) => {
      seen.current.reopened = Number(event.detail?.taskId) || null;
    };
    document.addEventListener('focusin', onFocus);
    window.addEventListener(TASK_REOPENED, onReopened);
    return () => {
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener(TASK_REOPENED, onReopened);
    };
  }, []);
  useLayoutEffect(() => {
    const { card, place, reopened } = seen.current;
    const last = card ?? place;
    if (!last || last.node.isConnected) return;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!lost) return;
    const byId = (id) => document.getElementById(id);
    const target = card
      ? refocusTarget(card, columns, byId)
      : placeTarget(place, columns, byId, reopened);
    target?.focus({ preventScroll: true });
  });
}
