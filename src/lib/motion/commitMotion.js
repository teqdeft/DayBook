// The queue of "play this once the page shows it" requests (CONTRACT 28, Motion, Modules and
// signatures; motion.md 1.4 B): a change the server brings later (a new card after quick add or
// New task, the band's fill after a tick) plays in the first commit that draws it. A request
// plays once, waits while it isn't ready and is dropped after `maxAgeMs` (2 s): a slow refresh
// simply shows the change. A commit with no request never animates.
import { LIMITS } from './tokens';

/**
 * @typedef {{ id: string, ready: (root: Element) => boolean, play: (root: Element) => void,
 *   maxAgeMs?: number, at: number, played?: boolean }} MotionRequest
 */

const readyIn = (request, root) => {
  try {
    return Boolean(root) && Boolean(request.ready(root));
  } catch {
    return false;
  }
};

/**
 * Plays the ready requests once and drops the old ones.
 * @param {MotionRequest[]} queue
 * @param {Element | null} root
 * @param {number} now performance.now()
 * @returns {MotionRequest[]} the requests still waiting
 */
export function runReady(queue, root, now) {
  const waiting = [];
  for (const request of queue ?? []) {
    if (!request || request.played) continue;
    const maxAge = request.maxAgeMs ?? LIMITS.newCardWait;
    if (now - (request.at ?? now) > maxAge) continue;
    if (!readyIn(request, root)) {
      waiting.push(request);
      continue;
    }
    request.played = true; // before play: a second effect run (StrictMode) never replays it
    try {
      request.play(root);
    } catch {
      // motion is decoration: a failed play leaves the page as React drew it
    }
  }
  return waiting;
}

/**
 * Adds a request (a later one with the same id replaces the waiting one).
 * @param {MotionRequest[]} queue
 * @param {Omit<MotionRequest, 'at'>} request
 * @param {number} now
 * @returns {MotionRequest[]}
 */
export function queueRequest(queue, request, now) {
  const others = (queue ?? []).filter((waiting) => waiting.id !== request.id);
  return [...others, { maxAgeMs: LIMITS.newCardWait, ...request, at: now, played: false }];
}
