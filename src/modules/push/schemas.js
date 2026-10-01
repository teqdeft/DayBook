import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Push services the worker may send to (host, or a parent domain). The worker POSTs to whatever
 * endpoint a browser hands us, so only real push services are accepted (no requests to
 * internal addresses). Chrome and most Chromium browsers use FCM, Edge uses Windows Push
 * Notification Services, Firefox uses Mozilla's autopush and Safari uses Apple's.
 */
export const PUSH_SERVICE_HOSTS = Object.freeze([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'notify.windows.com',
  'push.services.mozilla.com',
  'push.apple.com',
]);

export const ENDPOINT_MAX = 1000;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** True when the host is one of PUSH_SERVICE_HOSTS or a subdomain of one. */
export function isPushServiceHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Decoded byte length of a base64url (or base64) string, or -1 when it isn't one. */
export function base64UrlByteLength(value) {
  if (typeof value !== 'string' || !BASE64URL.test(value)) return -1;
  return Buffer.from(value.replace(/=+$/, ''), 'base64url').length;
}

/** True when the value is a P-256 public key (65 bytes, uncompressed) that encryption can use. */
export function isP256PublicKey(value) {
  if (base64UrlByteLength(value) !== 65) return false;
  const bytes = Buffer.from(value.replace(/=+$/, ''), 'base64url');
  if (bytes[0] !== 0x04) return false;
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    ecdh.computeSecret(bytes);
    return true;
  } catch {
    return false;
  }
}

const endpoint = z
  .string({ error: 'This browser sent no push endpoint.' })
  .trim()
  .min(1, 'This browser sent no push endpoint.')
  .max(ENDPOINT_MAX, 'The push endpoint is too long.')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'The push endpoint must be an https:// address.')
  .refine((value) => {
    try {
      // The push service's own host on the default https port, nothing else.
      const url = new URL(value);
      return isPushServiceHost(url.hostname) && url.port === '';
    } catch {
      return true; // the check above already reported it
    }
  }, "This browser's push service isn't supported.");

// p256dh: the browser's P-256 public key, 65 bytes uncompressed (87 characters of base64url).
const p256dh = z
  .string({ error: 'The subscription keys are missing.' })
  .trim()
  .min(86, 'The subscription key is not valid.')
  .max(90, 'The subscription key is not valid.')
  .refine(isP256PublicKey, 'The subscription key is not valid.');

// auth: the 16-byte authentication secret (22 characters of base64url).
const auth = z
  .string({ error: 'The subscription keys are missing.' })
  .trim()
  .min(22, 'The subscription secret is not valid.')
  .max(44, 'The subscription secret is not valid.')
  .refine((value) => {
    const bytes = base64UrlByteLength(value);
    return bytes >= 16 && bytes <= 32;
  }, 'The subscription secret is not valid.');

/** POST /api/push/subscriptions: the browser's PushSubscription.toJSON(). */
export const subscribeSchema = z.object(
  {
    endpoint,
    expirationTime: z
      .number({ error: 'The subscription expiry is not valid.' })
      .nonnegative('The subscription expiry is not valid.')
      .nullish(),
    keys: z.object({ p256dh, auth }, { error: 'The subscription keys are missing.' }),
  },
  { error: 'This browser sent no push subscription.' },
);

/** DELETE /api/push/subscriptions: which of this person's subscriptions to remove. */
export const unsubscribeSchema = z.object(
  {
    endpoint: z
      .string({ error: 'This browser sent no push endpoint.' })
      .trim()
      .min(1, 'This browser sent no push endpoint.')
      .max(ENDPOINT_MAX, 'The push endpoint is too long.'),
  },
  { error: 'This browser sent no push endpoint.' },
);
