// The browser side of screen time (CONTRACT section 11), without React: heartbeats, Idle
// Detection, the window fallback and the Web Lock that keeps it to one tracker per browser.
// Used only by ActivityTracker.jsx. Reports only active, idle or screen locked; never apps,
// websites, keystrokes or screenshots.
//
// - With Idle Detection allowed (source 'system'), the whole computer counts, so it doesn't matter
//   which tab reports: tabs queue for the lock and the next one takes over when the holder closes.
// - Without it (source 'window'), only the Daybook window in use can tell: the tab the person is
//   looking at or using takes the lock from whichever tab had it (a hidden tab sends nothing).
// - A heartbeat goes out on every change, every 60 s, and when the page is hidden or closed (fetch
//   keepalive, which carries the Origin header the API checks). The server decides the times.

const HEARTBEAT_URL = '/api/activity/heartbeat';
const LOCK_NAME = 'daybook-screen-time';
const BEAT_MS = 60_000;
const WINDOW_CHECK_MS = 15_000;
const REFRESH_GAP_MS = 5_000; // visibility flips refresh the segment at most this often
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

export const hasIdleDetector = () => typeof window.IdleDetector === 'function';
const isVisible = () => document.visibilityState === 'visible';

/** @returns {Promise<'ok' | 'stop' | 'retry'>} stop: signed out, not allowed or tracking is off */
async function sendHeartbeat(state, source) {
  try {
    const response = await fetch(HEARTBEAT_URL, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, source }),
    });
    if (response.status === 401 || response.status === 403) return 'stop';
    if (!response.ok) return 'retry';
    const json = await response.json().catch(() => null);
    return json?.data?.state === 'off' ? 'stop' : 'ok';
  } catch {
    return 'retry'; // offline: the next heartbeat tries again
  }
}

/** Idle Detection is usable when the browser has it and the person allowed it. */
async function systemAllowed() {
  if (!hasIdleDetector()) return false;
  try {
    const status = await navigator.permissions.query({ name: 'idle-detection' });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

/** Reports changes and a heartbeat every minute until `signal` aborts; `stop` ends tracking. */
function createReporter(signal, stop) {
  const current = { state: null, source: null, paused: false, sentAt: -Infinity };
  let timer = 0;
  const beat = async () => {
    if (signal.aborted || current.paused || !current.state) return;
    current.sentAt = performance.now();
    if ((await sendHeartbeat(current.state, current.source)) === 'stop') stop();
  };
  const restartTimer = () => {
    clearInterval(timer);
    if (!signal.aborted && !current.paused) timer = setInterval(beat, BEAT_MS);
  };
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  return {
    current,
    beat,
    /** A new state (or the same one with force): heartbeat now, next one in a minute. */
    report(state, source, { force = false } = {}) {
      if (signal.aborted) return;
      const changed = state !== current.state || source !== current.source || current.paused;
      Object.assign(current, { state, source, paused: false });
      if (!changed && !force) return;
      beat();
      restartTimer();
    },
    /** Sends the last state once more (keeps the segment's end current), then stops beating. */
    pause() {
      beat();
      current.paused = true;
      clearInterval(timer);
    },
    refresh() {
      if (performance.now() - current.sentAt >= REFRESH_GAP_MS) beat();
    },
  };
}

/** Idle Detection: active, idle or locked for the whole computer. Throws when not allowed. */
async function watchSystem(reporter, { idleMs, signal }) {
  const detector = new window.IdleDetector();
  const read = () => {
    if (detector.screenState === 'locked') return 'locked';
    return detector.userState === 'idle' ? 'idle' : 'active';
  };
  detector.addEventListener('change', () => reporter.report(read(), 'system'));
  await detector.start({ threshold: idleMs, signal });
  reporter.report(read(), 'system');
}

/** Fallback: mouse and keyboard inside this window only; no reports while it's hidden. */
function watchWindow(reporter, { idleMs, signal }) {
  let lastInput = performance.now();
  const onInput = () => {
    lastInput = performance.now();
    if (isVisible() && reporter.current.state !== 'active') reporter.report('active', 'window');
  };
  const check = () => {
    if (!isVisible() || reporter.current.paused) return;
    reporter.report(performance.now() - lastInput < idleMs ? 'active' : 'idle', 'window');
  };
  for (const name of INPUT_EVENTS) {
    window.addEventListener(name, onInput, { passive: true, capture: true, signal });
  }
  const interval = setInterval(check, WINDOW_CHECK_MS);
  signal.addEventListener('abort', () => clearInterval(interval), { once: true });
  if (isVisible()) reporter.report('active', 'window');
}

/** Tracks until `signal` aborts (this tab's turn ends) or the server says stop. */
async function track({ idleMs, signal, stop, system }) {
  const reporter = createReporter(signal, stop);
  const onVisibility = () => {
    if (reporter.current.source !== 'window') return reporter.refresh();
    if (!isVisible()) return reporter.pause();
    return reporter.report('active', 'window', { force: true });
  };
  document.addEventListener('visibilitychange', onVisibility, { signal });
  window.addEventListener('pagehide', () => reporter.beat(), { signal });

  if (system) {
    try {
      if (!signal.aborted) await watchSystem(reporter, { idleMs, signal });
      return;
    } catch {
      // Permission withdrawn or Idle Detection failed: use the window instead.
    }
  }
  if (!signal.aborted) watchWindow(reporter, { idleMs, signal });
}

const untilAborted = (signal) =>
  new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', resolve, { once: true });
  });

