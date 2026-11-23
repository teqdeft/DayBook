// One tab's live check timing (CONTRACT 26 "The loop"): one timer and one check at a time. Every
// trigger first clears the pending timeout; a trigger during a check in flight runs once right
// after it, never in parallel; at most one check per 5 s unless forced (`checkNow()`); and, while
// the tab leads, the one next timeout is set after each answer (`setTimeout` after the awaited
// fetch, never `setInterval`, so Chrome never treats it as a timer chain). Pure, with injected
// timers and clock.
import { CHECK_GAP_MS } from './liveRules';

/**
 * @param {{ run: () => Promise<void>, nextDelay: () => number, setTimer?: Function,
 *   clearTimer?: Function, now: () => number, gapMs?: number }} options
 * @returns {{ trigger: (options?: { force?: boolean }) => Promise<void>,
 *   setPeriodic: (on: boolean) => void, busy: () => boolean, stop: () => void }}
 *   `trigger` resolves after the check it asked for has run (and its answer was handled).
 */
export function createLoop({
  run,
  nextDelay,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now,
  gapMs = CHECK_GAP_MS,
}) {
  let timer = null;
  let timerKind = null; // 'gap' (a trigger waiting for the 5 s mark) | 'next' (the leader's timeout)
  let inFlight = false;
  let queued = null; // { force } while a trigger waits for the check in flight
  let lastStart = -Infinity;
  let periodic = false;
  let stopped = false;
  let waiters = [];

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    timerKind = null;
  }

  function settle(list) {
    list.forEach((resolve) => resolve());
  }

  function schedule(kind, ms, fn) {
    clear();
    timerKind = kind;
    timer = setTimer(() => {
      timer = null;
      timerKind = null;
      fn();
    }, ms);
  }

  function begin(force) {
    const wait = force ? 0 : lastStart + gapMs - now();
    if (wait > 0) schedule('gap', wait, start);
    else start();
  }

  function start() {
    clear();
    if (stopped) {
      settle(waiters.splice(0));
      return;
    }
    const mine = waiters.splice(0);
    inFlight = true;
    lastStart = now();
    Promise.resolve()
      .then(run)
      .catch(() => {})
      .then(() => {
        inFlight = false;
        settle(mine);
        if (stopped) {
          settle(waiters.splice(0));
          return;
        }
        if (queued) {
          const { force } = queued;
          queued = null;
          begin(force);
        } else if (periodic) {
          schedule('next', nextDelay(), () => trigger());
        }
      });
  }

  function trigger({ force = false } = {}) {
    if (stopped) return Promise.resolve();
    const done = new Promise((resolve) => waiters.push(resolve));
    if (inFlight) {
      if (timerKind) clear();
      queued = { force: Boolean(queued?.force) || force };
      return done;
    }
    clear();
    begin(force);
    return done;
  }

  return {
    trigger,
    /** The tab leads (a timeout after each answer) or follows (checks only when asked). */
    setPeriodic(on) {
      periodic = Boolean(on);
      if (!periodic && timerKind === 'next') clear();
    },
    busy: () => inFlight,
    stop() {
      stopped = true;
      clear();
      queued = null;
      if (!inFlight) settle(waiters.splice(0));
    },
  };
}
