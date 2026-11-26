'use client';
// Windows and toasts that play their exit before they go (CONTRACT 28, Motion, Modules and
// signatures; motion.md 1.1): the picture stays rendered after `open` turns false, marked
// `closing` (the root then gets `data-closing`, `inert` and `pointer-events: none`, so clicks
// pass straight to the page), and goes on its own `animationend` or after `exitMs + 50`. Focus
// and the scroll lock follow `open`, not this: they end the moment the person closes it.
import { useCallback, useEffect, useState } from 'react';

const SAFETY_MS = 50;

/**
 * The next presence state for an `open` value (pure, called during render).
 * @param {{ open: boolean, closing: boolean }} state
 * @param {boolean} open
 * @param {number} exitMs
 * @returns {{ open: boolean, closing: boolean }} the same object when nothing changes
 */
export function nextPresence(state, open, exitMs) {
  if (open) return state.open && !state.closing ? state : { open: true, closing: false };
  if (!state.open) return state;
  return { open: false, closing: exitMs > 0 };
}

/** Whether an `animationend` should remove the picture: only the element's own exit counts. */
export const ownAnimationEnd = (event) => !event || event.target === event.currentTarget;

/** The safety timeout's length. */
export const exitTimeout = (exitMs) => Math.max(0, exitMs) + SAFETY_MS;

/**
 * @param {boolean} open
 * @param {number} exitMs the exit's length (DUR.out for windows, DUR.toastOut for toasts)
 * @returns {{ rendered: boolean, closing: boolean,
 *   onAnimationEnd: (event?: AnimationEvent) => void }} put `onAnimationEnd` on the element
 *   that plays the exit
 */
export function usePresence(open, exitMs) {
  const [state, setState] = useState(() => ({ open: Boolean(open), closing: false }));
  const next = nextPresence(state, Boolean(open), exitMs);
  if (next !== state) setState(next); // derived state, adjusted while rendering
  const closing = next.closing;
  const finish = useCallback(
    () => setState((now) => (now.closing ? { open: false, closing: false } : now)),
    [],
  );
  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(finish, exitTimeout(exitMs));
    return () => clearTimeout(timer);
  }, [closing, exitMs, finish]);
  const onAnimationEnd = useCallback(
    (event) => {
      if (ownAnimationEnd(event)) finish();
    },
    [finish],
  );
  return { rendered: next.open || closing, closing, onAnimationEnd };
}

/**
 * `value` while open, and the last open one while the exit plays, so a closing window never
 * shows the content its caller has already cleared (a title read from a task now null).
 * @template T
 * @param {boolean} open
 * @param {T} value
 * @returns {T}
 */
export function useHeldValue(open, value) {
  const [held, setHeld] = useState(value);
  if (open && held !== value) setHeld(value); // derived state, adjusted while rendering
  return open ? value : held;
}

/**
 * The marks on a window's root (pure): `data-closing`, `inert` and no clicks while its exit
 * plays; `data-instant` (no entrance) for a window that was open when the page loaded.
 * @param {boolean} closing
 * @param {boolean} instant
 * @returns {{ 'data-closing'?: '', 'data-instant'?: '', inert?: true }}
 */
export function windowMarks(closing, instant) {
  return {
    'data-closing': closing ? '' : undefined,
    'data-instant': instant && !closing ? '' : undefined,
    inert: closing || undefined,
  };
}

/**
 * A window's presence (Dialog, Drawer): rendered while its exit plays, and its root's marks. A
 * window open on the page's first render (a deep link, `isClient` still false) shows without its
 * entrance; once closed, later openings play it (nothing animates on page load, rule 2).
 * @param {boolean} open the window's own `open`
 * @param {boolean} isClient false while the page hydrates (useIsClient)
 * @param {number} exitMs DUR.out
 * @returns {{ rendered: boolean, closing: boolean, onAnimationEnd: (event?: AnimationEvent) =>
 *   void, marks: ReturnType<typeof windowMarks> }}
 */
export function useWindowPresence(open, isClient, exitMs) {
  const presence = usePresence(Boolean(open) && isClient, exitMs);
  const [instant, setInstant] = useState(() => Boolean(open) && !isClient);
  if (instant && !open) setInstant(false);
  return { ...presence, marks: windowMarks(presence.closing, instant) };
}
