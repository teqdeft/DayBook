'use client';
// Shared behaviour for Drawer and Dialog: focus moves in on open and returns to the opener on
// close, Tab stays inside, Escape closes, and the page behind doesn't scroll. Only the top-most
// open modal reacts to keys, so a dialog opened from a drawer closes first.
import { useEffect, useRef, useSyncExternalStore } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

const stack = [];
let lockCount = 0;
let saved = null;

function lockScroll() {
  lockCount += 1;
  if (lockCount > 1) return;
  const { body, documentElement } = document;
  const scrollbar = window.innerWidth - documentElement.clientWidth;
  saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0 || !saved) return;
  document.body.style.overflow = saved.overflow;
  document.body.style.paddingRight = saved.paddingRight;
  saved = null;
}

/** Visible, focusable elements inside a container, in tab order. */
export function focusableIn(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && (el.offsetParent !== null || el === document.activeElement),
  );
}

function pickInitialFocus(panel) {
  const marked = panel.querySelector('[data-autofocus]');
  if (marked) return marked;
  const body = panel.querySelector('[data-modal-body]');
  return focusableIn(body)[0] ?? panel;
}

/**
 * @param {{ open: boolean, onClose?: () => void, panelRef: { current: HTMLElement | null } }} options
 */
export function useModal({ open, onClose, panelRef }) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;
    const opener = document.activeElement;
    const entry = { panel };
    stack.push(entry);
    lockScroll();
    pickInitialFocus(panel).focus({ preventScroll: true });

    function onKeyDown(event) {
      if (stack[stack.length - 1] !== entry || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = stack.indexOf(entry);
      if (index !== -1) stack.splice(index, 1);
      unlockScroll();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}

const noopSubscribe = () => () => {};

/** False during server rendering and hydration, true afterwards (safe gate for portals). */
export function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
