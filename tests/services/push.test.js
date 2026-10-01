// Desktop notifications (CONTRACT 14): subscriptions and the worker's sendPending(), with a fake
// push service in place of web-push.
import crypto from 'node:crypto';
import webpush from 'web-push';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { setNowForTests } from '@/lib/time';
import { notifications } from '@/modules/notifications';
import { push } from '@/modules/push';
import { endpointHash } from '@/modules/push/payload';
import { setPushSenderForTests, setVapidKeysForTests } from '@/modules/push/sender';
import { users } from '@/modules/users';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const T0 = '2026-09-30T08:00:00Z';
const KEYS = webpush.generateVAPIDKeys();

let alice;
let bob;
let hr;
let counter = 0;

/** A browser-shaped PushSubscription.toJSON() with valid keys. */
function browserSubscription(host = 'fcm.googleapis.com') {
  counter += 1;
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://${host}/fcm/send/device-${counter}-${crypto.randomBytes(8).toString('hex')}`,
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: crypto.randomBytes(16).toString('base64url'),
    },
  };
}

const actor = (row) => ({ id: row.id, role: row.role, status: 'active' });

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

function subscriptionsOf(userId) {
  return db('push_subscriptions').where({ userId }).orderBy('id');
}

async function notification(userId, overrides = {}) {
  await notifications.notify({
    userIds: [userId],
    type: 'project_task.added',
    title: 'New P1 task on internal-tool: Fix login timeout',
    body: 'Users are signed out after 5 minutes.',
    link: '/today',
    ...overrides,
  });
  return db('notifications').where({ userId }).orderBy('id', 'desc').first();
}

/** A fake push service: every call resolves 201 unless `reply` says otherwise. */
function fakeService(reply = () => ({ statusCode: 201 })) {
  const sender = vi.fn(async (subscription, payload, options) => {
    const answer = await reply(subscription, payload, options);
    if (answer.statusCode >= 300) {
      throw Object.assign(new Error('Received unexpected response code'), answer);
    }
    return answer;
  });
  setPushSenderForTests(sender);
  return sender;
}

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser({ name: 'Alice Rao' });
  bob = await createUser({ name: 'Bob Das' });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
});

beforeEach(async () => {
  setNowForTests(T0);
  setVapidKeysForTests({ ...KEYS, subject: 'mailto:admin@example.com' });
  await setSettings({ push_enabled: true });
  await db('push_subscriptions').delete();
  await db('notifications').delete();
  push.resetForTests();
});

afterEach(() => {
  setPushSenderForTests(null);
  setVapidKeysForTests(undefined);
});

describe('push.isConfigured and push.publicKey', () => {
  it('gives the public key only when both keys are set', () => {
    expect(push.isConfigured()).toBe(true);
    expect(push.publicKey()).toBe(KEYS.publicKey);
    setVapidKeysForTests({ publicKey: KEYS.publicKey, privateKey: '' });
    expect(push.isConfigured()).toBe(false);
    expect(push.publicKey()).toBeNull();
    setVapidKeysForTests(null);
    expect(push.publicKey()).toBeNull();
  });
});

