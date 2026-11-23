// The alerted record of this browser (CONTRACT 26), in localStorage `daybook.live.<userId>`:
// `{ chimeAt, chimed: [[id, at], ...], shown: [[id, at], ...] }`. `chimed` = ids a tab chimed for,
// `shown` = ids whose card a tab showed while in front; each keeps the last 50 ids for 10 minutes.
// claimChime keeps a batch to one chime per browser and at most one every 10 s. Without storage
// (private mode, blocked) the tab keeps the same record in memory. Never sent anywhere.

export const CHIME_MIN_GAP_MS = 10_000;
export const RECORD_MAX_IDS = 50;
export const RECORD_MAX_AGE_MS = 10 * 60_000;

const memory = new Map(); // key -> record, when storage can't be used
let storageBroken = false;

const keyFor = (userId) => `daybook.live.${userId}`;
const emptyRecord = () => ({ chimeAt: 0, chimed: [], shown: [] });

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Only well-formed entries, newer than 10 minutes, the last 50. */
function prune(list, now) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (entry) =>
        Array.isArray(entry) &&
        Number.isFinite(entry[0]) &&
        Number.isFinite(entry[1]) &&
        now - entry[1] <= RECORD_MAX_AGE_MS,
    )
    .slice(-RECORD_MAX_IDS);
}

function clean(record, now) {
  return {
    chimeAt: Number.isFinite(record?.chimeAt) ? record.chimeAt : 0,
    chimed: prune(record?.chimed, now),
    shown: prune(record?.shown, now),
  };
}

/**
 * The record for a person, pruned.
 * @param {number} userId
 * @param {Storage | null} [storage] localStorage by default
 * @param {number} [now] the tab's clock (ms)
 */
export function readRecord(userId, storage = defaultStorage(), now = 0) {
  const key = keyFor(userId);
  if (storage && !storageBroken) {
    try {
      const raw = storage.getItem(key);
      return clean(raw ? JSON.parse(raw) : emptyRecord(), now);
    } catch {
      storageBroken = true;
    }
  }
  return clean(memory.get(key) ?? emptyRecord(), now);
}

function writeRecord(userId, record, storage) {
  const key = keyFor(userId);
  memory.set(key, record);
  if (!storage || storageBroken) return;
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    storageBroken = true;
  }
}

const addIds = (list, ids, now) => {
  const fresh = new Set(ids);
  return [...list.filter(([id]) => !fresh.has(id)), ...[...fresh].map((id) => [id, now])].slice(
    -RECORD_MAX_IDS,
  );
};

/**
 * Whether this tab may chime for `ids` now; on 'play' it writes `chimeAt` and the ids into
 * `chimed` first. Ids in `shown` don't count (a card of the same flush has just written them).
 * Run it inside the `daybook-chime-<userId>` lock where there is one (withChimeLock).
 * @param {{ userId: number, ids: number[], now: number, storage?: Storage | null,
 *   minGapMs?: number }} options
 * @returns {'play' | 'too_soon' | 'done_elsewhere'}
 */
export function claimChime({
  userId,
  ids,
  now,
  storage = defaultStorage(),
  minGapMs = CHIME_MIN_GAP_MS,
}) {
  const record = readRecord(userId, storage, now);
  if (now - record.chimeAt < minGapMs) return 'too_soon';
  const chimed = new Set(record.chimed.map(([id]) => id));
  if (ids.some((id) => chimed.has(id))) return 'done_elsewhere';
  writeRecord(
    userId,
    { ...record, chimeAt: now, chimed: addIds(record.chimed, ids, now) },
    storage,
  );
  return 'play';
}

/**
 * Cards shown while the tab is in front: a later system notification for them is silent.
 * @param {{ userId: number, ids: number[], now: number, storage?: Storage | null }} options
 */
export function markAlerted({ userId, ids, now, storage = defaultStorage() }) {
  if (!ids?.length) return;
  const record = readRecord(userId, storage, now);
  writeRecord(userId, { ...record, shown: addIds(record.shown, ids, now) }, storage);
}

/**
 * The ids this browser already alerted the person about (`chimed` or `shown`).
 * @returns {Set<number>}
 */
export function alertedIds({ userId, now, storage = defaultStorage() }) {
  const record = readRecord(userId, storage, now);
  return new Set([...record.chimed, ...record.shown].map(([id]) => id));
}

/** Whether `id` is in either list. */
export function isAlerted({ userId, id, now, storage = defaultStorage() }) {
  return alertedIds({ userId, now, storage }).has(Number(id));
}

/**
 * Runs `fn` inside the browser's `name` lock when there is one (so two tabs never claim at the
 * same moment), else at once.
 * @template T
 * @param {LockManager | null | undefined} locks
 * @param {string} name
 * @param {() => T} fn
 * @returns {Promise<T>}
 */
export async function withChimeLock(locks, name, fn) {
  if (!locks?.request) return fn();
  let ran = false;
  try {
    return await locks.request(name, () => {
      ran = true;
      return fn();
    });
  } catch (error) {
    if (ran) throw error;
    return fn(); // the lock itself failed: claim without it
  }
}

/** Tests only: forget the in-memory records and the broken-storage flag. */
export function resetChimeGateForTests() {
  memory.clear();
  storageBroken = false;
}
