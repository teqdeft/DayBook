import { db } from '@/lib/db';

const COLUMNS = ['id', 'type', 'title', 'body', 'link', 'readAt', 'createdAt'];

/** Inserts many notification rows in one statement. */
export function insertMany(rows, trx = db) {
  return trx('notifications').insert(rows);
}

/** A person's latest notifications, newest first. Uses the (user_id, read_at) index. */
export function listForUser(userId, limit, trx = db) {
  return trx('notifications')
    .where({ userId })
    .orderBy([
      { column: 'createdAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(limit)
    .select(COLUMNS);
}

export async function countUnread(userId, trx = db) {
  const row = await trx('notifications')
    .where({ userId })
    .whereNull('readAt')
    .count({ count: '*' })
    .first();
  return Number(row?.count ?? 0);
}

export function markAllRead(userId, readAt, trx = db) {
  return trx('notifications')
    .where({ userId })
    .whereNull('readAt')
    .update({ readAt, updatedAt: readAt });
}

export function deleteReadBefore(before, trx = db) {
  return trx('notifications').whereNotNull('readAt').where('readAt', '<', before).delete();
}

/** True when the person has a notification of this type created at or after `since`. */
export async function existsSince({ userId, type, since }, trx = db) {
  const row = await trx('notifications')
    .where({ userId, type })
    .where('createdAt', '>=', since)
    .first('id');
  return Boolean(row);
}

/** One of a person's notifications, or undefined (someone else's or missing). */
export function findForUser({ userId, id }, trx = db) {
  return trx('notifications').where({ id, userId }).first(COLUMNS);
}

/** Sets or clears read_at on one of a person's notifications; returns how many rows changed. */
export function setReadAt({ userId, id, readAt, at }, trx = db) {
  return trx('notifications').where({ id, userId }).update({ readAt, updatedAt: at });
}

/** Deletes one of a person's notifications; returns how many rows were deleted (0 or 1). */
export function deleteForUser({ userId, id }, trx = db) {
  return trx('notifications').where({ id, userId }).delete();
}
