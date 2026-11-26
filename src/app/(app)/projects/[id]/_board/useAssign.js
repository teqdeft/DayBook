'use client';
// Giving a task to someone (CONTRACT 28, Cards and the card menu; The people window), for every part
// of a project page: Assign to me and the people window's picks. The new face shows at once (the old
// one fades out, the new one fades in and the card flashes; a Table row only flashes) while `PATCH
// /api/project-tasks/[id] { assigneeId }` runs, then the toast says who the task is for now, with
// who was told (from the answer) and Undo. Undo gives the task back to the person who held it a
// moment ago (`shareConfirmed: true`, no toast) and is offered only when that person can still be
// picked. A failed change puts the face back with "Couldn't change the person"; a failed Undo says
// "Couldn't undo" and keeps the new person. The persons on their way stay laid over the tasks until
// the refresh that follows a save has landed.
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { flash } from '@/lib/motion/animate';
import {
  assignBody,
  assignToast,
  asksShare,
  shownPerson,
  undoBody,
  undoable,
  withPersons,
} from './assignView';
import { swapFace } from './boardMotion';
import { personIdOf } from './peopleView';
import { shownIn } from './table/tableDom';

const sameId = (a, b) =>
  (a ?? null) === null ? (b ?? null) === null : (b ?? null) !== null && Number(a) === Number(b);

/**
 * Where a change of person plays: the task's card, else its Table row where it is shown (the table
 * and the phone's list both draw it; either may be absent).
 */
export function placeOf(taskId) {
  if (typeof document === 'undefined') return {};
  const card = document.querySelector(`[data-flip="card:${taskId}"]`);
  return card ? { card } : { row: shownIn(document, `[data-flip="row:${taskId}"]`) };
}

/** The face button next to what was pressed: in the task window, the card or the row. */
export function faceButtonNear(origin, taskId) {
  const scope =
    origin?.closest?.('[role="dialog"]') ??
    origin?.closest?.('[data-flip]') ??
    placeOf(taskId).card ??
    placeOf(taskId).row ??
    null;
  return (
    scope?.querySelector('[data-face-button]') ??
    scope?.querySelector('button[aria-haspopup="dialog"]') ??
    null
  );
}

/** Plays a change of person: the face swap on a card (it flashes after), a flash on a row. */
async function showPerson(taskId, change) {
  const { card, row } = placeOf(taskId);
  if (card) {
    await swapFace(card, change);
    return;
  }
  flushSync(change);
  if (row) flash(row);
}

/**
 * The person shown for `assigneeId`: an option (head.options), the viewer, or the task's own.
 * @returns {object | null} null for anyone on the project
 */
function personFor(assigneeId, { task, options, viewer }) {
  if (assigneeId === null || assigneeId === undefined) return null;
  const option = options.find((one) => Number(one.id) === Number(assigneeId));
  if (option) return shownPerson(option, viewer.id);
  if (sameId(task?.assignee?.id, assigneeId)) return shownPerson(task.assignee, viewer.id);
  if (Number(assigneeId) === Number(viewer.id)) return shownPerson(viewer, viewer.id);
  return shownPerson({ id: assigneeId, name: '' }, viewer.id);
}

/**
 * The persons laid over the tasks while their saves run: once the refresh after a save has
 * landed, its entry goes and the page's own data shows.
 */
function useShownPersons() {
  const [shown, setShown] = useState(() => new Map());
  const [refreshing, startRefresh] = useTransition();
  const waited = useRef(false);
  useEffect(() => {
    if (refreshing) {
      waited.current = true;
      return;
    }
    if (!waited.current) return;
    waited.current = false;
    setShown((now) => {
      const next = new Map([...now].filter(([, entry]) => !entry.settled));
      return next.size === now.size ? now : next;
    });
  }, [refreshing]);
  const put = useCallback((taskId, entry) => {
    setShown((now) => {
      const next = new Map(now);
      if (entry) next.set(Number(taskId), entry);
      else next.delete(Number(taskId));
      return next;
    });
  }, []);
  return { shown, put, startRefresh };
}

/** Focus on the face button once the change is drawn (the control that was pressed may go). */
function focusFaceSoon(task, opts) {
  requestAnimationFrame(() =>
    (opts.focus?.() ?? faceButtonNear(opts.origin, task.id))?.focus({ preventScroll: true }),
  );
}

