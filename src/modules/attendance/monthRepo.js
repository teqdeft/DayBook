// Queries of the month view, the person month, Needs a look and the late alert (CONTRACT 25,
// items 4, 8 and 10). One query per table for a whole period (no per-day loop). Attendance rows
// carry who entered a missing check-out (migration 018) but never the check-in or check-out IP.
// Before 018 the entered-by columns, leave_entries and attendance_alerts are missing (errno 1054
// or 1146): the rows read again without the columns, the other reads and writes are guarded by
// their callers (migration018.js).
import { db } from '@/lib/db';
import { isMissing018 } from './migration018';

// ROW_COLUMNS of repo.js without checkInIp and checkOutIp: no attendance IP leaves the day page.
const ROW_COLUMNS = [
  'id',
  'userId',
  'workDate',
  'checkInAt',
  'checkOutAt',
  'location',
  'officeVerified',
  'note',
  'lateMinutes',
  'isWorkingDay',
  'checkoutStatus',
  'source',
];

const ENTERED_COLUMNS = [
  'a.checkoutEnteredBy',
  'a.checkoutEnteredAt',
  'a.checkoutSuggestedAt',
  'e.name as checkoutEnteredByName',
];

// The same filter as repo.listBreaksByDate, over a range: every break, away ones included.
const BREAK_COLUMNS = [
  'id',
  'userId',
  'attendanceId',
  'workDate',
  'startedAt',
  'endedAt',
  'endReason',
];

function rowsQuery({ userIds, from, to }, trx, withEntered) {
  const query = trx('attendance as a')
    .select(ROW_COLUMNS.map((column) => `a.${column}`))
    .whereIn('a.userId', userIds)
    .whereBetween('a.workDate', [from, to])
    .orderBy('a.userId', 'asc')
    .orderBy('a.workDate', 'asc');
  if (withEntered) {
    query.leftJoin('users as e', 'e.id', 'a.checkoutEnteredBy').select(ENTERED_COLUMNS);
  }
  return query;
}

/**
 * Attendance rows of `userIds` from `from` to `to` (the user_id, work_date unique index), with
 * who entered a missing check-out (checkoutEnteredBy, checkoutEnteredAt, checkoutSuggestedAt,
 * checkoutEnteredByName; null before migration 018). Never the IPs.
 * @param {{ userIds: number[], from: string, to: string }} range
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<object[]>} by person, then day
 */
export async function listRowsByRange({ userIds, from, to }, trx = db) {
  if (!userIds?.length) return [];
  try {
    return await rowsQuery({ userIds, from, to }, trx, true);
  } catch (error) {
    if (!isMissing018(error)) throw error;
    return rowsQuery({ userIds, from, to }, trx, false);
  }
}

/**
 * Every break of `userIds` from `from` to `to`, away breaks included (they count like any other).
 * @param {{ userIds: number[], from: string, to: string }} range
 * @param {import('knex').Knex} [trx]
 */
export function listBreaksByRange({ userIds, from, to }, trx = db) {
  if (!userIds?.length) return Promise.resolve([]);
  return trx('attendanceBreaks')
    .select(BREAK_COLUMNS)
    .whereIn('userId', userIds)
    .whereBetween('workDate', [from, to])
    .orderBy('userId', 'asc')
    .orderBy('startedAt', 'asc')
    .orderBy('id', 'asc');
}

/**
 * The rows with stored late minutes of `userIds` from `from` to `to` ("4th this month"), with
 * what the person's day needs (role, tracking, joined, shift, status, deactivatedAt), in one
 * query.
 * @param {{ userIds: number[], from: string, to: string }} range
 * @param {import('knex').Knex} [trx]
 */
export function listLateDays({ userIds, from, to }, trx = db) {
  if (!userIds?.length) return Promise.resolve([]);
  return trx('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    .select(
      'a.userId',
      'a.workDate',
      'a.lateMinutes',
      'u.role',
      'u.tracksAttendance',
      'u.joinedOn',
      'u.shiftStart',
      'u.shiftEnd',
      'u.status',
      'u.deactivatedAt',
    )
    .whereIn('a.userId', userIds)
    .whereBetween('a.workDate', [from, to])
    .where('a.lateMinutes', '>', 0)
    .orderBy('a.userId', 'asc')
    .orderBy('a.workDate', 'asc');
}

/**
 * Leave entries of `userIds` touching `from`..`to`, with the note and who marked them (the month
 * Excel's "Leave note", the person month's Changes). Throws 1146 before migration 018.
 * @param {{ userIds: number[], from: string, to: string }} range
 * @param {import('knex').Knex} [trx]
 */
export function listLeaveEntries({ userIds, from, to }, trx = db) {
  if (!userIds?.length) return Promise.resolve([]);
  return trx('leaveEntries as l')
    .leftJoin('users as c', 'c.id', 'l.createdBy')
    .select(
      'l.id',
      'l.userId',
      'l.fromDate',
      'l.toDate',
      'l.part',
      'l.paid',
      'l.leaveType',
      'l.note',
      'l.createdBy',
      'l.createdAt',
      'c.name as createdByName',
    )
    .whereIn('l.userId', userIds)
    .where('l.fromDate', '<=', to)
    .where('l.toDate', '>=', from)
    .orderBy('l.fromDate', 'asc')
    .orderBy('l.id', 'asc');
}

/**
 * Claims one late alert (or summary) per person, kind and period: errno 1062 when it was already
 * sent, 1146 before migration 018.
 * @param {{ userId: number, kind: string, periodKey: string, days: number, createdAt: Date }} row
 * @param {import('knex').Knex.Transaction} trx
 */
export async function insertAlert(row, trx) {
  const [id] = await trx('attendanceAlerts').insert(row);
  return id;
}
