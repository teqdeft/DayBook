'use client';
// Wires the page into one tab's live engine (CONTRACT 26): the engine itself (liveTab.js), the
// page's visibility and focus, `freeze` and `resume`, `online`, `pagehide` and `pageshow`, the
// service worker's messages, the preference messages from other tabs, the sound's unlock listeners
// and `window.__daybookLive`. A 401, 403 or another person's answer stops it for good (until a new
// page load, or a page back from the back-forward cache).
import { useEffect, useRef } from 'react';
import { now } from '@/lib/time';
import { getChimePlayer } from './chime';
import { alertedIds } from './chimeGate';
import { PREFS_CHANNEL, onPreferenceChange, openChannel, pickPreferences } from './liveChannel';
import { createLiveTab } from './liveTab';

const clock = () => now().valueOf();

/** The page's own state for presence and the rules. */
export function pageState() {
  const visible = document.visibilityState === 'visible';
  return {
    visible,
    front: visible && document.hasFocus(),
    audio: getChimePlayer().state() === 'running',
  };
}

function listenToWorker(engine, signal) {
  const worker = typeof navigator === 'undefined' ? null : navigator.serviceWorker;
  if (!worker?.addEventListener) return;
  worker.addEventListener(
    'message',
    (event) => {
      const data = event.data;
      if (data?.type !== 'daybook:notification') return;
      if (data.ask) {
        const port = event.ports?.[0];
        engine.answerAsk(data, (answer) => {
          try {
            port?.postMessage(answer);
          } catch {
            // the worker shows the notification after 1 s
          }
        });
      } else if (data.os) engine.osShown(data);
      else engine.nudge();
    },
    { signal },
  );
}

function listenToPage(engine, signal) {
  const changed = () => engine.selfChanged();
  document.addEventListener('visibilitychange', changed, { signal });
  window.addEventListener('focus', changed, { signal });
  window.addEventListener('blur', changed, { signal });
  // A frozen page can't check or chime: the others stop counting on it until it resumes.
  document.addEventListener('freeze', () => engine.frozen(), { signal });
  document.addEventListener('resume', changed, { signal });
  window.addEventListener('online', () => engine.online(), { signal });
  window.addEventListener('pagehide', () => engine.leave('pagehide'), { signal });
}

/** Preferences saved in My settings, in this tab or another tab of the same person. */
function listenToPrefs(userId, onPrefs, signal) {
  // This tab's own saves: a BroadcastChannel never delivers to the object that posted.
  signal.addEventListener('abort', onPreferenceChange(onPrefs));
  const opened = openChannel(PREFS_CHANNEL);
  if (!opened) return;
  const onMessage = (event) => {
    const message = event?.data;
    if (message?.type !== 'prefs') return;
    if (message.userId !== undefined && message.userId !== userId) return;
    onPrefs(pickPreferences(message));
  };
  opened.channel.addEventListener('message', onMessage);
  signal.addEventListener('abort', () => {
    opened.channel.removeEventListener('message', onMessage);
    opened.release();
  });
}

/**
 * @param {{ userId: number, store: object, callbacks: { current: { prefs: () => object,
 *   onBatch: Function, onItemsRead: Function, onBellOpen: Function, onPrefs: Function,
 *   stackIds: () => Iterable<number>, choice: () => string } } }} options `callbacks` is a ref
 *   to the provider's latest handlers, so the engine never restarts for a re-render.
 * @returns {{ current: ReturnType<typeof createLiveTab> | null }}
 */
export function useLiveEngine({ userId, store, callbacks }) {
  const engineRef = useRef(null);

  useEffect(() => {
    const player = getChimePlayer();
    let listeners = null;
    let engine = null;
    let hook = null; // this engine's window.__daybookLive

    function start() {
      listeners = new AbortController();
      const { signal } = listeners;
      engine = createLiveTab({
        userId,
        store,
        fetch: (...args) => window.fetch(...args),
        locks: navigator.locks ?? null,
        now: clock,
        self: pageState,
        prefs: () => callbacks.current.prefs(),
        alerted: () => alertedIds({ userId, now: clock() }),
        stackIds: () => callbacks.current.stackIds(),
        onBatch: (batch) => callbacks.current.onBatch(batch),
        onItemsRead: (ids) => callbacks.current.onItemsRead(ids),
        onBellOpen: (open) => callbacks.current.onBellOpen(open),
        onStop: () => {
          listeners.abort();
          player.listen(false);
          if (window.__daybookLive === hook) delete window.__daybookLive;
        },
      });
      engineRef.current = engine;
      const current = engine;
      hook = {
        checkNow: () => current.checkNow(),
        get cursor() {
          return store.cursor;
        },
        isLeader: () => current.isLeader(),
      };
      window.__daybookLive = hook;
      listenToPage(current, signal);
      listenToWorker(current, signal);
      listenToPrefs(userId, (values) => callbacks.current.onPrefs(values), signal);
      const offState = player.onState(() => current.selfChanged());
      signal.addEventListener('abort', offState);
      player.listen(callbacks.current.choice() !== 'off');
    }

    // A page back from the back-forward cache asks for the lock again and checks.
    function onPageShow(event) {
      if (event.persisted && engine?.isStopped()) start();
    }

    start();
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      engine?.leave('unmount');
      engineRef.current = null;
    };
  }, [userId, store, callbacks]);

  return engineRef;
}