/**
 * The save of a change of person: the new face shows at once, `PATCH /api/project-tasks/[id]`,
 * then the page refreshes; a failure puts the face back (`revertTo`, else the page's own person).
 * @returns {{ send: (task: object, assigneeId: number | null, opts: object) =>
 *   Promise<{ data?: object, person?: object | null, error?: Error }>,
 *   apply: (tasks: object[]) => object[] }}
 */
function useSend({ options, viewer }) {
  const router = useRouter();
  const { shown, put, startRefresh } = useShownPersons();
  const send = useCallback(
    async (task, assigneeId, opts) => {
      const person = personFor(assigneeId, { task, options, viewer });
      await showPerson(task.id, () => put(task.id, { assignee: person, settled: false }));
      if (opts.focusFace) focusFaceSoon(task, opts);
      try {
        const body = opts.undo ? undoBody(assigneeId) : assignBody(assigneeId, opts);
        const { data } = await api.patch(`/api/project-tasks/${task.id}`, body);
        put(task.id, { assignee: person, settled: true });
        startRefresh(() => router.refresh());
        return { data, person };
      } catch (error) {
        await showPerson(task.id, () => put(task.id, opts.revertTo ?? null));
        return { error };
      }
    },
    [put, router, startRefresh, options, viewer],
  );
  const apply = useCallback((tasks) => withPersons(tasks, shown), [shown]);
  return { send, apply };
}

/**
 * The Undo toast of the last change of person: its words, the task and who held it before. Undo
 * gives the task back silently (`shareConfirmed: true`); a failed Undo says "Couldn't undo" and
 * the new person stays.
 */
function useUndoSlot({ send, toast }) {
  const [pending, setPending] = useState(null);
  const counter = useRef(0);
  const offer = useCallback((entry) => {
    counter.current += 1;
    setPending({ key: counter.current, ...entry });
  }, []);
  const run = useCallback(async () => {
    const last = pending;
    if (!last) return;
    setPending(null);
    const { error } = await send(last.task, last.before ? last.before.id : null, {
      undo: true,
      focusFace: true,
      revertTo: { assignee: last.task.assignee, settled: true },
    });
    if (error) toast({ title: "Couldn't undo", body: error.message, tone: 'error' });
  }, [pending, send, toast]);
  const end = useCallback(() => setPending(null), []);
  return { pending, offer, run, end };
}

/**
 * @param {{ options: object[], viewer: { id: number, name: string, role?: string } }} input
 *   options: `head.options`; viewer: who is signed in
 * @returns {{ apply: (tasks: object[]) => object[],
 *   assign: (task: object, assigneeId: number | null, options?: object) => Promise<object | null>,
 *   take: (task: object, options?: { origin?: Element, focus?: () => Element | null }) =>
 *     Promise<object | null>,
 *   undo: { pending: object | null, run: () => void, end: () => void } }} assign resolves the
 *   answer's task, or null when it failed (its toast shown)
 */
export function useAssign({ options = [], viewer }) {
  const toast = useToast();
  const { send, apply } = useSend({ options, viewer });
  const undo = useUndoSlot({ send, toast });
  const { offer, end } = undo;

  const assign = useCallback(
    async (task, assigneeId, opts = {}) => {
      const to = assigneeId ?? null;
      const before = task?.assignee ?? null;
      if (!task || sameId(personIdOf(task), to)) return task ?? null;
      const { data, person, error } = await send(task, to, opts);
      if (error) {
        if (asksShare(error) && opts.onShareAsk) opts.onShareAsk(error);
        else toast({ title: "Couldn't change the person", body: error.message, tone: 'error' });
        return null;
      }
      const words = assignToast(task, person, viewer.id, data);
      if (undoable(before ? before.id : null, options)) {
        offer({ ...words, task: { ...task, assignee: person }, before });
      } else {
        end();
        toast(words);
      }
      return data;
    },
    [send, toast, viewer, options, offer, end],
  );

  const take = useCallback(
    (task, { origin, focus } = {}) => assign(task, viewer.id, { origin, focus, focusFace: true }),
    [assign, viewer],
  );
  return { apply, assign, take, undo: { pending: undo.pending, run: undo.run, end } };
}
