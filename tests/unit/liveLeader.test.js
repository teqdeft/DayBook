// Leader and followers (CONTRACT 26), with three tabs of one browser in one process (the fakes in
// tests/helpers/liveFakes.js: navigator.locks with steal, a BroadcastChannel bus that never echoes
// to the sender, a fake server behind fetch), and fake timers. Also the service worker's ask
// (answerPush) and one chime per batch without locks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChimeGateForTests } from '@/components/live/chimeGate';
import { checkOnce } from '@/components/live/liveCheck';
import { decideChime } from '@/components/live/liveSound';
import { answerPush } from '@/components/live/swAnswer';
import { fakeBus, fakeLocks, fakeServer, makeTab, reply, settle, USER } from '../helpers/liveFakes';

describe('leader and followers', () => {
  let bus;
  let locks;
  let server;
  let tabs;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = fakeBus();
    locks = fakeLocks();
    server = fakeServer();
    tabs = [];
  });

  afterEach(() => {
    tabs.forEach((tab) => tab.live.stop());
    vi.useRealTimers();
  });

  const open = (name, options) => {
    const tab = makeTab(name, { bus, locks, server, ...options });
    tabs.push(tab);
    return tab;
  };
  const items = (tab) => tab.events.filter((e) => e.kind === 'items');

  it('lets the first tab lead and fetch alone; its results reach the others', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map((name) => open(name));
    await settle();
    expect(a.live.isLeader()).toBe(true);
    expect(b.live.isLeader()).toBe(false);
    expect(server.calls).toEqual(['a']);
    server.add();
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(server.calls).toEqual(['a', 'a']);
    for (const tab of [a, b, c]) {
      expect(
        items(tab)
          .at(-1)
          .items.map((n) => n.id),
      ).toEqual([101]);
      expect(tab.store.cursor).toBe(101);
    }
    await vi.advanceTimersByTimeAsync(1500);
    for (const tab of [a, b, c])
      expect(tab.batches.map((x) => x.items.map((n) => n.id))).toEqual([[101]]);
    expect(a.batches[0].soundTabId).toBe('a');
  });

  it('brings the leader’s own check to its own store with a single tab', async () => {
    const a = open('a');
    server.add();
    await settle();
    expect(items(a)).toHaveLength(1);
    expect(a.store.unread).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.batches).toHaveLength(1);
  });

  it('coalesces check-now to one check per 5 s', async () => {
    open('a');
    const b = open('b');
    await settle();
    expect(server.count('a')).toBe(1);
    b.live.online();
    b.live.online();
    await vi.advanceTimersByTimeAsync(1000);
    b.live.online();
    await settle();
    expect(server.count('a')).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    await settle();
    expect(server.count('a')).toBe(2);
    expect(server.count('b')).toBe(0);
  });

  it('runs a trigger during a check in flight once after it, never two in parallel', async () => {
    let release;
    let slow = true;
    const a = open('a', {
      respond: () => (slow ? new Promise((resolve) => (release = () => resolve(null))) : null),
    });
    await settle();
    expect(server.count('a')).toBe(1);
    const first = a.live.checkNow();
    const second = a.live.checkNow();
    await settle();
    expect(server.count('a')).toBe(1);
    slow = false;
    release();
    await settle();
    await Promise.all([first, second]);
    expect(server.count('a')).toBe(2);
    expect(server.maxInFlight).toBe(1);
  });

  it('gives the lead to the next tab when the leader stops, which checks at once', async () => {
    const a = open('a');
    const b = open('b');
    await settle();
    a.live.leave();
    await settle();
    expect(b.live.isLeader()).toBe(true);
    expect(server.count('b')).toBe(1);
  });

  it('stops the loop on a 401, releases the lock and never touches window.location', async () => {
    const location = { href: 'http://daybook.test/today', assign: vi.fn(), replace: vi.fn() };
    globalThis.window = { location };
    try {
      const a = open('a', { respond: () => reply(401, { error: { code: 'UNAUTHORIZED' } }) });
      const b = open('b');
      await settle();
      expect(a.stops).toEqual(['signed_out']);
      expect(a.live.isStopped()).toBe(true);
      expect(b.live.isLeader()).toBe(true);
      expect(location.href).toBe('http://daybook.test/today');
      expect(location.assign).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(server.count('a')).toBe(1);
    } finally {
      delete globalThis.window;
    }
    const fetch = vi.fn(async () => reply(403, {}));
    expect(await checkOnce({ fetch, after: 5 })).toEqual({ stop: true });
    expect(fetch.mock.calls[0][0]).toBe('/api/notifications?after=5');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
  });

  it('backs off after a 400, a 404 or a network error', async () => {
    let failing = 3;
    const answers = [reply(400, {}), reply(404, {}), null];
    open('a', {
      respond: () => {
        if (failing <= 0) return null;
        failing -= 1;
        const answer = answers.shift();
        if (!answer) throw new TypeError('Failed to fetch');
        return answer;
      },
    });
    await settle();
    expect(server.count('a')).toBe(1); // 400
    await vi.advanceTimersByTimeAsync(59_999);
    expect(server.count('a')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(server.count('a')).toBe(2); // 404, after 60 s
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(server.count('a')).toBe(3); // network error, after 120 s
    await vi.advanceTimersByTimeAsync(240_000);
    await settle();
    expect(server.count('a')).toBe(4); // a success after 240 s resets it
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(server.count('a')).toBe(5);
    expect(await checkOnce({ fetch: async () => reply(500, {}), after: 0 })).toEqual({
      retry: true,
    });
  });

  it('ignores and stops on a result for another person, posting nothing', async () => {
    server.add();
    const a = open('a', { respond: (after) => server.answer(after, 99) });
    await settle();
    expect(a.stops).toEqual(['other_user']);
    expect(a.store.cursor).toBe(100);
    expect(items(a)).toHaveLength(0);
    expect(bus.sent.filter((m) => m.type === 'result')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.batches).toHaveLength(0);
    expect(a.live.isLeader()).toBe(false);
    const b = open('b'); // the lock was released: the next tab leads
    await settle();
    expect(b.live.isLeader()).toBe(true);
  });

  it('lets a visible tab’s watchdog take the lead from a frozen leader after 75 s', async () => {
    const a = open('a', { respond: () => new Promise(() => {}), visible: false }); // never answers
    const b = open('b');
    await settle();
    expect(a.live.isLeader()).toBe(true);
    await vi.advanceTimersByTimeAsync(74_000);
    await settle();
    expect(server.count('b')).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(b.live.isLeader()).toBe(true);
    expect(server.count('b')).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    expect(server.count('b')).toBe(2);
    expect(a.live.isLeader()).toBe(false); // asked again as a follower after its AbortError
    expect(a.live.isStopped()).toBe(false);
    b.live.leave();
    await settle();
    expect(a.live.isLeader()).toBe(true); // it was back in line
  });

  it('lets every tab poll without locks, and claimChime lets only one chime', async () => {
    resetChimeGateForTests();
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const [a, b, c] = ['a', 'b', 'c'].map((name) => open(name, { locks: null }));
    await settle();
    expect(server.calls.sort()).toEqual(['a', 'b', 'c']);
    server.add();
    for (const tab of [a, b, c]) await tab.live.checkNow();
    await vi.advanceTimersByTimeAsync(1500);
    const played = [];
    const reasons = [];
    for (const tab of [a, b, c]) {
      expect(tab.batches).toHaveLength(1);
      expect(tab.batches[0].frontTabId).toBeNull();
      expect(tab.batches[0].soundTabId).toBe(tab.name);
      reasons.push(
        await decideChime({
          batch: tab.batches[0],
          userId: USER,
          tabId: tab.name,
          choice: 'important',
          tone: 'chime',
          osSound: tab.live.osSound,
          pushState: async () => ({ active: false, apple: false }),
          player: { ready: async () => true, play: (info) => played.push(tab.name, info) },
          locks: null,
          storage,
          now: () => Date.now(),
        }),
      );
    }
    expect(reasons).toEqual(['play', 'too_soon', 'too_soon']); // the same batch, 10 s rule first
    expect(played).toHaveLength(2);
  });

  it('checks at once after answering shown, even as a follower', async () => {
    open('a');
    const b = open('b', { front: true, audio: true });
    await settle();
    expect(b.live.running()).toBe(true);
    const id = server.add();
    const answers = [];
    b.live.answerAsk({ type: 'daybook:notification', ask: true, id, userId: USER }, (x) =>
      answers.push(x),
    );
    expect(answers).toEqual([{ shown: true, alerted: false, osSound: false }]);
    await settle();
    expect(server.count('b')).toBe(1);
    expect(
      items(b)
        .at(-1)
        .items.map((n) => n.id),
    ).toEqual([id]);
  });

  it('asks the leader to check when it didn’t answer shown', async () => {
    const a = open('a');
    const b = open('b', { visible: false });
    await settle();
    b.live.answerAsk({ ask: true, id: 500, userId: USER }, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(server.count('b')).toBe(0);
    expect(server.count('a')).toBe(2);
    expect(b.live.osSound.has(500)).toBe(false); // a hidden tab learns it from the os message
    b.live.osShown({ os: true, id: 500, silent: false });
    expect(b.live.osSound.has(500)).toBe(true);
    a.live.osShown({ os: true, id: 501, silent: true });
    expect(a.live.osSound.has(501)).toBe(false);
  });
});

