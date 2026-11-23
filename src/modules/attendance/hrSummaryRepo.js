// Queries of the morning HR summary and the evening wrap-up (CONTRACT 25, item 1): what waits for
// the recipient, the missing and auto check-outs of the last working days, and the once-a-day
// claim in attendance_alerts (migration 018).
import { db } from '@/lib/db';

/** Rows of active people who track attendance, with the person's name and role. */
function rowsOfTracked(trx) {
  return trx('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    .where('u.status', 'active')
    .where('u.tracksAttendance', true)
    .select('a.id', 'a.userId', 'a.workDate', 'a.checkOutAt', 'a.checkoutStatus')
    .select('u.name', 'u.role');
}

/**
 * Pending requests waiting for the recipient, never their own: correction requests, and work
 * from home requests whose last day is `today` or later (as the Attendance nav badge counts).
 * Admins' requests are left out with `hideAdmins`.
 * @param {{ hideAdmins: boolean, excludeUserId: number, today?: string | null }} where
 * @returns {Promise<{ corrections: number, wfh: number }>}
 */
export async function countWaiting({ hideAdmins, excludeUserId, today = null }, trx = db) {
  const corrections = trx('attendanceCorrections as c')
    .join('users as u', 'u.id', 'c.userId')
    .where('c.status', 'pending')
    .whereNot('c.userId', excludeUserId);
  const wfh = trx('wfhRequests as w')
    .join('users as u', 'u.id', 'w.userId')
    .where('w.status', 'pending')
    .whereNot('w.userId', excludeUserId);
  if (today) wfh.where('w.toDate', '>=', today);
  if (hideAdmins) {
    corrections.whereNot('u.role', 'admin');
    wfh.whereNot('u.role', 'admin');
  }
  const [a, b] = await Promise.all([
    corrections.count({ n: '*' }).first(),
    wfh.count({ n: '*' }).first(),
  ]);
  return { corrections: Number(a?.n ?? 0), wfh: Number(b?.n ?? 0) };
}

/**
 * Rows still marked as a missing check-out from `from` to `to` (inclusive), oldest first.
 * @returns {Promise<Array<{ id: number, userId: number, workDate: string, name: string,
 *   role: string }>>}
 */
export function listMissingBetween(from, to, trx = db) {
  return rowsOfTracked(trx)
    .where('a.checkoutStatus', 'missing')
    .whereBetween('a.workDate', [from, to])
    .orderBy('a.workDate', 'asc')
    .orderBy('u.name', 'asc');
}

/**
 * Every row from `from` to `to` (inclusive), oldest first (the evening's auto check-outs).
 * @returns {Promise<Array<{ id: number, userId: number, workDate: string,
 *   checkOutAt: Date | null, checkoutStatus: string, name: string, role: string }>>}
 */
export function listRowsBetween(from, to, trx = db) {
  return rowsOfTracked(trx)
    .whereBetween('a.workDate', [from, to])
    .orderBy('a.workDate', 'asc')
    .orderBy('u.name', 'asc');
}

/**
 * The once-a-day claim of one recipient's summary: errno 1062 when it was already sent, 1146
 * before migration 018.
 * @param {{ userId: number, kind: 'hr_morning' | 'hr_evening', periodKey: string,
 *   createdAt: Date }} row periodKey = the date 'YYYY-MM-DD'
 * @returns {Promise<number>} the new claim id
 */
export async function insertSummaryClaim(row, trx = db) {
  const [id] = await trx('attendanceAlerts').insert({ ...row, days: 0 });
  return id;
}
