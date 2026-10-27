'use client';
// The bell in the top bar: a red dot when something is unread, and a gentle swing about every 6 s
// while it is (once at once when the count goes up), unless the person turned the swing off in My
// settings (`bellRing`, CONTRACT 21; read from UserPrefs). It opens the latest 20 notifications with
// "Mark all as read"; each item marks itself read and opens its screen, and can be marked read or
// unread and deleted with Undo (NotificationItem, CONTRACT 20). The dropdown ends with "Show on
// this computer" (desktop notifications for this browser, CONTRACT 14).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/apiClient';
import { now, workDate } from '@/lib/time';
import { useNotificationActions } from './NotificationBell.actions';
import { hidePending } from './NotificationBell.list';
import { bellSwing } from './NotificationBell.ring';
import NotificationList from './NotificationList';
import NotificationUndo from './NotificationUndo';
import PushSwitch, { useDesktopPush } from './PushSwitch';
import { useToast } from './ToastProvider';
import { useBellRing } from './UserPrefs';
import styles from './NotificationBell.module.css';

const SWING_CLASS = { now: styles.ringNow, later: styles.ringLater };

const REFRESH_AFTER_MS = 60_000;

// The canvas draws its own bell (straight sides, flat base, a round clapper), not lucide's; traced
// from the artboards at 1 unit = 1 CSS px and drawn the lucide way (currentColor, round joins).
function BellIcon() {
  return (
    <svg
      className={styles.icon}
      width="20"
      height="20"
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

/** Accepts `{ data: [...] }`, `{ data: { items|notifications: [...] } }` and an optional unreadCount. */
function readResponse(json) {
  const data = json?.data;
  const items = Array.isArray(data) ? data : (data?.items ?? data?.notifications ?? []);
  const count = json?.unreadCount ?? data?.unreadCount;
  const unread = typeof count === 'number' ? count : items.filter((n) => !n.readAt).length;
  return { items, unread };
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
  const desktop = useDesktopPush(push);
  const ringEnabled = useBellRing();
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
  const panelId = useId();
  const titleId = useId();

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setStatus('loading');
    try {
      const json = await api.get('/api/notifications?limit=20');
      const result = hidePending(readResponse(json), pendingRef.current);
      lastLoad.current = now().valueOf();
      setItems(result.items.slice(0, 20));
      setUnread(result.unread);
      setStatus('idle');
    } catch {
      if (!quiet) setStatus('error');
    }
  }, []);
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

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setRing((r) => (r.now ? { ...r, now: false } : r));
    load({ quiet: items !== null });
  }

  async function markAllRead() {
    if (marking || unread === 0) return;
    setMarking(true);
    try {
      await api.post('/api/notifications/read-all');
      const readAt = now().toISOString();
      setItems((list) => (list ?? []).map((n) => (n.readAt ? n : { ...n, readAt })));
      setUnread(0);
      router.refresh();
    } catch (error) {
      toast({ title: "Couldn't mark them as read", body: error.message, tone: 'error' });
    } finally {
      setMarking(false);
    }
  }

  /** Focus back in the list: on `target` when it is still there, else the list's top, else the bell. */
  function focusList(target) {
    const fallback = rootRef.current?.querySelector('[data-notification-fallback]');
    (target?.isConnected ? target : (fallback ?? buttonRef.current))?.focus();
  }

  function undo() {
    // Undo had focus and goes away with the toast: focus goes to the item that came back.
    const fromToast = document.activeElement?.closest?.('[data-notification-undo]');
    const id = actions.pending?.item.id;
    actions.undo();
    if (!fromToast) return;
    requestAnimationFrame(() => {
      const row = rootRef.current?.querySelector(`[data-notification-id="${id}"]`);
      focusList(row?.querySelector('a, button'));
    });
  }

  /** Tab, Shift+Tab or Escape on the Undo toast: back to the row focus was on before it. */
  function leaveUndo() {
    focusList(actions.pending?.returnFocus);
  }

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
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    function onMessage(event) {
      if (event.data?.type === 'daybook:notification') load({ quiet: true });
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [load]);

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
        onUndo={undo}
        onDismiss={actions.dismiss}
        onHold={actions.hold}
        onLeave={leaveUndo}
      />
    </div>
  );
}
