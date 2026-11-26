'use client';
// The Table's sort (CONTRACT 28, Table and bulk bar: Sorting; Motion, Moments: Table sort). The
// sort itself is the board's (`board.tableSort`, for the visit; "Group by phase again" clears it):
// a header's first click sorts in that column's first direction (Files and Time most first), a
// second reverses it, a third reverses it again. The rows slide to their new places (FLIP over the
// shown rows, `--dur-room`); a group row that comes back fades in. Over 150 rows, in a hidden tab or
// with reduce motion the new order simply shows.
import { play } from '@/lib/motion/animate';
import { DUR, EASE } from '@/lib/motion/tokens';
import { flipSync } from '@/lib/motion/useMotion';
import { ROWS, shownBody } from './tableDom';
import { SORTS, ariaSortFor } from './tableView';

/** A group row that comes back (grouped by phase again) fades in. */
const fadeIn = (el) =>
  play(el, [{ opacity: 0 }, { opacity: 1 }], {
    duration: DUR.room,
    easing: EASE.decelerate,
    id: 'group-in',
  });

/**
 * Commits `change` and slides the shown rows from where they were (the sort, or "Group by phase
 * again" in the line under the toolbar). Only from a handler, a timer or an animation callback.
 * @param {() => void} change the state change that orders the rows anew
 * @param {ParentNode | null} [root] where the Table is (the page by default)
 * @returns {Animation[]}
 */
export function flipRows(change, root = globalThis.document ?? null) {
  return flipSync(shownBody(root), change, { selector: ROWS, onEnter: fadeIn });
}

/**
 * @param {{ tableSort?: { key: string | null, dir: 'ascending' | 'descending',
 *   set: (key: string, firstDir?: string) => void } }} board the board object
 * @param {import('react').RefObject<HTMLElement>} rootRef the Table
 * @returns {{ key: string | null, dir: 'ascending' | 'descending', sorted: boolean,
 *   ariaSort: (key: string) => 'ascending' | 'descending' | undefined,
 *   sortBy: (key: string) => void }} sorted: a header sorts the rows (no groups, the Phase
 *   column shows)
 */
export function useTableSort(board, rootRef) {
  const sort = board.tableSort ?? { key: null, dir: 'ascending', set: () => {} };
  const now = { key: SORTS[sort.key] ? sort.key : null, dir: sort.dir };
  return {
    ...now,
    sorted: now.key !== null,
    ariaSort: (key) => ariaSortFor(key, now),
    sortBy(key) {
      if (!SORTS[key]) return;
      flipRows(() => sort.set(key, SORTS[key].first), rootRef.current);
    },
  };
}
