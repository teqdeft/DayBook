// The live bell's channels between tabs of one browser (CONTRACT 26): names, message builders, one
// BroadcastChannel object per name per tab, and My settings' `postPreferenceChange`. A
// BroadcastChannel never delivers a message to the object that posted it, so a posting tab applies
// its own message itself (local listeners here, or its own handler in the provider).

export const PREFS_CHANNEL = 'daybook-live-prefs';

/** The lock and the channel of one person's live check in this browser. */
export const liveName = (userId) => `daybook-live-${userId}`;

/** The lock that keeps a batch to one chime per browser. */
export const chimeLockName = (userId) => `daybook-chime-${userId}`;

/** A random id per page load (crypto.randomUUID where there is one). */
export function newTabId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `tab-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export const presenceMessage = ({ userId, tabId, visible, front, audio, at, gone = false }) => ({
  type: 'presence',
  userId,
  tabId,
  visible: !!visible,
  front: !!front,
  audio: !!audio,
  at,
  ...(gone ? { gone: true } : {}),
});

export const checkNowMessage = ({ userId, tabId }) => ({ type: 'check-now', userId, tabId });

export const resultMessage = ({ answer, checkedAt, frontTabId, soundTabId }) => ({
  type: 'result',
  userId: answer.userId,
  items: answer.items,
  more: !!answer.more,
  unreadCount: answer.unreadCount,
  latestId: answer.latestId,
  checkedAt,
  frontTabId: frontTabId ?? null,
  soundTabId: soundTabId ?? null,
});

export const readMessage = ({ userId, ids, unreadCount }) => ({
  type: 'read',
  userId,
  ids,
  unreadCount,
});

export const readAllMessage = ({ userId }) => ({ type: 'read-all', userId, unreadCount: 0 });

// name -> { channel, users }, per factory: the page's own (BroadcastChannel), or a test's (each fake
// tab passes its own factory, so tabs in one test process don't share channel objects).
const registries = new WeakMap();

/**
 * This tab's one channel object for `name` (shared by everyone who opens it here), or null when
 * the browser has no BroadcastChannel or it throws. Call the returned `release` when done.
 * @param {string} name
 * @param {(name: string) => BroadcastChannel} [factory]
 * @returns {{ channel: BroadcastChannel, release: () => void } | null}
 */
export function openChannel(name, factory = defaultFactory) {
  if (!registries.has(factory)) registries.set(factory, new Map());
  const channels = registries.get(factory);
  let entry = channels.get(name);
  if (!entry) {
    let channel;
    try {
      channel = factory(name);
    } catch {
      return null;
    }
    if (!channel) return null;
    entry = { channel, users: 0 };
    channels.set(name, entry);
  }
  entry.users += 1;
  let released = false;
  return {
    channel: entry.channel,
    release() {
      if (released) return;
      released = true;
      entry.users -= 1;
      if (entry.users > 0 || channels.get(name) !== entry) return;
      channels.delete(name);
      try {
        entry.channel.close();
      } catch {
        // already closed
      }
    },
  };
}

function defaultFactory(name) {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
}

const prefListeners = new Set();
let prefsUserId = null;

/** The provider names the signed-in person, so a preference message is only theirs. */
export function setPreferenceUser(userId) {
  prefsUserId = userId ?? null;
}

/**
 * Listens for `{ bellSound?, bellTone?, bellPreview? }` saved in My settings, from this tab or
 * another one of the same person.
 * @returns {() => void} unsubscribe
 */
export function onPreferenceChange(listener) {
  prefListeners.add(listener);
  return () => prefListeners.delete(listener);
}

const PREF_KEYS = ['bellSound', 'bellTone', 'bellPreview'];

/** Only the three live preferences, from a message or a call. */
export function pickPreferences(values) {
  const picked = {};
  for (const key of PREF_KEYS) if (values && Object.hasOwn(values, key)) picked[key] = values[key];
  return picked;
}

/**
 * My settings saved one of the live preferences (C calls it after a successful save): this tab
 * uses it at once and the other tabs on their next message, each until its next router.refresh()
 * brings the stored values.
 * @param {{ bellSound?: string, bellTone?: string, bellPreview?: boolean }} values
 */
export function postPreferenceChange(values) {
  const picked = pickPreferences(values);
  if (Object.keys(picked).length === 0) return;
  const message = {
    type: 'prefs',
    ...(prefsUserId !== null ? { userId: prefsUserId } : {}),
    ...picked,
  };
  prefListeners.forEach((listener) => listener(picked));
  const opened = openChannel(PREFS_CHANNEL);
  if (!opened) return;
  try {
    opened.channel.postMessage(message);
  } catch {
    // another tab picks it up after its next refresh
  } finally {
    opened.release();
  }
}
