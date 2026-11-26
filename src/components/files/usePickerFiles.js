'use client';
// The "From project files" picker's data (CONTRACT 28, "From project files" picker): the project's
// Files tab files as `GET /api/projects/[id]/files?taskId=<id>` answers them (managers only; no
// `taskId` for a task not saved yet), loaded each time the picker opens, never kept, so a file
// added or deleted in Files meanwhile shows. `state` is 'loading' (three skeleton rows), 'ready',
// 'error' ("Couldn't load the project's files." with Try again) or 'update' (before migration 020:
// "This needs the latest database update. Ask an Admin.", also for the route's UPDATE_NEEDED
// before 019).
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';

const EMPTY = { files: [], places: [], taskPhase: null };

/** The picker route's path for a project and, when saved, a task. */
export function pickerPath(projectId, taskId = null) {
  const base = `/api/projects/${projectId}/files`;
  return Number(taskId) > 0 ? `${base}?taskId=${Number(taskId)}` : base;
}

/**
 * The state an answer (or a failure) gives.
 * @param {{ data?: object } | null} answer
 * @param {object | null} [failure] an ApiError
 */
export function pickerState(answer, failure = null) {
  if (failure) {
    const state = failure.code === 'UPDATE_NEEDED' ? 'update' : 'error';
    return { state, ...EMPTY, message: failure.message ?? '' };
  }
  const data = answer?.data ?? {};
  if (data.linksReady === false) return { state: 'update', ...EMPTY, message: '' };
  return {
    state: 'ready',
    files: data.files ?? [],
    places: data.places ?? [],
    taskPhase: data.taskPhase ?? null,
    message: '',
  };
}

/**
 * @param {{ projectId: number, taskId?: number | null, open: boolean }} args
 * @returns {{ state: 'loading' | 'ready' | 'error' | 'update', files: object[],
 *   places: Array<{ key: string, label: string, count: number }>, taskPhase: string | null,
 *   reload: () => void }}
 */
export function usePickerFiles({ projectId, taskId = null, open }) {
  const [tries, setTries] = useState(0);
  const key = open ? `${projectId}:${taskId ?? ''}:${tries}` : null;
  // The answer of the load named by `key`; an older one (or none yet) reads as loading.
  const [shown, setShown] = useState({ key: null, state: 'loading', ...EMPTY });

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    api.get(pickerPath(projectId, taskId), { signal: controller.signal }).then(
      (answer) => setShown({ key, ...pickerState(answer) }),
      (failure) => {
        if (failure?.name !== 'AbortError') setShown({ key, ...pickerState(null, failure) });
      },
    );
    return () => controller.abort();
  }, [key, projectId, taskId]);

  const reload = useCallback(() => setTries((count) => count + 1), []);
  const current = shown.key === key ? shown : { state: 'loading', ...EMPTY };
  return {
    state: current.state,
    files: current.files,
    places: current.places,
    taskPhase: current.taskPhase,
    reload,
  };
}
