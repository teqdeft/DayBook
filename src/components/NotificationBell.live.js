'use client';
// The bell with the live check (CONTRACT 26): it follows the live store when there is one (inside
// LiveNotifications): new rows join the loaded list, reads from a card or another tab show here,
// the count follows each answer, the summary card's "See them" opens the list, and the store
// learns where the bell is and whether its list is open (the actions tell it about each write and
// a delete waiting for its Undo). Without the store (the dev shell) nothing here runs and the bell
// is as in 1.10.
import { useEffect, useEffectEvent } from 'react';
import { now } from '@/lib/time';
import { onBellReload } from './NotificationBell.actions';
import { BELL_LIMIT, mergeLiveItems, setManyRead, storeUnread } from './NotificationBell.list';

/**
 * The id of the bell row that holds focus (the bell's root is the button's parent), else null.
 * @param {HTMLElement | null} button the bell button
 * @param {Document} [doc]
 */
export function focusedRowId(button, doc = typeof document === 'undefined' ? null : document) {
  const active = doc?.activeElement ?? null;
  if (!active || !button?.parentElement?.contains(active)) return null;
  const id = Number(active.closest?.('[data-notification-id]')?.dataset.notificationId);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * @param {{ live: object | null, buffer: ReturnType<import('./NotificationBell.list')
 *   .createLiveBuffer>, open: boolean, loaded: boolean, buttonRef: { current: HTMLElement | null },
 *   setItems: Function, setUnread: Function, pendingRef: { current: object | null },
 *   onOpenBell: () => void, reload: () => void }} options `buffer` holds live rows while one of
 *   the bell's loads is in flight; `onOpenBell` opens the list and focuses the button (the summary
 *   card's "See them").
 */
export function useBellLive({
  live,
  buffer,
  open,
  loaded,
  buttonRef,
  setItems,
  setUnread,
  pendingRef,
  onOpenBell,
  reload,
}) {
  const onEvent = useEffectEvent((event) => {
    const pending = pendingRef.current;
    if (event.kind === 'openBell') {
      onOpenBell();
      return;
    }
    if (event.kind === 'items') {
      buffer.hold(event.items);
      const keepId = focusedRowId(buttonRef.current);
      setItems((list) => mergeLiveItems(list, event.items, pending, BELL_LIMIT, keepId));
    } else if (event.kind === 'read' || event.kind === 'read-all') {
      const ids = event.kind === 'read' ? event.ids : 'all';
      const readAt = event.readAt ?? now().toISOString();
      buffer.read(ids, readAt);
      setItems((list) => setManyRead(list, ids, readAt));
    }
    // After every answer and every read the count is the store's (read when React applies it).
    setUnread((current) => storeUnread(live, pending, current));
  });
  const openFromStore = useEffectEvent(() => onOpenBell());
  const reloadIfLoaded = useEffectEvent(() => {
    if (loaded) reload();
  });

  useEffect(() => {
    if (!live) return undefined;
    return live.subscribe((event) => onEvent(event));
  }, [live]);

  useEffect(() => {
    if (!live) return undefined;
    return live.registerBell({ button: buttonRef.current, open: () => openFromStore() });
  }, [live, buttonRef]);

  useEffect(() => {
    live?.setBellOpen(open);
  }, [live, open]);

  // A card's save failed: the list (if loaded) reloads quietly.
  useEffect(() => onBellReload(() => reloadIfLoaded()), []);
}
