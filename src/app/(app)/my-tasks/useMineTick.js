'use client';
// The tick on a My tasks row (CONTRACT 28, Motion, Moments: "My tasks tick", as a card's tick): the
// check draws and the row turns 0.6 at once (`data-ticking`); after 600 ms (unticking cancels) it
// fades out, leaves its group while the rows below slide up, and the group's count changes. Until
// its leave has played the row keeps its place, ticked, even when the refresh already left the
// task out (the hold); a failed save brings it back. TaskCheck's own save, its "Marked done." toast
// with Undo (the page's TaskUndoProvider) and the refresh run at once. The task opened again from
// outside its row (that Undo, the task window's Reopen: TASK_REOPENED) stops the leave, or stops
// hiding the row. Focus after the row leaves (Look and accessibility): the next row's title, else
// the previous row's, else the list (tickFocus.js, where the toast's Undo hands it back to too).
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { LIMITS } from '@/lib/motion/tokens';
import { flipSync } from '@/lib/motion/useMotion';
import { riseIn, tickLeave } from '@/app/(app)/projects/[id]/_board/boardMotion';
import { TASK_REOPENED } from '@/app/(app)/projects/[id]/taskEvents';
import { placeAfterTick } from '@/app/(app)/projects/[id]/tickFocus';
import { withTicks } from './myTasksView';

const FORGET_MS = 15000; // a left row the page still lists shows again after this
const ROW = '[data-flip^="mine:"]';
const MOVING = '[data-flip^="mine"]'; // the rows, the group headings and the card's foot

/** The row a control is in. */
export const rowOf = (el) => el?.closest?.(ROW) ?? null;

/**
 * The focus as this row leaves, read before it does: a function that moves it to the row's
 * `placeAfterTick` afterwards, or does nothing when the focus was somewhere else on the page (the
 * toast's Undo has it: the toast hands it back there itself).
 * @param {Element | null} row
 * @returns {() => void}
 */
export function focusAfterLeave(row) {
  const doc = row?.ownerDocument;
  if (!doc) return () => {};
  const active = doc.activeElement;
  const hadFocus = !active || active === doc.body || row.contains(active);
  if (!hadFocus) return () => {};
  const place = placeAfterTick(row);
  return () => {
    const to = place();
    to?.focus({ preventScroll: to.getAttribute('tabindex') === '-1' }); // a list or a part: no jump
  };
}

/** The change, with the rows below sliding up (no FLIP past 150 rows: rule 6). */
function leaveWithFlip(row, change) {
  const root = row?.closest?.('[data-mine-root]') ?? row?.closest?.('[data-mine-list]');
  if (!root || root.querySelectorAll(ROW).length > LIMITS.flipCards) {
    flushSync(change);
    return;
  }
  flipSync(root, change, { selector: MOVING });
}

const without = (map, id) => {
  const next = new Map(map);
  next.delete(id);
  return next;
};
const withId = (set, id, keep = true) => {
  const next = new Set(set);
  if (keep) next.add(id);
  else next.delete(id);
  return next;
};

/** The state with one task held: ticked, its leave still to play. */
export const holdTick = (state, task) => ({
  ...state,
  held: new Map(state.held).set(task.id, task),
  open: withId(state.open, task.id, false),
});

/**
 * The state once a row has left: no longer held, and hidden while the page still lists it (the
 * refresh that says done may not have come yet); a task the page already left out needs nothing.
 */
export function leftTick(state, id) {
  const listed = state.listed.some((task) => task.id === id);
  return {
    ...state,
    held: without(state.held, id),
    gone: listed ? withId(state.gone, id) : state.gone,
  };
}

/** The state with a task back in the list (unticked, or its save failed). */
export const backTick = (state, id) => ({
  ...state,
  held: without(state.held, id),
  gone: withId(state.gone, id, false),
});

/**
 * The state with a task opened again from outside its row: no longer ticked and no longer hidden. A
 * held row the page has already left out stays in its place, unticked, until the next refresh.
 */
export function reopenedTick(state, id) {
  if (!state.held.has(id) && !state.gone.has(id)) return state;
  const listed = state.listed.some((task) => task.id === id);
  if (listed || !state.held.has(id)) return backTick(state, id);
  return { ...state, open: withId(state.open, id) };
}

