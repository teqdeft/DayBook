'use client';
// "Notification deleted" with Undo (CONTRACT 20), shown for 5 s after a delete from the bell. It
// sits with the app's toasts (ToastProvider's slot, under them), outside the bell, so it stays
// when the list closes. The live region is always there (once on the client) so screen readers
// announce each new toast. The 5 s stop while the pointer or focus is on it (WCAG 2.2.1). After a
// delete from the keyboard focus moves to Undo; Tab, Shift+Tab or Escape (which also ends the
// toast) go back to the row focus was on, so a keyboard user can always reach Undo in time.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useToastSlot } from './ToastProvider';
import styles from './NotificationUndo.module.css';

const noSubscription = () => () => {};
const useOnClient = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

/**
 * @param {{ pending: { key: number, keyboard?: boolean } | null, onUndo: () => void,
 *   onDismiss: () => void, onHold: (reason: 'pointer' | 'focus', on: boolean) => void,
 *   onLeave: () => void }} props onDismiss ends the toast now (the delete is sent); onHold stops
 *   and restarts the 5 s; onLeave puts focus back in the list (Tab, Shift+Tab, Escape)
 */
export default function NotificationUndo({ pending, onUndo, onDismiss, onHold, onLeave }) {
  const onClient = useOnClient();
  const slot = useToastSlot();
  const undoRef = useRef(null);

  useEffect(() => {
    if (pending?.keyboard) undoRef.current?.focus();
  }, [pending]);

  if (!onClient) return null;

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onLeave();
      onDismiss();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onLeave();
    }
  }

  return createPortal(
    <div
      className={slot ? styles.stacked : styles.region}
      role="status"
      aria-live="polite"
      data-notification-undo=""
    >
      {pending ? (
        <div
          key={pending.key}
          className={styles.toast}
          onPointerEnter={() => onHold('pointer', true)}
          onPointerLeave={() => onHold('pointer', false)}
          onFocus={() => onHold('focus', true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onHold('focus', false);
          }}
          onKeyDown={onKeyDown}
        >
          <Trash2 className={styles.icon} size={20} strokeWidth={1.8} aria-hidden="true" />
          <p className={styles.title}>Notification deleted</p>
          <button ref={undoRef} type="button" className={styles.undo} onClick={onUndo}>
            Undo
          </button>
        </div>
      ) : null}
    </div>,
    slot ?? document.body,
  );
}
