// Fakes for the live engine's tests (CONTRACT 26): several tabs of one browser in one process. A
// fake navigator.locks (granted in the order asked, with steal), an in-memory BroadcastChannel bus
// that, like the real one, never echoes to the sender, a fake server behind fetch, and a tab maker
// around the real createLiveTab. Used with vitest's fake timers.
import { vi } from 'vitest';
import { createLiveStore } from '@/components/live/liveStore';
import { createLiveTab } from '@/components/live/liveTab';

export const USER = 4;
export const abortError = () => new DOMException('The lock request was aborted', 'AbortError');

/** navigator.locks for one browser: FIFO per name, `signal` to leave the line, `steal`. */
export function fakeLocks() {
  const queues = new Map();
  const queueOf = (name) => {
    if (!queues.has(name)) queues.set(name, { holder: null, waiting: [] });
    return queues.get(name);
  };
  function start(name, request) {
    const queue = queueOf(name);
    queue.holder = request;
    const done = (settle) => (value) => {
      if (queue.holder === request) {
        queue.holder = null;
        grant(name);
      }
      if (!request.stolen) settle(value);
    };
    Promise.resolve()
      .then(() => request.callback({ name }))
      .then(done(request.resolve), done(request.reject));
  }
  function grant(name) {
    const queue = queueOf(name);
    if (!queue.holder && queue.waiting.length > 0) start(name, queue.waiting.shift());
  }
  const locks = {
    steals: 0,
    request(name, options, callback) {
      const queue = queueOf(name);
      if (options.steal) locks.steals += 1;
      return new Promise((resolve, reject) => {
        const request = { callback, resolve, reject, stolen: false };
        if (options.signal) {
          if (options.signal.aborted) return reject(abortError());
          options.signal.addEventListener('abort', () => {
            const at = queue.waiting.indexOf(request);
            if (at === -1) return;
            queue.waiting.splice(at, 1);
            reject(abortError());
          });
        }
        if (options.steal) {
          if (queue.holder) {
            queue.holder.stolen = true;
            queue.holder.reject(abortError());
            queue.holder = null;
          }
          start(name, request);
        } else {
          queue.waiting.push(request);
          grant(name);
        }
        return undefined;
      });
    },
  };
  return locks;
}

/** One BroadcastChannel bus for the browser; each tab gets its own factory. */
export function fakeBus() {
  const byName = new Map();
  return {
    sent: [],
    factory() {
      return (name) => {
        if (!byName.has(name)) byName.set(name, new Set());
        const channel = {
          onmessage: null,
          postMessage: (message) => {
            this.sent.push(message);
            for (const other of byName.get(name)) {
              if (other === channel) continue;
              const data = structuredClone(message);
              queueMicrotask(() => other.onmessage?.({ data }));
            }
          },
          close: () => byName.get(name).delete(channel),
        };
        byName.get(name).add(channel);
        return channel;
      };
    },
  };
}

export const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

/** The person's notifications, served like GET /api/notifications?after=. */
export function fakeServer() {
  const rows = [];
  let nextId = 100;
  const server = {
    calls: [],
    inFlight: 0,
    maxInFlight: 0,
    add(extra = {}) {
      nextId += 1;
      rows.push({
        id: nextId,
        userId: USER,
        type: 'attendance.remind_check_in',
        title: `Notification ${nextId}`,
        body: null,
        link: '/today',
        readAt: null,
        createdAt: '2026-11-23T04:11:00.000Z',
        ...extra,
      });
      return nextId;
    },
    answer(after, userId = USER) {
      const mine = rows
        .filter((r) => r.userId === USER && r.id > after)
        .sort((a, b) => b.id - a.id);
      const items = mine.slice(0, 20).map(({ userId: _, ...row }) => row);
      return reply(200, {
        data: {
          userId,
          items,
          more: mine.length > 20,
          unreadCount: rows.filter((r) => !r.readAt).length,
          latestId: Math.max(after, items[0]?.id ?? 0),
        },
      });
    },
    fetchFor(name, respond) {
      return async (url) => {
        server.calls.push(name);
        server.inFlight += 1;
        server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
        try {
          const after = Number(new URL(url, 'http://daybook.test').searchParams.get('after'));
          const custom = respond ? await respond(after) : null;
          return custom ?? server.answer(after);
        } finally {
          server.inFlight -= 1;
        }
      };
    },
    count: (name) => server.calls.filter((call) => call === name).length,
  };
  return server;
}

/** Lets every pending microtask and zero-delay timer run. */
export const settle = async () => {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0);
};

/**
 * One tab: the real createLiveTab with its own store, the shared bus, locks and server.
 * `self` (visible, front, audio) and `prefs` are plain objects the test changes.
 */
export function makeTab(name, { bus, locks, server, respond, cursor = 100, ...self } = {}) {
  const state = { visible: true, front: false, audio: false, ...self };
  const store = createLiveStore({ userId: USER, cursor });
  const tab = {
    name,
    self: state,
    store,
    batches: [],
    events: [],
    stops: [],
    prefs: { choice: 'important', preview: true },
  };
  store.subscribe((event) => tab.events.push(event));
  tab.live = createLiveTab({
    tabId: name,
    userId: USER,
    store,
    fetch: server.fetchFor(name, respond),
    locks,
    channelFactory: bus?.factory(),
    now: () => Date.now(),
    random: () => 0.5,
    self: () => state,
    prefs: () => tab.prefs,
    alerted: () => new Set(),
    stackIds: () => [],
    onBatch: (batch) => tab.batches.push(batch),
    onStop: (reason) => tab.stops.push(reason),
  });
  return tab;
}
