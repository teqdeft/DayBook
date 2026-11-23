// Batches of new notifications (CONTRACT 26): items within 1.5 s of the first form one batch;
// items read or hidden meanwhile leave it (and the queue); an empty batch never flushes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATCH_WINDOW_MS, createBatcher } from '@/components/live/liveBatch';

const item = (id) => ({ id, type: 'leave.marked', title: `N ${id}`, readAt: null });

describe('createBatcher', () => {
  let flushed;
  let batcher;

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
    batcher = createBatcher({
      onFlush: (batch) => flushed.push(batch),
      now: () => Date.now(),
    });
  });

  afterEach(() => {
    batcher.dispose();
    vi.useRealTimers();
  });

  const ids = (batch) => batch.items.map((n) => n.id);

  it('has a 1.5 s window', () => {
    expect(BATCH_WINDOW_MS).toBe(1500);
  });

  it('puts items within 1.5 s of the first one into one batch, without duplicates', () => {
    batcher.add([item(1)], { gapMs: 30_000, soundTabId: 'a', frontTabId: 'a' });
    vi.advanceTimersByTime(1000);
    batcher.add([item(2), item(1)], { gapMs: 200_000, soundTabId: 'b', frontTabId: null });
    vi.advanceTimersByTime(499);
    expect(flushed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(1);
    expect(ids(flushed[0])).toEqual([2, 1]);
    expect(flushed[0].gapMs).toBe(200_000); // the largest of its answers
    expect(flushed[0].soundTabId).toBe('b'); // the newest answer's
    expect(flushed[0].frontTabId).toBeNull();
  });

  it('starts the next batch with an item at 1.6 s', () => {
    batcher.add([item(1)]);
    vi.advanceTimersByTime(1600);
    batcher.add([item(2)]);
    vi.advanceTimersByTime(1500);
    expect(flushed.map(ids)).toEqual([[1], [2]]);
  });

  it('drops read and hidden items at flush', () => {
    batcher.add([item(1), item(2), item(3)]);
    batcher.read([2]);
    batcher.hide(3, true);
    vi.advanceTimersByTime(1500);
    expect(flushed.map(ids)).toEqual([[1]]);
  });

  it('keeps an item whose Undo brought it back', () => {
    batcher.hide(3, true);
    batcher.hide(3, false);
    batcher.add([item(3)]);
    vi.advanceTimersByTime(1500);
    expect(flushed.map(ids)).toEqual([[3]]);
  });

  it('drops every item learned before a read-all, in the batch and in the queue', () => {
    batcher.enqueue({ items: [item(1)] });
    batcher.add([item(2)]);
    batcher.readAll();
    batcher.add([item(3)]); // learned after it
    vi.advanceTimersByTime(1500);
    expect(flushed.map(ids)).toEqual([[3]]);
    expect(batcher.hasQueue()).toBe(false);
    expect(batcher.takeQueue()).toBeNull();
  });

  it('drops read items from the queue', () => {
    batcher.enqueue({ items: [item(1), item(2)] });
    batcher.read([1]);
    expect(batcher.takeQueue().items.map((n) => n.id)).toEqual([2]);
  });

  it('never flushes an empty batch', () => {
    batcher.add([]);
    batcher.add([item(1)]);
    batcher.read([1]);
    vi.advanceTimersByTime(5000);
    expect(flushed).toEqual([]);
  });

  it('counts the open batch and the queue as pending', () => {
    batcher.enqueue({ items: [item(1)] });
    batcher.add([item(2)]);
    expect([...batcher.pendingIds()].sort()).toEqual([1, 2]);
  });
});
