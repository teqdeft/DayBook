'use client';
// A toast with Undo (CONTRACT 22): "Marked done." and "Task deleted." It sits with the app's toasts
// (ToastProvider's slot, under them). The live region is always there once on the client, so screen
// readers announce each new toast. The 6 s stop while the pointer or focus is on it (WCAG 2.2.1).
// After a tick or delete from the keyboard focus moves to Undo; Tab, Shift+Tab or Escape (which also
// ends the toast) call onLeave, so a keyboard user can always reach Undo in time. Tab is the
// browser's own when onLeave moved nothing, and a toast that goes from the keyboard (Escape, Close,
// Undo) hands the focus back to where it came from when nothing else took it, so the focus is never
// stuck on the toast or dropped to the page. Since 1.13 it fades out when it goes (CONTRACT 28,
// Motion), inert while it does, and an optional body line sits under the title ("It was on 2 tasks.",
// "Simran Kaur gets a notification.").
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, X } from 'lucide-react';
import { useToastSlot } from '@/components/ToastProvider';
import { useIsClient } from '@/components/useModal';
import { DUR } from '@/lib/motion/tokens';
import { useHeldValue, usePresence } from '@/lib/motion/presence';
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
 * The toast on screen: the pending one, or the last one while its fade plays (CONTRACT 28,
 * Motion: Toast, Undo toast; it goes on its own animationend, with a safety timeout).
 */
function useShownToast(pending) {
  const open = Boolean(pending);
  const presence = usePresence(open, DUR.toastOut);
  const held = useHeldValue(open, pending);
  const leaving = !open && presence.closing;
  return {
    shown: pending ?? (leaving ? held : null),
    leaving,
    onAnimationEnd: presence.onAnimationEnd,
  };
}

const hasFocus = (toast) => toast.contains(document.activeElement);

/**
 * The focus as a toast is used from the keyboard: onLeave puts it back where it belongs; a toast
 * about to go that still has it gives it to the element it came from, else to the page's main part.
 * @param {{ onUndo: () => void, onEnd: () => void, onLeave?: () => void }} props UndoToast's
 * @returns {Record<'onFocus' | 'onKeyDown' | 'onUndoClick' | 'onCloseClick', Function>} the
 *   toast's handlers (a click with `detail` 0 is Enter or Space)
 */
export function useToastKeys({ onUndo, onEnd, onLeave }) {
  const from = useRef(null);
  function handBack(toast) {
    if (!hasFocus(toast)) return;
    const back = from.current?.isConnected ? from.current : document.getElementById('main');
    back?.focus({ preventScroll: true });
  }
  return {
    onFocus(event) {
      if (!event.currentTarget.contains(event.relatedTarget)) from.current = event.relatedTarget;
    },
    onKeyDown(event) {
      const toast = event.currentTarget;
      if (event.key === 'Escape') {
        event.preventDefault();
        onLeave?.();
        handBack(toast);
        onEnd();
      } else if (event.key === 'Tab') {
        onLeave?.();
        if (!hasFocus(toast)) event.preventDefault();
      }
    },
    onUndoClick(event) {
      onUndo();
      if (event.detail === 0) handBack(event.currentTarget.parentElement);
    },
    onCloseClick(event) {
      if (event.detail === 0) {
        onLeave?.();
        handBack(event.currentTarget.parentElement);
      }
      onEnd();
    },
  };
}

/**
 * The toast itself: the title (with its body line, read with it), Undo and the close button; the
 * clock stops while it is in use.
 */
export function UndoToastBody({
  shown,
  leaving,
  hold,
  undoRef,
  onUndo,
  onEnd,
  onLeave,
  onAnimationEnd,
}) {
  const keys = useToastKeys({ onUndo, onEnd, onLeave });
  return (
    <div
      className={styles.toast}
      data-leaving={leaving ? '' : undefined}
      inert={leaving || undefined}
      onAnimationEnd={(event) => leaving && onAnimationEnd(event)}
      onPointerEnter={() => hold('pointer', true)}
      onPointerLeave={() => hold('pointer', false)}
      onFocus={(event) => {
        keys.onFocus(event);
        hold('focus', true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) hold('focus', false);
      }}
      onKeyDown={keys.onKeyDown}
    >
      <CircleCheck className={styles.icon} size={20} strokeWidth={1.8} aria-hidden="true" />
      <p className={styles.title}>
        {shown.title}
        {shown.body ? <span className={styles.body}> {shown.body}</span> : null}
      </p>
      <button ref={undoRef} type="button" className={styles.undo} onClick={keys.onUndoClick}>
        Undo
      </button>
      <button type="button" className={styles.close} aria-label="Close" onClick={keys.onCloseClick}>
        <X size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * @param {{ pending: { key: string | number, title: string, body?: string | null,
 *   keyboard?: boolean } | null,
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
  const { shown, leaving, onAnimationEnd } = useShownToast(pending);

  useEffect(() => {
    if (key !== null && keyboard) undoRef.current?.focus();
  }, [key, keyboard]);

  if (!onClient) return null;

  return createPortal(
    <div className={slot ? styles.stacked : styles.region} role="status" aria-live="polite">
      {shown ? (
        <UndoToastBody
          key={shown.key}
          {...{ shown, leaving, hold, undoRef, onUndo, onEnd, onLeave, onAnimationEnd }}
        />
      ) : null}
    </div>,
    slot ?? document.body,
  );
}
