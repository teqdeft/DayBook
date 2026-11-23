// attendance_reminders queries (CONTRACT 25, item 5; migration 018). One row per remind sent.
// Lists filter work_date first (its KEY), so the day page's 60 s refresh never scans 180 days.
import { db } from '@/lib/db';

const COLUMNS = ['r.id', 'r.userId', 'r.kind', 'r.workDate', 'r.sentBy', 'r.sentAt'];

/**
 * The person's reminders of one kind sent at or after `since`, newest first, locked. Inside a
 * REPEATABLE READ transaction this locks the (user_id, kind, sent_at) index range and the gap
 * after it, so two sends at once wait or deadlock and the retry sees the first one.
 * @param {{ userId: number, kind: string, since: Date }} where
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<Array<{ id: number, sentAt: Date }>>}
 */
export function findRecentForUpdate({ userId, kind, since }, trx) {
  return trx('attendanceReminders')
    .select('id', 'sentAt')
    .where({ userId, kind })
    .where('sentAt', '>=', since)
    .orderBy('sentAt', 'desc')
    .forUpdate();
}

/**
 * @param {{ userId: number, kind: string, workDate: string, sentBy: number | null,
 *   sentAt: Date, autoKey: string | null }} row
 * @returns {Promise<number>} the new reminder id
 * @throws errno 1062 when an automatic reminder with that auto_key was already sent
 */
export async function insertReminder(row, trx = db) {
  const at = row.sentAt;
  const [id] = await trx('attendanceReminders').insert({ ...row, createdAt: at, updatedAt: at });
  return id;
}

/**
 * Reminders sent from `sinceDate` (company date) and `since` on, newest first, with the
 * sender's name (null = Daybook, or a sender since deleted).
 * @param {{ since: Date, sinceDate: string, userIds?: number[], kinds?: string[] }} where
 * @returns {Promise<Array<{ id: number, userId: number, kind: string, workDate: string,
 *   sentBy: number | null, sentAt: Date, senderName: string | null }>>}
 */
export function listSince({ since, sinceDate, userIds, kinds }, trx = db) {
  const query = trx('attendanceReminders as r')
    .leftJoin('users as s', 's.id', 'r.sentBy')
    .select([...COLUMNS, 's.name as senderName'])
    .where('r.workDate', '>=', sinceDate)
    .where('r.sentAt', '>=', since);
  if (userIds) query.whereIn('r.userId', userIds);
  if (kinds) query.whereIn('r.kind', kinds);
  return query.orderBy('r.sentAt', 'desc').orderBy('r.id', 'desc');
}

/**
 * Who got a reminder of one kind on a company date (the check-in reminder job's first read).
 * @param {{ workDate: string, kind: string }} where
 * @returns {Promise<number[]>}
 */
export async function listUserIdsForDay({ workDate, kind }, trx = db) {
  const rows = await trx('attendanceReminders').distinct('userId').where({ workDate, kind });
  return rows.map((row) => Number(row.userId));
}

/**
 * Deletes reminders of company dates before `beforeDate` (the daily cleanup keeps 180 days).
 * @param {string} beforeDate 'YYYY-MM-DD'
 * @returns {Promise<number>} how many were deleted
 */
export function deleteBefore(beforeDate, trx = db) {
  return trx('attendanceReminders').where('workDate', '<', beforeDate).del();
}
