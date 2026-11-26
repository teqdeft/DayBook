'use client';
// One task's details for the task window and the Edit task window (CONTRACT 27 and 28): the
// `GET /api/project-tasks/[id]` answer (TaskDetails). The last 8 stay in memory for this tab, so
// a task opened again shows at once while it loads again behind. forgetTaskDetails drops one after
// a save, an attach or a file removal; a window still showing that task then loads it again and
// keeps showing what it had until the answer comes.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/apiClient';

const KEEP = 8;
const memory = new Map(); // taskId -> TaskDetails, oldest first
const listeners = new Set();
let round = 0; // goes up with every forget, so the hooks showing a task load it again

function remember(id, task) {
  memory.delete(id);
  memory.set(id, task);
  while (memory.size > KEEP) memory.delete(memory.keys().next().value);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentRound = () => round;
const serverRound = () => 0;

/**
 * Drops a task from the memory (all tasks when left out), so its next open loads it again: after
 * a save, an attach or a file removal.
 * @param {number} [taskId]
 */
export function forgetTaskDetails(taskId) {
  if (taskId === undefined || taskId === null) memory.clear();
  else memory.delete(Number(taskId));
  round += 1;
  listeners.forEach((listener) => listener());
}

/** The state a new load starts from: the remembered task, else what the hook showed before. */
function startState(key, id, previous) {
  if (!id) return { key, id: null, status: 'idle', task: null, error: null };
  return { key, id, status: 'loading', task: memory.get(id) ?? previous ?? null, error: null };
}

/**
 * @param {number | null} taskId null loads nothing
 * @returns {{ task: object | null, loading: boolean, error: object | null,
 *   reload: () => void }} task: TaskDetails (`{ id, projectId, project: { …, pmId }, title,
 *   details, priority, status, phase, dueDate, assignee: { …, role, status } | null, createdBy,
 *   createdAt, doneAt, latestReport, updates, updateCount, minutes, privateLinkCount, files (own,
 *   then linked with `linked: true`), fileCount, canManage, canSeeFiles }`, CONTRACT 28), shown
 *   from memory while it loads again; error: the ApiError of a failed load (task null then)
 */
export function useTaskDetails(taskId) {
  const id = Number(taskId) > 0 ? Number(taskId) : null;
  const seen = useSyncExternalStore(subscribe, currentRound, serverRound);
  const [tries, setTries] = useState(0);
  const key = id ? `${id}:${seen}:${tries}` : null;
  const [state, setState] = useState(() => startState(key, id, null));
  let shown = state;
  if (state.key !== key) {
    shown = startState(key, id, state.id === id ? state.task : null);
    setState(shown);
  }
  const { status } = shown;

  useEffect(() => {
    if (!id || status !== 'loading') return undefined;
    const controller = new AbortController();
    api.get(`/api/project-tasks/${id}`, { signal: controller.signal }).then(
      ({ data }) => {
        remember(id, data);
        setState({ key, id, status: 'ready', task: data, error: null });
      },
      (error) => {
        if (error?.name === 'AbortError') return;
        memory.delete(id);
        setState({ key, id, status: 'error', task: null, error });
      },
    );
    return () => controller.abort();
  }, [id, key, status]);

  const reload = useCallback(() => setTries((count) => count + 1), []);
  const { task, error } = shown;
  return useMemo(
    () => ({ task, loading: status === 'loading', error, reload }),
    [task, status, error, reload],
  );
}
