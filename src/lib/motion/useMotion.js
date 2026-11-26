'use client';
// React glue for the motion (CONTRACT 28, Motion, Modules and signatures; motion.md 1.4): a FLIP
// around a state change we own (measure, flushSync(change), play), and the queue the Board plays
// after every commit for changes the server brings. flushSync only from event handlers,
// animation callbacks and timers: in render or an effect React warns and does nothing.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { flipFrom, measure, tooManyToFlip } from './flip';
import { queueRequest, runReady } from './commitMotion';

const now = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * Measure, commit `change`, play. Over 150 cards or rows, in a hidden tab or with reduce motion
 * the change simply commits.
 * @param {Element | null} root the smallest box that can move
 * @param {() => void} change
 * @param {{ selector?: string } & Parameters<typeof flipFrom>[2]} [options] flipFrom's options
 * @returns {Animation[]}
 */
export function flipSync(root, change, { selector = '[data-flip]', ...flipOptions } = {}) {
  if (!root || tooManyToFlip(root)) {
    flushSync(change);
    return [];
  }
  const elements = () => root.querySelectorAll(selector);
  const first = measure(elements(), { keyOf: flipOptions.keyOf });
  flushSync(change);
  return flipFrom(first, elements(), flipOptions);
}

/**
 * The queue the Board plays after every commit (a layout effect with no deps). It never starts
 * motion by itself: only a request an action queued plays.
 * @param {import('react').RefObject<Element>} rootRef
 * @returns {{ expect: (request: { id: string, ready: (root: Element) => boolean,
 *   play: (root: Element) => void, maxAgeMs?: number }) => void }}
 */
export function useCommitMotion(rootRef) {
  const queue = useRef([]);
  useLayoutEffect(() => {
    if (queue.current.length) queue.current = runReady(queue.current, rootRef.current, now());
  });
  return useMemo(
    () => ({
      expect(request) {
        queue.current = queueRequest(queue.current, request, now());
      },
    }),
    [],
  );
}
