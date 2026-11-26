'use client';
// The rows selected for the bulk bar (CONTRACT 28, Table and bulk bar): the project's PM and Admins
// tick open rows (done rows can't be); "Select all shown tasks" takes the open rows shown, the first
// 100 of them; a 101st is refused with "You can pick up to 100 tasks at a time." (an error toast).
// A row that leaves (a filter hides it, it is done, it is gone) leaves the selection; a switch to
// the Board clears it (the Table goes), and so does every bulk action.
import { useCallback, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { LIMIT_TEXT, headerState, pruneSelection, selectAll, toggleOne } from './bulkView';

/**
 * @param {Array<{ id: number }>} selectable the open rows shown, in the order they are drawn
 * @returns {{ ids: number[], tasks: object[], count: number, has: (id: number) => boolean,
 *   toggle: (id: number, on: boolean) => void, toggleAll: (on: boolean) => void,
 *   clear: () => void, header: { checked: boolean, mixed: boolean, disabled: boolean } }} tasks:
 *   the selected rows' tasks, in the order they are drawn
 */
export function useSelection(selectable) {
  const toast = useToast();
  const [stored, setStored] = useState([]);
  const shownIds = selectable.map((task) => task.id);
  const ids = pruneSelection(stored, shownIds);
  if (ids !== stored) setStored(ids); // rows that left leave the selection (adjusted in render)
  const chosen = new Set(ids);

  const refuse = useCallback(() => toast({ title: LIMIT_TEXT, tone: 'error' }), [toast]);
  const toggle = (id, on) => {
    const next = toggleOne(ids, id, on);
    if (next.refused) refuse();
    if (next.ids !== ids) setStored(next.ids);
  };
  const toggleAll = (on) => {
    if (!on) return setStored([]);
    const next = selectAll(shownIds);
    if (next.capped) refuse();
    setStored(next.ids);
  };
  return {
    ids,
    tasks: selectable.filter((task) => chosen.has(task.id)),
    count: ids.length,
    has: (id) => chosen.has(id),
    toggle,
    toggleAll,
    clear: () => setStored([]),
    header: headerState(ids.length, shownIds.length),
  };
}
