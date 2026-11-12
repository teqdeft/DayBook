'use client';
// A toast with Undo (CONTRACT 22): "Marked done." and "Task deleted." It sits with the app's toasts
// (ToastProvider's slot, under them). The live region is always there once on the client, so screen
// readers announce each new toast. The 6 s stop while the pointer or focus is on it (WCAG 2.2.1).
// After a tick or delete from the keyboard focus moves to Undo; Tab, Shift+Tab or Escape (which also
// ends the toast) call onLeave, so a keyboard user can always reach Undo in time.
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, X } from 'lucide-react';
import { useToastSlot } from '@/components/ToastProvider';
import { useIsClient } from '@/components/useModal';
import { now } from '@/lib/time';
import styles from './UndoToast.module.css';

export const UNDO_MS = 6000;
const AT_LEAST_AFTER_HOLD_MS = 2000;

/** Calls onEnd when the time is up; hold(reason, on) stops and restarts the clock. */
function useCountdown(key, onEnd, duration) {
  const onEndRef = useRef(onEnd);
  const timer = useRef(null);
  const endsAt = useRef(0);
  const left = useRef(duration);
  const holds = useRef(new Set());

  useEffect(() => {
    onEndRef.current = onEnd;
  });

  const start = useCallback((ms) => {
    clearTimeout(timer.current);
    endsAt.current = now().valueOf() + ms;
    timer.current = setTimeout(() => onEndRef.current(), ms);
  }, []);

  useEffect(() => {
    if (key === null) return undefined;
    holds.current.clear();
    start(duration);
    return () => clearTimeout(timer.current);
  }, [key, duration, start]);

  return useCallback(
    (reason, on) => {
      const wasHeld = holds.current.size > 0;
      if (on) holds.current.add(reason);
      else holds.current.delete(reason);
      const held = holds.current.size > 0;
      if (held && !wasHeld) {
        clearTimeout(timer.current);
        left.current = endsAt.current - now().valueOf();
      } else if (!held && wasHeld) {
        start(Math.max(left.current, AT_LEAST_AFTER_HOLD_MS));
      }
    },
    [start],
  );
}

/**
 * @param {{ pending: { key: string | number, title: string, keyboard?: boolean } | null,
 *   onUndo: () => void, onEnd: () => void, onLeave?: () => void, duration?: number }} props
 *   a new `key` is a new toast and starts the clock again; onEnd: the time is up or it was closed;
 *   onLeave puts focus back on the page (Tab, Shift+Tab, Escape)
 */
export default function UndoToast({ pending, onUndo, onEnd, onLeave, duration = UNDO_MS }) {
  const onClient = useIsClient();
  const slot = useToastSlot();
  const undoRef = useRef(null);
  const key = pending?.key ?? null;
  const keyboard = Boolean(pending?.keyboard);
  const hold = useCountdown(key, onEnd, duration);

  useEffect(() => {
    if (key !== null && keyboard) undoRef.current?.focus();
  }, [key, keyboard]);

  if (!onClient) return null;

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onLeave?.();
      onEnd();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onLeave?.();
    }
  }

  return createPortal(
    <div className={slot ? styles.stacked : styles.region} role="status" aria-live="polite">
      {pending ? (
        <div
          key={pending.key}
          className={styles.toast}
          onPointerEnter={() => hold('pointer', true)}
          onPointerLeave={() => hold('pointer', false)}
          onFocus={() => hold('focus', true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) hold('focus', false);
          }}
          onKeyDown={onKeyDown}
        >
          <CircleCheck className={styles.icon} size={20} strokeWidth={1.8} aria-hidden="true" />
          <p className={styles.title}>{pending.title}</p>
          <button ref={undoRef} type="button" className={styles.undo} onClick={onUndo}>
            Undo
          </button>
          <button type="button" className={styles.close} aria-label="Close" onClick={onEnd}>
            <X size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>,
    slot ?? document.body,
  );
}