describe('push.subscribe', () => {
  it('saves the subscription under sha256(endpoint) for the signed-in person', async () => {
    const sub = browserSubscription();
    const result = await push.subscribe({
      user: actor(alice),
      subscription: sub,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140',
    });
    expect(result).toEqual({ subscribed: true, id: expect.any(Number) });
    const [row] = await subscriptionsOf(alice.id);
    expect(row).toMatchObject({
      endpoint: sub.endpoint,
      endpointHash: endpointHash(sub.endpoint),
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140',
      failureCount: 0,
      lastSuccessAt: null,
    });
    expect(row.endpointHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('updates the same endpoint instead of adding a second row', async () => {
    const sub = browserSubscription();
    await push.subscribe({ user: actor(alice), subscription: sub });
    await db('push_subscriptions').update({ failureCount: 7 });
    const renewed = { ...sub, keys: browserSubscription().keys };
    await push.subscribe({ user: actor(alice), subscription: renewed });
    const rows = await subscriptionsOf(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ p256dh: renewed.keys.p256dh, failureCount: 0 });
  });

  it('saves one new endpoint sent by several tabs at once, without an error', async () => {
    // Restored tabs all sync at the same moment; a locking read of the missing row used to
    // take gap locks and deadlock the inserts (ER_LOCK_DEADLOCK).
    for (let round = 0; round < 10; round += 1) {
      const sub = browserSubscription();
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => push.subscribe({ user: actor(alice), subscription: sub })),
      );
      expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.code)).toEqual([]);
      expect(new Set(results.map((r) => r.value.id)).size).toBe(1);
    }
    expect(await subscriptionsOf(alice.id)).toHaveLength(10);
  });

  it('moves an endpoint to the person now signed in on that browser', async () => {
    const sub = browserSubscription();
    await push.subscribe({ user: actor(alice), subscription: sub });
    await push.subscribe({ user: actor(bob), subscription: sub });
    expect(await subscriptionsOf(alice.id)).toHaveLength(0);
    expect(await subscriptionsOf(bob.id)).toHaveLength(1);
  });

  it('accepts Edge, Firefox and Safari push services', async () => {
    for (const host of [
      'wns2-par02p.notify.windows.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
    ]) {
      await push.subscribe({ user: actor(alice), subscription: browserSubscription(host) });
    }
    expect(await subscriptionsOf(alice.id)).toHaveLength(3);
  });

  it('keeps the newest 10 browsers per person', async () => {
    for (let i = 0; i < 11; i += 1) {
      setNowForTests(new Date(Date.parse(T0) + i * 1000).toISOString());
      await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    }
    const rows = await subscriptionsOf(alice.id);
    expect(rows).toHaveLength(10);
    expect(rows[0].id).toBeGreaterThan(1); // the oldest one went
  });

  it.each([
    ['an http endpoint', { endpoint: 'http://fcm.googleapis.com/fcm/send/x' }, 'endpoint'],
    ['an unknown host', { endpoint: 'https://10.0.0.5/push' }, 'endpoint'],
    ['a look-alike host', { endpoint: 'https://fcm.googleapis.com.evil.test/x' }, 'endpoint'],
    ['a long endpoint', { endpoint: `https://fcm.googleapis.com/${'x'.repeat(1000)}` }, 'endpoint'],
    ['a short key', { keys: { p256dh: 'abc', auth: 'x'.repeat(22) } }, 'keys.p256dh'],
    [
      'a key off the curve',
      { keys: { p256dh: `BA${'A'.repeat(85)}`, auth: 'x'.repeat(22) } },
      'keys.p256dh',
    ],
    [
      'a bad secret',
      { keys: { ...browserSubscription().keys, auth: '!'.repeat(22) } },
      'keys.auth',
    ],
  ])('refuses %s', async (_label, change, field) => {
    const sub = { ...browserSubscription(), ...change };
    const error = await expectAppError(
      push.subscribe({ user: actor(alice), subscription: sub }),
      'VALIDATION_FAILED',
    );
    expect(Object.keys(error.fields)).toContain(field);
    expect(await subscriptionsOf(alice.id)).toHaveLength(0);
  });

  it('refuses while pushes are off for the company or there are no keys', async () => {
    await setSettings({ push_enabled: false });
    const off = await expectAppError(
      push.subscribe({ user: actor(alice), subscription: browserSubscription() }),
      'PUSH_OFF',
    );
    expect(off.status).toBe(409);
    await setSettings({ push_enabled: true });
    setVapidKeysForTests(null);
    await expectAppError(
      push.subscribe({ user: actor(alice), subscription: browserSubscription() }),
      'PUSH_OFF',
    );
  });

  it('needs a signed-in person', async () => {
    await expectAppError(
      push.subscribe({ user: null, subscription: browserSubscription() }),
      'UNAUTHENTICATED',
    );
  });
});

describe('push.unsubscribe, deleteForUser and deactivation', () => {
  it("removes the person's own subscription only", async () => {
    const sub = browserSubscription();
    await push.subscribe({ user: actor(alice), subscription: sub });
    expect(await push.unsubscribe({ user: actor(bob), endpoint: sub.endpoint })).toEqual({
      removed: 0,
    });
    expect(await push.unsubscribe({ user: actor(alice), endpoint: sub.endpoint })).toEqual({
      removed: 1,
    });
    expect(await subscriptionsOf(alice.id)).toHaveLength(0);
  });

  it('deleteForUser removes every browser of that person', async () => {
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    await push.subscribe({ user: actor(bob), subscription: browserSubscription() });
    expect(await push.deleteForUser(alice.id)).toBe(2);
    expect(await subscriptionsOf(alice.id)).toHaveLength(0);
    expect(await subscriptionsOf(bob.id)).toHaveLength(1);
  });

  it('deactivating a person deletes their subscriptions in the same change', async () => {
    const person = await createUser({ name: 'Leaving Person' });
    await push.subscribe({ user: actor(person), subscription: browserSubscription() });
    await users.deactivate({ user: actor(hr), id: person.id });
    expect(await subscriptionsOf(person.id)).toHaveLength(0);
  });
});

