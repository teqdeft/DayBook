// Desktop notifications (CONTRACT 14): browsers subscribe per person, and the worker pushes every
// bell notification to them through Web Push. Sending never happens inside a request.
import { db, supportsSkipLocked } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, validationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { now, nowDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import { buildPayload, classifyFailure, describeFailure, endpointHash } from './payload';
import * as repo from './repo';
import { subscribeSchema, unsubscribeSchema } from './schemas';
import { hasKeys, sendPush, vapidKeys } from './sender';

/** Notifications claimed per tick. */
export const BATCH_SIZE = 50;
/** A notification that couldn't be pushed within this long is dropped (never pops up late). */
export const MAX_AGE_MINUTES = 60;
/** Browsers kept per person; subscribing another removes the least recently used. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;
const SEND_CONCURRENCY = 8;
const SAVE_ATTEMPTS = 3;
const USER_AGENT_MAX = 255;

// Retried notifications: which subscriptions already showed them, so a retry only goes to the
// ones that failed (a second delivery would pop up again after the first was dismissed).
// In-process only; another worker retrying the same row sends to every subscription.
const deliveredBefore = new Map(); // notificationId -> { createdAt, subscriptionIds: Set }

function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

function requireUserId(user) {
  const id = Number(user?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('UNAUTHENTICATED');
  return id;
}

function cleanUserAgent(value) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim() : '';
  return text ? text.slice(0, USER_AGENT_MAX) : null;
}

/**
 * True when the VAPID keys are set, so pushes can be signed and sent.
 * @returns {boolean}
 */
export function isConfigured() {
  return hasKeys();
}

/**
 * The VAPID public key browsers subscribe with (safe to show), or null without keys. The private
 * key never leaves the server.
 * @returns {string | null}
 */
export function publicKey() {
  return hasKeys() ? vapidKeys().publicKey : null;
}

/** Both conditions for pushing: keys are set and Admin hasn't switched it off. */
async function pushIsOn() {
  if (!hasKeys()) return false;
  const current = await settings.getAll();
  return current.pushEnabled !== false;
}

async function saveSubscription({ userId, input, hash, userAgent }) {
  return db.transaction(async (trx) => {
    const at = nowDate();
    // Lock only a row that exists: a locking read of a missing key takes a gap lock, and two
    // tabs saving the same new endpoint at once then deadlock on their inserts. A new endpoint
    // is just inserted; the unique endpoint_hash turns a race into 1062, retried below.
    const found = await repo.findByEndpointHash(hash, trx);
    const existing = found ? await repo.findByEndpointHash(hash, trx, { lock: true }) : null;
    const values = {
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent,
      failureCount: 0,
      updatedAt: at,
    };
    let id;
    if (existing) {
      id = existing.id;
      await repo.updateSubscription(id, values, trx);
    } else {
      id = await repo.insertSubscription({ ...values, endpointHash: hash, createdAt: at }, trx);
    }
    const others = (await repo.listIdsForUser(userId, trx)).filter((other) => other !== id);
    const extra = others.slice(MAX_SUBSCRIPTIONS_PER_USER - 1);
    await repo.deleteByIds(extra, trx);
    const previousUserId = existing && existing.userId !== userId ? existing.userId : null;
    return { id, created: !existing, previousUserId, trimmed: extra.length };
  });
}

/**
 * Saves this browser's push subscription for the signed-in person (POST /api/push/subscriptions).
 * The endpoint is the key (sha256 endpoint_hash): subscribing again updates the keys, and an
 * endpoint that belonged to someone else (another person signed in on this browser) moves to
 * this person. Each person keeps at most MAX_SUBSCRIPTIONS_PER_USER browsers.
 * @param {{ user: { id: number }, subscription: { endpoint: string, expirationTime?: number | null,
 *   keys: { p256dh: string, auth: string } }, userAgent?: string | null }} input
 * @returns {Promise<{ subscribed: true, id: number }>}
 * @throws UNAUTHENTICATED, VALIDATION_FAILED (https push-service endpoint up to 1000 characters,
 *   valid keys), PUSH_OFF (409) when there are no VAPID keys or Admin switched pushes off
 */
export async function subscribe({ user, subscription, userAgent }) {
  const userId = requireUserId(user);
  const input = parseInput(subscribeSchema, subscription);
  if (!(await pushIsOn())) {
    throw new AppError('PUSH_OFF', {
      status: 409,
      message: 'Desktop notifications are turned off for the company.',
    });
  }
  const hash = endpointHash(input.endpoint);
  const args = { userId, input, hash, userAgent: cleanUserAgent(userAgent) };
  let saved;
  for (let attempt = 1; !saved; attempt += 1) {
    try {
      saved = await saveSubscription(args);
    } catch (error) {
      // Two requests saving the same endpoint at once (two tabs opening together): the unique
      // hash stops the second one (1062), or the database picks a deadlock victim (1213). Try
      // again: the row the first one wrote is then updated.
      if (![1062, 1213].includes(error?.errno) || attempt >= SAVE_ATTEMPTS) throw error;
    }
  }
  if (saved.previousUserId) {
    logger.info(
      { userId, previousUserId: saved.previousUserId, subscriptionId: saved.id },
      'push subscription moved to the person signed in on this browser',
    );
  } else if (saved.created) {
    logger.info({ userId, subscriptionId: saved.id }, 'push subscription added');
  }
  return { subscribed: true, id: saved.id };
}

/**
 * Removes one of the signed-in person's subscriptions (turning it off in the bell, signing out).
 * Someone else's subscription is never touched.
 * @param {{ user: { id: number }, endpoint: string }} input
 * @returns {Promise<{ removed: number }>}
 * @throws UNAUTHENTICATED, VALIDATION_FAILED
 */
export async function unsubscribe({ user, endpoint }) {
  const userId = requireUserId(user);
  const input = parseInput(unsubscribeSchema, { endpoint });
  const removed = await repo.deleteForUserByHash({
    userId,
    endpointHash: endpointHash(input.endpoint),
  });
  if (removed > 0) logger.info({ userId }, 'push subscription removed');
  return { removed };
}

/**
 * Deletes every push subscription of a person (deactivation). Pass the caller's transaction.
 * @param {number} userId
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number>} how many were deleted
 */
export function deleteForUser(userId, trx = db) {
  return repo.deleteForUser(userId, trx);
}

/** Claims up to BATCH_SIZE due notifications: locks them and sets pushed_at as the claim. */
async function claimDue(since) {
  const skipLocked = await supportsSkipLocked();
  return db.transaction(async (trx) => {
    const rows = await repo.selectDueForUpdate({ since, limit: BATCH_SIZE, skipLocked }, trx);
    await repo.markPushed(
      rows.map((row) => row.id),
      nowDate(),
      trx,
    );
    return rows;
  });
}

/** Runs fn over items, at most `size` at a time. fn must not throw. */
async function runPool(items, size, fn) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

/** One message per (notification, subscription), minus the ones a retry already delivered. */
function planDeliveries(due, subscriptions) {
  const byUser = new Map();
  for (const subscription of subscriptions) {
    if (!byUser.has(subscription.userId)) byUser.set(subscription.userId, []);
    byUser.get(subscription.userId).push(subscription);
  }
  const deliveries = [];
  let skipped = 0;
  for (const notification of due) {
    const done = deliveredBefore.get(notification.id)?.subscriptionIds;
    const targets = (byUser.get(notification.userId) ?? []).filter((s) => !done?.has(s.id));
    if (targets.length === 0) {
      skipped += 1;
      deliveredBefore.delete(notification.id);
      continue;
    }
    const payload = buildPayload(notification, env.APP_URL);
    for (const subscription of targets) deliveries.push({ notification, subscription, payload });
  }
  return { deliveries, skipped };
}

async function deliver(deliveries) {
  const outcome = {
    sent: 0,
    failed: 0,
    succeeded: new Set(),
    gone: new Set(),
    failures: new Map(),
    retry: new Set(),
  };
  await runPool(deliveries, SEND_CONCURRENCY, async ({ notification, subscription, payload }) => {
    if (outcome.gone.has(subscription.id)) return;
    try {
      await sendPush(subscription, payload);
      outcome.sent += 1;
      outcome.succeeded.add(subscription.id);
      const entry = deliveredBefore.get(notification.id) ?? {
        createdAt: notification.createdAt,
        subscriptionIds: new Set(),
      };
      entry.subscriptionIds.add(subscription.id);
      deliveredBefore.set(notification.id, entry);
    } catch (error) {
      const context = { notificationId: notification.id, subscriptionId: subscription.id };
      if (classifyFailure(error) === 'gone') {
        outcome.gone.add(subscription.id);
        logger.info(
          { ...context, userId: subscription.userId, ...describeFailure(error) },
          'push subscription is gone; removed',
        );
        return;
      }
      outcome.failed += 1;
      outcome.failures.set(subscription.id, (outcome.failures.get(subscription.id) ?? 0) + 1);
      outcome.retry.add(notification.id);
      logger.debug({ ...context, ...describeFailure(error) }, 'desktop push failed');
    }
  });
  return outcome;
}

/** Saves what the push services said: successes, failure counts, gone subscriptions. */
async function recordOutcome(outcome) {
  const at = nowDate();
  await repo.deleteByIds([...outcome.gone]);
  const succeeded = [...outcome.succeeded].filter((id) => !outcome.gone.has(id));
  await repo.markSucceeded(succeeded, at);
  // One update per distinct count (usually just 1).
  const idsByCount = new Map();
  for (const [id, count] of outcome.failures) {
    if (outcome.gone.has(id)) continue;
    idsByCount.set(count, [...(idsByCount.get(count) ?? []), id]);
  }
  for (const [count, ids] of idsByCount) await repo.incrementFailures(ids, at, count);
}

/** Forgets retry bookkeeping for notifications that are finished or too old. */
function forgetDelivered(finishedIds, cutoff) {
  for (const id of finishedIds) deliveredBefore.delete(id);
  for (const [id, entry] of deliveredBefore) {
    if (new Date(entry.createdAt) < cutoff) deliveredBefore.delete(id);
  }
}

/**
 * Pushes due bell notifications to the recipients' browsers (worker job push-notifications,
 * every 10 seconds). Claims up to BATCH_SIZE notifications with pushed_at IS NULL created in the
 * last hour, newest first (FOR UPDATE, SKIP LOCKED where supported; pushed_at is set as the
 * claim; newest first so retries never hold back new notifications), then sends
 * outside the transaction to each subscription of the recipient. A 404/410 deletes the
 * subscription; any other failure counts up failure_count and the notification is put back for
 * the next tick until it is an hour old. Older notifications, and every notification while there
 * are no VAPID keys or settings.pushEnabled is off, are marked pushed without sending.
 * @returns {Promise<{ claimed: number, sent: number, failed: number, removed: number,
 *   retried: number, skipped: number, off?: 'not_configured' | 'disabled' }>} sent, failed:
 *   messages; removed: subscriptions deleted; claimed, retried, skipped: notifications
 */
export async function sendPending() {
  const result = { claimed: 0, sent: 0, failed: 0, removed: 0, retried: 0, skipped: 0 };
  const at = nowDate();
  if (!(await pushIsOn())) {
    result.off = hasKeys() ? 'disabled' : 'not_configured';
    result.skipped = await repo.markUnsentHandled({ at });
    deliveredBefore.clear();
    return result;
  }
  const cutoff = now().subtract(MAX_AGE_MINUTES, 'minute').toDate();
  result.skipped = await repo.markUnsentHandled({ before: cutoff, at });
  const due = await claimDue(cutoff);
  result.claimed = due.length;
  if (due.length === 0) {
    forgetDelivered([], cutoff);
    return result;
  }

  const userIds = [...new Set(due.map((notification) => notification.userId))];
  const plan = planDeliveries(due, await repo.listForUsers(userIds));
  result.skipped += plan.skipped;
  const outcome = await deliver(plan.deliveries);
  await recordOutcome(outcome);

  // Retry only while the notification is still under an hour old.
  const retryCutoff = now().subtract(MAX_AGE_MINUTES, 'minute').toDate();
  const retry = due.filter((n) => outcome.retry.has(n.id) && new Date(n.createdAt) >= retryCutoff);
  await repo.releaseForRetry(retry.map((n) => n.id));
  const retrying = new Set(retry.map((n) => n.id));
  forgetDelivered(
    due.map((n) => n.id).filter((id) => !retrying.has(id)),
    cutoff,
  );

  result.sent = outcome.sent;
  result.failed = outcome.failed;
  result.removed = outcome.gone.size;
  result.retried = retry.length;
  return result;
}

/** Tests only: forget which subscriptions retried notifications already reached. */
export function resetForTests() {
  deliveredBefore.clear();
}
