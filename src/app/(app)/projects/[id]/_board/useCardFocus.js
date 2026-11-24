'use client';
// Keyboard focus on a card that is drawn again (CONTRACT 27, Board tab; "Focus stays inside" and
// "focus returns to what opened it" of the task window): a card moves to another list as a new
// element when the page's refresh brings it back done (Mark done in the task window, often after
// the window has closed and given the focus back to the card), or when a failed move puts it back.
// The browser then drops the focus to the page. When the control that had it (the card's title or
// its "⋯") leaves the page that way, focus goes to the same control of the card's new copy, or to
// its column's "› 6 done" button while that fold is closed. A card that is gone (deleted, moved by
// someone else out of the viewer's board) is left alone: the delete has its own focus rules.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { cardId, cardTitleId, foldButtonId } from './boardView';

const CARD = /^board-card-(\d+)$/;

/**
 * Which card control had the focus: `{ taskId, menu, node }`, or null outside a card.
 * @param {Element | null} element
 */
export function focusedCardControl(element) {
  const match = element?.closest?.('li[id^="board-card-"]')?.id.match(CARD);
  if (!match) return null;
  const menu = element.getAttribute?.('aria-haspopup') === 'menu';
  return { taskId: Number(match[1]), menu, node: element };
}

/**
 * Where focus goes when that control has left the page: the same control on the card's new
 * copy, else its column's done fold button; null when the card isn't on the board any more.
 * @param {{ taskId: number, menu: boolean } | null} seen
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
  const control = seen.menu
    ? card?.querySelector('[aria-haspopup="menu"]')
    : byId(cardTitleId(seen.taskId));
  return control ?? byId(foldButtonId(column.key));
}

/** @param {object[]} columns the Board's columns, as drawn */
export function useCardFocusKeeper(columns) {
  const seen = useRef(null);
  useEffect(() => {
    const onFocus = (event) => {
      seen.current = focusedCardControl(event.target);
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
  useLayoutEffect(() => {
    const last = seen.current;
    if (!last || last.node.isConnected) return;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!lost) return;
    refocusTarget(last, columns, (id) => document.getElementById(id))?.focus({
      preventScroll: true,
    });
  });
}
