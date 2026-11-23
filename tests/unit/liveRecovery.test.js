// The live engine when things go wrong (CONTRACT 26), with the fakes of tests/helpers/liveFakes.js
// and fake timers: a check that never answers, checks that keep failing with two visible tabs,
// tabs hidden for minutes, a tab opened in front after a hidden one, a frozen tab, and the service
// worker's ask from a tab in front that nobody has clicked yet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkOnce } from '@/components/live/liveCheck';
import { CHECK_TIMEOUT_MS } from '@/components/live/liveRules';
import { answerPush } from '@/components/live/swAnswer';
import { fakeBus, fakeLocks, fakeServer, makeTab, reply, settle, USER } from '../helpers/liveFakes';

const never = () => new Promise(() => {}); // a request the host or a proxy holds for ever
const ask = (id) => ({
  type: 'daybook:notification',
  ask: true,
  id,
  userId: USER,
  mustShow: false,
});

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

const hide = (tab) => {
  Object.assign(tab.self, { visible: false, front: false });
  tab.live.selfChanged();
};

const answerOf = (tab, id) => {
  const answers = [];
  tab.live.answerAsk(ask(id), (answer) => answers.push(answer));
  return answers[0];
};

describe('a live check that never answers', () => {
  it('gives up after 20 s, aborts the request and counts as an error', async () => {
    let signal = null;
    const pending = checkOnce({
      fetch: (url, init) => {
        signal = init.signal;
        return never();
      },
      after: 7,
    });
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ retry: true });
    expect(signal.aborted).toBe(true);
    expect(CHECK_TIMEOUT_MS).toBe(20_000);
  });

  it('lets a lone tab check again, and runs the triggers that waited behind it', async () => {
    let hang = false;
    const a = open('a', { respond: () => (hang ? never() : null) });
    await settle();
    expect(server.count('a')).toBe(1);
    hang = true;
    const stalled = a.live.checkNow();
    await settle();
    expect(server.count('a')).toBe(2);
    hang = false;
    server.add();
    await vi.advanceTimersByTimeAsync(1000);
    a.live.online(); // waits behind the stalled check
    let done = false;
    stalled.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await settle();
    expect(done).toBe(true);
    expect(server.count('a')).toBe(3);
    expect(a.store.cursor).toBe(101);
    expect(a.live.running()).toBe(true);
  });

  it('backs off after a stalled check like a network error', async () => {
    let hang = false;
    const a = open('a', { respond: () => (hang ? never() : null) });
    await settle();
    hang = true;
    a.live.checkNow();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await settle();
    expect(a.live.running()).toBe(false);
    hang = false;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(server.count('a')).toBe(2);
    await vi.advanceTimersByTimeAsync(1000); // 60 s: the first step of the backoff
    await settle();
    expect(server.count('a')).toBe(3);
    expect(a.live.running()).toBe(true);
  });
});

describe('the watchdog while every check fails', () => {
  it('takes the lead at most once per 75 s with two visible tabs', async () => {
    let failing = false;
    const respond = () => (failing ? reply(500, {}) : null);
    const a = open('a', { respond });
    open('b', { respond });
    await settle();
    expect(a.live.isLeader()).toBe(true);
    failing = true; // offline, a restart answering 5xx, the host at its process limit
    for (let ms = 0; ms < 80_000; ms += 100) await vi.advanceTimersByTimeAsync(100);
    expect(locks.steals).toBe(1);
    const fetches = server.calls.length;
    for (let ms = 0; ms < 60_000; ms += 100) await vi.advanceTimersByTimeAsync(100);
    expect(locks.steals).toBe(1); // the tab that lost the lead waits a full 75 s
    expect(server.calls.length - fetches).toBeLessThanOrEqual(2); // the backoff holds
    failing = false;
    for (let ms = 0; ms < 120_000; ms += 100) await vi.advanceTimersByTimeAsync(100);
    const steals = locks.steals;
    for (let ms = 0; ms < 120_000; ms += 100) await vi.advanceTimersByTimeAsync(100);
    expect(locks.steals).toBe(steals); // results again: no more steals
  });
});

describe('the sound tab when tabs stay hidden', () => {
  it('still names the hidden follower whose audio runs after 2 minutes', async () => {
    const a = open('a'); // leads, never clicked
    const b = open('b', { front: true, audio: true });
    await settle();
    expect(a.live.isLeader()).toBe(true);
    hide(a);
    hide(b);
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    server.add();
    await a.live.checkNow();
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.batches.at(-1).soundTabId).toBe('b');
    expect(b.batches.at(-1).soundTabId).toBe('b');
  });

  it('lets a tab opened later learn an older hidden tab’s audio at once', async () => {
    const a = open('a', { audio: true });
    await settle();
    hide(a);
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    const c = open('c', { front: true });
    await settle();
    server.add();
    await c.live.checkNow();
    await vi.advanceTimersByTimeAsync(1500);
    expect(c.batches.at(-1).soundTabId).toBe('a');
  });

  it('stops counting on a frozen tab until it resumes', async () => {
    const a = open('a');
    const b = open('b', { audio: true });
    await settle();
    hide(b);
    b.live.frozen();
    await settle();
    server.add();
    await a.live.checkNow();
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.batches.at(-1).soundTabId).toBe('a');
    b.live.selfChanged(); // resume
    await settle();
    server.add();
    await vi.advanceTimersByTimeAsync(5000);
    await a.live.checkNow();
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.batches.at(-1).soundTabId).toBe('b');
  });
});

describe('the ask from a tab in front that nobody has clicked', () => {
  it('doesn’t answer shown when no tab can make the sound: the system notification sounds', async () => {
    const a = open('a', { front: true });
    await settle();
    expect(a.live.running()).toBe(true);
    const id = server.add();
    expect(answerOf(a, id)).toEqual({ shown: false, alerted: false, osSound: true });
  });

  it('answers shown when its own audio runs, or Sound is Off', async () => {
    const a = open('a', { front: true, audio: true });
    await settle();
    expect(answerOf(a, server.add())).toEqual({ shown: true, alerted: false, osSound: false });
    a.self.audio = false;
    a.prefs = { choice: 'off', preview: true };
    expect(answerOf(a, server.add())).toMatchObject({ shown: true, alerted: true });
  });

  it('answers shown when a hidden tab’s audio runs, even one hidden for minutes', async () => {
    const a = open('a', { audio: true });
    await settle();
    hide(a);
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    const c = open('c', { front: true });
    await vi.advanceTimersByTimeAsync(60_000); // the hidden leader's next check reaches it
    await settle();
    expect(c.live.running()).toBe(true);
    expect(answerOf(c, server.add())).toEqual({ shown: true, alerted: false, osSound: false });
  });

  it('is the rule of answerPush: canSound false never shows', () => {
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
    expect(answerPush({ ...base, canSound: false })).toEqual({
      shown: false,
      alerted: false,
      osSound: true,
    });
    expect(answerPush({ ...base, canSound: true }).shown).toBe(true);
  });
});