describe('answerPush', () => {
  const base = {
    data: { id: 120, userId: USER, mustShow: false },
    userId: USER,
    cursor: 110,
    inFront: true,
    running: true,
    preview: true,
    bellOpen: false,
    choice: 'important',
    alertedIds: new Set(),
    pendingIds: new Set(),
  };

  it('shows a new id in front', () => {
    expect(answerPush(base)).toEqual({ shown: true, alerted: false, osSound: false });
  });

  it('doesn’t show an id the page already had when it loaded', () => {
    expect(answerPush({ ...base, data: { ...base.data, id: 105 } })).toEqual({
      shown: false,
      alerted: false,
      osSound: true,
    });
  });

  it('shows an id in the open batch or the queue, without osSound', () => {
    const data = { ...base.data, id: 105 };
    expect(answerPush({ ...base, data, pendingIds: new Set([105]) })).toEqual({
      shown: true,
      alerted: false,
      osSound: false,
    });
  });

  it('never shows another person’s, or a 1.10 payload without userId', () => {
    expect(answerPush({ ...base, data: { ...base.data, userId: 9 } }).shown).toBe(false);
    expect(answerPush({ ...base, data: { id: 120 } }).shown).toBe(false);
  });

  it('doesn’t show with preview off and the list closed, and the system sound plays', () => {
    expect(answerPush({ ...base, preview: false })).toEqual({
      shown: false,
      alerted: false,
      osSound: true,
    });
    expect(answerPush({ ...base, preview: false, bellOpen: true }).shown).toBe(true);
  });

  it('is alerted (silent) in front with preview off and Sound Off', () => {
    expect(answerPush({ ...base, preview: false, choice: 'off' })).toEqual({
      shown: false,
      alerted: true,
      osSound: false,
    });
  });

  it('doesn’t show from a tab that had no result for 75 s', () => {
    expect(answerPush({ ...base, running: false }).shown).toBe(false);
  });

  it('gives osSound for mustShow unless alerted', () => {
    const data = { ...base.data, mustShow: true };
    expect(answerPush({ ...base, data })).toEqual({ shown: true, alerted: false, osSound: true });
    expect(answerPush({ ...base, data, alertedIds: new Set([120]) })).toEqual({
      shown: true,
      alerted: true,
      osSound: false,
    });
  });

  it('gives a hidden tab no osSound', () => {
    expect(answerPush({ ...base, inFront: false })).toEqual({
      shown: false,
      alerted: false,
      osSound: false,
    });
  });
});
