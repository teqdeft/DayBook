// The bell's notification center (CONTRACT 20): list helpers behind mark read / unread, delete
// with Undo and loads during a pending delete, and the numbers behind swipe to delete. With the
// live check (CONTRACT 26): the merge of new rows into the list, the item's time shared with the
// preview cards, the bell's own icon at the cards' size and the ids "Mark these as read" sends.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BellIcon } from '@/components/NotificationBell';
import {
  BELL_LIMIT,
  byNewest,
  createLiveBuffer,
  hidePending,
  isInAppLink,
  isPlainClick,
  itemTime,
  mergeLiveItems,
  readResponse,
  removeItem,
  restoreItem,
  sameUser,
  setItemRead,
  setManyRead,
  storeUnread,
  UNDO_RESUME_MIN_MS,
  undoResumeMs,
  unreadDelta,
} from '@/components/NotificationBell.list';
import { MARK_MANY_MAX, newestIds } from '@/components/live/usePreviewActions';
import { focusedRowId } from '@/components/NotificationBell.live';
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

// Rows as the API sends them: newest first, `createdAt` as ISO strings.
const row = (id, minute, readAt = null) => ({
  id,
  title: `Item ${id}`,
  readAt,
  createdAt: `2026-11-23T04:${String(minute).padStart(2, '0')}:00.000Z`,
});
const ids = (items) => items.map((item) => item.id);

describe('live rows in the bell (CONTRACT 26)', () => {
  it('adds only the rows the list does not have, newest first', () => {
    const list = [row(5, 40), row(4, 30), row(2, 10)];
    const merged = mergeLiveItems(list, [row(7, 50), row(5, 40), row(6, 45), row(7, 50)], null);
    expect(ids(merged)).toEqual([7, 6, 5, 4, 2]);
    expect(merged[2]).toBe(list[0]); // a row it already had keeps the list's own copy
    expect(mergeLiveItems(list, [row(4, 30)], null)).toBe(list);
    expect(mergeLiveItems(list, [], null)).toBe(list);
  });

  it('never brings back the row a delete keeps hidden for its Undo', () => {
    const pending = { item: row(6, 45), index: 0 };
    const merged = mergeLiveItems([row(5, 40)], [row(7, 50), row(6, 45)], pending);
    expect(ids(merged)).toEqual([7, 5]);
  });

  it('sorts as the list does: createdAt, then the higher id', () => {
    const same = [row(3, 20), row(9, 20), row(4, 25)];
    expect(ids([...same].sort(byNewest))).toEqual([4, 9, 3]);
    const merged = mergeLiveItems([row(8, 10)], [row(10, 5), row(9, 30)], null);
    expect(ids(merged)).toEqual([9, 8, 10]);
  });

  it('keeps the newest 20', () => {
    expect(BELL_LIMIT).toBe(20);
    const list = Array.from({ length: 20 }, (_, i) => row(20 - i, 20 - i));
    const merged = mergeLiveItems(list, [row(22, 40), row(21, 35)], null);
    expect(merged).toHaveLength(20);
    expect(ids(merged).slice(0, 3)).toEqual([22, 21, 20]);
    expect(ids(merged).at(-1)).toBe(3);
  });

  it('keeps the row that holds keyboard focus, even past 20 (focus never drops to the page)', () => {
    const list = Array.from({ length: 20 }, (_, i) => row(20 - i, 20 - i));
    const merged = mergeLiveItems(list, [row(21, 35)], null, BELL_LIMIT, 1);
    expect(merged).toHaveLength(21);
    expect(ids(merged).slice(0, 2)).toEqual([21, 20]);
    expect(merged.at(-1)).toBe(list.at(-1)); // the focused row, the list's own copy
    const later = mergeLiveItems(merged, [row(22, 40)], null, BELL_LIMIT, null); // focus moved
    expect(later).toHaveLength(20);
    expect(ids(mergeLiveItems(list, [row(21, 35)], null, BELL_LIMIT, 5))).toHaveLength(20);
  });

  it('finds the focused row of this bell only', () => {
    const rowOf = (id) => ({ dataset: { notificationId: String(id) } });
    const link = { closest: () => rowOf(17) };
    const root = { contains: (element) => element === link };
    const button = { parentElement: root };
    expect(focusedRowId(button, { activeElement: link })).toBe(17);
    expect(focusedRowId(button, { activeElement: { closest: () => rowOf(3) } })).toBeNull();
    expect(focusedRowId(button, { activeElement: null })).toBeNull();
    expect(focusedRowId(null, { activeElement: link })).toBeNull();
  });

  it('waits while the list is not loaded (the next load brings the rows)', () => {
    expect(mergeLiveItems(null, [row(1, 1)], null)).toBeNull();
  });

  it('merges rows that came during the first load once it ends', () => {
    const buffer = createLiveBuffer();
    buffer.hold([row(1, 1)]); // no load in flight: nothing to keep
    expect(buffer.held).toEqual([]);
    buffer.started();
    buffer.hold([row(9, 50)]);
    buffer.hold([row(10, 55), row(9, 50)]);
    const loaded = [row(8, 45), row(7, 40)];
    expect(ids(buffer.ended(loaded, null))).toEqual([10, 9, 8, 7]);
    expect(buffer.held).toEqual([]);
  });

  it('keeps held rows until every load in flight ends, and read ones stay read', () => {
    const buffer = createLiveBuffer();
    buffer.started();
    buffer.started();
    buffer.hold([row(9, 50), row(10, 55)]);
    buffer.read([9], READ);
    expect(buffer.ended(null, null)).toBeNull(); // the first load failed
    const merged = buffer.ended([row(8, 45)], { item: row(10, 55), index: 0 });
    expect(ids(merged)).toEqual([9, 8]);
    expect(merged[0].readAt).toBe(READ);
    expect(buffer.held).toEqual([]);
  });

  it('a read elsewhere marks rows read and keeps the first read time', () => {
    const items = [row(3, 30), row(2, 20, '2026-11-23T04:25:00.000Z'), row(1, 10)];
    const read = setManyRead(items, [3, 2], READ);
    expect(read.map((item) => item.readAt)).toEqual([READ, items[1].readAt, null]);
    expect(read[1]).toBe(items[1]);
    expect(setManyRead(items, [99], READ)).toBe(items);
    expect(setManyRead(items, 'all', READ).every((item) => item.readAt)).toBe(true);
    expect(setManyRead(null, 'all', READ)).toBeNull();
  });

  it("drops a load for someone else, and shows the store's count without a pending delete", () => {
    const live = { userId: 7, unread: 4 };
    expect(sameUser(null, {})).toBe(true);
    expect(sameUser(live, { userId: 7 })).toBe(true);
    expect(sameUser(live, { userId: 8 })).toBe(false);
    expect(sameUser(live, { items: [] })).toBe(false);
    expect(sameUser(live, null)).toBe(false);
    expect(storeUnread(live, null, 1)).toBe(4);
    expect(storeUnread(live, { item: { id: 3, readAt: null } }, 1)).toBe(3);
    expect(storeUnread(live, { item: { id: 3, readAt: READ } }, 1)).toBe(4);
    expect(storeUnread({ userId: 7, unread: null }, null, 2)).toBe(2);
  });

  it('reads the load answer with or without the live fields', () => {
    const items = [row(2, 20), row(1, 10, READ)];
    expect(readResponse({ data: { items, unreadCount: 5, latestId: 2, userId: 7 } })).toEqual({
      items,
      unread: 5,
    });
    expect(readResponse({ data: items })).toEqual({ items, unread: 1 });
    expect(readResponse({ data: null })).toEqual({ items: [], unread: 0 });
  });
});

