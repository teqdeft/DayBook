'use client';
// One notification in the bell (CONTRACT 20): a blue dot while unread, the title, body and time.
// Clicking it marks it read and opens its link. Mark as read / Mark as unread and Delete show on
// hover and focus (always on touch screens); on touch, swiping it left past a threshold deletes it.
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Mail, MailOpen, Trash2 } from 'lucide-react';
import { formatRelativeDay, formatTimeAmPm, workDate } from '@/lib/time';
import { isInAppLink } from './NotificationBell.list';
import {
  SWIPE_SETTLE_MS,
  swipeDeletes,
  swipeIntent,
  swipeOffset,
  swipeThreshold,
} from './NotificationBell.swipe';
import styles from './NotificationItem.module.css';

/** Pointer handlers that let a finger drag the row left; `onSwiped` runs once it has slid out. */
function useSwipe(onSwiped) {
  const rowRef = useRef(null);
  const gesture = useRef(null);
  const swiped = useRef(false);
  const settleTimer = useRef(null);
  const [drag, setDrag] = useState(null); // null | 'moving' | 'armed' (past the threshold)

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  function place(offset, animate) {
    const row = rowRef.current;
    if (!row) return;
    row.style.transition = animate ? `transform ${SWIPE_SETTLE_MS}ms ease-out` : 'none';
    row.style.transform = offset ? `translateX(${offset}px)` : '';
  }

  function end(event, letGo) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (g.mode !== 'swipe') return;
    swiped.current = true; // the click that may follow isn't a tap
    const width = rowRef.current?.offsetWidth ?? 0;
    const remove = letGo && swipeDeletes({ offset: g.offset, width });
    place(remove ? -width : 0, true);
    settleTimer.current = setTimeout(() => {
      if (remove) onSwiped();
      else setDrag(null);
    }, SWIPE_SETTLE_MS);
  }

  const handlers = {
    onPointerDown(event) {
      swiped.current = false;
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: null };
    },
    onPointerMove(event) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId || g.mode === 'scroll') return;
      const dx = event.clientX - g.x;
      if (!g.mode) {
        g.mode = swipeIntent({ dx, dy: event.clientY - g.y });
        if (g.mode !== 'swipe') return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      g.offset = swipeOffset(dx);
      place(g.offset, false);
      const armed = -g.offset >= swipeThreshold(rowRef.current?.offsetWidth);
      setDrag(armed ? 'armed' : 'moving');
    },
    onPointerUp: (event) => end(event, true),
    onPointerCancel: (event) => end(event, false),
    onClickCapture(event) {
      if (!swiped.current) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return { rowRef, drag, handlers };
}

/**
 * Moves focus off a row that is about to go: the next row, else the one before, else `fallback`.
 * @returns {HTMLElement | null} where focus went (Undo's toast sends a keyboard user back there)
 */
function focusAfterDelete(button) {
  const row = button.closest('li');
  const next = row?.nextElementSibling ?? row?.previousElementSibling;
  const target =
    next?.querySelector('a, button') ??
    row?.closest('[role="dialog"]')?.querySelector('[data-notification-fallback]');
  target?.focus();
  return target ?? null;
}

/**
 * @param {{ item: { id: number, title: string, body?: string | null, link?: string | null,
 *   readAt?: string | null, createdAt?: string | null }, today: string, tz: string,
 *   onOpen: (item: object, event: import('react').MouseEvent) => void,
 *   onToggleRead: (item: object) => void, onDelete: (item: object, options?: { keyboard:
 *   boolean, returnFocus: HTMLElement | null }) => void }} props a keyboard delete (Enter or
 *   Space: no pointer, `detail` 0) moves focus to the Undo toast, then back to `returnFocus`
 */
export default function NotificationItem({ item, today, tz, onOpen, onToggleRead, onDelete }) {
  const titleId = useId();
  const { rowRef, drag, handlers } = useSwipe(() => onDelete(item));
  const read = Boolean(item.readAt);
  const when = item.createdAt
    ? `${formatRelativeDay(workDate(tz, item.createdAt), today)} at ${formatTimeAmPm(item.createdAt, tz)}`
    : null;

  const content = (
    <>
      <span className={`${styles.dot} ${read ? styles.read : ''}`} aria-hidden="true" />
      <span className={styles.text}>
        <span id={titleId} className={styles.title}>
          {item.title}
          {read ? null : <span className="visually-hidden"> (unread)</span>}
        </span>
        {item.body ? <span className={styles.body}>{item.body}</span> : null}
        {when ? <span className={styles.time}>{when}</span> : null}
      </span>
    </>
  );

  return (
    <li className={`${styles.slot} ${drag ? styles.dragging : ''}`} data-notification-id={item.id}>
      {drag ? (
        <div className={`${styles.swipeBack} ${drag === 'armed' ? styles.armed : ''}`}>
          <Trash2 size={18} strokeWidth={1.8} aria-hidden="true" />
          <span aria-hidden="true">Delete</span>
        </div>
      ) : null}
      <div ref={rowRef} className={styles.row} {...handlers}>
        {isInAppLink(item.link) ? (
          <Link
            href={item.link}
            className={styles.main}
            draggable={false}
            onClick={(event) => onOpen(item, event)}
          >
            {content}
          </Link>
        ) : (
          <div className={styles.main} onClick={(event) => onOpen(item, event)}>
            {content}
          </div>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => onToggleRead(item)}
            aria-label={read ? 'Mark as unread' : 'Mark as read'}
            aria-describedby={titleId}
            title={read ? 'Mark as unread' : 'Mark as read'}
          >
            {read ? (
              <Mail size={16} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <MailOpen size={16} strokeWidth={1.8} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.delete}`}
            onClick={(event) => {
              const returnFocus = focusAfterDelete(event.currentTarget);
              onDelete(item, { keyboard: event.detail === 0, returnFocus });
            }}
            aria-label="Delete"
            aria-describedby={titleId}
            title="Delete"
          >
            <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}
