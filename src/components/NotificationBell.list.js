// Pure helpers for the bell's list (CONTRACT 20): read state, delete with Undo, what a fresh load
// shows while a delete is still waiting for its toast to end, the item's time, and the merge of
// the live check's rows (CONTRACT 26). No React, no browser.
import { dayjs, formatRelativeDay, formatTimeAmPm, workDate } from '@/lib/time';

/** The most rows the bell keeps, as its load asks for. */
export const BELL_LIMIT = 20;

/**
 * An item's time as the bell writes it ("Today at 9:41 AM", "Monday at 9:41 AM", "13 November at
 * 9:41 AM"), shared with the preview cards (CONTRACT 26); null without a `createdAt`.
 * @param {{ createdAt?: string | null }} item
 * @param {string} tz the company time zone
 * @param {string} today the company's date ('YYYY-MM-DD')
 * @returns {string | null}
 */
export function itemTime(item, tz, today) {
  if (!item?.createdAt) return null;
  const day = formatRelativeDay(workDate(tz, item.createdAt), today);
  return `${day} at ${formatTimeAmPm(item.createdAt, tz)}`;
}

/** In-app paths only ('//host' and '/\host' would leave the site). */
export function isInAppLink(link) {
  return typeof link === 'string' && /^\/(?![/\\])/.test(link);
}

