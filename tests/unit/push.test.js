// Desktop notifications (CONTRACT 14): the pure helpers of the push module and of the bell's
// "Show on this computer" switch. No database, no network.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BODY_MAX,
  TITLE_MAX,
  buildPayload,
  classifyFailure,
  describeFailure,
  endpointHash,
  notificationUrl,
} from '@/modules/push/payload';
import {
  base64UrlByteLength,
  isP256PublicKey,
  isPushServiceHost,
  subscribeSchema,
  unsubscribeSchema,
} from '@/modules/push/schemas';
import {
  pushState,
  sameServerKey,
  urlBase64ToUint8Array,
} from '@/components/NotificationBell.push';

const APP = 'https://daybook.example.com';

function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: crypto.randomBytes(16).toString('base64url'),
  };
}

describe('endpointHash', () => {
  it('is the sha256 of the endpoint as 64 hex characters', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    expect(endpointHash(endpoint)).toBe(crypto.createHash('sha256').update(endpoint).digest('hex'));
    expect(endpointHash(endpoint)).toMatch(/^[0-9a-f]{64}$/);
    expect(endpointHash(`${endpoint}d`)).not.toBe(endpointHash(endpoint));
  });
});

describe('notificationUrl', () => {
  it('puts in-app links on the app origin', () => {
    expect(notificationUrl('/requests', APP)).toBe(`${APP}/requests`);
    expect(notificationUrl('/projects/3?tab=tasks#p1', APP)).toBe(`${APP}/projects/3?tab=tasks#p1`);
    expect(notificationUrl('/log', 'http://localhost:3000/ignored/path')).toBe(
      'http://localhost:3000/log',
    );
  });

  it('opens the home page for no link, other sites and tricks', () => {
    for (const link of [
      null,
      undefined,
      '',
      'requests',
      'https://evil.example/x',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
    ]) {
      expect(notificationUrl(link, APP)).toBe(`${APP}/`);
    }
  });
});

describe('buildPayload', () => {
  it('is { id, title, body, url } as JSON', () => {
    const payload = buildPayload(
      {
        id: 42,
        title: 'New P1 task on internal-tool: Fix login timeout',
        body: null,
        link: '/today',
      },
      APP,
    );
    expect(JSON.parse(payload)).toEqual({
      id: 42,
      title: 'New P1 task on internal-tool: Fix login timeout',
      body: '',
      url: `${APP}/today`,
    });
  });

  it('clips long text and squeezes white space, so it stays far under 4 KB', () => {
    const payload = buildPayload(
      {
        id: 1,
        title: `  ${'T'.repeat(500)}  `,
        body: `line one\n\n${'b'.repeat(2000)}`,
        link: '/',
      },
      APP,
    );
    const data = JSON.parse(payload);
    expect(data.title).toHaveLength(TITLE_MAX);
    expect(data.title.endsWith('…')).toBe(true);
    expect(data.body.startsWith('line one b')).toBe(true);
    expect(data.body).toHaveLength(BODY_MAX);
    expect(Buffer.byteLength(payload)).toBeLessThan(1500);
  });

  it('falls back to "Daybook" for an empty title', () => {
    expect(JSON.parse(buildPayload({ id: 1, title: '  ' }, APP)).title).toBe('Daybook');
  });
});

describe('classifyFailure and describeFailure', () => {
  it('treats 404 and 410 as gone and anything else as retry', () => {
    expect(classifyFailure({ statusCode: 404 })).toBe('gone');
    expect(classifyFailure({ statusCode: 410 })).toBe('gone');
    expect(classifyFailure({ statusCode: 429 })).toBe('retry');
    expect(classifyFailure({ statusCode: 500 })).toBe('retry');
    expect(classifyFailure(new Error('socket hang up'))).toBe('retry');
    expect(classifyFailure(null)).toBe('retry');
  });

  it('describes an error by status or network code only (never the endpoint)', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/secret';
    expect(describeFailure({ statusCode: 410, endpoint, body: endpoint })).toEqual({
      statusCode: 410,
    });
    expect(describeFailure(Object.assign(new Error(endpoint), { code: 'ECONNRESET' }))).toEqual({
      errorCode: 'ECONNRESET',
    });
    expect(describeFailure(new Error(endpoint))).toEqual({ errorCode: 'error' });
  });
});

