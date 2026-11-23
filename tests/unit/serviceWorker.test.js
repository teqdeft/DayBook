// public/sw.js (CONTRACT 14, 26) run in node:vm with a fake self, clients, registration and
// MessageChannel: a push asks every Daybook window first; a focused visible window that answers
// `shown` gets no system notification (unless mustShow), `alerted` makes it silent (never with
// mustShow), no answer in 1 s shows it as in 1.10, and notificationclick is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://daybook.example.com';
const SOURCE = fs.readFileSync(path.resolve(import.meta.dirname, '../../public/sw.js'), 'utf8');

/** A MessageChannel whose port2.postMessage reaches port1.onmessage on a later microtask. */
class FakeMessageChannel {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = {
      postMessage: (data) => queueMicrotask(() => this.port1.onmessage?.({ data })),
    };
  }
}

/**
 * A window client. `answer(message)` gives the page's reply to an ask ({ shown, alerted }), or
 * undefined for a page that never answers (a 1.10 bundle).
 */
function windowClient({ focused = false, visible = true, url = `${ORIGIN}/today`, answer } = {}) {
  const client = {
    url,
    focused,
    visibilityState: visible ? 'visible' : 'hidden',
    messages: [],
    postMessage: vi.fn((message, ports = []) => {
      client.messages.push({ message, ports: ports.length });
      const reply = answer?.(message);
      if (ports[0] && reply !== undefined) ports[0].postMessage(reply);
    }),
    focus: vi.fn(async () => client),
    navigate: vi.fn(async () => client),
  };
  return client;
}

/** Loads sw.js with these windows and this push subscription endpoint (null = none). */
function loadWorker({ windows = [], endpoint = 'https://fcm.googleapis.com/fcm/send/abc' } = {}) {
  const listeners = {};
  const shown = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    skipWaiting: vi.fn(),
    clients: {
      matchAll: vi.fn(async () => windows),
      claim: vi.fn(async () => {}),
      openWindow: vi.fn(async () => null),
    },
    registration: {
      showNotification: vi.fn(async (title, options) => {
        shown.push({ title, options });
      }),
      pushManager: { getSubscription: vi.fn(async () => (endpoint ? { endpoint } : null)) },
    },
  };
  const context = vm.createContext({
    self,
    URL,
    MessageChannel: FakeMessageChannel,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  });
  vm.runInContext(SOURCE, context, { filename: 'sw.js' });

  /** Fires `push` with this JSON payload and resolves when its waitUntil settles. */
  function firePush(payload) {
    let work = null;
    listeners.push({
      data: { json: () => payload, text: () => JSON.stringify(payload) },
      waitUntil: (promise) => {
        work = promise;
      },
    });
    return work;
  }

  function fireClick(url) {
    let work = null;
    const notification = { data: { url }, close: vi.fn() };
    listeners.notificationclick({ notification, waitUntil: (promise) => (work = promise) });
    return { work, notification };
  }

  return { self, shown, firePush, fireClick };
}

const PAYLOAD = {
  id: 42,
  userId: 7,
  title: 'Neha Kapoor reminded you to check in',
  body: 'You are past your late mark.',
  url: `${ORIGIN}/today`,
};
const showsCard = (message) => ({ shown: message.userId === 7, alerted: false });

afterEach(() => {
  vi.useRealTimers();
});

