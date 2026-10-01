// The one place that talks to push services (web-push, signed with the VAPID keys from env).
// Tests swap the sender and the keys with setPushSenderForTests() / setVapidKeysForTests().
import webpush from 'web-push';
import { env } from '@/lib/env';

/** Seconds a push service keeps an undelivered message (the computer is asleep or offline). */
export const PUSH_TTL_SECONDS = 60 * 60;
const SEND_TIMEOUT_MS = 10_000;

let testSender = null;
let testKeys; // undefined = use env; null = no keys

/**
 * Tests only: replace the network call. `fn(subscription, payload, options)` resolves to
 * `{ statusCode }` or throws an error with `statusCode` (like web-push's WebPushError).
 * null restores web-push.
 */
export function setPushSenderForTests(fn) {
  testSender = fn;
}

/** Tests only: `{ publicKey, privateKey, subject }`, null for "no keys", undefined for env. */
export function setVapidKeysForTests(keys) {
  testKeys = keys;
}

/** The VAPID keys in use: `{ publicKey, privateKey, subject }` (empty strings when unset). */
export function vapidKeys() {
  if (testKeys !== undefined) {
    return {
      publicKey: testKeys?.publicKey ?? '',
      privateKey: testKeys?.privateKey ?? '',
      subject: testKeys?.subject ?? env.VAPID_SUBJECT,
    };
  }
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

/** True when both VAPID keys are set. */
export function hasKeys() {
  const keys = vapidKeys();
  return Boolean(keys.publicKey && keys.privateKey);
}

/**
 * Sends one encrypted message to one subscription.
 * @param {{ endpoint: string, p256dh: string, auth: string }} subscription
 * @param {string} payload JSON text
 * @returns {Promise<{ statusCode: number }>}
 * @throws an error with `statusCode` when the push service refuses it, or a network error
 */
export async function sendPush(subscription, payload) {
  const keys = vapidKeys();
  const target = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  };
  const options = {
    TTL: PUSH_TTL_SECONDS,
    urgency: 'normal',
    timeout: SEND_TIMEOUT_MS,
    vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
  };
  if (testSender) return testSender(target, payload, options);
  const result = await webpush.sendNotification(target, payload, options);
  return { statusCode: result.statusCode };
}
