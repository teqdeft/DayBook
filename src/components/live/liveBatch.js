// Batches of new notifications (CONTRACT 26): the items a tab learns about from the first one until
// 1.5 s later, from one or more answers, give at most one chime and at most one summary card. The
// batcher also holds the tab's queue (items whose cards wait behind a modal, an open list of
// suggestions or a paused stack). Items read or hidden meanwhile leave both. Pure, with injected
// timers and clock.
import { queueBatch, releaseQueue } from './liveRules';

export const BATCH_WINDOW_MS = 1500;

/**
 * @param {{ windowMs?: number, onFlush: (batch: { items: object[], more: boolean, gapMs: number,
 *   soundTabId: string | null, frontTabId: string | null }) => void, setTimer?: Function,
 *   clearTimer?: Function, now?: () => number }} options
 */
export function createBatcher({
  windowMs = BATCH_WINDOW_MS,
  onFlush,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => 0,
}) {
  let open = null; // { items: Map<id, item>, more, gapMs, soundTabId, frontTabId }
  let timer = null;
  let queue = [];
  const hidden = new Set();

  function flush() {
    timer = null;
    const batch = open;
    open = null;
    if (!batch) return;
    const items = [...batch.items.values()].filter((item) => !hidden.has(item.id));
    if (items.length === 0) return;
    items.sort((a, b) => b.id - a.id);
    onFlush({ ...batch, items });
  }

  return {
    /**
     * New items of one answer. `meta` is the answer's: its gap, `more`, and the result's
     * `soundTabId` / `frontTabId` (the newest answer's win).
     */
    add(items, { gapMs = 0, more = false, soundTabId = null, frontTabId = null } = {}) {
      const fresh = (items ?? []).filter((item) => !hidden.has(item.id));
      if (fresh.length === 0) return;
      if (!open) {
        open = { items: new Map(), more: false, gapMs: 0, soundTabId, frontTabId };
        timer = setTimer(flush, windowMs);
      }
      for (const item of fresh) open.items.set(item.id, item);
      open.more = open.more || more;
      open.gapMs = Math.max(open.gapMs, gapMs);
      open.soundTabId = soundTabId;
      open.frontTabId = frontTabId;
    },
    /** Items marked read (here or in another tab): out of the open batch and the queue. */
    read(ids) {
      const gone = new Set((ids ?? []).map(Number));
      if (open) for (const id of gone) open.items.delete(id);
      queue = queue.filter((entry) => !gone.has(entry.item.id));
    },
    /** Mark all as read: every item learned before it leaves the open batch and the queue. */
    readAll() {
      if (open) open.items.clear();
      queue = [];
    },
    /** A delete waiting for its Undo hides an item (dropped at flush); Undo shows it again. */
    hide(id, on) {
      if (on) hidden.add(id);
      else hidden.delete(id);
      if (on) queue = queue.filter((entry) => entry.item.id !== id);
    },
    /** A flushed batch whose cards must wait. */
    enqueue(batch) {
      queue = queueBatch(queue, batch, now());
    },
    hasQueue() {
      return queue.length > 0;
    },
    /** Everything queued as one batch (5 minutes at most by the tab's clock), or null. */
    takeQueue() {
      const batch = releaseQueue(
        queue.filter((entry) => !hidden.has(entry.item.id)),
        now(),
      );
      queue = [];
      return batch;
    },
    /** Ids in the open batch and the queue (the service worker's answer counts them). */
    pendingIds() {
      const ids = new Set(queue.map((entry) => entry.item.id));
      if (open) for (const id of open.items.keys()) ids.add(id);
      return ids;
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      open = null;
      queue = [];
    },
  };
}