describe('subscription validation', () => {
  it('accepts the push services of Chrome, Edge, Firefox and Safari only', () => {
    for (const host of [
      'fcm.googleapis.com',
      'wns2-par02p.notify.windows.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
    ]) {
      expect(isPushServiceHost(host)).toBe(true);
    }
    for (const host of [
      'localhost',
      '10.0.0.5',
      'fcm.googleapis.com.evil.test',
      'evilfcm.googleapis.com.test',
      'notify.windows.com.example',
      '',
    ]) {
      expect(isPushServiceHost(host)).toBe(false);
    }
  });

  it('measures base64url keys and checks the browser key is a P-256 point', () => {
    const keys = browserKeys();
    expect(base64UrlByteLength(keys.p256dh)).toBe(65);
    expect(base64UrlByteLength(keys.auth)).toBe(16);
    expect(base64UrlByteLength('not base64!')).toBe(-1);
    expect(isP256PublicKey(keys.p256dh)).toBe(true);
    expect(isP256PublicKey(`BA${'A'.repeat(85)}`)).toBe(false);
    expect(isP256PublicKey(keys.auth)).toBe(false);
  });

  it('parses a browser PushSubscription.toJSON()', () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
      expirationTime: null,
      keys: browserKeys(),
    };
    expect(subscribeSchema.safeParse(subscription).success).toBe(true);
    expect(
      subscribeSchema.safeParse({ ...subscription, endpoint: 'https://u:p@fcm.googleapis.com/x' })
        .success,
    ).toBe(false);
    expect(subscribeSchema.safeParse({ endpoint: subscription.endpoint }).success).toBe(false);
    expect(unsubscribeSchema.safeParse({ endpoint: subscription.endpoint }).success).toBe(true);
    expect(unsubscribeSchema.safeParse({ endpoint: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('only sends to the push service on its default https port', () => {
    const keys = browserKeys();
    const parse = (endpoint) => subscribeSchema.safeParse({ endpoint, keys });
    expect(parse('https://fcm.googleapis.com:443/fcm/send/device-1').success).toBe(true);
    const other = parse('https://fcm.googleapis.com:8443/fcm/send/device-1');
    expect(other.success).toBe(false);
    expect(other.error.issues[0]).toMatchObject({
      path: ['endpoint'],
      message: "This browser's push service isn't supported.",
    });
  });

  it('answers bad bodies with messages written for people', () => {
    const keys = browserKeys();
    const endpoint = 'https://fcm.googleapis.com/fcm/send/device-1';
    const message = (schema, body) => schema.safeParse(body).error.issues[0].message;
    expect(message(subscribeSchema, [1, 2])).toBe('This browser sent no push subscription.');
    expect(message(subscribeSchema, { endpoint, keys, expirationTime: 'soon' })).toBe(
      'The subscription expiry is not valid.',
    );
    expect(message(subscribeSchema, { endpoint, keys, expirationTime: -1 })).toBe(
      'The subscription expiry is not valid.',
    );
    expect(message(unsubscribeSchema, 'x')).toBe('This browser sent no push endpoint.');
  });
});

describe('the bell switch helpers', () => {
  it('turns the VAPID public key into the bytes pushManager.subscribe() takes', () => {
    const bytes = crypto.randomBytes(65);
    const key = bytes.toString('base64url');
    expect(Array.from(urlBase64ToUint8Array(key))).toEqual(Array.from(bytes));
  });

  it('tells whether a subscription was made with this key', () => {
    const bytes = crypto.randomBytes(65);
    const key = bytes.toString('base64url');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    expect(sameServerKey(buffer, key)).toBe(true);
    expect(sameServerKey(buffer, crypto.randomBytes(65).toString('base64url'))).toBe(false);
    expect(sameServerKey(null, key)).toBe(false);
    expect(sameServerKey(buffer, '')).toBe(false);
  });

  it('shows Off, On, Blocked, or nothing when the browser has no push', () => {
    expect(pushState({ supported: false, permission: 'granted', subscribed: true })).toBe(
      'unsupported',
    );
    expect(pushState({ supported: true, permission: 'denied', subscribed: true })).toBe('blocked');
    expect(pushState({ supported: true, permission: 'granted', subscribed: true })).toBe('on');
    expect(pushState({ supported: true, permission: 'granted', subscribed: false })).toBe('off');
    expect(pushState({ supported: true, permission: 'default', subscribed: true })).toBe('off');
  });
});
