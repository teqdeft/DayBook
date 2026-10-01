// Push subscriptions, and the desktop-push state of bell notifications (notifications.pushed_at).
// pushed_at belongs to this module: the notifications module creates rows, the push worker marks
// them handled (sent or skipped).
import { db } from '@/lib/db';

const SUBSCRIPTION_COLUMNS = [
  'id',
  'userId',
  'endpoint',
  'endpointHash',
  'p256dh',
  'auth',
  'lastSuccessAt',
  'failureCount',
  'createdAt',
  'updatedAt',
];
const FAILURE_COUNT_MAX = 65535; // SMALLINT UNSIGNED

// ---------- subscriptions ----------

/** One subscription by sha256(endpoint), optionally locked FOR UPDATE (inside a transaction). */
export function findByEndpointHash(endpointHash, trx = db, { lock = false } = {}) {
  const query = trx('push_subscriptions').where({ endpointHash }).first(SUBSCRIPTION_COLUMNS);
  return lock ? query.forUpdate() : query;
}

export async function insertSubscription(row, trx = db) {
  const [id] = await trx('push_subscriptions').insert(row);
  return id;
}

export function updateSubscription(id, changes, trx = db) {
  return trx('push_subscriptions').where({ id }).update(changes);
}

/** A person's subscription ids, most recently updated first. */
export async function listIdsForUser(userId, trx = db) {
  const rows = await trx('push_subscriptions')
    .where({ userId })
    .orderBy([
      { column: 'updatedAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .select('id');
  return rows.map((row) => row.id);
}

/** Every subscription of these people (what the worker sends to). */
export function listForUsers(userIds, trx = db) {
  if (userIds.length === 0) return Promise.resolve([]);
  return trx('push_subscriptions')
    .whereIn('userId', userIds)
    .orderBy('id', 'asc')
    .select(SUBSCRIPTION_COLUMNS);
}

export function deleteForUserByHash({ userId, endpointHash }, trx = db) {
  return trx('push_subscriptions').where({ userId, endpointHash }).delete();
}

export function deleteForUser(userId, trx = db) {
  return trx('push_subscriptions').where({ userId }).delete();
}

export function deleteByIds(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve(0);
  return trx('push_subscriptions').whereIn('id', ids).delete();
}

/** A push service accepted a message: remember when, and forget earlier failures. */
export function markSucceeded(ids, at, trx = db) {
  if (ids.length === 0) return Promise.resolve(0);
  return trx('push_subscriptions')
    .whereIn('id', ids)
    .update({ lastSuccessAt: at, failureCount: 0, updatedAt: at });
}

/** Sends failed (not 404/410): count them, capped at the column's maximum. */
export function incrementFailures(ids, at, by = 1, trx = db) {
  if (ids.length === 0) return Promise.resolve(0);
  return trx('push_subscriptions')
    .whereIn('id', ids)
    .update({
      failureCount: trx.raw('LEAST(failure_count + ?, ?)', [by, FAILURE_COUNT_MAX]),
      updatedAt: at,
    });
}

// ---------- notifications.pushed_at ----------

/**
 * Due notifications (pushed_at IS NULL, created at or after `since`), newest first, locked FOR
 * UPDATE (SKIP LOCKED when the database supports it) so two workers never claim the same row.
 * Newest first: notifications being retried (put back with pushed_at NULL) can't fill every
 * batch and hold new ones back for up to an hour. Call inside a transaction.
 */
export function selectDueForUpdate({ since, limit, skipLocked }, trx) {
  const query = trx('notifications')
    .whereNull('pushedAt')
    .where('createdAt', '>=', since)
    .orderBy('id', 'desc')
    .limit(limit)
    .select('id', 'userId', 'type', 'title', 'body', 'link', 'createdAt')
    .forUpdate();
  return skipLocked ? query.skipLocked() : query;
}

/** Marks notifications handled (the claim, before sending). */
export function markPushed(ids, at, trx = db) {
  if (ids.length === 0) return Promise.resolve(0);
  return trx('notifications').whereIn('id', ids).whereNull('pushedAt').update({ pushedAt: at });
}

/** Puts claimed notifications back, so the next tick tries them again. */
export function releaseForRetry(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve(0);
  return trx('notifications').whereIn('id', ids).update({ pushedAt: null });
}

/**
 * Marks every unhandled notification created before `before` as handled without sending
 * (too old to pop up). With `before` null, marks every unhandled one (pushes are off).
 */
export function markUnsentHandled({ before = null, at }, trx = db) {
  const query = trx('notifications').whereNull('pushedAt');
  if (before) query.where('createdAt', '<', before);
  return query.update({ pushedAt: at });
}
