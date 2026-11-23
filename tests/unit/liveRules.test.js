// The live bell's rules (CONTRACT 26): what is new for a tab, the poll delay, how many cards fit,
// which cards a batch gives (and when they wait), which tab may chime and whether it does, and the
// cards' and the announcement's copy.
import { describe, expect, it } from 'vitest';
import {
  announcement,
  cardLimit,
  gapOf,
  newItems,
  nextCursor,
  pickFrontTab,
  pickSoundTab,
  planCards,
  pollDelay,
  queueBatch,
  releaseQueue,
  seeLabel,
  shouldChime,
  summaryMore,
  summaryTitle,
} from '@/components/live/liveRules';

const item = (id, extra = {}) => ({
  id,
  type: 'leave.marked',
  title: `Notification ${id}`,
  body: null,
  link: '/today',
  readAt: null,
  createdAt: '2026-11-23T04:11:00.000Z',
  ...extra,
});

describe('newItems and nextCursor (the cursor)', () => {
  it('alerts nothing on the first answer with a null cursor, which sets the cursor', () => {
    expect(newItems([item(5), item(4)], null)).toEqual([]);
    expect(nextCursor(null, 5)).toBe(5);
    expect(nextCursor(null, null)).toBeNull();
  });

  it('never gives ids at or below the cursor', () => {
    const fresh = newItems([item(12), item(11), item(10), item(9)], 10);
    expect(fresh.map((n) => n.id)).toEqual([12, 11]);
  });

  it('never gives read items, yet the cursor rises to latestId', () => {
    const items = [item(12, { readAt: '2026-11-23T04:12:00.000Z' })];
    expect(newItems(items, 10)).toEqual([]);
    expect(nextCursor(10, 12)).toBe(12);
  });

  it('never gives items hidden in the bell (a delete waiting for its Undo)', () => {
    expect(newItems([item(12), item(11)], 10, new Set([12])).map((n) => n.id)).toEqual([11]);
    expect(newItems([item(12)], 10, [12])).toEqual([]);
  });

  it('never gives an older item marked unread again', () => {
    expect(newItems([item(8, { readAt: null })], 10)).toEqual([]);
  });

  it('never moves the cursor down', () => {
    expect(nextCursor(20, 12)).toBe(20);
    expect(nextCursor(20, null)).toBe(20);
    expect(nextCursor(20, 25)).toBe(25);
  });

  it('gives the new ones newest first', () => {
    expect(newItems([item(11), item(13), item(12)], 10).map((n) => n.id)).toEqual([13, 12, 11]);
  });
});

describe('gapOf', () => {
  it('counts from the newest result a follower handled, so its first check as leader is fresh', () => {
    const mountedAt = 0;
    const lastCheckedAt = 200_000; // a broadcast result handled 30 s ago
    expect(gapOf({ checkedAt: 230_000, lastCheckedAt, mountedAt })).toBe(30_000);
  });

  it('counts from the mount when the tab handled none', () => {
    expect(gapOf({ checkedAt: 12_000, lastCheckedAt: null, mountedAt: 10_000 })).toBe(2000);
  });
});

describe('pollDelay', () => {
  const middle = () => 0.5;

  it('is 30 s while a tab is visible and 60 s while all are hidden', () => {
    expect(pollDelay({ anyVisible: true, random: middle })).toBe(30_000);
    expect(pollDelay({ anyVisible: false, random: middle })).toBe(60_000);
  });

  it('drifts by a factor of 0.9 to 1.1', () => {
    expect(pollDelay({ anyVisible: true, random: () => 0 })).toBe(27_000);
    expect(pollDelay({ anyVisible: true, random: () => 1 })).toBe(33_000);
  });

  it('doubles per failure up to 5 minutes', () => {
    const delays = [0, 1, 2, 3, 4, 5].map((failures) =>
      pollDelay({ anyVisible: true, failures, random: middle }),
    );
    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(pollDelay({ anyVisible: false, failures: 3, random: middle })).toBe(300_000);
  });
});

describe('cardLimit', () => {
  it('holds 3, 2 at 640 px and narrower, 1 under 500 px high', () => {
    expect(cardLimit({ width: 1440, height: 900 })).toBe(3);
    expect(cardLimit({ width: 641, height: 900 })).toBe(3);
    expect(cardLimit({ width: 640, height: 900 })).toBe(2);
    expect(cardLimit({ width: 390, height: 844 })).toBe(2);
    expect(cardLimit({ width: 1440, height: 499 })).toBe(1);
    expect(cardLimit({ width: 390, height: 480 })).toBe(1);
  });
});

