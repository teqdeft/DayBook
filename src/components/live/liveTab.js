// One tab's live engine (CONTRACT 26), without React or the DOM: leadership, the loop, presence
// (livePresence.js), answers (its own and broadcast ones), the batcher, the watchdog and the
// service worker's ask.
// LiveNotifications.jsx wires the page's events into it and shows the cards; the tests drive
// several of these against fake locks, channels, fetch and timers.
import { createBatcher } from './liveBatch';
import {
  checkNowMessage,
  newTabId,
  presenceMessage,
  readAllMessage,
  readMessage,
  resultMessage,
} from './liveChannel';
import { checkOnce } from './liveCheck';
import { startLeadership } from './liveLeader';
import { createLoop } from './liveLoop';
import { createPresences } from './livePresence';
import { gapOf, newItems, pollDelay, WATCHDOG_MS } from './liveRules';
import { answerPush } from './swAnswer';

const PRESENCE_EVERY_MS = 30_000;

/**
 * @param {{ userId: number, store: ReturnType<import('./liveStore').createLiveStore>,
 *   fetch: typeof fetch, locks?: LockManager | null, channelFactory?: Function,
 *   now: () => number, random?: () => number, setTimer?: Function, clearTimer?: Function,
 *   self: () => { visible: boolean, front: boolean, audio: boolean },
 *   prefs: () => { choice: string, preview: boolean },
 *   alerted?: () => Set<number>, stackIds?: () => Iterable<number>,
 *   onBatch: (batch: object) => void, onItemsRead?: (ids: number[] | 'all') => void,
 *   onBellOpen?: (open: boolean) => void, onStop?: (reason: string) => void,
 *   tabId?: string }} options
 */
