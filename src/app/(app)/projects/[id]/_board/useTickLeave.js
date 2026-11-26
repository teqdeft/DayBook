'use client';
// The tick of a card (CONTRACT 28, Motion, Moments: Tick done; motion.md 3.4): the check draws and
// the card turns 0.6 at once (`data-ticking`); after 600 ms (unticking cancels) it fades out and
// joins its column's "› 6 done" while the cards below slide up, or, when it was the last open card
// of a past phase, the column folds into the rail. The hold: until its leave has played, a ticked
// card stays in its column's open list (drawn ticked, with its real status), even when the refresh
// already says done. A failed save brings it back. TaskCheck's own save and refresh run at once.
// The optimistic done ends as soon as the page's own task says done, so a later "open" from the
// server (a Reopen here or on another computer) shows at once. The toast's Undo and the task
// window's Reopen (TASK_REOPENED) stop the leave and drop it too.
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { flipSync } from '@/lib/motion/useMotion';
import { PROJECT_PHASES, isPhase } from '@/modules/projectPlan/phases';
import { TASK_REOPENED } from '../taskEvents';
import { tickLeave, riseIn, MOVING } from './boardMotion';
import { playFold } from './phaseMotion';

const FORGET_MS = 15000; // an optimistic "done" the refresh never confirmed goes after this

/**
 * The hold and the optimistic done set, as an external store (changed in handlers, and by the
 * page's tasks when a refresh brings them: `agree`).
 */
export function createTickStore() {
  let state = { leaving: new Set(), done: new Set() };
  let pageDone = new Set(); // what the page itself shows done: it needs no optimistic done
  const listeners = new Set();
  const set = (change) => {
    const leaving = new Set(state.leaving);
    const done = new Set(state.done);
    change({ leaving, done });
    state = { leaving, done };
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hold: (id) => set((next) => next.leaving.add(id)),
    release: (id) => set((next) => next.leaving.delete(id)),
    left: (id) =>
      set((next) => {
        next.leaving.delete(id);
        if (!pageDone.has(id)) next.done.add(id);
      }),
    /** The page's tasks: an optimistic done the page agrees with ends. */
    agree(tasks) {
      pageDone = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id));
      const over = [...state.done].filter((id) => pageDone.has(id));
      if (over.length) set((next) => over.forEach((id) => next.done.delete(id)));
    },
    forget: (id) =>
      set((next) => {
        next.leaving.delete(id);
        next.done.delete(id);
      }),
  };
}

/**
 * The board's tasks as the ticks show them: a card whose leave hasn't played is held open
 * (`holdOpen`, boardColumns keeps it in the open list); one that left shows done until the
 * refresh agrees. Pure.
 * @param {object[]} tasks
 * @param {{ leaving: Set<number>, done: Set<number> }} state
 */
export function applyTicks(tasks, state) {
  if (!state.leaving.size && !state.done.size) return tasks;
  return tasks.map((task) => {
    if (state.leaving.has(task.id)) return { ...task, holdOpen: true };
    if (state.done.has(task.id) && task.status !== 'done') return { ...task, status: 'done' };
    return task;
  });
}

const cardOf = (root, task, el) =>
  el?.closest?.('[data-flip^="card:"], [data-flip^="row:"], [data-flip^="mine:"]') ??
  root?.querySelector?.(`[data-flip="card:${task.id}"]`) ??
  null;

/** True when this card is the only open (or ticking) card left in its column's list. */
function lastOpen(card) {
  const list = card?.closest?.('[data-cards]');
  if (!list) return false;
  const open = list.querySelectorAll(
    '[data-flip^="card:"][data-open], [data-flip^="card:"][data-ticking]',
  );
  return open.length === 1 && open[0] === card;
}

/** A phase before the current one (the column whose header has the "Current" tag). */
function pastPhase(column) {
  const key = column?.dataset?.column;
  const board = column?.closest?.('[data-board]') ?? column?.parentElement;
  const tag = board?.querySelector?.('[data-column] [data-current-tag]');
  const current = tag?.closest('[data-column]')?.dataset.column;
  const at = (phase) => PROJECT_PHASES.findIndex((one) => one.key === phase);
  return isPhase(key) && isPhase(current) && at(key) < at(current);
}