describe('the time on a bell item and a preview card', () => {
  const tz = 'Asia/Kolkata';
  const today = '2026-11-25'; // a Wednesday

  it('writes the day as the bell does', () => {
    expect(itemTime({ createdAt: '2026-11-25T04:11:00.000Z' }, tz, today)).toBe('Today at 9:41 AM');
    expect(itemTime({ createdAt: '2026-11-24T12:35:00.000Z' }, tz, today)).toBe(
      'Yesterday at 6:05 PM',
    );
    expect(itemTime({ createdAt: '2026-11-23T04:11:00.000Z' }, tz, today)).toBe(
      'Monday at 9:41 AM',
    );
    expect(itemTime({ createdAt: '2026-11-13T04:11:00.000Z' }, tz, today)).toBe(
      '13 November at 9:41 AM',
    );
  });

  it("uses the company's time zone, and has no time without createdAt", () => {
    expect(itemTime({ createdAt: '2026-11-24T19:00:00.000Z' }, tz, today)).toBe(
      'Today at 12:30 AM',
    );
    expect(itemTime({ createdAt: null }, tz, today)).toBeNull();
    expect(itemTime({}, tz, today)).toBeNull();
  });
});

describe("the bell's own icon and the cards' ids", () => {
  it('draws at 20 px in the bell and at any size asked', () => {
    const bell = renderToStaticMarkup(createElement(BellIcon));
    expect(bell).toContain('width="20"');
    expect(bell).toContain('height="20"');
    expect(bell).toContain('viewBox="0 0 20 20"');
    expect(bell).toContain('aria-hidden="true"');
    const card = renderToStaticMarkup(createElement(BellIcon, { size: 18 }));
    expect(card).toContain('width="18"');
    expect(card).toContain('height="18"');
  });

  it('sends at most the newest 50 distinct ids to Mark these as read', () => {
    expect(MARK_MANY_MAX).toBe(50);
    expect(newestIds([3, 9, 3, 5])).toEqual([9, 5, 3]);
    const many = Array.from({ length: 60 }, (_, i) => i + 1);
    const picked = newestIds(many);
    expect(picked).toHaveLength(50);
    expect(picked[0]).toBe(60);
    expect(picked.at(-1)).toBe(11);
    expect(newestIds(null)).toEqual([]);
    expect(newestIds([0, -2, 'x'])).toEqual([]);
  });
});