describe('planCards', () => {
  const base = {
    stack: [],
    preview: true,
    visible: true,
    bellOpen: false,
    wait: false,
    maxCards: 3,
    now: 1000,
  };
  const batchOf = (...ids) => ({ items: ids.map((id) => item(id)) });
  const ids = (stack) => stack.map((entry) => entry.items.map((n) => n.id));

  it('gives one card per item for 1 and 2, the newest on top', () => {
    const one = planCards({ ...base, batch: batchOf(5) });
    expect(one.reason).toBe('cards');
    expect(one.stack.map((entry) => entry.kind)).toEqual(['single']);
    expect(one.announce).toBe(true);
    const two = planCards({ ...base, batch: batchOf(5, 6) });
    expect(ids(two.stack)).toEqual([[6], [5]]);
  });

  it('gives one summary for 3 or more', () => {
    const plan = planCards({ ...base, batch: batchOf(5, 6, 7) });
    expect(plan.stack).toHaveLength(1);
    expect(plan.stack[0].kind).toBe('summary');
    expect(ids(plan.stack)).toEqual([[7, 6, 5]]);
  });

  it('pushes the oldest out for a fourth entry (2 on a phone)', () => {
    let stack = [];
    for (const id of [1, 2, 3]) stack = planCards({ ...base, stack, batch: batchOf(id) }).stack;
    const plan = planCards({ ...base, stack, batch: batchOf(4) });
    expect(ids(plan.stack)).toEqual([[4], [3], [2]]);
    expect(ids(plan.removed)).toEqual([[1]]);
    const phone = planCards({ ...base, maxCards: 2, stack: plan.stack, batch: batchOf(5) });
    expect(ids(phone.stack)).toEqual([[5], [4]]);
    expect(ids(phone.removed)).toEqual([[3], [2]]);
  });

  it('gives none with preview off or in a hidden tab, and no announcement', () => {
    for (const plan of [
      planCards({ ...base, preview: false, batch: batchOf(5) }),
      planCards({ ...base, visible: false, batch: batchOf(5) }),
    ]) {
      expect(plan.stack).toEqual([]);
      expect(plan.announce).toBe(false);
      expect(plan.queue).toBe(false);
    }
  });

  it('gives none while the bell list is open, but announces', () => {
    const plan = planCards({ ...base, bellOpen: true, batch: batchOf(5) });
    expect(plan.reason).toBe('bell_open');
    expect(plan.stack).toEqual([]);
    expect(plan.announce).toBe(true);
  });

  it('queues while a modal, an open search list or a paused stack waits', () => {
    const plan = planCards({ ...base, wait: true, batch: batchOf(5) });
    expect(plan.reason).toBe('wait');
    expect(plan.queue).toBe(true);
    expect(plan.stack).toEqual([]);
    expect(plan.announce).toBe(false);
  });

  it('queues a new entry while the stack is paused and shows it on resume', () => {
    const shown = planCards({ ...base, batch: batchOf(5) }).stack;
    const paused = planCards({ ...base, stack: shown, wait: true, batch: batchOf(6) });
    expect(paused.stack).toBe(shown);
    const queue = queueBatch([], batchOf(6), 2000);
    const released = releaseQueue(queue, 3000);
    const resumed = planCards({ ...base, stack: shown, batch: released, now: 3000 });
    expect(ids(resumed.stack)).toEqual([[6], [5]]);
  });

  it('releases items queued from several batches as one batch (3 or more: one summary)', () => {
    let queue = queueBatch([], batchOf(5), 1000);
    queue = queueBatch(queue, batchOf(6, 5), 1500); // no duplicates
    queue = queueBatch(queue, batchOf(7), 2000);
    const released = releaseQueue(queue, 2500);
    expect(released.items.map((n) => n.id)).toEqual([7, 6, 5]);
    const plan = planCards({ ...base, batch: released });
    expect(plan.stack).toHaveLength(1);
    expect(plan.stack[0].kind).toBe('summary');
    expect(announcement(released)).toBe('3 new notifications. The newest: Notification 7');
  });

  it("drops a queued item 5 minutes after it was queued by the tab's clock", () => {
    const queuedAt = 1_000_000;
    const past = item(5, { createdAt: '2020-01-01T00:00:00.000Z' });
    const future = item(6, { createdAt: '2040-01-01T00:00:00.000Z' });
    const queue = queueBatch([], { items: [past, future] }, queuedAt);
    expect(releaseQueue(queue, queuedAt + 300_000).items).toHaveLength(2);
    expect(releaseQueue(queue, queuedAt + 300_001)).toBeNull();
  });
});

