// The bell's notification center (CONTRACT 20): list helpers behind mark read / unread, delete
// with Undo and loads during a pending delete, and the numbers behind swipe to delete.
import { describe, expect, it } from 'vitest';
import {
  hidePending,
  isInAppLink,
  isPlainClick,
  removeItem,
  restoreItem,
  setItemRead,
  UNDO_RESUME_MIN_MS,
  undoResumeMs,
  unreadDelta,
} from '@/components/NotificationBell.list';
import {
  MIN_SWIPE,
  SWIPE_SLOP,
  swipeDeletes,
  swipeIntent,
  swipeOffset,
  swipeThreshold,
} from '@/components/NotificationBell.swipe';

const READ = '2026-09-30T05:00:00.000Z';
const list = () => [
  { id: 3, title: 'Third', readAt: null },
  { id: 2, title: 'Second', readAt: READ },
  { id: 1, title: 'First', readAt: null },
];

describe('links and clicks', () => {
  it('follows in-app paths only', () => {
    expect(isInAppLink('/today')).toBe(true);
    expect(isInAppLink('/report?date=2026-09-29')).toBe(true);
    expect(isInAppLink('//evil.example/x')).toBe(false);
    expect(isInAppLink('/\\evil.example')).toBe(false);
    expect(isInAppLink('https://evil.example')).toBe(false);
    expect(isInAppLink(null)).toBe(false);
  });

  it('navigates itself only on a plain left click (new-tab clicks stay with the browser)', () => {
    expect(isPlainClick({ button: 0 })).toBe(true);
    expect(isPlainClick({ button: 1 })).toBe(false);
    expect(isPlainClick({ button: 0, metaKey: true })).toBe(false);
    expect(isPlainClick({ button: 0, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ button: 0, shiftKey: true })).toBe(false);
    expect(isPlainClick({ button: 0, altKey: true })).toBe(false);
  });
});

describe('read and unread', () => {
  it('moves the unread count only when the state changes', () => {
    expect(unreadDelta(null, READ)).toBe(-1);
    expect(unreadDelta(READ, null)).toBe(1);
    expect(unreadDelta(READ, '2026-09-30T06:00:00.000Z')).toBe(0);
    expect(unreadDelta(null, null)).toBe(0);
  });

  it('changes one item and keeps the list when nothing changes', () => {
    const items = list();
    const read = setItemRead(items, 3, READ);
    expect(read).not.toBe(items);
    expect(read[0]).toEqual({ id: 3, title: 'Third', readAt: READ });
    expect(read[1]).toBe(items[1]);
    expect(setItemRead(items, 2, READ)).toBe(items);
    expect(setItemRead(items, 99, READ)).toBe(items);
    expect(setItemRead(null, 3, READ)).toBeNull();
    expect(setItemRead(items, 2, null)[1].readAt).toBeNull();
  });
});

describe('delete with Undo', () => {
  it('removes an item and remembers where it was', () => {
    const items = list();
    const { items: rest, removed } = removeItem(items, 2);
    expect(rest.map((item) => item.id)).toEqual([3, 1]);
    expect(removed).toEqual({ item: items[1], index: 1 });
    expect(removeItem(items, 99)).toEqual({ items, removed: null });
    expect(removeItem(null, 1).removed).toBeNull();
  });

  it('Undo puts it back in its place, once', () => {
    const { items: rest, removed } = removeItem(list(), 2);
    const back = restoreItem(rest, removed);
    expect(back.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(restoreItem(back, removed)).toBe(back);
    expect(restoreItem([], { item: removed.item, index: 5 })).toEqual([removed.item]);
    expect(restoreItem(null, removed)).toEqual([removed.item]);
  });

  it('after the pointer or focus leaves the toast it keeps its time, at least 2 s', () => {
    expect(UNDO_RESUME_MIN_MS).toBe(2000);
    expect(undoResumeMs(3500)).toBe(3500);
    expect(undoResumeMs(300)).toBe(2000);
    expect(undoResumeMs(-40)).toBe(2000);
    expect(undoResumeMs(undefined)).toBe(2000);
  });

  it('a load during the toast keeps the item hidden and out of the count', () => {
    const result = { items: list(), unread: 2 };
    expect(hidePending(result, null)).toBe(result);
    const unread = hidePending(result, { item: { id: 3, readAt: null } });
    expect(unread).toEqual({ items: [result.items[1], result.items[2]], unread: 1 });
    const read = hidePending(result, { item: { id: 2, readAt: READ } });
    expect(read.unread).toBe(2);
    expect(read.items.map((item) => item.id)).toEqual([3, 1]);
    expect(hidePending({ items: [], unread: 0 }, { item: { id: 9, readAt: null } }).unread).toBe(0);
  });
});

describe('swipe to delete', () => {
  it('waits for the finger to move, then tells a sideways swipe from a scroll', () => {
    expect(swipeIntent({ dx: -SWIPE_SLOP + 1, dy: 3 })).toBeNull();
    expect(swipeIntent({ dx: -24, dy: 6 })).toBe('swipe');
    expect(swipeIntent({ dx: 30, dy: 4 })).toBe('swipe');
    expect(swipeIntent({ dx: -8, dy: 20 })).toBe('scroll');
    expect(swipeIntent({ dx: 12, dy: -12 })).toBe('scroll');
  });

  it('follows the finger to the left only', () => {
    expect(swipeOffset(-42.4)).toBe(-42);
    expect(swipeOffset(0)).toBe(0);
    expect(swipeOffset(35)).toBe(0);
  });

  it('deletes past 35% of the row (at least 80 px) and snaps back below it', () => {
    expect(swipeThreshold(343)).toBeCloseTo(120.05);
    expect(swipeThreshold(150)).toBe(MIN_SWIPE);
    expect(swipeThreshold(undefined)).toBe(MIN_SWIPE);
    expect(swipeDeletes({ offset: -121, width: 343 })).toBe(true);
    expect(swipeDeletes({ offset: -119, width: 343 })).toBe(false);
    expect(swipeDeletes({ offset: -80, width: 150 })).toBe(true);
    expect(swipeDeletes({ offset: 0, width: 343 })).toBe(false);
  });
});
