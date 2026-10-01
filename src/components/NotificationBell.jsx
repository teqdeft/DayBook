'use client';
// The bell in the top bar: a red dot when something is unread; opens the latest 20 notifications
// with "Mark all as read". Each item links to its screen. The dropdown ends with "Show on this
// computer" (desktop notifications for this browser, CONTRACT 14).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/apiClient';
import { formatRelativeDay, formatTimeAmPm, now, workDate } from '@/lib/time';
import PushSwitch, { useDesktopPush } from './PushSwitch';
import { useToast } from './ToastProvider';
import styles from './NotificationBell.module.css';

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
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | error
  const [unread, setUnread] = useState(initialUnread);
  // The server's count from the last render: after router.refresh() it takes over, without
  // remounting the bell (a remount closed the open list and dropped keyboard focus).
  const [serverUnread, setServerUnread] = useState(initialUnread);
  if (serverUnread !== initialUnread) {
    setServerUnread(initialUnread);
    setUnread(initialUnread);
  }
  const [marking, setMarking] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const lastLoad = useRef(0);
  const panelId = useId();
  const titleId = useId();

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setStatus('loading');
    try {
      const result = readResponse(await api.get('/api/notifications?limit=20'));
      lastLoad.current = now().valueOf();
      setItems(result.items.slice(0, 20));
      setUnread(result.unread);
      setStatus('idle');
    } catch {
      if (!quiet) setStatus('error');
    }
  }, []);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    load({ quiet: items !== null });
  }

  function close({ focus = true } = {}) {
    setOpen(false);
    if (focus) buttonRef.current?.focus();
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

  // Close on outside click and Escape while open.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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

  const today = workDate(tz);

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
        <BellIcon />
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
            >
              {marking ? 'Marking…' : 'Mark all as read'}
            </button>
          </div>
          <Body
            status={status}
            items={items}
            today={today}
            tz={tz}
            onRetry={() => load()}
            onNavigate={() => close({ focus: false })}
          />
          <PushSwitch push={desktop} />
        </div>
      ) : null}
    </div>
  );
}

function Body({ status, items, today, tz, onRetry, onNavigate }) {
  if (status === 'error' && !items) {
    return (
      <div className={styles.message}>
        <p className={styles.messageTitle}>Couldn&apos;t load notifications</p>
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (!items) {
    return (
      <ul className={styles.list} aria-busy="true" aria-label="Loading notifications">
        {[0, 1, 2].map((i) => (
          <li key={i} className={styles.skeletonRow}>
            <span className={styles.skeletonLine} />
            <span className={`${styles.skeletonLine} ${styles.short}`} />
          </li>
        ))}
      </ul>
    );
  }
  if (items.length === 0) {
    return (
      <div className={styles.message}>
        <p className={styles.messageTitle}>You&apos;re all caught up</p>
        <p className={styles.messageBody}>Requests, reminders and approvals show up here.</p>
      </div>
    );
  }
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.id}>
          <Item item={item} today={today} tz={tz} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

function Item({ item, today, tz, onNavigate }) {
  const when = item.createdAt
    ? `${formatRelativeDay(workDate(tz, item.createdAt), today)} at ${formatTimeAmPm(item.createdAt, tz)}`
    : null;
  const content = (
    <>
      <span
        className={`${styles.unreadDot} ${item.readAt ? styles.read : ''}`}
        aria-hidden="true"
      />
      <span className={styles.itemText}>
        <span className={styles.itemTitle}>
          {item.title}
          {item.readAt ? null : <span className="visually-hidden"> (unread)</span>}
        </span>
        {item.body ? <span className={styles.itemBody}>{item.body}</span> : null}
        {when ? <span className={styles.itemTime}>{when}</span> : null}
      </span>
    </>
  );
  // In-app paths only ('//host' and '/\host' would leave the site).
  if (item.link && /^\/(?![/\\])/.test(item.link)) {
    return (
      <Link href={item.link} className={styles.item} onClick={onNavigate}>
        {content}
      </Link>
    );
  }
  return <div className={styles.item}>{content}</div>;
}
