// Pure helpers for the bell's list (CONTRACT 20): read state, delete with Undo, and what a fresh
// load shows while a delete is still waiting for its toast to end. No React, no browser.

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
