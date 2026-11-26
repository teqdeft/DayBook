'use client';
// The board's filters for the visit (CONTRACT 28, How filters work): the search, the Filter menu's
// items, Mine and one face, never remembered. `?show=critical` or `?show=files` (the Summary tab's
// links) ticks that item first. The Board fades the open cards that don't match; the Table hides
// the rows that don't. "Show done tasks" opens every done fold and adds the done rows.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  badgeCount,
  filterCounts,
  firstFilters,
  isDimmed,
  isFiltering,
  matches,
  noFilters,
} from './boardFilters';

/**
 * @param {{ access: string, filesAccess: string, show?: string | null, tasks: object[],
 *   viewerId: number | null, today: string }} args tasks: the tasks the viewer sees
 * @returns {{ state: object, any: boolean, showDone: boolean, badge: number, counts: object,
 *   matches: (task: object) => boolean, dims: (task: object) => boolean,
 *   set: (key: string, value: unknown) => void, toggle: (key: string) => void,
 *   setFace: (face: number | 'anyone' | null) => void, clear: () => void }} any: something
 *   takes tasks out of view (search, an item, Mine or a face); matches: the task matches every
 *   filter that is on; dims: the Board fades this card; setFace: one face at a time, the pressed
 *   one again clears it
 */
export function useBoardFilters({ access, filesAccess, show, tasks, viewerId, today }) {
  const params = useSearchParams();
  const [state, setState] = useState(() =>
    firstFilters({ access, filesAccess, show: show ?? params?.get('show') }),
  );
  const counts = useMemo(() => filterCounts(tasks, viewerId, today), [tasks, viewerId, today]);
  return {
    state,
    any: isFiltering(state),
    showDone: state.showDone,
    badge: badgeCount(state),
    counts,
    matches: (task) => matches(task, state, viewerId, today),
    dims: (task) => isDimmed(task, state, viewerId, today),
    set: (key, value) => setState((now) => ({ ...now, [key]: value })),
    toggle: (key) => setState((now) => ({ ...now, [key]: !now[key] })),
    setFace: (face) => setState((now) => ({ ...now, face: now.face === face ? null : face })),
    clear: () => setState(noFilters()),
  };
}
