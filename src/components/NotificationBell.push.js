// Browser side of desktop notifications (CONTRACT 14), shared by the bell's "Show on this
// computer" switch and sign-out. Talks to the service worker's PushManager and to
// /api/push/subscriptions. No React here; the pure helpers are unit-tested.
import { api } from '@/lib/apiClient';

const ENDPOINT = '/api/push/subscriptions';
const SW_URL = '/sw.js';
// Remembers, per person, that they turned it on in this browser, so it comes back on after they
// sign out and in again (permission is already granted, so no prompt).
const WANTED_KEY = 'daybook.push.wanted';

/** 'BASE64URL' VAPID key -> the Uint8Array pushManager.subscribe() takes. */
export function urlBase64ToUint8Array(value) {
  const base64 = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** True when a subscription's applicationServerKey (ArrayBuffer) is this VAPID public key. */
export function sameServerKey(buffer, publicKey) {
  if (!buffer || !publicKey) return false;
  const a = new Uint8Array(buffer);
  const b = urlBase64ToUint8Array(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * What the switch shows: 'unsupported' (hide it), 'blocked' (the person said no in the browser),
 * 'on' (permission granted and this browser is subscribed) or 'off'.
 * @param {{ supported: boolean, permission: string, subscribed: boolean }} state
 */
export function pushState({ supported, permission, subscribed }) {
  if (!supported) return 'unsupported';
  if (permission === 'denied') return 'blocked';
  return permission === 'granted' && subscribed ? 'on' : 'off';
}

/** Service worker + Push API + Notification API, in a secure context. */
export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function permission() {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}

/** This browser's current subscription, or null (never prompts). */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function readyRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register(SW_URL);
  return navigator.serviceWorker.ready;
}

function rememberWanted(userId, wanted) {
  try {
    if (wanted) window.localStorage.setItem(WANTED_KEY, String(userId));
    else window.localStorage.removeItem(WANTED_KEY);
  } catch {
    // storage blocked: the switch just won't come back on by itself after signing in again
  }
}

// The last sync of this page load: { key: 'userId|publicKey', promise } (see syncExisting).
let lastSync = null;

function wantedBy() {
  try {
    return window.localStorage.getItem(WANTED_KEY);
  } catch {
    return null;
  }
}

/**
 * Subscribes this browser and saves it for the signed-in person. Asks for permission first when
 * the browser hasn't been asked (call it from a click). A subscription made with another VAPID key
 * is replaced.
 * @returns {Promise<'on' | 'blocked' | 'off'>}
 * @throws ApiError when the server refuses it (the browser subscription is then removed again)
 */
export async function turnOn({ publicKey, userId }) {
  let granted = permission();
  if (granted === 'default') granted = await Notification.requestPermission();
  if (granted === 'denied') return 'blocked';
  if (granted !== 'granted') return 'off';
  const registration = await readyRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameServerKey(subscription.options?.applicationServerKey, publicKey)) {
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  try {
    await api.post(ENDPOINT, subscription.toJSON());
  } catch (error) {
    await subscription.unsubscribe().catch(() => {});
    throw error;
  }
  rememberWanted(userId, true);
  return 'on';
}

/**
 * The person turned it off: unsubscribes this browser, removes it on the server, and forgets the
 * choice (it doesn't come back on at their next sign-in).
 * @returns {Promise<'off'>}
 */
export async function turnOff({ userId }) {
  const subscription = await currentSubscription();
  rememberWanted(userId, false);
  if (!subscription) return 'off';
  const { endpoint } = subscription;
  const unsubscribed = await subscription.unsubscribe().catch(() => false);
  try {
    await api.delete(ENDPOINT, { body: { endpoint } });
  } catch (error) {
    // Once the browser dropped it, nothing more can reach this computer (the next push gets a
    // 410 and the worker deletes the row), so it is off; otherwise say it didn't work.
    if (!unsubscribed) throw error;
  }
  return 'off';
}

/** Unsubscribes this browser and asks the server to forget it; never throws or redirects. */
async function dropSubscription() {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const { endpoint } = subscription;
    await subscription.unsubscribe().catch(() => {});
    await fetch(ENDPOINT, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // best effort: a push to a dropped subscription gets 410 and the worker deletes the row
  }
}

/**
 * Sign-out: removes this browser's subscription without ever blocking or redirecting (best
 * effort, about 3 seconds at most). The person's "on" choice is kept for their next sign-in.
 */
export async function removeOnSignOut() {
  lastSync = null;
  if (!pushSupported()) return;
  await Promise.race([dropSubscription(), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

async function runSync({ publicKey, userId }) {
  if (permission() === 'denied') {
    // Blocked in the browser: stop the server sending to it (it comes back if they allow again).
    await dropSubscription();
    return 'off';
  }
  if (permission() !== 'granted') return 'off';
  const subscription = await currentSubscription();
  const owner = wantedBy();
  if (!subscription) {
    return owner === String(userId) ? turnOn({ publicKey, userId }).catch(() => 'off') : 'off';
  }
  if (owner && owner !== String(userId)) {
    await subscription.unsubscribe().catch(() => {});
    rememberWanted(userId, false);
    return 'off';
  }
  if (!sameServerKey(subscription.options?.applicationServerKey, publicKey)) {
    return turnOn({ publicKey, userId }).catch(() => 'off');
  }
  await api.post(ENDPOINT, subscription.toJSON());
  rememberWanted(userId, true);
  return 'on';
}

/**
 * Brings this browser in line with the signed-in person, without prompting: turns it back on for
 * someone who had it on before signing out, renews a subscription made with an old key, saves an
 * existing one for this person, and removes one another person turned on here, so their
 * notifications never show up for someone else. Runs once per page load and person (the shell
 * and the bell share the run) unless `fresh` (the permission changed).
 * @param {{ publicKey: string, userId: number }} config
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<'on' | 'off'>}
 */
export function syncExisting({ publicKey, userId }, { fresh = false } = {}) {
  const key = `${userId}|${publicKey}`;
  if (!fresh && lastSync?.key === key) return lastSync.promise;
  const promise = runSync({ publicKey, userId });
  lastSync = { key, promise };
  promise.catch(() => {
    if (lastSync?.promise === promise) lastSync = null;
  });
  return promise;
}
