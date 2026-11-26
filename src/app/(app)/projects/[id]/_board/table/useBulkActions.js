'use client';
// The bulk bar's actions (CONTRACT 28, Bulk actions in the Table; Table and bulk bar): Assign to me,
// Give to… (the people window, "Give 2 tasks to") and Move to phase… ("Move 2 tasks"), each one
// `POST /api/projects/[id]/tasks/bulk`, all or nothing. Not optimistic: the pressed button turns
// busy and the others wait; after the answer the selection clears, focus goes to "Select all shown
// tasks", the page refreshes once and the changed rows slide and flash when it lands. One toast
// counts the tasks that changed ("Nothing to change." at 0), with Undo (6 s) when every earlier
// person can be picked now; Undo sends the same route back with `shareConfirmed: true`. A failure
// keeps the selection ("Couldn't change the tasks"); a share confirm the server asks for opens in
// the people window instead, with the selected tasks read again.
import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { useCommitMotion } from '@/lib/motion/useMotion';
import { asksShare } from '../assignView';
import { useTaskActions } from '../TaskActionsProvider';
import { useTaskEditor } from '../TaskEditorProvider';
import { readTasks } from '../usePeople';
import { bulkMotion } from './bulkMotion';
import {
  beforeOf,
  bulkBody,
  bulkToast,
  canUndo,
  changesFor,
  nameOf,
  undoBody,
  undoChanges,
} from './bulkView';
import { focusAfterBulk } from './tableDom';

const routeOf = (projectId) => `/api/projects/${projectId}/tasks/bulk`;
const kindOf = (to) => (Object.hasOwn(to, 'phase') ? 'phase' : 'person');

/** What a save changed, as the rows will show it (the answer's `tasks`). */
const shownChanges = (kind, tasks = []) =>
  tasks.map((task) =>
    kind === 'phase'
      ? { id: task.id, phase: task.phase ?? null }
      : { id: task.id, assigneeId: task.assigneeId ?? null },
  );

/**
 * After a save (an action or its Undo): the rows' motion (and the band's after a move) waits for
 * the refresh, focus goes to "Select all shown tasks", the page refreshes once.
 */
function useAfterSave(rootRef, expectBand) {
  const router = useRouter();
  const motion = useCommitMotion(rootRef);
  const [, startRefresh] = useTransition();
  return useCallback(
    (kind, data) => {
      const changes = shownChanges(kind, data?.tasks);
      const ids = changes.map((change) => change.id);
      const refocus = () => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost) focusAfterBulk(rootRef.current, ids);
      };
      if (changes.length)
        motion.expect(bulkMotion(rootRef.current, changes, { onPlayed: refocus }));
      if (changes.length && kind === 'phase') expectBand?.();
      focusAfterBulk(rootRef.current, ids);
      startRefresh(() => router.refresh());
    },
    [motion, rootRef, router, expectBand],
  );
}

/** The Undo toast's state and its run: the changed tasks back as they were, silently. */
function useBulkUndo({ projectId, afterSave, toast }) {
  const [pending, setPending] = useState(null);
  const counter = useRef(0);
  const offer = useCallback((title, kind, changes) => {
    counter.current += 1;
    setPending({ key: `bulk:${counter.current}`, title, kind, changes });
  }, []);
  const run = useCallback(async () => {
    const last = pending;
    if (!last) return;
    setPending(null);
    try {
      const { data } = await api.post(routeOf(projectId), undoBody(last.changes));
      afterSave(last.kind, data);
    } catch (error) {
      toast({ title: "Couldn't undo", body: error.message, tone: 'error' });
    }
  }, [pending, projectId, afterSave, toast]);
  const end = useCallback(() => setPending(null), []);
  return { pending, offer, run, end };
}

/** The toast of a save: with Undo when it changed something that can be put back. */
function tellSaved({ to, data, before, tasks, board, options, toast, undo }) {
  const kind = kindOf(to);
  const title = bulkToast({
    changed: data?.changed,
    ...(kind === 'phase' ? { phase: to.phase } : { assigneeId: to.assigneeId ?? null }),
    viewerId: board.viewerId,
    name: kind === 'person' ? nameOf(to.assigneeId, options, tasks) : null,
  });
  const back = undoChanges(kind, before, data?.tasks);
  if (back.length && canUndo(back, options)) undo.offer(title, kind, back);
  else toast({ title });
}

/**
 * One save at a time: the bulk route, then the toast; the pressed button is busy until the answer.
 * Give to… hands a share confirm the server asks for back to the people window (its foot turns
 * into the confirm), with the tasks read again (`error.tasks`): the page's `privateLinkCount` was
 * stale. Any other failure keeps the selection and says so.
 */
function useBulkSave({ board, selection, options, toast, undo, afterSave }) {
  const [busy, setBusy] = useState(null);
  const waiting = useRef(false);
  async function save(to, tasks, { key, shareConfirmed = false }) {
    if (waiting.current || tasks.length === 0) return;
    waiting.current = true;
    setBusy(key);
    const before = beforeOf(tasks);
    try {
      const body = bulkBody(changesFor(tasks, to), shareConfirmed);
      const { data } = await api.post(routeOf(board.projectId), body);
      selection.clear();
      afterSave(kindOf(to), data);
      tellSaved({ to, data, before, tasks, board, options, toast, undo });
    } catch (error) {
      if (key === 'give' && asksShare(error)) {
        throw Object.assign(error, { tasks: await readTasks(tasks) });
      }
      toast({ title: "Couldn't change the tasks", body: error.message, tone: 'error' });
    } finally {
      waiting.current = false;
      setBusy(null);
    }
  }
  return { save, busy };
}

/**
 * @param {{ board: object, selection: ReturnType<typeof import('./useSelection').useSelection>,
 *   rootRef: import('react').RefObject<HTMLElement> }} args board: the board object (projectId,
 *   viewerId); selection: useSelection's
 * @returns {{ takeAll: () => Promise<void>, giveAll: () => void,
 *   moveAll: (origin?: Element | null) => void, clear: () => void,
 *   undo: { pending: object | null, run: () => void, end: () => void },
 *   busy: 'take' | 'give' | 'move' | null }} busy: the action waiting for its answer
 */
export function useBulkActions({ board, selection, rootRef }) {
  const toast = useToast();
  const actions = useTaskActions();
  const options = useTaskEditor()?.options ?? [];
  const afterSave = useAfterSave(rootRef, board.expectBand);
  const undo = useBulkUndo({ projectId: board.projectId, afterSave, toast });
  const { save, busy } = useBulkSave({ board, selection, options, toast, undo, afterSave });
  return {
    takeAll: () => save({ assigneeId: board.viewerId }, selection.tasks, { key: 'take' }),
    giveAll() {
      const tasks = selection.tasks;
      actions?.openPeople({
        tasks,
        // The tasks as the window has them: read again after a share confirm, so the Undo puts
        // back the people who hold them now.
        onPick: (assigneeId, { shareConfirmed, tasks: shown = tasks } = {}) =>
          save({ assigneeId }, shown, { key: 'give', shareConfirmed }),
      });
    },
    moveAll(origin = null) {
      const tasks = selection.tasks;
      actions?.openMove({
        tasks,
        origin,
        onMove: (phase) => save({ phase }, tasks, { key: 'move' }),
      });
    },
    clear() {
      selection.clear();
      focusAfterBulk(rootRef.current);
    },
    undo,
    busy,
  };
}
