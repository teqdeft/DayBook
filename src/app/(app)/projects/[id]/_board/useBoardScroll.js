'use client';
// The board's own sideways scroll (CONTRACT 28, The sideways scroll): which sides have more columns
// (`data-more` on the wrapper: "left", "right" or "left right"), set from a ResizeObserver and the
// board's scroll event straight on the element, so a scroll never draws the Board again (the fade
// and the round arrows follow it in CSS); a column's width per arrow press; and bringing one
// column into view (a band part, a card moved by its menu, a quick add). Scrolling is smooth, and
// instant with reduce motion (scrollBehavior()).
import { useCallback, useEffect, useRef } from 'react';
import { scrollBehavior } from '@/lib/motion/reducedMotion';

/** A tolerance for the sub-pixel widths of a zoomed page. */
const SLACK = 2;

/**
 * The sides with more columns, from the board's scroll box.
 * @param {{ scrollLeft: number, scrollWidth: number, clientWidth: number }} box
 * @returns {'' | 'left' | 'right' | 'left right'}
 */
export function moreSides({ scrollLeft, scrollWidth, clientWidth }) {
  if (scrollWidth <= clientWidth + SLACK) return '';
  const sides = [];
  if (scrollLeft > SLACK) sides.push('left');
  if (scrollLeft + clientWidth < scrollWidth - SLACK) sides.push('right');
  return sides.join(' ');
}

/**
 * Where the board scrolls so a column is in full view (it moves as little as it can).
 * @param {{ left: number, right: number }} column the column's box, in the board's coordinates
 * @param {{ scrollLeft: number, clientWidth: number }} board
 * @returns {number} the new scrollLeft
 */
export function scrollToShow(column, { scrollLeft, clientWidth }) {
  if (column.left < scrollLeft) return Math.max(0, column.left - 4);
  if (column.right > scrollLeft + clientWidth) return column.right - clientWidth + 4;
  return scrollLeft;
}

/** Keeps the wrapper's `data-more` in step with the board's scroll box. */
function useMoreSides(boardRef, wrapRef, layout) {
  useEffect(() => {
    const board = boardRef.current;
    const wrap = wrapRef.current;
    if (!board || !wrap) return undefined;
    const mark = () => {
      const sides = moreSides(board);
      if (wrap.dataset.more !== sides) wrap.dataset.more = sides;
    };
    mark();
    board.addEventListener('scroll', mark, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    observer?.observe(board);
    for (const child of board.children) observer?.observe(child);
    return () => {
      board.removeEventListener('scroll', mark);
      observer?.disconnect();
    };
  }, [boardRef, wrapRef, layout]);
}

/**
 * @param {string} layout changes when the columns change (which are shown, their order), so the
 *   board is measured again
 * @returns {[import('react').RefObject<HTMLElement>, import('react').RefObject<HTMLElement>,
 *   { step: (direction: -1 | 1) => void,
 *     show: (columnKey: string, options?: { instant?: boolean }) => void }]} the board's ref, its
 *   wrapper's ref, and its scroll: step moves one column width plus the 12 px gap; show brings
 *   the column whose `data-column` is the key into full view
 */
export function useBoardScroll(layout) {
  const boardRef = useRef(null);
  const wrapRef = useRef(null);
  useMoreSides(boardRef, wrapRef, layout);

  const step = useCallback((direction) => {
    const board = boardRef.current;
    if (!board) return;
    const column = board.querySelector('[data-column]:not([hidden])');
    const width = (column?.getBoundingClientRect().width ?? 248) + 12;
    board.scrollBy({ left: direction * width, behavior: scrollBehavior() });
  }, []);

  const show = useCallback((columnKey, { instant = false } = {}) => {
    const board = boardRef.current;
    const column = board?.querySelector(`[data-column="${columnKey}"]`);
    if (!board || !column || column.hidden) return;
    const box = board.getBoundingClientRect();
    const rect = column.getBoundingClientRect();
    const left = rect.left - box.left + board.scrollLeft;
    const to = scrollToShow({ left, right: left + rect.width }, board);
    if (to === board.scrollLeft) return;
    board.scrollTo({ left: to, behavior: instant ? 'instant' : scrollBehavior() });
  }, []);

  return [boardRef, wrapRef, { step, show }];
}
