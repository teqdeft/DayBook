'use client';
// The project page's one people window (CONTRACT 28, The people window), for TaskActionsProvider:
// which window is open (one at a time, a new key each time it opens), what a pick does and where
// focus goes after it. A plain pick saves and the window closes at once (the face swaps on the card
// meanwhile); "Give and share" keeps the window open until the save is done. When the server asks
// for the share confirm (`fields.shareConfirmed`: a private file linked in another tab, or the task
// given to someone else meanwhile), the task is read again (`GET /api/project-tasks/[id]`) and the
// window asks with it: its foot turns into the confirm, or, when the window had already closed, it
// opens again on the confirm.
import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';

/**
 * The task read again, over what the page knows (a BoardTask keeps its own fields); the task as it
 * was when the read fails.
 * @param {{ id: number }} task
 */
export async function readTask(task) {
  try {
    const { data } = await api.get(`/api/project-tasks/${task.id}`);
    return data ? { ...task, ...data, assignee: data.assignee ?? null } : task;
  } catch {
    return task;
  }
}

const READS_AT_ONCE = 6;

/**
 * Several tasks read again (the bulk selection, at most 100), a few at a time, in the same order;
 * one that can't be read stays as it was.
 * @param {Array<{ id: number }>} tasks
 * @returns {Promise<object[]>}
 */
export async function readTasks(tasks) {
  const fresh = [];
  for (let at = 0; at < tasks.length; at += READS_AT_ONCE) {
    const some = tasks.slice(at, at + READS_AT_ONCE);
    fresh.push(...(await Promise.all(some.map(readTask))));
  }
  return fresh;
}

/**
 * "Give and share": the save with the confirm, naming its person (`shareWith`, '' for anyone).
 * Resolves when the save is done (or failed with its own toast); rejects with the server's
 * `fields.shareConfirmed` and the task read again (`tasks`) when the server asks again.
 */
async function confirmedPick(assign, task, assigneeId, anchor) {
  let asked = null;
  await assign(task, assigneeId, {
    shareConfirmed: true,
    shareWith: assigneeId ?? '',
    anchor,
    onShareAsk: (error) => {
      asked = error;
    },
  });
  if (!asked) return;
  const fresh = await readTask(task);
  throw Object.assign(new Error(asked.message), { fields: asked.fields, tasks: [fresh] });
}

/**
 * @param {{ assign: (task: object, assigneeId: number | null, options?: object) =>
 *   Promise<object | null> }} deps useAssign's assign
 * @returns {{ people: object | null, openPeople: (options: object) => void,
 *   reask: (task: object, assigneeId: number | null, anchor?: Element | null) => Promise<void>,
 *   pickFor: (shown: object) => Function, close: (shown: object, how?: object) => void }}
 */
export function usePeople({ assign }) {
  const [people, setPeople] = useState(null);
  const counter = useRef(0);

  const openPeople = useCallback(({ tasks, anchor = null, title, onPick = null, ask = null }) => {
    counter.current += 1;
    setPeople({ key: counter.current, tasks, anchor, title, onPick, ask, open: true });
  }, []);

  // A plain pick whose save asked for the confirm after the window had closed: ask again.
  const reask = useCallback(
    async (task, assigneeId, anchor) => {
      const fresh = await readTask(task);
      openPeople({
        tasks: [fresh],
        anchor: anchor?.isConnected ? anchor : null,
        ask: { assigneeId },
      });
    },
    [openPeople],
  );

  // A pick from the window, with the tasks as the window has them now (read again after a confirm).
  const pickFor =
    (shown) =>
    (assigneeId, { shareConfirmed, tasks = shown.tasks } = {}) => {
      const task = tasks[0];
      if (shareConfirmed) return confirmedPick(assign, task, assigneeId, shown.anchor);
      assign(task, assigneeId, {
        anchor: shown.anchor,
        onShareAsk: () => reask(task, assigneeId, shown.anchor),
      });
      return undefined;
    };

  // Kept while closing, so the window can play its exit (a popover closes at once).
  const close = (shown, how) => {
    setPeople((now) => (now?.key === shown.key ? { ...now, open: false } : now));
    if (how?.picked && shown.anchor?.isConnected) shown.anchor.focus({ preventScroll: true });
  };
  return { people, openPeople, reask, pickFor, close };
}