/** The leave itself: into the fold (FLIP), or the whole column folding away. */
function leaveNow({ store, root, task, card, isPast }) {
  const column = card?.closest?.('[data-column]');
  const key = column?.dataset?.column;
  const change = () => store.left(task.id);
  const past = isPast ? isPast(key) : pastPhase(column);
  if (key && past && lastOpen(card)) playFold({ board: root, keys: [key], commit: change });
  else flipSync(column ?? root, change, { selector: MOVING });
  card?.removeAttribute('data-ticking');
}

function tickDone(ctx, task, saved, card) {
  const { store, leaves } = ctx;
  leaves.get(task.id)?.();
  card?.setAttribute('data-ticking', '');
  store.hold(task.id);
  const cancel = tickLeave(card, {
    onLeave: () => {
      leaves.delete(task.id);
      leaveNow({ ...ctx, task, card });
      setTimeout(() => store.get().done.has(task.id) && store.forget(task.id), FORGET_MS);
    },
  });
  leaves.set(task.id, cancel);
  Promise.resolve(saved).then((ok) => {
    if (ok !== false) return;
    leaves.get(task.id)?.();
    leaves.delete(task.id);
    const wasGone = store.get().done.has(task.id);
    card?.removeAttribute('data-ticking');
    if (!wasGone) return store.forget(task.id);
    flushSync(() => store.forget(task.id)); // back in the open list now, so it can rise in
    riseIn(cardOf(ctx.root, task, null));
  });
}

function tickOpen(ctx, task, card) {
  ctx.leaves.get(task.id)?.(); // unticking within the wait cancels the leave
  ctx.leaves.delete(task.id);
  card?.removeAttribute('data-ticking');
  if (ctx.store.get().leaving.has(task.id) || ctx.store.get().done.has(task.id)) {
    ctx.store.forget(task.id);
  }
}

/**
 * @param {{ rootRef: import('react').RefObject<Element>, tasks?: object[],
 *   isPast?: (phaseKey: string) => boolean }} options tasks: the page's own (what ends an
 *   optimistic done); isPast: a phase before the current one (its column folds when its last open
 *   card is ticked); by default read from the board (a column before the one tagged "Current")
 * @returns {{ apply: (tasks: object[]) => object[],
 *   tick: (task: object, next: boolean, saved: Promise<boolean> | unknown,
 *     options?: { el?: Element | null }) => unknown, reopen: (taskId: number) => void }} tick
 *   returns `saved`; reopen: the task was opened again from outside its card (the toast's Undo or
 *   the task window's Reopen, heard as TASK_REOPENED on `window`)
 */
export function useTickLeave({ rootRef, tasks, isPast } = {}) {
  const [store] = useState(createTickStore);
  const [leaves] = useState(() => new Map());
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const options = useMemo(() => ({ rootRef, isPast }), [rootRef, isPast]);
  useLayoutEffect(() => {
    if (tasks) store.agree(tasks);
  }, [store, tasks]);
  useEffect(
    () => () => {
      for (const cancel of leaves.values()) cancel(); // the waits and fades end with the board
      leaves.clear();
    },
    [leaves],
  );
  const ticks = useMemo(
    () => ({
      apply: (tasks) => applyTicks(tasks, state),
      tick(task, next, saved, { el } = {}) {
        const root = options.rootRef?.current ?? null;
        const ctx = { store, leaves, root, isPast: options.isPast };
        const card = cardOf(root, task, el);
        if (next) tickDone(ctx, task, saved, card);
        else tickOpen(ctx, task, card);
        return saved;
      },
      reopen(taskId) {
        const root = options.rootRef?.current ?? null;
        tickOpen({ store, leaves, root }, { id: taskId }, cardOf(root, { id: taskId }, null));
      },
    }),
    [state, store, leaves, options],
  );
  const { reopen } = ticks;
  useEffect(() => {
    const onReopened = (event) => reopen(Number(event.detail?.taskId));
    window.addEventListener(TASK_REOPENED, onReopened);
    return () => window.removeEventListener(TASK_REOPENED, onReopened);
  }, [reopen]);
  return ticks;
}