describe('sw.js push', () => {
  it('shows nothing when a focused, visible window answers that it shows the card', async () => {
    const front = windowClient({ focused: true, answer: showsCard });
    const worker = loadWorker({ windows: [front] });
    await worker.firePush(PAYLOAD);
    expect(worker.self.registration.showNotification).not.toHaveBeenCalled();
    expect(front.messages).toEqual([
      {
        message: { type: 'daybook:notification', ask: true, id: 42, userId: 7, mustShow: false },
        ports: 1,
      },
    ]);
  });

  it('still shows it with mustShow, from the payload or an Apple subscription', async () => {
    const front = windowClient({ focused: true, answer: showsCard });
    const fromPayload = loadWorker({ windows: [front] });
    await fromPayload.firePush({ ...PAYLOAD, mustShow: true });
    expect(fromPayload.shown).toHaveLength(1);
    expect(front.messages[0].message.mustShow).toBe(true);

    const safari = windowClient({ focused: true, answer: showsCard });
    const apple = loadWorker({ windows: [safari], endpoint: 'https://web.push.apple.com/abc' });
    await apple.firePush(PAYLOAD);
    expect(apple.shown).toHaveLength(1);
    expect(safari.messages[0].message.mustShow).toBe(true);
  });

  it('shows it without silent when no window answers within 1 s', async () => {
    vi.useFakeTimers();
    const silentPage = windowClient({ focused: true, answer: () => undefined });
    const worker = loadWorker({ windows: [silentPage] });
    const work = worker.firePush(PAYLOAD);
    await vi.advanceTimersByTimeAsync(999);
    expect(worker.shown).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await work;
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].options).not.toHaveProperty('silent');
  });

  it('shows it when the window that answers shown is visible but not focused', async () => {
    const other = windowClient({ focused: false, visible: true, answer: showsCard });
    const hidden = windowClient({ focused: true, visible: false, answer: showsCard });
    const worker = loadWorker({ windows: [other, hidden] });
    await worker.firePush(PAYLOAD);
    expect(worker.shown).toHaveLength(1);
    expect(worker.shown[0].options).not.toHaveProperty('silent');
  });

  it('makes it silent when a window says this browser already alerted it, never with mustShow', async () => {
    const alerted = () => ({ shown: false, alerted: true });
    const worker = loadWorker({ windows: [windowClient({ answer: alerted })] });
    await worker.firePush(PAYLOAD);
    expect(worker.shown[0].options.silent).toBe(true);

    const apple = loadWorker({
      windows: [windowClient({ answer: alerted })],
      endpoint: 'https://web.push.apple.com/abc',
    });
    await apple.firePush(PAYLOAD);
    expect(apple.shown[0].options).not.toHaveProperty('silent');
    const mustShow = loadWorker({ windows: [windowClient({ answer: alerted })] });
    await mustShow.firePush({ ...PAYLOAD, mustShow: true });
    expect(mustShow.shown[0].options).not.toHaveProperty('silent');
  });

  it('asks every Daybook window at once and tells each what happened after', async () => {
    const first = windowClient({ answer: () => ({ shown: false, alerted: true }) });
    const second = windowClient({ url: `${ORIGIN}/report`, answer: () => ({ shown: false }) });
    const elsewhere = windowClient({ url: 'https://other.example/x', answer: showsCard });
    const worker = loadWorker({ windows: [first, second, elsewhere] });
    await worker.firePush(PAYLOAD);
    const ask = { type: 'daybook:notification', ask: true, id: 42, userId: 7, mustShow: false };
    const told = { type: 'daybook:notification', os: true, id: 42, silent: true };
    for (const client of [first, second]) {
      expect(client.messages).toEqual([
        { message: ask, ports: 1 },
        { message: told, ports: 0 },
      ]);
    }
    expect(elsewhere.postMessage).not.toHaveBeenCalled();
  });

  it('shows a payload without userId (the page never claims it)', async () => {
    const front = windowClient({ focused: true, answer: showsCard });
    const worker = loadWorker({ windows: [front] });
    const { userId, ...old } = PAYLOAD;
    expect(userId).toBe(7);
    await worker.firePush(old);
    expect(front.messages[0].message).toMatchObject({ ask: true, userId: null });
    expect(worker.shown).toHaveLength(1);
    expect(front.messages[1].message).toEqual({
      type: 'daybook:notification',
      os: true,
      id: 42,
      silent: false,
    });
  });

  it('keeps the 1.10 title, body, tag and same-origin url', async () => {
    const worker = loadWorker({ windows: [] });
    await worker.firePush({ ...PAYLOAD, url: 'https://evil.example/requests?x=1#y' });
    expect(worker.shown).toEqual([
      {
        title: 'Neha Kapoor reminded you to check in',
        options: {
          body: 'You are past your late mark.',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          tag: 'daybook-42',
          timestamp: expect.any(Number),
          data: { url: '/requests?x=1#y' },
        },
      },
    ]);
    const bare = loadWorker({ windows: [], endpoint: null });
    await bare.firePush({ body: 42 });
    expect(bare.shown[0].title).toBe('Daybook');
    expect(bare.shown[0].options.body).toBe('');
    expect(bare.shown[0].options.data).toEqual({ url: '/' });
  });

  it('shows it when asking a window throws', async () => {
    const broken = windowClient({ focused: true });
    broken.postMessage.mockImplementation(() => {
      throw new Error('closed');
    });
    const worker = loadWorker({ windows: [broken] });
    await worker.firePush(PAYLOAD);
    expect(worker.shown).toHaveLength(1);
  });
});

describe('sw.js notificationclick (unchanged)', () => {
  it('asks the focused Daybook window to open the link', async () => {
    const page = windowClient({
      focused: true,
      answer: (message) => (message.type === 'daybook:open' ? true : undefined),
    });
    const worker = loadWorker({ windows: [page] });
    const { work, notification } = worker.fireClick('/requests');
    await work;
    expect(notification.close).toHaveBeenCalled();
    expect(page.focus).toHaveBeenCalled();
    expect(page.messages).toEqual([
      { message: { type: 'daybook:open', url: '/requests' }, ports: 1 },
    ]);
    expect(page.navigate).not.toHaveBeenCalled();
  });

  it('opens a new window when no Daybook window is open', async () => {
    const worker = loadWorker({ windows: [windowClient({ url: 'https://other.example/' })] });
    await worker.fireClick('https://evil.example/log').work;
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('/log');
  });
});
