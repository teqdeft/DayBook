// The attach store without React (CONTRACT 27, Task files and "Dropping files on a card"): files
// added to a saved task from the task window ("Add files") or dropped on its card. A batch is
// every file added to one task while one of its files is still running; it is done when every
// file has finished, failed or been removed. A file that pauses counts as failed in a batch started
// by a card drop; in one started from the task window it holds the batch until Retry or Remove
// while that window is open (closing the window makes it failed). When the batch is done the store
// makes one attach call and tells the page (a toast, a refresh). No Undo: the person is told.
import * as messages from '@/modules/projectFiles/fileMessages';
import { plural } from '@/lib/text';
import { sendAttach } from './uploadAttach';
import { RUNNING } from './uploadItems';
import { createUploadSet } from './uploadSet';

/** "Simran Kaur is told." / "Everyone on the project is told." / nothing when nobody was. */
export function toldLine(told, toldName) {
  if (told === 'person' && toldName) return `${toldName} is told.`;
  if (told === 'members') return 'Everyone on the project is told.';
  return undefined;
}

/** The error toast of a batch's failed files: the first one's words, then how many more. */
export function failedToast(failed) {
  const [first] = failed;
  const title =
    first.state === 'paused' || !first.message ? messages.dropFailed(first.name) : first.message;
  const more = failed.length - 1;
  const body = more > 0 ? `${more} more ${plural(more, 'file')} couldn't be added.` : undefined;
  return { title, body, tone: 'error' };
}

/** The words of a refused attach call: the save's own field message names the file. */
function attachFailure(failure, items) {
  const name = items[0]?.name ?? 'This file';
  if (failure.code === 'NETWORK') return messages.dropFailed(name);
  const field = failure.fields?.uploadKeys;
  if (field) return field;
  return messages.forCode(failure.code, { name, message: failure.message ?? undefined });
}

/**
 * @param {{ settings?: { projectId: number, limits?: object },
 *   notify?: (toast: { title: string, body?: string, tone?: string }) => void,
 *   refresh?: (taskId: number) => void, send?: Function, io?: object, queue?: object,
 *   preview?: object }} options notify: the page's toast; refresh: after files were added;
 *   `configure` replaces settings, notify and refresh with the page's latest
 */
