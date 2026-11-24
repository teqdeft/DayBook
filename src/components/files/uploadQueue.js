// The tab's upload queue (CONTRACT 27, Uploads, Browser side): at most 2 files go up at a time in
// one browser tab, the others wait ("Waiting…"). A job is started only when it leaves Waiting, so
// the tab never holds more than 2 running uploads and never reserves space on the server for files
// that are still waiting. Plain JS, no React: every useUploads and the attach store
// (TaskAttachProvider) share `sharedUploadQueue`.

/**
 * @typedef {{ start: () => Promise<unknown> }} QueueJob `start` runs the job's turn (Start, the
 *   pieces, Finish) and settles when it no longer needs its place: done, paused, failed or
 *   cancelled. A paused or failed job comes back through `add` (Retry).
 */

/**
 * @param {{ concurrency?: number }} [options]
 * @returns {{ add: (job: QueueJob) => boolean, remove: (job: QueueJob) => boolean,
 *   has: (job: QueueJob) => boolean, isRunning: (job: QueueJob) => boolean,
 *   readonly waiting: number, readonly running: number }}
 *   add: queues a job (false when it is already waiting or running); remove: takes a waiting
 *   job out of the line (false when it isn't waiting: a running job ends through its own
 *   cancel); has: waiting or running
 */
export function createUploadQueue({ concurrency = 2 } = {}) {
  const limit = Math.max(1, Math.floor(concurrency));
  /** @type {QueueJob[]} */
  const line = [];
  /** @type {Set<QueueJob>} */
  const active = new Set();

  function pump() {
    while (active.size < limit && line.length > 0) {
      const job = line.shift();
      active.add(job);
      let turn;
      try {
        turn = Promise.resolve(job.start());
      } catch (error) {
        turn = Promise.reject(error);
      }
      turn
        .catch(() => undefined)
        .finally(() => {
          active.delete(job);
          pump();
        });
    }
  }

  return {
    add(job) {
      if (!job || active.has(job) || line.includes(job)) return false;
      line.push(job);
      pump();
      return true;
    },
    remove(job) {
      const at = line.indexOf(job);
      if (at === -1) return false;
      line.splice(at, 1);
      return true;
    },
    has(job) {
      return active.has(job) || line.includes(job);
    },
    isRunning(job) {
      return active.has(job);
    },
    get waiting() {
      return line.length;
    },
    get running() {
      return active.size;
    },
  };
}

/** The one queue of this browser tab (2 files at a time). */
export const sharedUploadQueue = createUploadQueue({ concurrency: 2 });
