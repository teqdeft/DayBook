import { db } from '@/lib/db';
import { nowDate } from '@/lib/time';
import * as repo from './repo';
import { notifySchema } from './schemas';

/**
 * Creates in-app notifications (the bell), one per person. Always created, whatever the Slack
 * settings are. Pass the caller's transaction so the notification commits with the change.
 * Duplicate and empty user ids are dropped; no ids means nothing is written.
 * Long titles and bodies are cut to the column size rather than failing the caller's change.
 * @param {{ userIds: Array<number | null | undefined>, type: string, title: string,
 *   body?: string | null, link?: string | null }} input for example
 *   { userIds: [4], type: 'report_edit.approved', title: 'Your edit request was approved',
 *   link: '/report?date=2026-09-29' }
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number>} how many notifications were created
 * @throws ZodError when type or title is missing (a programming error)
 */
export async function notify(input, trx = db) {
  const ids = [
    ...new Set((input?.userIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (ids.length === 0) return 0;
  const { type, title, body, link } = notifySchema.parse({ ...input, userIds: ids });
  const at = nowDate();
  await repo.insertMany(
    ids.map((userId) => ({ userId, type, title, body, link, createdAt: at, updatedAt: at })),
    trx,
  );
  return ids.length;
}

/**
 * A person's latest notifications, newest first.
 * @param {number} userId
 * @param {{ limit?: number }} [options] default 20, at most 100
 * @returns {Promise<Array<{ id: number, type: string, title: string, body: string | null,
 *   link: string | null, readAt: Date | null, createdAt: Date }>>}
 */
export function listForUser(userId, { limit = 20 } = {}) {
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100);
  return repo.listForUser(userId, size);
}

/**
 * How many of a person's notifications are unread (the bell dot).
 * @param {number} userId
 * @returns {Promise<number>}
 */
export function unreadCount(userId) {
  return repo.countUnread(userId);
}

/**
 * Marks every unread notification of a person as read.
 * @param {number} userId
 * @returns {Promise<number>} how many were marked
 */
export function markAllRead(userId) {
  return repo.markAllRead(userId, nowDate());
}

/**
 * Deletes notifications that were read before a moment (the daily cleanup keeps 180 days).
 * Unread notifications are never deleted.
 * @param {Date} before
 * @returns {Promise<number>} how many were deleted
 */
export function deleteOldRead(before) {
  return repo.deleteReadBefore(before);
}
