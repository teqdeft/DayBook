'use client';
// The Files tab's own state (CONTRACT 27, Files tab): the place (in the URL, changed with the
// native History API so it makes no server trip and the leave guard never asks), the search, the
// sort (remembered per person in localStorage `daybook.files.sort`), the open window, the picture
// viewer, Delete with Undo (the row hides at once; the DELETE goes after the 6 s toast), and where
// focus goes once Edit details has saved.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUndoDelete } from '../useUndoDelete';
import { rowNameId } from './FileListRow';
import {
  countItems,
  deleteCopy,
  filesItems,
  placeHref,
  placeOf,
  placeView,
  SORT_KEY,
  sortOf,
} from './filesTabView';

// ---------- the sort, remembered per person in this browser ----------

const sortListeners = new Set();

function readSort() {
  try {
    return sortOf(window.localStorage.getItem(SORT_KEY));
  } catch {
    return 'new'; // a private window or blocked storage
  }
}

function writeSort(value) {
  try {
    window.localStorage.setItem(SORT_KEY, value);
  } catch {
    // a private window or blocked storage: the sort still changes for this page
  }
  sortListeners.forEach((listener) => listener());
}

function subscribeSort(listener) {
  sortListeners.add(listener);
  return () => sortListeners.delete(listener);
}

/** The id where focus goes after a row goes: the next row's name, else the one before. */
function neighbourOf(shown, item) {
  const at = shown.findIndex((one) => one.key === item.key);
  const next = shown[at + 1] ?? shown[at - 1] ?? null;
  return next ? rowNameId(next) : null;
}

/** The first of these elements on the page. */
const firstOf = (...ids) =>
  ids
    .filter(Boolean)
    .map((id) => document.getElementById(id))
    .find(Boolean) ?? null;

/** A row's "⋯" while the row is on the page, else null. */
const rowMenuOf = (item) =>
  document
    .getElementById(rowNameId(item))
    ?.closest('li')
    ?.querySelector('button[aria-haspopup="menu"]') ?? null;

/**
 * Where focus goes after Edit details saved `item`: its row's "⋯" while the row is still shown,
 * else the next row's name (it moved out of the place shown), else Upload files or the search.
 * @param {object} item a filesItems item
 * @param {string | null} next the id of the row name after it (or before it) as it was shown
 * @returns {() => HTMLElement | null}
 */
export const focusAfterEdit = (item, next) => () =>
  rowMenuOf(item) ?? firstOf(next, 'files-upload', 'files-search');

/**
 * Edit details' save: the window closes together with the page's new data (one transition), then
 * focus goes to `focusAfterEdit`. The window's own return to its opener finds the "⋯" gone when
 * the file left the place shown, and focus would fall to the page. A window closed while it saved
 * only refreshes.
 */
function useSavedEdit({ panel, setPanel, shown }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const panelNow = useRef(panel);
  const focusAfter = useRef(null);
  useEffect(() => {
    panelNow.current = panel;
    if (refreshing || panel || !focusAfter.current) return;
    const find = focusAfter.current;
    focusAfter.current = null;
    requestAnimationFrame(() => find()?.focus());
  }, [refreshing, panel]);

  return (item) => {
    const open = panelNow.current;
    const still = open?.kind === 'edit' && open.item?.key === item.key;
    if (still) focusAfter.current = focusAfterEdit(item, neighbourOf(shown, item));
    startRefresh(() => {
      if (still) setPanel(null);
      router.refresh();
    });
  };
}

/**
 * @param {{ files: object[], documents: object[], place: string, canManage: boolean }} props
 *   place: the server's `?place=` (the URL's wins once it changes)
 */
export function useFilesTab({ files, documents, place: firstPlace, canManage }) {
  const params = useSearchParams();
  const place = placeOf(params?.get('place') ?? firstPlace);
  const [query, setQuery] = useState('');
  const sort = useSyncExternalStore(subscribeSort, readSort, () => 'new');
  const [panel, setPanel] = useState(null); // { kind: 'note' | 'view' | 'edit', item? }
  const [viewer, setViewer] = useState(null); // the index of the picture shown
  const undo = useUndoDelete();

  const all = useMemo(() => filesItems({ files, documents }), [files, documents]);
  const items = all.filter((item) => !undo.isHidden(item.key));
  const counts = countItems(items);
  const view = placeView({ items, place, query, sort, canManage });

  const choosePlace = useCallback((next) => {
    window.history.replaceState(null, '', placeHref(next));
  }, []);
  const saved = useSavedEdit({ panel, setPanel, shown: view.shown });

  /** Delete with Undo; focus goes to the next row (or the Upload button). */
  function remove(item, { keyboard = false } = {}) {
    const { url, label, failTitle } = deleteCopy(item);
    const next = neighbourOf(view.shown, item);
    const returnFocus = () => firstOf(next, 'files-upload', 'files-search');
    setPanel(null);
    undo.remove({ key: item.key, url, label, failTitle, keyboard, returnFocus });
    if (!keyboard) requestAnimationFrame(() => returnFocus()?.focus());
  }

  return {
    place,
    choosePlace,
    query,
    setQuery,
    sort,
    setSort: writeSort,
    items,
    counts,
    view,
    panel,
    setPanel,
    viewer,
    setViewer,
    remove,
    saved,
    toast: undo.toast,
  };
}
