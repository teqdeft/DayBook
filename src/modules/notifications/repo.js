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