/** A plain left click without modifier keys: the bell navigates itself (Next.js Link's rule). */
export function isPlainClick(event) {
  return (
    (event.button ?? 0) === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * How the unread count moves when an item's read time changes from `fromReadAt` to `toReadAt`.
 * @returns {-1 | 0 | 1}
 */
export function unreadDelta(fromReadAt, toReadAt) {
  return (toReadAt ? 0 : 1) - (fromReadAt ? 0 : 1);
}

/** The list with one item's `readAt` replaced (the same list when the item isn't there). */
export function setItemRead(items, id, readAt) {
  if (!items) return items;
  let changed = false;
  const next = items.map((item) => {
    if (item.id !== id || (item.readAt ?? null) === (readAt ?? null)) return item;
    changed = true;
    return { ...item, readAt };
  });
  return changed ? next : items;
}

/** The list without one item, and where it was (for Undo); `removed` is null when it isn't there. */
export function removeItem(items, id) {
  const index = (items ?? []).findIndex((item) => item.id === id);
  if (index === -1) return { items, removed: null };
  return {
    items: [...items.slice(0, index), ...items.slice(index + 1)],
    removed: { item: items[index], index },
  };
}

/** Undo: the item back at its old place (clamped), unless a load already brought it back. */
export function restoreItem(items, { item, index }) {
  const list = items ?? [];
  if (list.some((other) => other.id === item.id)) return list;
  const at = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** The Undo toast's time left after a pause, never less than this, so it can still be reached. */
export const UNDO_RESUME_MIN_MS = 2000;

/**
 * How long the Undo toast stays once the pointer or focus has left it: the time it had left,
 * but at least UNDO_RESUME_MIN_MS.
 * @param {number} leftMs time left when it was paused
 * @returns {number}
 */
export function undoResumeMs(leftMs) {
  return Math.max(UNDO_RESUME_MIN_MS, Number.isFinite(leftMs) ? leftMs : 0);
}

/**
 * A load from the server while a delete waits for its toast: the item stays hidden and, when it
 * was unread, it doesn't count.
 * @param {{ items: any[], unread: number }} result
 * @param {{ item: { id: number, readAt?: unknown } } | null} pending
 * @returns {{ items: any[], unread: number }}
 */
export function hidePending(result, pending) {
  if (!pending) return result;
  const items = result.items.filter((item) => item.id !== pending.item.id);
  const unread = Math.max(0, result.unread - (pending.item.readAt ? 0 : 1));
  return { items, unread };
}

/** The answer of the bell's load: `{ data: [...] }`, `{ data: { items|notifications: [...] } }`. */
export function readResponse(json) {
  const data = json?.data;
  const items = Array.isArray(data) ? data : (data?.items ?? data?.notifications ?? []);
  const count = json?.unreadCount ?? data?.unreadCount;
  const unread = typeof count === 'number' ? count : items.filter((n) => !n.readAt).length;
  return { items, unread };
}

const timeOf = (item) => (item.createdAt ? dayjs(item.createdAt).valueOf() || 0 : 0);

/** The list's order (and the server's): newest `createdAt` first, then the higher id. */
export function byNewest(a, b) {
  return timeOf(b) - timeOf(a) || b.id - a.id;
}

/**
 * The live check's rows added to the loaded list (CONTRACT 26): only rows it doesn't have, never
 * the one a delete keeps hidden, in the list's order, at most `limit`. The row holding keyboard
 * focus (`keepId`) stays even past the limit, so focus is never dropped to the page (it goes on
 * the next merge without focus, or the next load). The same list when nothing is added, and null
 * while the list isn't loaded.
 * @param {any[] | null} items the bell's list
 * @param {any[]} incoming rows of a live answer, newest first
 * @param {{ item: { id: number } } | null} pending a delete waiting for its Undo
 * @param {number} [limit]
 * @param {number | null} [keepId] the id of the row that has focus
 * @returns {any[] | null}
 */
export function mergeLiveItems(items, incoming, pending, limit = BELL_LIMIT, keepId = null) {
  if (!items) return items;
  const have = new Set(items.map((item) => item.id));
  if (pending) have.add(pending.item.id);
  const added = [];
  for (const item of incoming ?? []) {
    if (have.has(item.id)) continue;
    have.add(item.id);
    added.push(item);
  }
  if (added.length === 0) return items;
  const sorted = [...items, ...added].sort(byNewest);
  const kept = sorted.slice(0, limit);
  const focused = keepId == null ? -1 : sorted.findIndex((item) => item.id === keepId);
  return focused >= limit ? [...kept, sorted[focused]] : kept;
}

/** Rows read elsewhere (a card, another tab): unread ones get `readAt`; the same list otherwise. */
export function setManyRead(items, ids, readAt) {
  if (!items) return items;
  const wanted = ids === 'all' ? null : new Set(ids);
  let changed = false;
  const next = items.map((item) => {
    if (item.readAt || (wanted && !wanted.has(item.id))) return item;
    changed = true;
    return { ...item, readAt };
  });
  return changed ? next : items;
}

/** Whether a load's answer is for the store's person (always true without the store). */
export function sameUser(live, data) {
  return !live || (data?.userId != null && Number(data.userId) === Number(live.userId));
}

/**
 * The store's count as the bell shows it: a delete waiting for its Undo doesn't count (as for
 * `initialUnread`). `current` when the store has no count yet.
 */
export function storeUnread(live, pending, current) {
  const count = live?.unread;
  if (typeof count !== 'number') return current;
  return hidePending({ items: [], unread: count }, pending).unread;
}

/**
 * Keeps the live check's rows while one of the bell's loads is in flight: its answer may have
 * been read before they came, so they are merged when it ends (CONTRACT 26).
 */
export function createLiveBuffer() {
  let loads = 0;
  let held = [];
  return {
    started() {
      loads += 1;
    },
    /** Ends a load: its list (null when it failed) with the rows held meanwhile. */
    ended(items, pending) {
      loads = Math.max(0, loads - 1);
      const merged = mergeLiveItems(items, held, pending);
      if (loads === 0) held = [];
      return merged;
    },
    /** A live answer's rows, kept only while a load is in flight. */
    hold(rows) {
      if (loads > 0) held = [...held, ...(rows ?? [])];
    },
    /** A `read` (ids) or `read-all` ('all') for rows still held. */
    read(ids, readAt) {
      held = setManyRead(held, ids, readAt);
    },
    get held() {
      return held;
    },
  };
}
