// One uploader's files without React (CONTRACT 27, Uploads, Browser side): picked files pass the
// early checks, join the tab's shared queue (2 at a time, Start only when a file leaves Waiting)
// and end as a held key (task) or a project file. useUploads and the attach store
// (TaskAttachProvider) each hold sets; React reads them through `subscribe` and `getSnapshot`.
import * as messages from '@/modules/projectFiles/fileMessages';
import { createFileUpload } from './uploadClient';
import { sharedUploadQueue } from './uploadQueue';
import { canPreview, checkPicked, itemAfter, newItem, RUNNING } from './uploadItems';
import { cancelledAllText, percentMilestone, startedText, uploadedText } from './uploadAnnouncer';

export const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 500 * 1024 * 1024,
  maxTaskFiles: 20,
  pickMax: 50,
});

let lastId = 0;
const nextId = () => {
  lastId += 1;
  return `upload-${lastId}`;
};

const isHeld = (item, target) => target === 'task' && item.state === 'done';

/** The Start body of one file: a project file always carries its place and who sees it. */
function requestOf(settings, overrides = {}) {
  if (settings.target === 'project') {
    return {
      projectId: settings.projectId,
      target: 'project',
      phase: overrides.phase !== undefined ? overrides.phase : (settings.phase ?? null),
      visibility: overrides.visibility ?? settings.visibility,
    };
  }
  return { projectId: settings.projectId, target: 'task', taskId: settings.taskId ?? null };
}

/**
 * @param {{ settings?: { projectId: number, target: 'project' | 'task',
 *   taskId?: number | null, phase?: string | null, visibility?: string, limits?: object,
 *   autoStart?: boolean }, queue?: object, io?: object, makeUpload?: Function,
 *   preview?: { create: (file: File) => string, revoke: (url: string) => void } }} options
 *   settings: the first ones; `configure` gives the latest (read at every add and start)
 */
