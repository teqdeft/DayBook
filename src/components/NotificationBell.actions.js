// The bell's item actions (CONTRACT 20): opening an item marks it read at once and then follows
// its link; Mark as read / Mark as unread; Delete with a 5 s Undo toast whose end sends the
// DELETE (also sent at once when another delete replaces the toast, the bell goes away or the
// page is left). The 5 s stop while the pointer or focus is on the toast (hold). With the live
// store every write's answer goes to it (CONTRACT 26); the preview cards share followLink.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/apiClient';
import { now } from '@/lib/time';
import { useToast } from './ToastProvider';
import {
  hidePending,
  isInAppLink,
  isPlainClick,
  removeItem,
  restoreItem,
  setItemRead,
  undoResumeMs,
  unreadDelta,
} from './NotificationBell.list';

export const UNDO_MS = 5000;
// A click waits at most this long for "read" to be saved, so the next page already counts it.
export const SAVE_BEFORE_NAVIGATE_MS = 400;

export const itemPath = (id) => `/api/notifications/${id}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Follows an item's in-app link after a plain left click: waits up to SAVE_BEFORE_NAVIGATE_MS for
 * `saving` (it resolves to null or the error), then `router.push`; a slow save refreshes after.
 * Any other click (no in-app link, a modifier or middle button) is left to the browser. Shared
 * with the preview cards' Open (CONTRACT 26). Call it synchronously in the click handler.
 * @param {{ item: { link?: string | null }, event: { preventDefault: () => void },
 *   saving: Promise<unknown> | null, router: { push: Function, refresh: Function },
 *   onNavigate?: () => void }} options
 */
export async function followLink({ item, event, saving, router, onNavigate }) {
  if (!isInAppLink(item.link) || !isPlainClick(event)) return;
  event.preventDefault();
  const saved = saving
    ? await Promise.race([saving.then(() => true), wait(SAVE_BEFORE_NAVIGATE_MS)])
    : true;
  onNavigate?.();
  router.push(item.link);
  // Saving was slow: the new page may still count it as unread.
  if (!saved) saving.then((error) => !error && router.refresh());
}

// A preview card's save failed: the bell (if its list is loaded) reloads quietly (CONTRACT 26).
const reloadListeners = new Set();

/** Asks every mounted bell to reload its list quietly. */
export function requestBellReload() {
  for (const listener of reloadListeners) listener();
}

/** @returns {() => void} unsubscribe */
export function onBellReload(listener) {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}

/**
 * @param {{ items: any[] | null, setItems: Function, setUnread: Function,
 *   pendingRef: { current: { key: number, item: any, index: number } | null },
 *   onNavigate: () => void, reload: () => void, live?: object | null }} options `pendingRef` is
 *   shared with the bell's loads, which keep a pending delete hidden. `live` is the live store
 *   (CONTRACT 26), told about every write; null outside it (as in 1.10).
 */
export function useNotificationActions({
  items,
  setItems,
  setUnread,
  pendingRef,
  onNavigate,
  reload,
  live = null,
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(null);
  const timer = useRef(null);
  const endsAt = useRef(0); // when the running Undo toast ends
  const holds = useRef(new Set()); // 'pointer' | 'focus' while either is on the toast
  const nextKey = useRef(0);

  const changeRead = useCallback(
    (item, readAt) => {
      setItems((list) => setItemRead(list, item.id, readAt));
      const delta = unreadDelta(item.readAt, readAt);
      if (delta) setUnread((count) => Math.max(0, count + delta));
    },
    [setItems, setUnread],
  );

  /**
   * With the live store: a write's answer goes to the store (reads as `reportRead`), so the cards
   * and the other tabs follow, and its count shows here (a delete waiting for Undo doesn't count).
   */
  const tellLive = useCallback(
    (json, readIds) => {
      const count = json?.data?.unreadCount;
      if (!live || typeof count !== 'number') return;
      if (readIds) live.reportRead(readIds, json.data.item?.readAt ?? now().toISOString(), count);
      else live.setUnread(count);
      setUnread(hidePending({ items: [], unread: count }, pendingRef.current).unread);
    },
    [live, setUnread, pendingRef],
  );

  /** Shows the new state at once and saves it; puts the old state back when saving fails. */
  const saveRead = useCallback(
    async (item, read) => {
      const readAt = read ? now().toISOString() : null;
      changeRead(item, readAt);
      try {
        const json = await api.patch(itemPath(item.id), { read });
        tellLive(json, read ? [item.id] : null);
        return null;
      } catch (error) {
        changeRead({ ...item, readAt }, item.readAt ?? null);
        return error;
      }
    },
    [changeRead, tellLive],
  );

  const toggleRead = useCallback(
    async (item) => {
      const error = await saveRead(item, !item.readAt);
      if (!error) return;
      const title = item.readAt ? "Couldn't mark it as unread" : "Couldn't mark it as read";
      toast({ title, body: error.message, tone: 'error' });
    },
    [saveRead, toast],
  );

  // No link, or a new-tab click: the browser opens it and the list stays.
  const open = useCallback(
    (item, event) => {
      const saving = item.readAt ? null : saveRead(item, true);
      return followLink({ item, event, saving, router, onNavigate });
    },
    [saveRead, onNavigate, router],
  );

  const commit = useCallback(
    (entry) => {
      api.delete(itemPath(entry.item.id)).then(
        (json) => tellLive(json, null),
        (error) => {
          if (error.status === 404) return; // already gone
          toast({ title: "Couldn't delete the notification", body: error.message, tone: 'error' });
          reload();
        },
      );
    },
    [toast, reload, tellLive],
  );

  /** Ends the Undo toast: Undo puts the item back, otherwise the DELETE is sent now. */
  const settle = useCallback(
    (entry, { undo }) => {
      if (pendingRef.current?.key !== entry.key) return;
      clearTimeout(timer.current);
      holds.current.clear();
      pendingRef.current = null;
      setPending(null);
      if (!undo) {
        commit(entry);
        return;
      }
      setItems((list) => restoreItem(list, entry));
      if (!entry.item.readAt) setUnread((count) => count + 1);
      live?.reportHidden(entry.item.id, false);
    },
    [pendingRef, commit, setItems, setUnread, live],
  );

  /** (Re)starts the toast's countdown. */
  const countDown = useCallback(
    (entry, ms) => {
      clearTimeout(timer.current);
      endsAt.current = now().valueOf() + ms;
      timer.current = setTimeout(() => settle(entry, { undo: false }), ms);
    },
    [settle],
  );

  /**
   * Deletes an item behind a 5 s Undo toast. `keyboard`: the toast takes focus, and Tab or
   * Escape there go back to `returnFocus` (the row focus moved to).
   */
  const remove = useCallback(
    (item, { keyboard = false, returnFocus = null } = {}) => {
      const { removed } = removeItem(items, item.id);
      if (!removed) return;
      if (pendingRef.current) settle(pendingRef.current, { undo: false });
      setItems((list) => removeItem(list, item.id).items);
      if (!removed.item.readAt) setUnread((count) => Math.max(0, count - 1));
      nextKey.current += 1;
      const entry = { key: nextKey.current, ...removed, keyboard, returnFocus };
      pendingRef.current = entry;
      setPending(entry);
      live?.reportHidden(item.id, true); // no card or chime for it while Undo waits (CONTRACT 26)
      countDown(entry, UNDO_MS);
    },
    [items, pendingRef, settle, setItems, setUnread, countDown, live],
  );

  const undo = useCallback(() => {
    if (pendingRef.current) settle(pendingRef.current, { undo: true });
  }, [pendingRef, settle]);

  /** Ends the toast now: the DELETE is sent (Escape on the toast). */
  const dismiss = useCallback(() => {
    if (pendingRef.current) settle(pendingRef.current, { undo: false });
  }, [pendingRef, settle]);

  /** The pointer or focus came onto the toast (`on`) or left it: stop or restart the 5 s. */
  const hold = useCallback(
    (reason, on) => {
      const entry = pendingRef.current;
      if (!entry) return;
      const wasHeld = holds.current.size > 0;
      if (on) holds.current.add(reason);
      else holds.current.delete(reason);
      const held = holds.current.size > 0;
      if (held && !wasHeld) {
        clearTimeout(timer.current);
        entry.leftMs = endsAt.current - now().valueOf();
      } else if (!held && wasHeld) {
        countDown(entry, undoResumeMs(entry.leftMs));
      }
    },
    [pendingRef, countDown],
  );

  // Leaving the page (or this bell unmounting on navigation) ends the toast: delete now.
  useEffect(() => {
    const timers = timer;
    function flush() {
      const entry = pendingRef.current;
      if (!entry) return;
      clearTimeout(timers.current);
      pendingRef.current = null;
      fetch(itemPath(entry.item.id), {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => {});
    }
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [pendingRef]);

  return { pending, open, toggleRead, remove, undo, dismiss, hold };
}

/**
 * Focus around the bell's Undo toast: Undo pressed on the toast focuses the row that came back;
 * Tab, Shift+Tab or Escape on the toast go back to the row focus was on before it. Each falls
 * back to the list's top, then the bell.
 * @param {{ rootRef: { current: HTMLElement | null }, buttonRef: { current: HTMLElement | null },
 *   actions: ReturnType<typeof useNotificationActions> }} options
 * @returns {{ undo: () => void, leave: () => void }}
 */
export function useUndoFocus({ rootRef, buttonRef, actions }) {
  const focusList = useCallback(
    (target) => {
      const fallback = rootRef.current?.querySelector('[data-notification-fallback]');
      (target?.isConnected ? target : (fallback ?? buttonRef.current))?.focus();
    },
    [rootRef, buttonRef],
  );

  const undo = useCallback(() => {
    // Undo had focus and goes away with the toast: focus goes to the item that came back.
    const fromToast = document.activeElement?.closest?.('[data-notification-undo]');
    const id = actions.pending?.item.id;
    actions.undo();
    if (!fromToast) return;
    requestAnimationFrame(() => {
      const row = rootRef.current?.querySelector(`[data-notification-id="${id}"]`);
      focusList(row?.querySelector('a, button'));
    });
  }, [actions, rootRef, focusList]);

  const leave = useCallback(() => focusList(actions.pending?.returnFocus), [actions, focusList]);

  return { undo, leave };
}