describe('pickFrontTab and pickSoundTab', () => {
  const presence = (tabId, extra) => ({
    tabId,
    visible: false,
    front: false,
    audio: false,
    at: 0,
    ...extra,
  });

  it('takes the front tab: the checking tab itself, else the newest presence in front', () => {
    const presences = [
      presence('b', { front: true, at: 10 }),
      presence('c', { front: true, at: 20 }),
    ];
    expect(pickFrontTab({ presences, selfId: 'a', selfFront: true })).toBe('a');
    expect(pickFrontTab({ presences, selfId: 'a', selfFront: false })).toBe('c');
    expect(pickFrontTab({ presences: [], selfId: 'a', selfFront: false })).toBeNull();
  });

  it('picks the front tab when its audio runs', () => {
    const presences = [presence('b', { front: true, audio: true, at: 5 })];
    expect(pickSoundTab({ presences, selfId: 'a', selfAudio: true, frontTabId: 'b' })).toBe('b');
  });

  it('picks a hidden tab with audio over a front tab without it', () => {
    const presences = [
      presence('b', { front: true, visible: true, audio: false, at: 9 }),
      presence('c', { audio: true, at: 5 }),
    ];
    expect(pickSoundTab({ presences, selfId: 'a', selfAudio: false, frontTabId: 'b' })).toBe('c');
  });

  it('picks a hidden follower with audio when no tab is in front and the checker has none', () => {
    const presences = [presence('b', { audio: true, at: 5 })];
    expect(pickSoundTab({ presences, selfId: 'a', selfAudio: false, frontTabId: null })).toBe('b');
  });

  it('falls back to the checking tab when its own audio runs or nobody has audio', () => {
    const presences = [presence('b', { audio: true, at: 5 })];
    expect(pickSoundTab({ presences, selfId: 'a', selfAudio: true, frontTabId: null })).toBe('a');
    expect(pickSoundTab({ presences: [], selfId: 'a', selfAudio: false, frontTabId: null })).toBe(
      'a',
    );
    expect(pickSoundTab({ presences: [], selfId: 'a', selfAudio: false, frontTabId: 'b' })).toBe(
      'b',
    );
  });
});

describe('shouldChime', () => {
  const important = item(9, { type: 'attendance.remind_check_in' });
  const normal = item(8, { type: 'leave.marked' });
  const base = {
    choice: 'important',
    batch: { items: [important] },
    osSound: new Set(),
    gapMs: 30_000,
    tabId: 'a',
    soundTabId: 'a',
    frontTabId: 'a',
    push: { active: false, apple: false },
  };

  it('goes through every reason in order', () => {
    expect(shouldChime({ ...base, choice: 'off' })).toBe('off');
    expect(shouldChime({ ...base, batch: { items: [normal] } })).toBe('not_important');
    expect(shouldChime({ ...base, choice: 'all', batch: { items: [normal] } })).toBe('play');
    expect(shouldChime({ ...base, osSound: new Set([9]) })).toBe('os');
    expect(shouldChime({ ...base, push: { active: true, apple: true } })).toBe('os');
    expect(shouldChime({ ...base, gapMs: 150_001 })).toBe('stale');
    expect(shouldChime({ ...base, gapMs: 150_000 })).toBe('play');
    expect(shouldChime({ ...base, soundTabId: 'b' })).toBe('not_sound_tab');
    expect(shouldChime({ ...base, frontTabId: null, push: { active: true, apple: false } })).toBe(
      'not_sound_tab',
    );
    expect(shouldChime({ ...base, frontTabId: null })).toBe('play');
    expect(shouldChime(base)).toBe('play');
  });

  it('chimes under Important only when any item of the batch is important', () => {
    expect(shouldChime({ ...base, batch: { items: [normal, important] } })).toBe('play');
  });
});

describe('the copy', () => {
  const batch = (n, more = false) => ({
    items: Array.from({ length: n }, (_, i) => item(i + 1, { title: `Title ${i + 1}` })),
    more,
  });

  it('announces 1, 2, 3 and more', () => {
    expect(announcement(batch(1))).toBe('New notification: Title 1');
    expect(announcement(batch(2))).toBe('2 new notifications. The newest: Title 2');
    expect(announcement(batch(3))).toBe('3 new notifications. The newest: Title 3');
    expect(announcement(batch(20, true))).toBe(
      'More than 20 new notifications. The newest: Title 20',
    );
  });

  it('writes the summary', () => {
    expect(summaryTitle(3, false)).toBe('3 new notifications');
    expect(summaryMore(3, false)).toBe('and 2 more');
    expect(summaryTitle(20, true)).toBe('More than 20 new notifications');
    expect(summaryMore(20, true)).toBe('and more');
  });

  it('labels See them', () => {
    expect(seeLabel(3, 3, false)).toBe('See them');
    expect(seeLabel(5, 3, false)).toBe('See the newest 3');
    expect(seeLabel(3, 2, false)).toBe('See the newest 2');
    expect(seeLabel(3, 1, false)).toBeNull();
    expect(seeLabel(5, 3, true)).toBe('See them');
    expect(seeLabel(3, 1, true)).toBe('See them');
  });
});