describe('push.sendPending', () => {
  it('sends { id, title, body, url } to every browser and marks it pushed', async () => {
    const sender = fakeService();
    const first = browserSubscription();
    await push.subscribe({ user: actor(alice), subscription: first });
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    const row = await notification(alice.id, { link: '/projects/3' });

    const result = await push.sendPending();

    expect(result).toMatchObject({ claimed: 1, sent: 2, failed: 0, removed: 0, retried: 0 });
    expect(sender).toHaveBeenCalledTimes(2);
    const [target, payload, options] = sender.mock.calls[0];
    expect(target).toEqual({ endpoint: first.endpoint, keys: first.keys });
    expect(JSON.parse(payload)).toEqual({
      id: row.id,
      title: 'New P1 task on internal-tool: Fix login timeout',
      body: 'Users are signed out after 5 minutes.',
      url: `${env.appOrigin}/projects/3`,
    });
    expect(options).toMatchObject({ TTL: 3600, urgency: 'normal' });
    expect(options.vapidDetails).toMatchObject({ publicKey: KEYS.publicKey });
    const pushed = await db('notifications').where({ id: row.id }).first();
    expect(pushed.pushedAt).toEqual(new Date(T0));
    for (const sub of await subscriptionsOf(alice.id)) {
      expect(sub.lastSuccessAt).toEqual(new Date(T0));
    }
    // Nothing left for the next tick.
    expect((await push.sendPending()).claimed).toBe(0);
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('opens the home page when a notification has no in-app link', async () => {
    const sender = fakeService();
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    await notification(alice.id, { link: null, body: null });
    await push.sendPending();
    expect(JSON.parse(sender.mock.calls[0][1])).toMatchObject({
      body: '',
      url: `${env.appOrigin}/`,
    });
  });

  it('deletes a subscription the push service says is gone (404/410)', async () => {
    const gone = browserSubscription();
    const fine = browserSubscription();
    fakeService((target) => ({ statusCode: target.endpoint === gone.endpoint ? 410 : 201 }));
    await push.subscribe({ user: actor(alice), subscription: gone });
    await push.subscribe({ user: actor(alice), subscription: fine });
    const row = await notification(alice.id);

    const result = await push.sendPending();

    expect(result).toMatchObject({ sent: 1, removed: 1, failed: 0, retried: 0 });
    const left = await subscriptionsOf(alice.id);
    expect(left.map((sub) => sub.endpoint)).toEqual([fine.endpoint]);
    expect((await db('notifications').where({ id: row.id }).first()).pushedAt).not.toBeNull();
  });

  it('counts a failure and retries only the failed browser on the next tick', async () => {
    const flaky = browserSubscription();
    const fine = browserSubscription();
    let down = true;
    const sender = fakeService((target) => ({
      statusCode: target.endpoint === flaky.endpoint && down ? 500 : 201,
    }));
    await push.subscribe({ user: actor(alice), subscription: flaky });
    await push.subscribe({ user: actor(alice), subscription: fine });
    const row = await notification(alice.id);

    expect(await push.sendPending()).toMatchObject({ sent: 1, failed: 1, retried: 1 });
    expect((await db('notifications').where({ id: row.id }).first()).pushedAt).toBeNull();
    const flakyRow = await db('push_subscriptions')
      .where({ endpointHash: endpointHash(flaky.endpoint) })
      .first();
    expect(flakyRow.failureCount).toBe(1);
    expect(flakyRow.lastSuccessAt).toBeNull();

    // Still failing: counts up again.
    setNowForTests('2026-09-30T08:00:10Z');
    expect(await push.sendPending()).toMatchObject({ sent: 0, failed: 1, retried: 1 });
    expect((await db('push_subscriptions').where({ id: flakyRow.id }).first()).failureCount).toBe(
      2,
    );

    // Back up: only the browser that missed it gets it, and the count resets.
    down = false;
    sender.mockClear();
    setNowForTests('2026-09-30T08:00:20Z');
    expect(await push.sendPending()).toMatchObject({ sent: 1, failed: 0, retried: 0 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0].endpoint).toBe(flaky.endpoint);
    const recovered = await db('push_subscriptions').where({ id: flakyRow.id }).first();
    expect(recovered).toMatchObject({ failureCount: 0 });
    expect(recovered.lastSuccessAt).toEqual(new Date('2026-09-30T08:00:20Z'));
    expect((await db('notifications').where({ id: row.id }).first()).pushedAt).not.toBeNull();
  });

  it('never lets a full batch of retries hold back a new notification', async () => {
    const broken = browserSubscription();
    const sender = fakeService((target) => ({
      statusCode: target.endpoint === broken.endpoint ? 500 : 201,
    }));
    await push.subscribe({ user: actor(alice), subscription: broken });
    await push.subscribe({ user: actor(bob), subscription: browserSubscription() });
    const createdAt = new Date(T0);
    await db('notifications').insert(
      Array.from({ length: push.BATCH_SIZE }, (_, i) => ({
        userId: alice.id,
        type: 'project_task.added',
        title: `Alice ${i}`,
        createdAt,
      })),
    );
    expect(await push.sendPending()).toMatchObject({ claimed: 50, failed: 50, retried: 50 });

    setNowForTests('2026-09-30T08:00:10Z');
    const fresh = await notification(bob.id, { title: 'For Bob' });
    sender.mockClear();
    const result = await push.sendPending();

    expect(result).toMatchObject({ claimed: 50, sent: 1 });
    const bobCalls = sender.mock.calls.filter(([, payload]) => JSON.parse(payload).id === fresh.id);
    expect(bobCalls).toHaveLength(1);
    expect((await db('notifications').where({ id: fresh.id }).first()).pushedAt).not.toBeNull();
    // The oldest retry waits for the next tick instead.
    expect(await db('notifications').whereNull('pushedAt')).toHaveLength(50);
  });

  it('stops retrying once the notification is an hour old', async () => {
    const sender = fakeService(() => ({ statusCode: 503 }));
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    const row = await notification(alice.id);
    expect(await push.sendPending()).toMatchObject({ failed: 1, retried: 1 });

    setNowForTests('2026-09-30T09:00:01Z');
    sender.mockClear();
    const result = await push.sendPending();
    expect(result).toMatchObject({ claimed: 0, skipped: 1 });
    expect(sender).not.toHaveBeenCalled();
    const after = await db('notifications').where({ id: row.id }).first();
    expect(after.pushedAt).toEqual(new Date('2026-09-30T09:00:01Z'));
  });

  it('marks notifications older than an hour pushed without sending them', async () => {
    const sender = fakeService();
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    setNowForTests('2026-09-30T06:59:00Z');
    const old = await notification(alice.id);
    setNowForTests(T0);

    expect(await push.sendPending()).toMatchObject({ claimed: 0, skipped: 1, sent: 0 });
    expect(sender).not.toHaveBeenCalled();
    expect((await db('notifications').where({ id: old.id }).first()).pushedAt).toEqual(
      new Date(T0),
    );
  });

  it('marks everything pushed without sending while pushes are off', async () => {
    const sender = fakeService();
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    await notification(alice.id);
    await setSettings({ push_enabled: false });

    expect(await push.sendPending()).toMatchObject({ off: 'disabled', skipped: 1, sent: 0 });
    expect(sender).not.toHaveBeenCalled();
    expect(await db('notifications').whereNull('pushedAt')).toHaveLength(0);
  });

  it('marks everything pushed without sending when there are no VAPID keys', async () => {
    const sender = fakeService();
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    await notification(alice.id);
    setVapidKeysForTests(null);

    expect(await push.sendPending()).toMatchObject({ off: 'not_configured', skipped: 1 });
    expect(sender).not.toHaveBeenCalled();
    expect(await db('notifications').whereNull('pushedAt')).toHaveLength(0);
  });

  it('marks a notification for someone without a browser as handled', async () => {
    const sender = fakeService();
    const row = await notification(bob.id);
    expect(await push.sendPending()).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(sender).not.toHaveBeenCalled();
    expect((await db('notifications').where({ id: row.id }).first()).pushedAt).not.toBeNull();
  });

  it('never sends a notification twice when two ticks run at once', async () => {
    const sender = fakeService(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { statusCode: 201 };
    });
    await push.subscribe({ user: actor(alice), subscription: browserSubscription() });
    await push.subscribe({ user: actor(bob), subscription: browserSubscription() });
    for (let i = 0; i < 3; i += 1) {
      await notification(alice.id, { title: `Alice ${i}` });
      await notification(bob.id, { title: `Bob ${i}` });
    }

    const [one, two] = await Promise.all([push.sendPending(), push.sendPending()]);

    expect(one.claimed + two.claimed).toBe(6);
    expect(sender).toHaveBeenCalledTimes(6);
    const ids = sender.mock.calls.map(([, payload]) => JSON.parse(payload).id);
    expect(new Set(ids).size).toBe(6);
  });

  it('never puts the endpoint or keys in the log', async () => {
    const { logger } = await import('@/lib/logger');
    const lines = [];
    const spies = ['debug', 'info', 'warn', 'error'].map((level) =>
      vi.spyOn(logger, level).mockImplementation((...args) => {
        lines.push(JSON.stringify(args));
      }),
    );
    const sub = browserSubscription();
    try {
      fakeService(() => ({ statusCode: 500, endpoint: sub.endpoint }));
      await push.subscribe({ user: actor(alice), subscription: sub });
      await notification(alice.id);
      await push.sendPending();
      fakeService(() => ({ statusCode: 410, endpoint: sub.endpoint }));
      setNowForTests('2026-09-30T08:00:10Z');
      await push.sendPending();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const text = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(text).not.toContain(sub.endpoint);
    expect(text).not.toContain(sub.keys.p256dh);
    expect(text).not.toContain(sub.keys.auth);
    expect(text).not.toContain(KEYS.privateKey);
  });
});
