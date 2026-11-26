'use client';
// Board | Table and the Done phases rail (CONTRACT 28, Board toolbar item 2; Done phases rail): the
// view shown and whether the rail is open, both remembered per person on that computer in cookies
// the server reads (BoardTab), so the first paint is already right and nothing switches after
// hydration (never browser storage). The view is also mirrored in the URL (`?view=table`) with
// `history.replaceState`, no server trip. The switch crossfades (the old view fades out, the new
// one in; a second click finishes the first fade and only the latest switch commits); the rail
// opens and folds with railFlip (the columns slide).
import { useCallback, useRef, useState } from 'react';
import { crossfade } from '@/lib/motion/animate';
import { railFlip } from './boardMotion';
import { RAIL_COOKIE, VIEW_COOKIE, rememberCookie, viewUrl } from './viewPrefs';

/**
 * @param {{ initialView: 'board' | 'table', initialRail: boolean }} args the Board's `view` and
 *   `railOpen` props (from the cookies or `?view=`)
 * @returns {{ view: 'board' | 'table', setView: (view: 'board' | 'table') => Promise<void>,
 *   viewRef: import('react').RefObject<HTMLElement>, railOpen: boolean,
 *   toggleRail: (board: Element | null) => Promise<void>, tableSort: object }} setView: resolves
 *   once the new view is drawn; viewRef: the `data-view` wrapper the switch fades; tableSort:
 *   the Table's sort (useTableSort)
 */
export function useBoardView({ initialView, initialRail }) {
  const [view, setViewState] = useState(initialView === 'table' ? 'table' : 'board');
  const [railOpen, setRailOpen] = useState(Boolean(initialRail));
  const viewRef = useRef(null);
  const target = useRef(null);
  const tableSort = useTableSort();

  const setView = useCallback(
    (next) => {
      if ((target.current ?? view) === next) return Promise.resolve();
      target.current = next;
      rememberCookie(VIEW_COOKIE, next);
      try {
        window.history.replaceState(null, '', viewUrl(window.location.href, next));
      } catch {
        // the address just keeps its old view
      }
      return crossfade(
        () => viewRef.current,
        () => {
          target.current = null;
          setViewState(next);
        },
      );
    },
    [view],
  );

  const toggleRail = useCallback(
    (board) => {
      const next = !railOpen;
      rememberCookie(RAIL_COOKIE, next ? 'open' : 'closed');
      return railFlip(board, () => setRailOpen(next));
    },
    [railOpen],
  );

  return { view, setView, viewRef, railOpen, toggleRail, tableSort };
}

/**
 * The Table's sort for the visit (T's useTableSort plays the rows' slide around it): a header's
 * first click sorts in that column's first direction, a second click reverses it; "Group by phase
 * again" clears it (FilterLine).
 * @returns {{ key: string | null, dir: 'ascending' | 'descending',
 *   set: (key: string, firstDir?: 'ascending' | 'descending') => void, clear: () => void }}
 */
function useTableSort() {
  const [sort, setSort] = useState({ key: null, dir: 'ascending' });
  const flip = (dir) => (dir === 'ascending' ? 'descending' : 'ascending');
  return {
    ...sort,
    set: (key, firstDir = 'ascending') =>
      setSort((now) => (now.key === key ? { key, dir: flip(now.dir) } : { key, dir: firstDir })),
    clear: () => setSort({ key: null, dir: 'ascending' }),
  };
}
