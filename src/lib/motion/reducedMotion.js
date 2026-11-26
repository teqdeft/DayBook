'use client';
// The computer's "reduce motion" setting (CONTRACT 28, Motion, rule 7): a fresh read at call time
// (false on the server), a subscription, the hook and the scroll behaviour it asks for. Never
// render different markup from it (rule 12): its server snapshot is false. The board's scroll,
// the live preview stack and every motion helper read it from here.
import { useSyncExternalStore } from 'react';

export const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the computer asks for reduced motion, read now; false on the server. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCE_QUERY)?.matches);
}

/**
 * Calls `onChange` whenever the setting changes.
 * @param {() => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeReducedMotion(onChange) {
  if (typeof window === 'undefined') return () => {};
  const query = window.matchMedia?.(REDUCE_QUERY);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

/** The setting as React state; false on the server and while the page hydrates. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

/** @returns {'instant' | 'smooth'} the `behavior` for scrollTo, scrollBy and scrollIntoView */
export function scrollBehavior() {
  return prefersReducedMotion() ? 'instant' : 'smooth';
}
