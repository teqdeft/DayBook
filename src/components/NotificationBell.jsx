'use client';
// The bell in the top bar: a red dot when something is unread, and a gentle swing about every 6 s
// while it is (once at once when the count goes up), unless the person turned the swing off in My
// settings (`bellRing`, CONTRACT 21; read from UserPrefs). It opens the latest 20 notifications with
// "Mark all as read"; each item marks itself read and opens its screen, and can be marked read or
// unread and deleted with Undo (NotificationItem, CONTRACT 20). The dropdown ends with "Show on
// this computer" (desktop notifications for this browser, CONTRACT 14). Inside LiveNotifications
// it follows the live check (NotificationBell.live, CONTRACT 26); without it, it is as in 1.10.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/apiClient';
import { now, workDate } from '@/lib/time';
import { useLiveNotifications } from './live/LiveNotifications';
import { useNotificationActions, useUndoFocus } from './NotificationBell.actions';
import {
  BELL_LIMIT,
  createLiveBuffer,
  hidePending,
  readResponse,
  sameUser,
} from './NotificationBell.list';
import { useBellLive } from './NotificationBell.live';
import { bellSwing } from './NotificationBell.ring';
import NotificationList from './NotificationList';
import NotificationUndo from './NotificationUndo';
import PushSwitch, { useDesktopPush } from './PushSwitch';
import { useToast } from './ToastProvider';
import { useBellRing } from './UserPrefs';
import styles from './NotificationBell.module.css';

const SWING_CLASS = { now: styles.ringNow, later: styles.ringLater };

const REFRESH_AFTER_MS = 60_000;

/**
 * The canvas draws its own bell (straight sides, flat base, a round clapper), not lucide's; traced
 * from the artboards at 1 unit = 1 CSS px and drawn the lucide way (currentColor, round joins).
 * Also the preview cards' icon for system notifications, at 18 px (CONTRACT 26).
 * @param {{ size?: number }} props
 */
export function BellIcon({ size = 20 }) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 9.08a5 5 0 0 1 10 0v3.22c0 1.25.6 2.05 1.6 2.45H3.4C4.4 14.35 5 13.55 5 12.3Z" />
      <path d="M8.33 15.6v1a1.67 1.67 0 0 0 3.34 0v-1" />
    </svg>
  );
}

/**
 * @param {{ initialUnread?: number, tz?: string,
 *   push?: { publicKey: string, userId: number } | null }} props
 *   `tz` is the company time zone for the item times. `push` turns on "Show on this computer"
 *   (null while desktop notifications are off for the company or have no keys).
 */
