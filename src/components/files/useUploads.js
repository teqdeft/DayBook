'use client';
// One uploader's files (CONTRACT 27, Uploads, Browser side): the New task and Edit task windows
// (target 'task': held keys the save sends), the Files tab (target 'project': each file is added
// to the project when it finishes). Picked files pass the early checks, join the tab's shared
// queue and go up in pieces (uploadSet.js, uploadClient.js). Leaving the page (pagehide) or
// unmounting the uploader cancels its running and held uploads with keepalive.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createUploadSet } from './uploadSet';
import { RUNNING } from './uploadItems';

const EMPTY = Object.freeze({
  items: Object.freeze([]),
  notices: Object.freeze([]),
  announcement: '',
});

/**
 * @param {{ projectId: number, target: 'project' | 'task', taskId?: number | null,
 *   phase?: string | null, visibility?: 'everyone' | 'managers',
 *   limits: { maxFileBytes: number, maxTaskFiles: number, pickMax: number },
 *   autoStart?: boolean }} options autoStart: send as soon as picked (the Files tab's dialog
 *   keeps them Ready until `start()`)
 * @returns {{ items: object[], add: (fileList: FileList | File[], options?: { existing?:
 *   object[], phase?: string | null, visibility?: string }) => { added: number, failed: number,
 *   notices: string[], ids: string[] }, start: (overrides?: { phase?: string | null,
 *   visibility?: string }) => number, cancel: (id: string) => void, retry: (id: string) => void,
 *   remove: (id: string) => void, cancelAll: () => number, forget: () => void,
 *   clearNotices: () => void, busy: boolean, paused: boolean, unsaved: boolean,
 *   readyKeys: string[], doneFiles: object[], notices: string[], announcement: string,
 *   counts: { running: number, paused: number, failed: number, done: number } }}
 *   items: `{ id, name, size, ext, source, previewUrl, state: 'ready' | 'waiting' | 'uploading' |
 *   'retrying' | 'paused' | 'error' | 'done', percent, message, canRetry, key, file }`;
 *   cancel and remove: the same (cancel says "Upload of brief.pdf cancelled." for a running
 *   file); forget: after a save attached the held keys (no Cancel is sent for them); notices:
 *   the lines under the box; announcement: the text of the uploader's one polite region
 */
export function useUploads({
  projectId,
  target,
  taskId = null,
  phase = null,
  visibility,
  limits,
  autoStart = true,
}) {
  const [set] = useState(() =>
    createUploadSet({
      settings: { projectId, target, taskId, phase, visibility, limits, autoStart },
    }),
  );
  useEffect(() => {
    set.configure({ projectId, target, taskId, phase, visibility, limits, autoStart });
  });
  const snapshot = useSyncExternalStore(set.subscribe, set.getSnapshot, () => EMPTY);

  useEffect(() => {
    function onPageHide(event) {
      if (!event.persisted) set.leave();
    }
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      set.leave();
    };
  }, [set]);

  return useMemo(() => {
    const { items } = snapshot;
    const count = (states) => items.filter((item) => states.includes(item.state)).length;
    const running = count(RUNNING);
    const paused = count(['paused']);
    const done = items.filter((item) => item.state === 'done');
    const unsaved =
      target === 'task'
        ? items.some((item) => item.state !== 'error')
        : running > 0 || paused > 0 || count(['ready']) > 0;
    return {
      items,
      add: set.add,
      start: set.start,
      cancel: set.remove,
      retry: set.retry,
      remove: set.remove,
      cancelAll: set.cancelAll,
      forget: set.forget,
      clearNotices: set.clearNotices,
      busy: running > 0,
      paused: paused > 0,
      unsaved,
      readyKeys: target === 'task' ? done.map((item) => item.key).filter(Boolean) : [],
      doneFiles: target === 'project' ? done.map((item) => item.file).filter(Boolean) : [],
      notices: snapshot.notices,
      announcement: snapshot.announcement,
      counts: { running, paused, failed: count(['error']), done: done.length },
    };
  }, [snapshot, set, target]);
}
