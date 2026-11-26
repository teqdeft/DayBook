'use client';
// Focus when a row goes away under it (CONTRACT 28, Look and accessibility: "A Table row that
// leaves after a tick → the next row's title, else the previous row's, else the table"): a ticked
// row leaves the Table once its leave has played (unless done tasks are shown), a filter or the
// refresh can take a row away too. When the control that had the focus left the page with its row
// and the browser dropped the focus to the page, it goes to the next row's title, else the previous
// one's, else the table itself (`tabIndex={-1}`); a row drawn again keeps its place (its title).
import { useEffect, useLayoutEffect, useRef } from 'react';
import { nextRowId, rowTitle, shownIn } from './tableDom';

const ROW = /^row:(\d+)$/;

/** The task id of the row an element is in, or null. */
const rowIdOf = (element) => {
  const match = element?.closest?.('[data-flip^="row:"]')?.dataset.flip.match(ROW);
  return match ? Number(match[1]) : null;
};

/**
 * @param {import('react').RefObject<HTMLElement>} rootRef the Table
 * @param {number[]} ids the rows' task ids as drawn now
 */
export function useRowFocus(rootRef, ids) {
  const seen = useRef(null);
  const drawn = useRef(ids);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onFocus = (event) => {
      const id = rowIdOf(event.target);
      seen.current = id === null ? null : { id, node: event.target };
    };
    root.addEventListener('focusin', onFocus);
    return () => root.removeEventListener('focusin', onFocus);
  }, [rootRef]);
  useLayoutEffect(() => {
    const before = drawn.current;
    drawn.current = ids;
    const last = seen.current;
    if (!last || last.node.isConnected) return;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (!lost) return;
    seen.current = null;
    const next = nextRowId(before, ids, last.id);
    const root = rootRef.current;
    const target = next === null ? shownIn(root, 'table') : rowTitle(root, next);
    target?.focus({ preventScroll: true });
  });
}