export default function NotificationBell({ initialUnread = 0, tz = 'Asia/Kolkata', push = null }) {
  const router = useRouter();
  const toast = useToast();
  const live = useLiveNotifications();
  const desktop = useDesktopPush(push);
  const ringEnabled = useBellRing();
  const [buffer] = useState(createLiveBuffer);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | error
  const [unread, setUnread] = useState(initialUnread);
  const [marking, setMarking] = useState(false);
  // The swing: a new `key` restarts it (one swing at once); `now` starts each cycle with a swing.
  const [ring, setRing] = useState({ key: 0, now: false });
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const lastLoad = useRef(0);
  const pendingRef = useRef(null); // a delete still waiting for its Undo toast to end
  const openRef = useRef(false); // the list is open (set at once on opening, for the live store)
  const panelId = useId();
  const titleId = useId();

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setStatus('loading');
      buffer.started();
      const json = await api.get('/api/notifications?limit=20').catch(() => null);
      // With the live store, an answer for someone else (signed in in another tab) shows nothing.
      if (!json || !sameUser(live, json.data)) {
        buffer.ended(null);
        if (!quiet) setStatus('error');
        return;
      }
      const result = hidePending(readResponse(json), pendingRef.current);
      lastLoad.current = now().valueOf();
      setItems(buffer.ended(result.items.slice(0, BELL_LIMIT), pendingRef.current));
      setUnread(result.unread);
      setStatus('idle');
      // Rows the person just saw in the open list never get a card or a chime later.
      const latestId = json.data?.latestId;
      if (live && openRef.current && Number.isFinite(latestId)) live.markSeen(latestId);
    },
    [buffer, live],
  );
  const reload = useCallback(() => load({ quiet: true }), [load]);

  const close = useCallback(({ focus = true } = {}) => {
    setOpen(false);
    if (focus) buttonRef.current?.focus();
  }, []);
  const onNavigate = useCallback(() => close({ focus: false }), [close]);

  const actions = useNotificationActions({
    items,
    setItems,
    setUnread,
    pendingRef,
    onNavigate,
    reload,
    live,
  });
  const undoFocus = useUndoFocus({ rootRef, buttonRef, actions });
  useBellLive({
    live,
    buffer,
    open,
    loaded: items !== null,
    buttonRef,
    setItems,
    setUnread,
    pendingRef,
    onOpenBell: openList,
    reload,
  });

  // The server's count from the last render: after router.refresh() it takes over, without
  // remounting the bell (a remount closed the open list and dropped keyboard focus).
  const [serverUnread, setServerUnread] = useState(initialUnread);
  if (serverUnread !== initialUnread) {
    setServerUnread(initialUnread);
    setUnread(hidePending({ items: [], unread: initialUnread }, actions.pending).unread);
  }

  // A higher count while the list is closed swings the bell at once.
  const [seenUnread, setSeenUnread] = useState(unread);
  if (seenUnread !== unread) {
    setSeenUnread(unread);
    if (unread > seenUnread && !open) setRing((r) => ({ key: r.key + 1, now: true }));
  }
  const swing = bellSwing({ enabled: ringEnabled, unread, open, now: ring.now });
  const ringClass = swing ? SWING_CLASS[swing] : '';

  function show() {
    openRef.current = true;
    setOpen(true);
    setRing((r) => (r.now ? { ...r, now: false } : r));
    load({ quiet: items !== null });
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    show();
  }

  /** The summary card's "See them": the list opens as with the button, which then has focus. */
  function openList() {
    if (!openRef.current) show();
    buttonRef.current?.focus();
  }

  async function markAllRead() {
    if (marking || unread === 0) return;
    setMarking(true);
    try {
      await api.post('/api/notifications/read-all');
      const readAt = now().toISOString();
      setItems((list) => (list ?? []).map((n) => (n.readAt ? n : { ...n, readAt })));
      setUnread(0);
      live?.reportReadAll(readAt);
      router.refresh();
    } catch (error) {
      toast({ title: "Couldn't mark them as read", body: error.message, tone: 'error' });
    } finally {
      setMarking(false);
    }
  }

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Close on outside click and Escape while open (the Undo toast counts as inside).
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (rootRef.current?.contains(event.target)) return;
      if (event.target?.closest?.('[data-notification-undo]')) return;
      setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // Refresh the dot when the person comes back to the tab.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (now().valueOf() - lastLoad.current < REFRESH_AFTER_MS) return;
      load({ quiet: true });
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // A desktop notification just popped up (public/sw.js tells open pages): show it here too.
  // With the live store, the provider listens and its check brings the rows (CONTRACT 26).
  useEffect(() => {
    if (live || !('serviceWorker' in navigator)) return undefined;
    function onMessage(event) {
      if (event.data?.type === 'daybook:notification') load({ quiet: true });
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [live, load]);

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.bell}
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        <span key={ring.key} className={`${styles.ring} ${ringClass}`}>
          <BellIcon />
        </span>
        {unread > 0 ? <span className={styles.dot} aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div id={panelId} className={styles.panel} role="dialog" aria-labelledby={titleId}>
          <div className={styles.head}>
            <h2 id={titleId} className={styles.title}>
              Notifications
            </h2>
            {/* aria-disabled, not disabled: a keyboard user keeps focus here after marking */}
            <button
              type="button"
              className={styles.markAll}
              onClick={markAllRead}
              aria-disabled={marking || unread === 0}
              data-notification-fallback=""
            >
              {marking ? 'Marking…' : 'Mark all as read'}
            </button>
          </div>
          <NotificationList
            status={status}
            items={items}
            today={workDate(tz)}
            tz={tz}
            actions={actions}
            onRetry={() => load()}
          />
          <PushSwitch push={desktop} />
        </div>
      ) : null}
      <NotificationUndo
        pending={actions.pending}
        onUndo={undoFocus.undo}
        onDismiss={actions.dismiss}
        onHold={actions.hold}
        onLeave={undoFocus.leave}
      />
    </div>
  );
}