export function createLiveTab(options) {
  const { userId, store, now, setTimer = setTimeout, clearTimer = clearTimeout } = options;
  const tabId = options.tabId ?? newTabId();
  const mountedAt = now();
  const presences = createPresences({ now, selfId: tabId });
  const osSound = new Set();
  let failures = 0;
  let lastResultAt = null;
  let followSince = null; // when the lead was stolen from this tab
  let lastCheckedAt = null;
  let stopped = false;
  let controller = null;
  let watchdog = null;
  let presenceTimer = null;
  let wasVisible = options.self().visible;

  const batcher = createBatcher({
    onFlush: (batch) => options.onBatch(batch),
    setTimer,
    clearTimer,
    now,
  });
  const anyVisible = () => options.self().visible || presences.anyVisible();
  // The watchdog counts from the last result, or from losing the lead: a tab whose lead was just
  // stolen waits a full 75 s before it takes it back (no steals back and forth while checks fail).
  const quietSince = () => Math.max(lastResultAt ?? mountedAt, followSince ?? -Infinity);

  const loop = createLoop({
    run: check,
    nextDelay: () => pollDelay({ anyVisible: anyVisible(), failures, random: options.random }),
    setTimer,
    clearTimer,
    now,
  });

  const leadership = startLeadership({
    userId,
    locks: options.locks,
    channelFactory: options.channelFactory,
    onLead() {
      clearTimer(watchdog);
      loop.setPeriodic(true);
      loop.trigger();
    },
    onFollow() {
      followSince = now();
      loop.setPeriodic(false);
      armWatchdog();
    },
    onMessage,
  });

  store.setHooks({
    onRead(ids, unreadCount, local) {
      batcher.read(ids);
      options.onItemsRead?.(ids);
      if (local) leadership.post(readMessage({ userId, ids, unreadCount }));
    },
    onReadAll(local) {
      batcher.readAll();
      options.onItemsRead?.('all');
      if (local) leadership.post(readAllMessage({ userId }));
    },
    onHidden: (id, on) => batcher.hide(id, on),
    onBellOpen: (open) => options.onBellOpen?.(open),
  });

  /** One live check by this tab: handled here, then broadcast. */
  async function check() {
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const outcome = await checkOnce({
      fetch: options.fetch,
      after: store.cursor,
      signal: controller?.signal,
      setTimer,
      clearTimer,
    });
    if (stopped) return;
    if (outcome.stop) {
      stop('signed_out');
      return;
    }
    if (outcome.retry) {
      failures += 1;
      return;
    }
    failures = 0;
    if (outcome.answer.userId !== userId) {
      stop('other_user');
      return;
    }
    const picked = presences.pick({ self: options.self(), fallback: leadership.isFallback() });
    const result = resultMessage({ answer: outcome.answer, checkedAt: now(), ...picked });
    handleResult(result);
    leadership.post(result);
  }

  /** A result, this tab's or another's: count, cursor, rows to the bell, new ones to the batch. */
  function handleResult(result) {
    if (stopped) return;
    if (result.userId !== userId) {
      stop('other_user');
      return;
    }
    const gapMs = gapOf({ checkedAt: result.checkedAt, lastCheckedAt, mountedAt });
    lastCheckedAt = Math.max(lastCheckedAt ?? -Infinity, result.checkedAt);
    lastResultAt = now();
    const items = newItems(result.items, store.cursor, store.hidden);
    store.applyAnswer(result);
    batcher.add(items, {
      gapMs,
      more: Boolean(result.more) && items.length > 0,
      soundTabId: result.soundTabId,
      frontTabId: result.frontTabId,
    });
    armWatchdog();
  }

  function onMessage(message) {
    if (stopped) return;
    if (message.type === 'presence') {
      // A tab that just opened learns at once which older tabs run audio (hidden ones post rarely).
      if (presences.apply(message)) postPresence();
    } else if (message.type === 'check-now') {
      if (leadership.isLeader()) loop.trigger();
    } else if (message.type === 'result') {
      handleResult(message);
    } else if (message.type === 'read') {
      store.applyRead(message.ids, message.unreadCount);
    } else if (message.type === 'read-all') {
      store.applyReadAll();
    }
  }

  /** A visible follower with no result for 75 s takes the lead (a frozen or sleeping leader). */
  function armWatchdog() {
    clearTimer(watchdog);
    watchdog = null;
    if (stopped || leadership.isLeader() || leadership.isFallback()) return;
    if (!options.self().visible) return;
    watchdog = setTimer(
      () => {
        watchdog = null;
        if (stopped || leadership.isLeader() || !options.self().visible) return;
        if (now() - quietSince() >= WATCHDOG_MS) leadership.takeLead();
        else armWatchdog();
      },
      Math.max(0, quietSince() + WATCHDOG_MS - now()),
    );
  }

  function postPresence({ gone = false } = {}) {
    const self = options.self();
    leadership.post(presenceMessage({ userId, tabId, ...self, at: now(), gone }));
    clearTimer(presenceTimer);
    presenceTimer = null;
    if (!gone && !stopped && self.visible) {
      presenceTimer = setTimer(() => postPresence(), PRESENCE_EVERY_MS);
    }
  }

  /** This tab or another asked for a check: the leader checks, a follower asks the leader. */
  function askForCheck() {
    if (leadership.isLeader()) loop.trigger();
    else leadership.post(checkNowMessage({ userId, tabId }));
  }

  function stop(reason) {
    if (stopped) return;
    stopped = true;
    controller?.abort();
    loop.stop();
    leadership.stop();
    batcher.dispose();
    clearTimer(watchdog);
    clearTimer(presenceTimer);
    options.onStop?.(reason);
  }

  const api = {
    tabId,
    osSound,
    batcher,
    isLeader: () => leadership.isLeader(),
    isFallback: () => leadership.isFallback(),
    isStopped: () => stopped,
    /** Not stopped, not backing off, and a successful answer handled in the last 75 s. */
    running: () =>
      !stopped && failures === 0 && lastResultAt !== null && now() - lastResultAt <= WATCHDOG_MS,
    /** `window.__daybookLive.checkNow()`: one check here now (no 5 s gap), resolved once handled. */
    checkNow: () => loop.trigger({ force: true }),
    /** Visibility, focus or the audio changed: tell the others; coming back asks for a check. */
    selfChanged() {
      if (stopped) return;
      const { visible } = options.self();
      postPresence();
      if (visible && !wasVisible) askForCheck();
      wasVisible = visible;
      armWatchdog();
    },
    /** A 1.10 worker's plain message (no ask, no port): check soon, as the 1.10 bell reloaded. */
    nudge() {
      if (!stopped) askForCheck();
    },
    /** Window `online`: failures reset, check at once. */
    online() {
      failures = 0;
      if (!stopped) askForCheck();
    },
    /** The service worker's ask: answer on the port at once, then check (CONTRACT 26). */
    answerAsk(data, reply) {
      if (stopped) return;
      const { choice, preview } = options.prefs();
      const self = options.self();
      const pendingIds = new Set([...batcher.pendingIds(), ...(options.stackIds?.() ?? [])]);
      const answer = answerPush({
        data,
        userId,
        cursor: store.cursor,
        inFront: self.front,
        running: api.running(),
        // Sound Off, or a tab of this browser can make the sound (else the system one does).
        canSound: choice === 'off' || self.audio || presences.anyAudio(),
        preview,
        bellOpen: store.bellOpen,
        choice,
        alertedIds: options.alerted?.() ?? new Set(),
        pendingIds,
      });
      reply(answer);
      if (answer.osSound && Number.isFinite(Number(data?.id))) osSound.add(Number(data.id));
      if (answer.shown || leadership.isFallback()) loop.trigger();
      else askForCheck();
    },
    /** The worker showed a system notification: when it made a sound, this tab won't chime. */
    osShown(data) {
      if (!stopped && !data?.silent && Number.isFinite(Number(data?.id))) {
        osSound.add(Number(data.id));
      }
    },
    /** The page is frozen (`freeze`): the others stop counting on it until it posts again. */
    frozen() {
      if (!stopped) postPresence({ gone: true });
    },
    /** pagehide or unmount: tell the others this tab is gone, then stop. */
    leave(reason = 'pagehide') {
      if (stopped) return;
      postPresence({ gone: true });
      stop(reason);
    },
    stop,
  };

  postPresence();
  armWatchdog();
  return api;
}
