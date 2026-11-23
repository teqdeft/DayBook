'use client';
// The live bell (CONTRACT 26), mounted once in AppFrame around the shell so it runs on every
// signed-in page, with or without a bell. While Daybook is open it notices new notifications by
// itself (one leader tab per browser checks every 30 s while a tab is visible, 60 s while all are
// hidden), shows a preview card for each new one (a summary for 3 or more), announces it, and
// plays the person's sound once per batch in one tab. First load is quiet: only notifications
// newer than what this tab has seen count. The bell follows through `useLiveNotifications()`.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { now } from '@/lib/time';
import { useBellPreview, useBellSound, useBellTone, useUserPrefs } from '../UserPrefs';
import { TONE_NAMES, getChimePlayer } from './chime';
import { markAlerted } from './chimeGate';
import { setPreferenceUser } from './liveChannel';
import { announcement, cardLimit, planCards } from './liveRules';
import { decideChime } from './liveSound';
import { createLiveStore } from './liveStore';
import LiveCards from './LiveCards';
import { blockedNow, createWaitWatch } from './previewWait';
import { desktopPushActive } from './pushActive';
import { pageState, useLiveEngine } from './useLiveEngine';
import { useStack } from './useStack';

const LiveContext = createContext(null);
const SOUNDS = ['important', 'all', 'off'];
const ANNOUNCE_CLEAR_MS = 5000;
const clock = () => now().valueOf();
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * The live store, or null outside the provider (the dev shell demo; the bell then works as in
 * 1.10): `{ userId, unread, subscribe, setUnread, reportRead, reportReadAll, reportHidden,
 * registerBell, setBellOpen, markSeen }` (CONTRACT 26).
 */
export function useLiveNotifications() {
  return useContext(LiveContext);
}

/** The person's three live preferences; a `prefs` message counts until the next refresh. */
function useLivePrefs() {
  const base = useUserPrefs();
  const sound = useBellSound();
  const tone = useBellTone();
  const preview = useBellPreview();
  const [override, setOverride] = useState({ base, values: {} });
  const values = override.base === base ? override.values : {};
  const apply = (next) =>
    setOverride((old) => ({ base, values: { ...(old.base === base ? old.values : {}), ...next } }));
  return {
    choice: SOUNDS.includes(values.bellSound) ? values.bellSound : sound,
    tone: TONE_NAMES.includes(values.bellTone) ? values.bellTone : tone,
    preview: typeof values.bellPreview === 'boolean' ? values.bellPreview : preview,
    apply,
  };
}

/** The status region's text: cleared, set on the next frame (so it is read), cleared after 5 s. */
function useAnnouncer() {
  const [text, setText] = useState('');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const announce = (next) => {
    setText('');
    clearTimeout(timer.current);
    requestAnimationFrame(() => setText(next));
    timer.current = setTimeout(() => setText(''), ANNOUNCE_CLEAR_MS);
  };
  return [text, announce];
}

/**
 * @param {{ userId: number, latestId: number | null, tz?: string, push?: boolean,
 *   children: import('react').ReactNode }} props `latestId` = the person's newest notification
 *   id when the page was rendered (read once, at mount); `push` = desktop push is on for the
 *   company with keys.
 */
export default function LiveNotifications({ userId, latestId, tz, push = false, children }) {
  const [store] = useState(() => createLiveStore({ userId, cursor: latestId }));
  const prefs = useLivePrefs();
  const [said, announce] = useAnnouncer();
  const callbacks = useRef(null);
  const watchRef = useRef(null); // the MutationObserver, made on first use (never during render)
  const {
    entries,
    hidden,
    api: stack,
    sectionRef,
    forget,
  } = useStack({
    now: clock,
    bellButton: () => store.bellButton(),
    onIdle: () => callbacks.current?.onIdle(),
  });
  const engineRef = useLiveEngine({ userId, store, callbacks });

  function syncWatch() {
    if (!watchRef.current) {
      watchRef.current = createWaitWatch((blocked) => callbacks.current?.onBlocked(blocked));
    }
    watchRef.current.sync(stack.count() > 0 || Boolean(engineRef.current?.batcher.hasQueue()));
  }

  /** A batch's cards and announcement (a flush, or the queue let out). */
  function present(batch, fromQueue) {
    const visible = document.visibilityState === 'visible';
    const plan = planCards({
      stack: stack.liveEntries(),
      batch,
      preview: prefs.preview,
      visible,
      bellOpen: store.bellOpen,
      wait: !fromQueue && (blockedNow() || stack.isPaused()),
      maxCards: cardLimit(viewport()),
      now: clock(),
    });
    if (plan.queue) engineRef.current?.batcher.enqueue(batch);
    if (plan.reason === 'cards') {
      stack.show(plan.added, plan.removed);
      const ids = plan.added.flatMap((entry) => entry.items.map((item) => item.id));
      if (pageState().front) markAlerted({ userId, ids, now: clock() });
    }
    if (plan.announce && (plan.reason === 'cards' || !fromQueue)) announce(announcement(batch));
    syncWatch();
  }

  function chime(batch) {
    const engine = engineRef.current;
    if (!engine || engine.isStopped()) return;
    decideChime({
      batch,
      userId,
      tabId: engine.tabId,
      choice: prefs.choice,
      tone: prefs.tone,
      osSound: engine.osSound,
      pushState: () => desktopPushActive({ pushConfigured: push }),
      player: getChimePlayer(),
      locks: navigator.locks ?? null,
      now: clock,
    }).catch(() => {});
  }

  function release() {
    const batch = engineRef.current?.batcher.takeQueue();
    if (batch) present(batch, true);
    syncWatch();
  }

  useLayoutEffect(() => {
    callbacks.current = {
      prefs: () => ({ choice: prefs.choice, preview: prefs.preview }),
      choice: () => prefs.choice,
      stackIds: () => stack.ids(),
      onBatch(batch) {
        present(batch, false);
        chime(batch);
      },
      onItemsRead: (ids) => stack.closeFor(ids),
      onBellOpen: (open) => open && stack.closeAll({ now: true }),
      onPrefs: prefs.apply,
      onBlocked(blocked) {
        stack.setBlocked(blocked);
        if (!blocked && !stack.isPaused()) release();
        syncWatch();
      },
      onIdle() {
        if (!blockedNow() && !stack.isPaused()) release();
        syncWatch();
      },
    };
  });

  useEffect(() => {
    setPreferenceUser(userId);
    return () => setPreferenceUser(null);
  }, [userId]);

  // The sound's unlock listeners only while Sound isn't Off.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine && !engine.isStopped()) getChimePlayer().listen(prefs.choice !== 'off');
  }, [prefs.choice, engineRef]);

  useEffect(
    () => () => {
      watchRef.current?.sync(false);
      forget();
    },
    [forget],
  );

  return (
    <LiveContext.Provider value={store}>
      {children}
      <LiveCards
        entries={entries}
        hidden={hidden}
        stack={stack}
        sectionRef={sectionRef}
        store={store}
        tz={tz ?? 'Asia/Kolkata'}
        maxCards={() => cardLimit(viewport())}
      />
      <div role="status" className="visually-hidden">
        {said}
      </div>
    </LiveContext.Provider>
  );
}
