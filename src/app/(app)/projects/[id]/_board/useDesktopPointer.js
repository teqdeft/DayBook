'use client';
// A mouse or pen on a wide screen (CONTRACT 28, Motion, Pointer drag): the only place a card can be
// dragged; phones and touch use "Move to phase…". Moved out of useBoardDrag.js (1.12's rule as it
// was). Never render different markup from it (rule 12): its server snapshot is false.
import { useSyncExternalStore } from 'react';

export const DESKTOP_QUERY = '(pointer: fine) and (min-width: 641px)';

/** True on a desktop pointer now (false on the server). */
export function isDesktopPointer() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(DESKTOP_QUERY)?.matches);
}

function subscribe(onChange) {
  if (typeof window === 'undefined') return () => {};
  const query = window.matchMedia?.(DESKTOP_QUERY);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

/** True on a desktop pointer (false while the page hydrates and on the server). */
export function useDesktopPointer() {
  return useSyncExternalStore(subscribe, isDesktopPointer, () => false);
}
