'use client';
// The people window as a popover (CONTRACT 28, The people window): 300 px, anchored to the face
// button that opened it, below it (above when there is no room), kept 8 px inside the window and
// following the button while the page scrolls. It is a dialog labelled "Assign to": the search takes
// the focus, Tab stays inside, Escape closes it and gives the focus back to the face (also inside the
// task window, which stays open), a press outside closes it. It comes in with the menus' short fade
// and closes at once.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { focusableIn, useIsClient } from '@/components/useModal';
import styles from './PeopleWindow.module.css';

const GAP = 6;
const EDGE = 8;

/**
 * Where the popover goes next to the button: below it, else above it, else as high as fits;
 * lined up with the button's left edge and kept `EDGE` px inside the window.
 * @param {{ top: number, bottom: number, left: number }} rect the button's
 * @param {{ width: number, height: number }} box the popover's
 * @param {{ width: number, height: number }} view the window's
 * @returns {{ top: number, left: number }}
 */
export function popoverPlace(rect, box, view) {
  const left = Math.round(Math.max(EDGE, Math.min(rect.left, view.width - EDGE - box.width)));
  const below = rect.bottom + GAP;
  if (below + box.height <= view.height - EDGE) return { top: Math.round(below), left };
  const above = rect.top - GAP - box.height;
  if (above >= EDGE) return { top: Math.round(above), left };
  return { top: Math.round(Math.max(EDGE, view.height - EDGE - box.height)), left };
}

/** Keeps the popover next to its button; closes it once the button has gone or left the view. */
function usePlace(ref, anchor, onGone, asking) {
  const [place, setPlace] = useState(null);
  const measure = useEffectEvent(() => {
    const el = ref.current;
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    if (!el || !rect || rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      onGone();
      return;
    }
    const box = { width: el.offsetWidth, height: el.offsetHeight };
    const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const next = popoverPlace(rect, box, view);
    setPlace((now) => (now && now.top === next.top && now.left === next.left ? now : next));
  });
  // Placed when it opens and again when its foot changes (the share confirm is taller).
  useLayoutEffect(() => measure(), [asking]);
  useEffect(() => {
    const onMove = (event) => {
      if (event.type === 'scroll' && ref.current?.contains(event.target)) return;
      measure();
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [ref]);
  return place;
}

/** Tab and Shift+Tab go round inside; the task window's own trap is told to leave them alone. */
function trapTab(event, box) {
  const items = focusableIn(box);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  event.preventDefault();
  if (!box.contains(active)) first.focus();
  else if (event.shiftKey) (active === first ? last : items[items.indexOf(active) - 1])?.focus();
  else (active === last ? first : items[items.indexOf(active) + 1])?.focus();
}

/**
 * @param {{ anchor: HTMLElement, asking: boolean, onClose: (how?: object) => void,
 *   children: import('react').ReactNode }} props asking: the foot shows the share confirm (the
 *   popover is placed again)
 */
export default function PeoplePopover({ anchor, asking, onClose, children }) {
  const isClient = useIsClient();
  const ref = useRef(null);
  const close = (restore) => {
    onClose({ picked: false });
    if (restore && anchor?.isConnected) anchor.focus({ preventScroll: true });
  };
  const place = usePlace(ref, anchor, () => close(false), asking);

  // A press outside closes it.
  const onOutside = useEffectEvent((event) => {
    if (!ref.current?.contains(event.target) && !anchor?.contains(event.target)) close(false);
  });
  useEffect(() => {
    const onPointerDown = (event) => onOutside(event);
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);
  // The search takes the focus once the popover is placed (it is hidden until then, and a hidden
  // field can't take the focus).
  const placed = Boolean(place);
  useEffect(() => {
    if (placed) ref.current?.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
  }, [placed]);

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      trapTab(event, ref.current);
    }
  }

  if (!isClient) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Assign to"
      className={styles.popover}
      style={place ?? { top: 0, left: 0, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
