// The Table's selection and bulk bar in words and request bodies (CONTRACT 28, Bulk actions in the
// Table; Table and bulk bar): at most 100 tasks selected, what `POST /api/projects/[id]/tasks/bulk`
// sends for Assign to me, Give to… and Move to phase…, the one toast that counts the answer's
// `changed` ("Nothing to change." at 0), and the Undo: the earlier value of each task the save
// changed, always with `shareConfirmed: true`, offered only when every earlier person can be
// picked now. Pure and safe in the browser.
import { plural } from '@/lib/text';
import { phaseLabel } from '@/modules/projectPlan/phases';

/** The most tasks one bulk action takes (the route's limit too). */
export const MAX_SELECTED = 100;
/** The error toast when a box or "Select all shown tasks" would pass it. */
export const LIMIT_TEXT = 'You can pick up to 100 tasks at a time.';
/** The toast of a bulk action that changed nothing (no Undo). */
export const NOTHING_TEXT = 'Nothing to change.';

/** "2 selected" */
export const selectedText = (count) => `${count} selected`;

const idOf = (value) =>
  value === null || value === undefined || value === '' ? null : Number(value);
const sameId = (a, b) => idOf(a) === idOf(b);

/**
 * A box ticked or cleared: at most `max` ids; a tick past it is refused (the ids stay as they were).
 * @param {number[]} ids the selection, in the order it was made
 * @param {number} id
 * @param {boolean} on
 * @returns {{ ids: number[], refused: boolean }} the same array when nothing changes
 */
export function toggleOne(ids, id, on, max = MAX_SELECTED) {
  const has = ids.includes(id);
  if (on === has) return { ids, refused: false };
  if (!on) return { ids: ids.filter((one) => one !== id), refused: false };
  if (ids.length >= max) return { ids, refused: true };
  return { ids: [...ids, id], refused: false };
}

/**
 * "Select all shown tasks": the first `max` of them, in the order they are drawn.
 * @param {number[]} shownIds the open rows shown, in order
 * @returns {{ ids: number[], capped: boolean }} capped: there were more than `max`
 */
export function selectAll(shownIds, max = MAX_SELECTED) {
  return { ids: shownIds.slice(0, max), capped: shownIds.length > max };
}

/**
 * The selection without the rows that left (filtered out, done, gone).
 * @returns {number[]} the same array when every id is still there
 */
export function pruneSelection(ids, selectableIds) {
  const shown = new Set(selectableIds);
  const kept = ids.filter((id) => shown.has(id));
  return kept.length === ids.length ? ids : kept;
}

/** The header box: checked when every task it can select is selected, mixed when only some. */
export function headerState(selectedCount, selectableCount, max = MAX_SELECTED) {
  const all = selectedCount > 0 && selectedCount >= Math.min(selectableCount, max);
  return { checked: all, mixed: selectedCount > 0 && !all, disabled: selectableCount === 0 };
}

/**
 * The changes a bulk action sends: each selected task to one person (null: anyone on the
 * project), or to one phase. Tasks already in that state are sent too; the server skips them.
 * @param {Array<{ id: number }>} tasks
 * @param {{ assigneeId?: number | null, phase?: string }} to
 */
export function changesFor(tasks, to) {
  if (Object.hasOwn(to, 'phase')) return tasks.map((task) => ({ id: task.id, phase: to.phase }));
  return tasks.map((task) => ({ id: task.id, assigneeId: idOf(to.assigneeId) }));
}

/** The route's body: the changes, and `shareConfirmed: true` after the share confirm. */
export const bulkBody = (changes, shareConfirmed = false) =>
  shareConfirmed ? { changes, shareConfirmed: true } : { changes };

/**
 * The selected tasks as they were before the action: each task's person and phase.
 * @param {Array<{ id: number, assignee?: { id: number } | null, phase?: string | null }>} tasks
 * @returns {Map<number, { assigneeId: number | null, phase: string | null }>}
 */
export function beforeOf(tasks) {
  return new Map(
    tasks.map((task) => [
      Number(task.id),
      { assigneeId: idOf(task.assignee?.id), phase: task.phase ?? null },
    ]),
  );
}

/**
 * Undo's changes: each task this save changed (the answer's `tasks`) back to its earlier person or
 * phase (`phase: null` puts it back in No phase yet).
 * @param {'person' | 'phase'} kind
 * @param {Map<number, { assigneeId: number | null, phase: string | null }>} before beforeOf's
 * @param {Array<{ id: number }>} changed the answer's `tasks`
 */
export function undoChanges(kind, before, changed = []) {
  return changed
    .filter((task) => before.has(Number(task.id)))
    .map((task) => {
      const was = before.get(Number(task.id));
      return kind === 'phase'
        ? { id: Number(task.id), phase: was.phase }
        : { id: Number(task.id), assigneeId: was.assigneeId };
    });
}

/** Undo's body: back to the people who held the tasks a moment ago, so it never asks the confirm. */
export const undoBody = (changes) => ({ changes, shareConfirmed: true });

/**
 * Whether the toast offers Undo: a move always; a person change only when every earlier person can
 * be picked now (anyone on the project, or a row of `head.options`, the viewer among them).
 * Someone away, or an Admin who isn't on the project and isn't the viewer, can't be.
 * @param {Array<{ id: number, assigneeId?: number | null, phase?: string | null }>} changes undoChanges'
 * @param {Array<{ id: number }>} options `head.options`
 */
export function canUndo(changes, options = []) {
  return changes.every(
    (change) =>
      !Object.hasOwn(change, 'assigneeId') ||
      change.assigneeId === null ||
      options.some((option) => sameId(option.id, change.assigneeId)),
  );
}

/**
 * The toast after a bulk action, counting the tasks it changed: "2 tasks are now yours.", "1 task
 * is now for Sneha Patil.", "2 tasks are now for anyone on the project.", "Moved 2 tasks to
 * Testing.", or "Nothing to change." when none changed.
 * @param {{ changed: number, phase?: string, assigneeId?: number | null, viewerId?: number | null,
 *   name?: string | null }} what phase: a move; else the person (the viewer: "yours")
 * @returns {string}
 */
export function bulkToast({ changed, phase, assigneeId = null, viewerId = null, name = null }) {
  const count = Number(changed) || 0;
  if (count === 0) return NOTHING_TEXT;
  const tasks = `${count} ${plural(count, 'task')}`;
  if (phase !== undefined) return `Moved ${tasks} to ${phaseLabel(phase)}.`;
  const verb = count === 1 ? 'is' : 'are';
  if (assigneeId !== null && sameId(assigneeId, viewerId)) return `${tasks} ${verb} now yours.`;
  const who = assigneeId === null ? 'anyone on the project' : name || 'someone else';
  return `${tasks} ${verb} now for ${who}.`;
}

/**
 * The picked person's full name for the toast: an option, else a selected task's own person.
 * @returns {string | null}
 */
export function nameOf(assigneeId, options = [], tasks = []) {
  if (idOf(assigneeId) === null) return null;
  const option = options.find((one) => sameId(one.id, assigneeId));
  if (option) return option.name;
  return tasks.find((task) => sameId(task.assignee?.id, assigneeId))?.assignee.name ?? null;
}

/** `--toast-offset` while the bar shows: its height plus 12 px, so toasts sit above it. */
export const toastOffset = (height) => `${Math.ceil(Number(height) || 0) + 12}px`;
