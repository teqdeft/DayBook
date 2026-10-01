// Desktop notifications in the browser (CONTRACT 14): the bell switch's turnOn / turnOff and the
// per-page sync, against a fake browser (service worker, PushManager, Notification, storage) and
// a fake /api/push/subscriptions. No real browser or network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLIC_KEY = Buffer.alloc(65, 7).toString('base64url');
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-browser';

/** A fake browser with one service worker registration; `subscribed` starts it subscribed. */
function fakeBrowser({ permission = 'granted', subscribed = false, wanted = null } = {}) {
  const storage = new Map(wanted ? [['daybook.push.wanted', String(wanted)]] : []);
  const browser = { permission, subscription: null, requests: [], deleteFails: false };

  function makeSubscription() {
    const subscription = {
      endpoint: ENDPOINT,
      options: { applicationServerKey: new Uint8Array(Buffer.from(PUBLIC_KEY, 'base64url')) },
      unsubscribeWorks: true,
      toJSON: () => ({
        endpoint: ENDPOINT,
        expirationTime: null,
        keys: { p256dh: 'p', auth: 'a' },
      }),
      unsubscribe: vi.fn(async () => {
        if (!subscription.unsubscribeWorks) throw new Error('unsubscribe failed');
        browser.subscription = null;
        return true;
      }),
    };
    return subscription;
  }
  if (subscribed) browser.subscription = makeSubscription();

  const registration = {
    pushManager: {
      getSubscription: async () => browser.subscription,
      subscribe: vi.fn(async () => {
        browser.subscription = makeSubscription();
        return browser.subscription;
      }),
    },
  };
  class FakeNotification {
    static get permission() {
      return browser.permission;
    }
    static requestPermission = vi.fn(async () => browser.permission);
  }
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('window', {
    isSecureContext: true,
    PushManager: class {},
    Notification: FakeNotification,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path, init) => {
      browser.requests.push({ path, method: init.method, body: JSON.parse(init.body ?? 'null') });
      if (init.method === 'DELETE' && browser.deleteFails) throw new TypeError('offline');
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    }),
  );
  browser.wanted = () => storage.get('daybook.push.wanted') ?? null;
  browser.registration = registration;
  browser.Notification = FakeNotification;
  return browser;
}

let helpers;

beforeEach(async () => {
  vi.resetModules(); // a fresh "page load" (the sync remembers its last run per page)
  helpers = await import('@/components/NotificationBell.push');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('turnOn', () => {
  it('asks once, subscribes with the VAPID key, saves it and remembers who turned it on', async () => {
    const browser = fakeBrowser({ permission: 'default' });
    browser.Notification.requestPermission.mockImplementation(async () => {
      browser.permission = 'granted';
      return 'granted';
    });
    expect(await helpers.turnOn({ publicKey: PUBLIC_KEY, userId: 7 })).toBe('on');
    expect(browser.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(browser.requests).toEqual([
      {
        path: '/api/push/subscriptions',
        method: 'POST',
        body: expect.objectContaining({ endpoint: ENDPOINT }),
      },
    ]);
    expect(browser.wanted()).toBe('7');
  });

  it('says Blocked, without subscribing, when the person says no', async () => {
    const browser = fakeBrowser({ permission: 'denied' });
    expect(await helpers.turnOn({ publicKey: PUBLIC_KEY, userId: 7 })).toBe('blocked');
    expect(browser.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(browser.requests).toHaveLength(0);
  });
});

describe('turnOff', () => {
  it('unsubscribes this browser, removes it on the server and forgets the choice', async () => {
    const browser = fakeBrowser({ subscribed: true, wanted: 7 });
    expect(await helpers.turnOff({ userId: 7 })).toBe('off');
    expect(browser.subscription).toBeNull();
    expect(browser.requests).toEqual([
      { path: '/api/push/subscriptions', method: 'DELETE', body: { endpoint: ENDPOINT } },
    ]);
    expect(browser.wanted()).toBeNull();
  });

  it('is off once the browser dropped the subscription, even if the server is unreachable', async () => {
    const browser = fakeBrowser({ subscribed: true, wanted: 7 });
    browser.deleteFails = true;
    expect(await helpers.turnOff({ userId: 7 })).toBe('off');
  });

  it('reports a failure when neither the browser nor the server dropped it', async () => {
    const browser = fakeBrowser({ subscribed: true, wanted: 7 });
    browser.subscription.unsubscribeWorks = false;
    browser.deleteFails = true;
    await expect(helpers.turnOff({ userId: 7 })).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('syncExisting (every page load)', () => {
  it('saves an existing subscription for the person who turned it on', async () => {
    const browser = fakeBrowser({ subscribed: true, wanted: 7 });
    expect(await helpers.syncExisting({ publicKey: PUBLIC_KEY, userId: 7 })).toBe('on');
    expect(browser.requests.map((r) => r.method)).toEqual(['POST']);
    // Once per page load: the bell and the shell share the run.
    await helpers.syncExisting({ publicKey: PUBLIC_KEY, userId: 7 });
    expect(browser.requests).toHaveLength(1);
  });

  it("never hands one person's notifications to the next person on this browser", async () => {
    const browser = fakeBrowser({ subscribed: true, wanted: 7 });
    expect(await helpers.syncExisting({ publicKey: PUBLIC_KEY, userId: 8 })).toBe('off');
    expect(browser.subscription).toBeNull();
    expect(browser.requests).toHaveLength(0);
  });

  it('turns it back on, without asking, for the same person after signing in again', async () => {
    const browser = fakeBrowser({ subscribed: false, wanted: 7 });
    expect(await helpers.syncExisting({ publicKey: PUBLIC_KEY, userId: 7 })).toBe('on');
    expect(browser.Notification.requestPermission).not.toHaveBeenCalled();
    expect(browser.registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it('leaves someone who never turned it on alone', async () => {
    const browser = fakeBrowser({ subscribed: false, wanted: 7 });
    expect(await helpers.syncExisting({ publicKey: PUBLIC_KEY, userId: 8 })).toBe('off');
    expect(browser.registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('stops the server sending to a browser where notifications are now blocked', async () => {
    const browser = fakeBrowser({ permission: 'denied', subscribed: true, wanted: 7 });
    expect(await helpers.syncExisting({ publicKey: PUBLIC_KEY, userId: 7 })).toBe('off');
    expect(browser.requests.map((r) => r.method)).toEqual(['DELETE']);
  });
});

describe('removeOnSignOut', () => {
  it("drops this browser's subscription but keeps the person's choice for next time", async () => {
    const browser = fakeBrowser({ subscribed: true, wanted: 7 });
    await helpers.removeOnSignOut();
    expect(browser.subscription).toBeNull();
    expect(browser.requests.map((r) => r.method)).toEqual(['DELETE']);
    expect(browser.wanted()).toBe('7');
  });
});
