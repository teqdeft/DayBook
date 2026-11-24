'use client';
// The board's sideways scroll (CONTRACT 27, Board tab): whether the columns are wider than their
// area (then "Scroll the board left" and "Scroll the board right" show), a column's width per
// press, and bringing one column into view (a band part, a card moved by its menu). With reduced
// motion nothing slides.
import { useCallback, useEffect, useRef, useState } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {string} layout changes when the columns change (which are shown, their order), so the
 *   board is measured again
 * @returns {[import('react').RefObject<HTMLElement>, { scrolls: boolean,
 *   step: (direction: -1 | 1) => void, show: (columnKey: string) => void }]} the board's ref, and
 *   its scroll: show brings the column whose `data-column` is the key into view
 */
export function useBoardScroll(layout) {
  const ref = useRef(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const board = ref.current;
    if (!board) return undefined;
    const measure = () => setScrolls(board.scrollWidth > board.clientWidth + 2);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    for (const child of board.children) observer.observe(child);
    return () => observer.disconnect();
  }, [layout]);

  const step = useCallback((direction) => {
    const board = ref.current;
    if (!board) return;
    const column = board.querySelector('[data-column]:not([hidden])');
    const width = (column?.getBoundingClientRect().width ?? 260) + 12;
    board.scrollBy({ left: direction * width, behavior: reduced() ? 'auto' : 'smooth' });
  }, []);

  const show = useCallback((columnKey) => {
    const column = ref.current?.querySelector(`[data-column="${columnKey}"]`);
    column?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduced() ? 'auto' : 'smooth',
    });
  }, []);

  return [ref, { scrolls, step, show }];
}
