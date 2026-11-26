// The motion after a bulk action and its Undo (CONTRACT 28, Motion, Moments: Table sort, Person
// changes; Table and bulk bar: "After the refresh the changed rows flash"). Bulk actions aren't
// optimistic: the rows change with the page's refresh, so the request waits for the first commit
// that draws every changed row with its new person or phase (`data-person`, `data-phase`), then
// the rows slide from where they were measured when the answer came (to their new group after a
// move) and the changed rows flash, in one `flash()` call. Over 150 rows, in a hidden tab or with
// reduce motion there is no slide, only the flash. DOM only, no React.
import { flash } from '@/lib/motion/animate';
import { flipFrom, measure, tooManyToFlip } from '@/lib/motion/flip';
import { ROWS, allShownIn, rowOf, shownBody } from './tableDom';

/**
 * The data attribute a row carries for a change, and the value it shows once the change is drawn.
 * @param {{ assigneeId?: number | null, phase?: string | null }} change
 * @returns {['person' | 'phase', string]}
 */
export function shownValue(change) {
  if (Object.hasOwn(change, 'phase')) return ['phase', change.phase ?? 'none'];
  const id = change.assigneeId;
  return ['person', id === null || id === undefined ? 'anyone' : String(id)];
}

/** True when every changed row on the page (the table's and the phone list's) shows its change. */
export function showsChanges(root, changes) {
  return changes.every((change) => {
    const [name, value] = shownValue(change);
    const rows = [...(root?.querySelectorAll?.(rowOf(change.id)) ?? [])];
    return rows.every((row) => row.dataset?.[name] === value);
  });
}

/**
 * The commit-motion request of a bulk save (useCommitMotion's `expect`), measured now, before the
 * refresh draws the change.
 * @param {ParentNode | null} root the Table
 * @param {Array<{ id: number, assigneeId?: number | null, phase?: string | null }>} changes what
 *   the save changed (each task's new value)
 * @param {{ onPlayed?: () => void }} [options] onPlayed: after the rows have moved (focus)
 * @returns {{ id: string, ready: (root: Element) => boolean, play: (root: Element) => void }}
 */
export function bulkMotion(root, changes, { onPlayed } = {}) {
  const body = shownBody(root);
  const first = body && !tooManyToFlip(body) ? measure(body.querySelectorAll(ROWS)) : null;
  return {
    id: 'bulk',
    ready: (where) => showsChanges(where, changes),
    play(where) {
      const now = shownBody(where);
      if (first && now) flipFrom(first, now.querySelectorAll(ROWS));
      flash(changes.flatMap((change) => allShownIn(where, rowOf(change.id))));
      onPlayed?.();
    },
  };
}
