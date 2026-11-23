// The live bell's rules (CONTRACT 26), pure: what is new for a tab, how long until the next live
// check, how many cards fit, which cards a batch gives, which tab may chime and whether it does,
// and the cards' and the announcement's copy. No React, no browser; every input is passed in.
import { isImportant } from '@/modules/notifications/alerts';

export const VISIBLE_MS = 30_000;
export const HIDDEN_MS = 60_000;
export const MAX_BACKOFF_MS = 300_000;
export const CHECK_GAP_MS = 5000;
/** A live check that hasn't answered in this long is aborted and counts as an error. */
export const CHECK_TIMEOUT_MS = 20_000;
export const WATCHDOG_MS = 75_000;
export const STALE_GAP_MS = 150_000;
export const MAX_CARDS = 3;
export const MAX_CARDS_PHONE = 2;
export const MAX_CARDS_SHORT = 1;
export const SHORT_WINDOW_PX = 500;
export const PHONE_MAX_PX = 640;
export const CARD_MS = 6000;
export const RESUME_MIN_MS = 2000;
export const QUEUE_MAX_AGE_MS = 300_000;
/** From this many items a batch shows one summary card. */
export const SUMMARY_FROM = 3;

const byIdDesc = (a, b) => b.id - a.id;

/**
 * The new notifications of one answer for a tab: above the cursor the tab had before it, unread
 * and not hidden in the bell (a delete waiting for its Undo). A null cursor is the baseline: none.
 * @param {Array<{ id: number, readAt?: string | null }>} items
 * @param {number | null} cursor
 * @param {Set<number> | number[]} [hidden]
 * @returns {object[]} newest first
 */
export function newItems(items, cursor, hidden = new Set()) {
  if (cursor === null || cursor === undefined || !Array.isArray(items)) return [];
  const skip = hidden instanceof Set ? hidden : new Set(hidden);
  return items
    .filter((item) => item.id > cursor && (item.readAt ?? null) === null && !skip.has(item.id))
    .sort(byIdDesc);
}

/** The cursor after an answer: it only goes up; a null cursor takes the answer's `latestId`. */
export function nextCursor(cursor, latestId) {
  const latest = Number.isFinite(latestId) ? latestId : null;
  if (cursor === null || cursor === undefined) return latest;
  return latest === null ? cursor : Math.max(cursor, latest);
}

/**
 * How long since this tab's previous answer (its own or a broadcast one), or since it mounted.
 * @returns {number} ms
 */
export function gapOf({ checkedAt, lastCheckedAt = null, mountedAt }) {
  return checkedAt - (lastCheckedAt ?? mountedAt);
}

/**
 * The delay before the leader's next live check: 30 s while any Daybook tab is visible, else 60 s,
 * doubled per failure up to 5 minutes, times 0.9 to 1.1 so browsers drift apart.
 * @param {{ anyVisible: boolean, failures?: number, random?: () => number }} options
 * @returns {number} ms
 */
export function pollDelay({ anyVisible, failures = 0, random = Math.random }) {
  const base = anyVisible ? VISIBLE_MS : HIDDEN_MS;
  const delay = Math.min(base * 2 ** Math.max(0, failures), MAX_BACKOFF_MS);
  return Math.round(delay * (0.9 + 0.2 * random()));
}

/** How many entries the stack holds: 3, 2 at 640 px and narrower, 1 under 500 px high. */
export function cardLimit({ width, height }) {
  if (height < SHORT_WINDOW_PX) return MAX_CARDS_SHORT;
  if (width <= PHONE_MAX_PX) return MAX_CARDS_PHONE;
  return MAX_CARDS;
}

/** One stack entry per item, or one summary for 3 or more (or `more`); newest on top. */
export function entriesFor(batch, now) {
  const items = [...batch.items].sort(byIdDesc);
  if (items.length >= SUMMARY_FROM || batch.more) {
    return [{ key: `summary-${items[0].id}-${now}`, kind: 'summary', items, more: !!batch.more }];
  }
  return items.map((item) => ({ key: `item-${item.id}`, kind: 'single', items: [item] }));
}

/**
 * What a batch's flush does with the cards (CONTRACT 26 "When cards show"), in that order.
 * `reason`: 'preview_off' | 'hidden' | 'bell_open' | 'wait' (queue the items) | 'cards'.
 * @param {{ stack: object[], batch: { items: object[], more?: boolean }, preview: boolean,
 *   visible: boolean, bellOpen: boolean, wait: boolean, maxCards: number, now: number }} options
 * @returns {{ reason: string, stack: object[], added: object[], removed: object[],
 *   queue: boolean, announce: boolean }}
 */
export function planCards({ stack, batch, preview, visible, bellOpen, wait, maxCards, now }) {
  const none = { stack, added: [], removed: [], queue: false, announce: false };
  if (!batch?.items?.length) return { ...none, reason: 'empty' };
  if (!preview) return { ...none, reason: 'preview_off' };
  if (!visible) return { ...none, reason: 'hidden' };
  if (bellOpen) return { ...none, reason: 'bell_open', announce: true };
  if (wait) return { ...none, reason: 'wait', queue: true };
  const added = entriesFor(batch, now);
  const keys = new Set(added.map((entry) => entry.key));
  const all = [...added, ...stack.filter((entry) => !keys.has(entry.key))];
  const limit = Math.max(1, maxCards);
  return {
    reason: 'cards',
    stack: all.slice(0, limit),
    added: added.slice(0, limit),
    removed: all.slice(limit),
    queue: false,
    announce: true,
  };
}