/**
 * Runs `run(turnSignal)` while this tab holds the lock. A turn ends when `signal` aborts or
 * another tab steals the lock.
 * @returns {Promise<'stolen' | 'ended'>}
 */
async function holdLock({ steal, signal }, run) {
  const turn = new AbortController();
  const end = () => turn.abort();
  signal.addEventListener('abort', end, { once: true });
  let started = false;
  // A steal is granted at once, and the spec doesn't allow a signal with it.
  const options = steal ? { steal: true } : { signal };
  try {
    await navigator.locks.request(LOCK_NAME, options, async () => {
      if (signal.aborted) return;
      started = true;
      await run(turn.signal);
      await untilAborted(turn.signal);
    });
    return 'ended';
  } catch {
    // AbortError: unmounted while waiting, or another tab took the lock.
    return started && !signal.aborted ? 'stolen' : 'ended';
  } finally {
    signal.removeEventListener('abort', end);
    end();
  }
}

/** Idle Detection: wait in line for the lock, and again if a window-only tab took it. */
async function queueForLock(signal, run) {
  while (!signal.aborted) {
    if ((await holdLock({ steal: false, signal }, run)) !== 'stolen') return;
  }
}

/** Window only: the tab being looked at or used takes the lock (a hidden tab can't tell). */
function takeLockWhenUsed(signal, run) {
  let holding = false;
  const take = () => {
    if (holding || signal.aborted || !isVisible()) return;
    holding = true;
    holdLock({ steal: true, signal }, run).finally(() => {
      holding = false;
    });
  };
  for (const name of INPUT_EVENTS) {
    window.addEventListener(name, take, { passive: true, capture: true, signal });
  }
  document.addEventListener('visibilitychange', take, { signal });
  window.addEventListener('focus', take, { signal });
  take();
}

/**
 * Runs the tracker in this tab until `signal` aborts (unmount) or the server says stop (`stop`).
 * @param {{ idleMs: number, signal: AbortSignal, stop: () => void }} options
 */
export async function startTracking({ idleMs, signal, stop }) {
  const system = await systemAllowed();
  if (signal.aborted) return;
  const run = (turn) => track({ idleMs, signal: turn, stop, system });
  if (!navigator.locks?.request) {
    await run(signal);
    return;
  }
  if (system) await queueForLock(signal, run);
  else takeLockWhenUsed(signal, run);
}