export function createUploadSet({
  settings: first = {},
  queue = sharedUploadQueue,
  io,
  makeUpload = createFileUpload,
  preview = {
    create: (file) => URL.createObjectURL(file),
    revoke: (url) => URL.revokeObjectURL(url),
  },
}) {
  let current = first;
  const settings = () => current;
  let items = [];
  let notices = [];
  let announcement = '';
  let snapshot = { items, notices, announcement };
  const entries = new Map(); // id -> { upload, job }
  const listeners = new Set();

  function changed() {
    snapshot = { items, notices, announcement };
    listeners.forEach((listener) => listener());
  }

  function say(text) {
    announcement = text;
  }

  function find(id) {
    return items.find((item) => item.id === id) ?? null;
  }

  function onSnapshot(id, snap) {
    const before = find(id);
    if (!before) return;
    const after = itemAfter(before, snap);
    items = after ? items.map((item) => (item.id === id ? after : item)) : without(id);
    if (after?.state === 'done' && before.state !== 'done') {
      const allDone = !items.some((item) => RUNNING.includes(item.state));
      say(uploadedText(after.name, allDone));
    } else if (after) {
      const step = percentMilestone(after, before.percent, after.percent);
      if (step) say(step);
    }
    changed();
  }

  function without(id) {
    const gone = find(id);
    if (gone?.previewUrl) preview.revoke(gone.previewUrl);
    return items.filter((item) => item.id !== id);
  }

  function queueItem(id, request) {
    const item = find(id);
    const upload = makeUpload({
      file: item.source,
      request,
      io,
      onChange: (snap) => onSnapshot(id, snap),
    });
    const job = { start: () => upload.run() };
    entries.set(id, { upload, job });
    queue.add(job);
  }

  /**
   * Picked or dropped files: the early checks, then (autoStart) the queue.
   * @param {ArrayLike<File>} fileList
   * @param {{ existing?: object[], phase?: string | null, visibility?: string }} [options]
   *   existing: files already on the task (the Edit window's kept ones), for "already
   *   attached" and the 20; phase, visibility: this pick's place and who sees it (Files tab)
   * @returns {{ added: number, failed: number, notices: string[], ids: string[] }}
   */
  function add(fileList, options = {}) {
    const now = settings();
    const limits = now.limits ?? DEFAULT_LIMITS;
    const kept = items.filter((item) => item.state !== 'error');
    const existing = [...(options.existing ?? []), ...kept];
    const task = now.target === 'task';
    const { results, notices: lines } = checkPicked(fileList, { existing, limits, task });
    const auto = now.autoStart !== false;
    const fresh = results.map(({ file, name, size, message }) => {
      const state = message ? 'error' : auto ? 'waiting' : 'ready';
      const item = newItem({ id: nextId(), file, name, size, state, message });
      if (!message && canPreview(file)) item.previewUrl = preview.create(file);
      return item;
    });
    items = [...items, ...fresh];
    notices = lines;
    const good = fresh.filter((item) => item.state !== 'error');
    if (auto) good.forEach((item) => queueItem(item.id, requestOf(now, options)));
    if (auto && good.length) say(startedText(good.length));
    changed();
    return {
      added: good.length,
      failed: fresh.length - good.length,
      notices: lines,
      ids: fresh.map((item) => item.id),
    };
  }

  /**
   * Sends every Ready file (the Files tab's "Upload 3 files"), with this place and who sees it.
   * @param {{ phase?: string | null, visibility?: string }} [overrides]
   * @returns {number} how many were queued
   */
  function start(overrides = {}) {
    const request = requestOf(settings(), overrides);
    const ready = items.filter((item) => item.state === 'ready');
    items = items.map((item) => (item.state === 'ready' ? { ...item, state: 'waiting' } : item));
    ready.forEach((item) => queueItem(item.id, request));
    if (ready.length) say(startedText(ready.length));
    changed();
    return ready.length;
  }

  /** Takes one file out of the queue and off the server (see `remove`); no announcement. */
  function stop(item, leaving) {
    const entry = entries.get(item.id);
    entries.delete(item.id);
    if (!entry) return;
    queue.remove(entry.job);
    entry.upload.cancel({ leaving }).catch(() => undefined);
  }

  /**
   * Takes a file out: a waiting one leaves the queue, a running one is aborted and cancelled,
   * a held one is cancelled on the server; a finished project file only leaves the list.
   * @param {string} id
   * @param {{ quiet?: boolean }} [options] quiet: no "Upload of brief.pdf cancelled."
   */
  function remove(id, { quiet = false } = {}) {
    const item = find(id);
    if (!item) return;
    stop(item, false);
    const stopped = RUNNING.includes(item.state) || item.state === 'paused';
    items = without(id);
    if (stopped && !quiet) say(messages.cancelled(item.name));
    changed();
  }

  /** Retry on a Paused file, or one stopped by a 401: Status first, nothing sent twice. */
  function retry(id) {
    const item = find(id);
    const entry = entries.get(id);
    if (!item || !entry || !(item.state === 'paused' || item.canRetry)) return;
    items = items.map((one) =>
      one.id === id ? { ...one, state: 'waiting', message: null, canRetry: false } : one,
    );
    queue.add(entry.job);
    changed();
  }

  /** Whether a file is still on its way or held on the server for a task. */
  function live(item) {
    return (
      RUNNING.includes(item.state) ||
      item.state === 'paused' ||
      item.state === 'ready' ||
      isHeld(item, settings().target)
    );
  }

  /**
   * Stops every file still on its way (and, for a task, every held one); failed files stay.
   * @returns {number} how many were stopped ("12 uploads cancelled")
   */
  function cancelAll() {
    const doomed = items.filter(live);
    doomed.forEach((item) => stop(item, false));
    doomed.forEach((item) => {
      items = without(item.id);
    });
    if (doomed.length) say(cancelledAllText(doomed.length));
    changed();
    return doomed.length;
  }

  /** After a save that attached the held files: they belong to the task now, so forget them. */
  function forget() {
    const { target } = settings();
    for (const item of items) {
      if (!isHeld(item, target) && live(item)) stop(item, false);
      if (item.previewUrl) preview.revoke(item.previewUrl);
    }
    entries.clear();
    items = [];
    notices = [];
    changed();
  }

  /** The page goes (pagehide) or the uploader unmounts: cancel with keepalive, no wait. */
  function leave() {
    items.filter(live).forEach((item) => stop(item, true));
  }

  /** Forget the line under the box (the next pick starts clean). */
  function clearNotices() {
    if (!notices.length) return;
    notices = [];
    changed();
  }

  return {
    /** The uploader's latest props (useUploads calls it after every render). */
    configure(next) {
      current = next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    add,
    start,
    remove,
    retry,
    cancelAll,
    forget,
    leave,
    clearNotices,
  };
}