export function createAttachStore({ send = sendAttach, ...options }) {
  let page = {
    settings: options.settings ?? {},
    notify: options.notify ?? (() => {}),
    refresh: options.refresh ?? (() => {}),
  };
  const { io, queue, preview } = options;
  const setOptions = Object.fromEntries(
    Object.entries({ io, queue, preview }).filter(([, value]) => value !== undefined),
  );
  const notify = (toast) => page.notify(toast);
  const refresh = (taskId) => page.refresh(taskId);
  const batches = new Map(); // taskId -> its latest batch (new files join it unless it posts)
  const all = new Set(); // every batch not done yet, posting ones too
  const watchers = new Map(); // taskId -> open task windows
  const views = new WeakMap(); // batch -> batchFor's last answer, kept while nothing moved
  const listeners = new Set();
  let state = { version: 0, running: 0 };

  /** How many files are still on their way, for the leave question. */
  function running() {
    let count = 0;
    for (const batch of all) {
      count += batch.set.getSnapshot().items.filter((item) => RUNNING.includes(item.state)).length;
    }
    return count;
  }

  function bump() {
    state = { version: state.version + 1, running: running() };
    listeners.forEach((listener) => listener());
  }

  function newBatch(taskId) {
    const batch = { taskId, title: null, from: null, posting: false };
    batch.set = createUploadSet({
      ...setOptions,
      settings: { ...page.settings, target: 'task', taskId, autoStart: true },
    });
    batch.set.subscribe(() => {
      settle(batch);
      bump();
    });
    return batch;
  }

  function isOpen(taskId) {
    return (watchers.get(taskId) ?? 0) > 0;
  }

  async function post(batch, ready) {
    const uploadKeys = ready.map((item) => item.key);
    const answer = await send({ taskId: batch.taskId, uploadKeys, ...setOptions }).catch(() => ({
      ok: false,
      failure: { code: 'NETWORK', fields: {} },
    }));
    if (answer.ok) {
      const { told, toldName } = answer.data ?? {};
      const what = `${ready.length} ${plural(ready.length, 'file')} added to`;
      notify({ title: `${what} ${batch.title ?? 'the task'}.`, body: toldLine(told, toldName) });
      batch.set.forget();
      refresh(batch.taskId);
    } else {
      batch.set.cancelAll();
      notify({ title: attachFailure(answer.failure, ready), tone: 'error' });
    }
  }

  /** Ends the batch once nothing in it is running (see the file comment). */
  function settle(batch) {
    if (batch.posting) return;
    const { items } = batch.set.getSnapshot();
    const holdPaused = batch.from === 'window' && isOpen(batch.taskId);
    const waits = items.some(
      (item) => RUNNING.includes(item.state) || (holdPaused && item.state === 'paused'),
    );
    if (waits) return;
    if (!items.length) {
      end(batch);
      return;
    }
    batch.posting = true;
    const ready = items.filter((item) => item.state === 'done');
    const failed = items.filter((item) => item.state === 'error' || item.state === 'paused');
    failed
      .filter((item) => item.state === 'paused')
      .forEach((item) => batch.set.remove(item.id, { quiet: true }));
    if (failed.length) notify(failedToast(failed));
    const finish = ready.length ? post(batch, ready) : Promise.resolve();
    finish.finally(() => end(batch));
  }

  function end(batch) {
    batch.posting = false;
    batch.done = true;
    all.delete(batch);
    if (batches.get(batch.taskId) === batch) batches.delete(batch.taskId);
    bump();
  }

  /** The batch new files of this task join: not one that is already posting. */
  function current(taskId) {
    const batch = batches.get(taskId);
    return batch && !batch.posting && !batch.done ? batch : null;
  }

  return {
    /** The page's latest `{ settings, notify, refresh }` (the provider calls it after renders). */
    configure(next) {
      page = { ...page, ...next };
      for (const batch of all) {
        batch.set.configure({
          ...page.settings,
          target: 'task',
          taskId: batch.taskId,
          autoStart: true,
        });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** `{ version, running }`: a new object after every change. */
    getSnapshot: () => state,

    /**
     * Files for one saved task: the early checks, then the tab's queue.
     * @param {number} taskId
     * @param {FileList | File[]} fileList
     * @param {{ title?: string, from?: 'drop' | 'window', existing?: object[],
     *   fileCount?: number }} [options] title: the task's, for the toast; from: a card drop
     *   (the default) or the task window's "Add files"; existing: the task's files (names and
     *   sizes, for "already attached" and the 20); fileCount: their number when the names
     *   aren't known (a card)
     */
    add(taskId, fileList, { title, from = 'drop', existing, fileCount = 0 } = {}) {
      let batch = current(taskId);
      if (!batch) {
        batch = newBatch(taskId);
        batches.set(taskId, batch);
        all.add(batch);
      }
      batch.title = title ?? batch.title;
      batch.from = batch.from ?? from;
      const known = existing ?? Array.from({ length: fileCount }, () => ({ name: '', size: -1 }));
      const result = batch.set.add(fileList, { existing: known });
      result.notices.forEach((title) => notify({ title, tone: 'error' }));
      if (from === 'drop') {
        const failed = batch.set
          .getSnapshot()
          .items.filter((item) => result.ids.includes(item.id) && item.state === 'error');
        failed.forEach((item) => batch.set.remove(item.id, { quiet: true }));
        if (failed.length) notify(failedToast(failed));
      }
      settle(batch);
      bump();
      return result;
    },

    /**
     * The running batch of one task, for its card and its window, or null.
     * @returns {{ items: object[], busy: boolean, count: number, percent: number } | null}
     *   count: its files that haven't failed; percent: their average
     */
    batchFor(taskId) {
      const batch = batches.get(taskId);
      if (!batch || batch.done) return null;
      const { items } = batch.set.getSnapshot();
      const known = views.get(batch);
      if (known && known.items === items && known.posting === batch.posting) return known.view;
      const live = items.filter((item) => item.state !== 'error');
      const sum = live.reduce(
        (total, item) => total + (item.state === 'done' ? 100 : item.percent),
        0,
      );
      const view = {
        items,
        busy: batch.posting || live.some((item) => item.state !== 'done'),
        count: live.length,
        percent: live.length ? Math.round(sum / live.length) : 0,
      };
      views.set(batch, { items, posting: batch.posting, view });
      return view;
    },

    retry(taskId, id) {
      batches.get(taskId)?.set.retry(id);
    },

    remove(taskId, id) {
      batches.get(taskId)?.set.remove(id);
    },

    /** A task window is open on this task; the returned function says it closed. */
    watch(taskId) {
      watchers.set(taskId, (watchers.get(taskId) ?? 0) + 1);
      return () => {
        watchers.set(taskId, Math.max(0, (watchers.get(taskId) ?? 1) - 1));
        const batch = batches.get(taskId);
        if (batch) settle(batch);
        bump();
      };
    },

    /** The page goes: cancel every running and held upload with keepalive. */
    leave() {
      for (const batch of all) batch.set.leave();
    },
  };
}