/**
 * The state once the page lists `tasks`: a left task the page no longer lists stops hiding, and a
 * task opened again (reopenedTick) is the page's again.
 */
export function listedTick(state, tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  const stale = [...state.gone].some((id) => !ids.has(id));
  const { open, held } = state;
  return {
    ...state,
    listed: tasks,
    gone: stale ? new Set([...state.gone].filter((id) => ids.has(id))) : state.gone,
    held: open.size ? new Map([...held].filter(([id]) => !open.has(id))) : held,
    open: open.size ? new Set() : open,
  };
}

/**
 * TaskCheck's onChange for every row (`tick`): the tick holds the row and starts its leave;
 * unticking within the wait, or a failed save, brings it back. `reopen(taskId)`: the task was
 * opened again from outside its row.
 * @param {{ leaves: Map<number, () => void>, update: Function }} parts update: the state's setter
 */
function makeTick({ leaves, update }) {
  function leave(task, row) {
    leaves.delete(task.id);
    const refocus = focusAfterLeave(row);
    leaveWithFlip(row, () => update((state) => leftTick(state, task.id)));
    row?.removeAttribute('data-ticking');
    refocus();
    setTimeout(
      () => update((state) => ({ ...state, gone: withId(state.gone, task.id, false) })),
      FORGET_MS,
    );
  }
  function back(task, row, list) {
    leaves.get(task.id)?.();
    leaves.delete(task.id);
    row?.removeAttribute('data-ticking');
    flushSync(() => update((state) => backTick(state, task.id)));
    if (!row?.isConnected) riseIn(list?.querySelector(`[data-flip="mine:${task.id}"]`) ?? null);
  }
  function tick(task, next, saved, { el } = {}) {
    const row = rowOf(el);
    const list = row?.closest?.('[data-mine-list]') ?? null;
    if (!next) return back(task, row, list); // unticked within the wait: no leave
    leaves.get(task.id)?.();
    row?.setAttribute('data-ticking', '');
    update((state) => holdTick(state, task));
    leaves.set(task.id, tickLeave(row, { onLeave: () => leave(task, row) }));
    Promise.resolve(saved).then((ok) => ok === false && back(task, row, list));
  }
  function reopen(taskId) {
    leaves.get(taskId)?.();
    leaves.delete(taskId);
    for (const row of document.querySelectorAll(`[data-flip="mine:${taskId}"]`)) {
      row.removeAttribute('data-ticking');
    }
    update((state) => reopenedTick(state, taskId));
  }
  return { tick, reopen };
}

/** The page's waits and fades end with it; a task opened again elsewhere stops its leave. */
function useTickEvents({ leaves, reopen }) {
  useEffect(
    () => () => {
      for (const cancel of leaves.values()) cancel();
      leaves.clear();
    },
    [leaves],
  );
  useEffect(() => {
    const onReopened = (event) => reopen(Number(event.detail?.taskId));
    window.addEventListener(TASK_REOPENED, onReopened);
    return () => window.removeEventListener(TASK_REOPENED, onReopened);
  }, [reopen]);
}

/**
 * @param {object[]} tasks the page's tasks (listMine's, with `canManage`), in its order
 * @returns {{ tasks: object[], tick: (task: object, next: boolean, saved: Promise<boolean>,
 *   options?: { el?: Element | null }) => void }} tasks: as the ticks show them (a held row has
 *   `ticking: true`); tick: TaskCheck's onChange for that row
 */
export function useMineTick(tasks) {
  const [state, update] = useState(() => ({
    held: new Map(),
    gone: new Set(),
    open: new Set(),
    listed: tasks,
  }));
  const [leaves] = useState(() => new Map());
  // A refresh: a left task the page no longer lists needn't stay hidden (an Undo shows it again).
  if (state.listed !== tasks) update((current) => listedTick(current, tasks));
  const { held, gone, open } = state;
  const shown = useMemo(() => withTicks(tasks, { held, gone, open }), [tasks, held, gone, open]);
  const { tick, reopen } = useMemo(() => makeTick({ leaves, update }), [leaves]);
  useTickEvents({ leaves, reopen });
  return { tasks: shown, tick };
}
