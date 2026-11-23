import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import { assertClassified, isClassified } from './alerts';
import * as repo from './repo';
import { READ_IDS_MAX, notifySchema } from './schemas';

const LIVE_LIMIT_MAX = 50;
const warnedTypes = new Set();

/**
 * Every type must be in ALERT_TYPES (CONTRACT 26). Under Vitest an unlisted type throws, so the
 * creating module's service test fails; in production it logs once per type per process and the
 * rows are written as before (a notification never fails the caller's change). VITEST is read at
 * call time so a test can switch it off.
 */
function checkClassified(type) {
  if (isClassified(type)) return;
  if (process.env.VITEST) assertClassified(type);
  if (warnedTypes.has(type)) return;
  warnedTypes.add(type);
  logger.warn({ type }, 'notification type has no alert level');
}

/**
 * Creates in-app notifications (the bell), one per person. Always created, whatever the Slack
 * settings are. Pass the caller's transaction so the notification commits with the change.
 * Duplicate and empty user ids are dropped; no ids means nothing is written.
 * Long titles and bodies are cut to the column size rather than failing the caller's change.
 * The type must be listed in ALERT_TYPES (@/modules/notifications/alerts, CONTRACT 26).
 * @param {{ userIds: Array<number | null | undefined>, type: string, title: string,
 *   body?: string | null, link?: string | null }} input for example
 *   { userIds: [4], type: 'report_edit.approved', title: 'Your edit request was approved',
 *   link: '/report?date=2026-09-29' }
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<number>} how many notifications were created
 * @throws ZodError when type or title is missing (a programming error); Error under Vitest when the
 *   type has no alert level (production logs a warning instead)
 */
export async function notify(input, trx = db) {
  const ids = [
    ...new Set((input?.userIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (ids.length === 0) return 0;
  const { type, title, body, link } = notifySchema.parse({ ...input, userIds: ids });
  checkClassified(type);
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
 * The live check (CONTRACT 26): a person's notifications with an id above `after`, newest first by
 * id, read or not.
 * @param {number} userId
 * @param {{ after: number, limit?: number }} options after = the highest id the tab has seen (0 for
 *   none); limit 1 to 50, default 20
 * @returns {Promise<{ items: Array<{ id: number, type: string, title: string, body: string | null,
 *   link: string | null, readAt: Date | null, createdAt: Date }>, more: boolean }>} more = rows
 *   above `after` beyond the limit
 */
export async function listAfter(userId, { after, limit = 20 } = {}) {
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), LIVE_LIMIT_MAX);
  const afterId = Math.max(Math.trunc(Number(after)) || 0, 0);
  const rows = await repo.listAfter(userId, afterId, size + 1);
  return { items: rows.slice(0, size), more: rows.length > size };
}

/**
 * The person's newest notification id (where a tab's live check starts, CONTRACT 26).
 * @param {number} userId
 * @returns {Promise<number>} 0 when they have none
 */
export function latestId(userId) {
  return repo.maxId(userId);
}

/** Positive whole ids without duplicates. */
function cleanIds(values) {
  return [...new Set(values.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

/**
 * Marks a person's unread notifications as read: every one, or with `ids` only those (their own
 * and unread; someone else's ids are ignored).
 * @param {number} userId
 * @param {{ ids?: number[] }} [options] at most 50 ids (a summary card's "Mark these as read")
 * @returns {Promise<number>} how many were marked
 * @throws VALIDATION_FAILED (fields.ids) for more than 50 ids
 */
export async function markAllRead(userId, { ids } = {}) {
  if (ids === undefined || ids === null) return repo.markAllRead(userId, nowDate());
  const list = cleanIds(Array.isArray(ids) ? ids : []);
  if (list.length > READ_IDS_MAX) {
    throw validationError({ ids: 'Pick 1 to 50 notifications.' }, 'Pick 1 to 50 notifications.');
  }
  if (list.length === 0) return 0;
  return repo.markAllRead(userId, nowDate(), list);
}

/** A positive whole id, or null (an id that can't exist answers NOT_FOUND like a missing one). */
function cleanId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Marks one of a person's notifications read or unread (the bell, CONTRACT 20). Marking read
 * keeps the first read time when it is already read.
 * @param {{ userId: number, id: number, read: boolean }} input
 * @returns {Promise<{ id: number, type: string, title: string, body: string | null,
 *   link: string | null, readAt: Date | null, createdAt: Date }>} the row after the change
 * @throws AppError NOT_FOUND when the notification is missing or belongs to someone else
 */
export async function markRead({ userId, id, read }) {
  const notificationId = cleanId(id);
  const row = notificationId ? await repo.findForUser({ userId, id: notificationId }) : null;
  if (!row) throw new AppError('NOT_FOUND');
  if (Boolean(read) === Boolean(row.readAt)) return row;
  const at = nowDate();
  const readAt = read ? at : null;
  await repo.setReadAt({ userId, id: notificationId, readAt, at });
  return { ...row, readAt };
}

/**
 * Deletes one of a person's notifications, read or not (the bell's Delete and swipe, CONTRACT 20).
 * @param {{ userId: number, id: number }} input
 * @returns {Promise<{ id: number }>}
 * @throws AppError NOT_FOUND when the notification is missing or belongs to someone else
 */
export async function remove({ userId, id }) {
  const notificationId = cleanId(id);
  const deleted = notificationId ? await repo.deleteForUser({ userId, id: notificationId }) : 0;
  if (!deleted) throw new AppError('NOT_FOUND');
  return { id: notificationId };
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

/**
 * Whether a person got a notification of this type at or after `since` (reminder jobs use it so
 * nobody is reminded twice too soon).
 * @param {{ userId: number, type: string, since: Date }} input
 * @returns {Promise<boolean>}
 */
export function hasRecent({ userId, type, since }) {
  return repo.existsSince({ userId, type, since });
}
