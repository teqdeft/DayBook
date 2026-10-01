'use client';
// Screen time recorder (CONTRACT section 11). Mounted once in AppFrame for tracked people with
// activity.self while screen time is on. It reports only whether the person is active, idle or
// has the screen locked; never apps, websites, keystrokes or screenshots.
//
// - First run: a notice, whose button asks for Idle Detection (the browser needs a click for it).
//   Tracking starts once the notice is closed.
// - The tracking itself (Idle Detection or the window fallback, heartbeats, one tracker per
//   browser through a Web Lock) is in ActivityTracker.track.js.
// - Automated browsers (navigator.webdriver: tests, screenshots) are never tracked.
import { useEffect, useState, useSyncExternalStore } from 'react';
import Button from './Button';
import Dialog from './Dialog';
import { hasIdleDetector, startTracking } from './ActivityTracker.track';
import styles from './ActivityTracker.module.css';

const NOTICE_TEXT =
  "Daybook records when you're active, idle or have the screen locked while the app is open. It never sees which apps or websites you use. Your manager can see it.";

// ---------- the notice choice, remembered per browser and person ----------
const noticeListeners = new Set();

function subscribeNotice(callback) {
  noticeListeners.add(callback);
  window.addEventListener('storage', callback);
  return () => {
    noticeListeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}

function readNotice(key) {
  try {
    return window.localStorage.getItem(key) === 'seen';
  } catch {
    return false; // storage blocked: the notice shows once per page load
  }
}

function saveNotice(key) {
  try {
    window.localStorage.setItem(key, 'seen');
  } catch {
    // Storage blocked or full: the choice lasts until the page reloads.
  }
  noticeListeners.forEach((callback) => callback());
}

const noopSubscribe = () => () => {};
const isAutomated = () => navigator.webdriver === true;

/** Tracks in this tab (see ActivityTracker.track.js) while `enabled`. */
function useTracker(enabled, idleMs) {
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const stop = () => controller.abort();
    startTracking({ idleMs, signal: controller.signal, stop }).catch(() => {});
    return stop;
  }, [enabled, idleMs]);
}

function NoticeStates({ idleMinutes }) {
  const rows = [
    ['active', 'Active', 'Using the mouse or keyboard.'],
    ['idle', 'Idle', `No mouse or keyboard for ${idleMinutes} min.`],
    ['locked', 'Screen locked', 'The computer is locked.'],
  ];
  return (
    <ul className={styles.states}>
      {rows.map(([key, label, help]) => (
        <li key={key} className={styles.state}>
          <span className={`${styles.dot} ${styles[key]}`} aria-hidden="true" />
          <span className={styles.stateLabel}>{label}</span>
          <span className={styles.stateHelp}>{help}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {{ userId: number, idleMinutes?: number }} props  idleMinutes: settings.activityIdleMinutes
 */
export default function ActivityTracker({ userId, idleMinutes = 5 }) {
  const key = `daybook.screenTimeNotice.${userId}`;
  const minutes = Math.max(1, Math.round(Number(idleMinutes) || 5));
  const stored = useSyncExternalStore(
    subscribeNotice,
    () => readNotice(key),
    () => null,
  );
  const automated = useSyncExternalStore(noopSubscribe, isAutomated, () => true);
  const systemSupported = useSyncExternalStore(noopSubscribe, hasIdleDetector, () => false);
  const [closed, setClosed] = useState(false);
  const [asking, setAsking] = useState(false);

  const seen = stored === true || closed;
  useTracker(!automated && seen && !asking, minutes * 60_000);

  function finish() {
    saveNotice(key);
    setClosed(true);
  }

  async function allow() {
    if (asking) return;
    if (hasIdleDetector()) {
      setAsking(true);
      try {
        // Must run inside the click: the browser only asks after a user gesture.
        await window.IdleDetector.requestPermission();
      } catch {
        // Dismissed or blocked: the window fallback is used.
      }
      setAsking(false);
    }
    finish();
  }

  return (
    <Dialog
      open={!automated && stored === false && !closed}
      onClose={finish}
      title="Screen time"
      description={NOTICE_TEXT}
      footer={
        <Button onClick={allow} loading={asking} data-autofocus>
          Got it
        </Button>
      }
    >
      <NoticeStates idleMinutes={minutes} />
      <p className={styles.note}>
        {systemSupported
          ? 'Your browser will ask to let Daybook know when this device is in use. Choose Allow so idle and locked time count for the whole computer.'
          : "This browser can't tell when the computer is idle, so Daybook only counts activity in its own window."}
      </p>
    </Dialog>
  );
}