/** The queue with a batch's items added (by id, no duplicates), each stamped with the tab's clock. */
export function queueBatch(queue, batch, now) {
  const have = new Set(queue.map((entry) => entry.item.id));
  const added = batch.items
    .filter((item) => !have.has(item.id))
    .map((item) => ({ item, queuedAt: now, more: !!batch.more }));
  return [...queue, ...added];
}

/**
 * Everything queued, as one batch (items queued more than 5 minutes ago by the tab's clock are
 * dropped; `createdAt` doesn't count). Null when nothing is left.
 * @returns {{ items: object[], more: boolean } | null}
 */
export function releaseQueue(queue, now) {
  const fresh = queue.filter((entry) => now - entry.queuedAt <= QUEUE_MAX_AGE_MS);
  if (fresh.length === 0) return null;
  return {
    items: fresh.map((entry) => entry.item).sort(byIdDesc),
    more: fresh.some((entry) => entry.more),
  };
}

/**
 * The tab in front (the checking tab counts itself), else null.
 * @param {{ presences: Array<{ tabId: string, front: boolean, at: number }>, selfId: string,
 *   selfFront: boolean }} options
 */
export function pickFrontTab({ presences, selfId, selfFront }) {
  if (selfFront) return selfId;
  const front = presences
    .filter((presence) => presence.front && presence.tabId !== selfId)
    .sort((a, b) => b.at - a.at)[0];
  return front?.tabId ?? null;
}

/**
 * The one tab that may chime for a result: the front tab when its audio runs; else the checking
 * tab when its own does; else the newest tab whose audio runs; else the front tab, else itself.
 * @param {{ presences: Array<{ tabId: string, audio: boolean, at: number }>, selfId: string,
 *   selfAudio: boolean, frontTabId: string | null }} options
 * @returns {string}
 */
export function pickSoundTab({ presences, selfId, selfAudio, frontTabId }) {
  const audioOf = (tabId) =>
    tabId === selfId ? selfAudio : presences.some((p) => p.tabId === tabId && p.audio);
  if (frontTabId && audioOf(frontTabId)) return frontTabId;
  if (selfAudio) return selfId;
  const withAudio = presences
    .filter((presence) => presence.audio && presence.tabId !== selfId)
    .sort((a, b) => b.at - a.at)[0];
  return withAudio?.tabId ?? frontTabId ?? selfId;
}

/**
 * Rules 1 to 5 of "When it chimes" (CONTRACT 26); 'play' when this tab goes on to `ready()` and
 * `claimChime`. Reasons: 'off', 'not_important', 'os', 'stale', 'not_sound_tab', 'play'.
 * @param {{ choice: 'important' | 'all' | 'off', batch: { items: object[] },
 *   osSound: Set<number>, gapMs: number, tabId: string, soundTabId: string | null,
 *   frontTabId: string | null, push: { active: boolean, apple: boolean } }} options
 */
export function shouldChime({
  choice,
  batch,
  osSound,
  gapMs,
  tabId,
  soundTabId,
  frontTabId,
  push,
}) {
  const items = batch?.items ?? [];
  if (choice === 'off') return 'off';
  if (choice !== 'all' && !items.some((item) => isImportant(item.type))) return 'not_important';
  if (items.some((item) => osSound?.has(item.id)) || (push?.active && push.apple)) return 'os';
  if (gapMs > STALE_GAP_MS) return 'stale';
  if (frontTabId == null && push?.active) return 'not_sound_tab';
  if (tabId !== soundTabId) return 'not_sound_tab';
  return 'play';
}

/** The summary's title: "3 new notifications", or "More than 20 new notifications". */
export function summaryTitle(count, more) {
  return more ? 'More than 20 new notifications' : `${count} new notifications`;
}

/** The summary's second line: "and 2 more", or "and more". */
export function summaryMore(count, more) {
  return more ? 'and more' : `and ${count - 1} more`;
}

/**
 * The summary's first button: "See them" (it opens the bell, or the batch fits the stack), "See
 * the newest 3" (it shows the newest that fit), or null (one card fits and there is no bell).
 */
export function seeLabel(count, maxCards, hasBell) {
  if (hasBell) return 'See them';
  if (maxCards <= 1) return null;
  return count <= maxCards ? 'See them' : `See the newest ${maxCards}`;
}

/** What the status region says when a batch's cards appear (bodies are never read out). */
export function announcement(batch) {
  const items = [...(batch?.items ?? [])].sort(byIdDesc);
  if (items.length === 0) return '';
  const newest = items[0].title;
  if (batch.more) return `More than 20 new notifications. The newest: ${newest}`;
  if (items.length === 1) return `New notification: ${newest}`;
  return `${items.length} new notifications. The newest: ${newest}`;
}
