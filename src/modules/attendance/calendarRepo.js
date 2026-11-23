// Queries of the person's day (CONTRACT 25): company holidays, HR's leave, approved WFH requests,
// and the attendance rows the day rules re-check. Holidays are always read from the table here,
// never from the companyDay cache. Tables of migration 018 (holidays, leave_entries) throw errno
// 1146 before it has run; the callers (calendarReads.js, dayRules.js) guard them.
import { db } from '@/lib/db';

const LEAVE_COLUMNS = ['id', 'userId', 'fromDate', 'toDate', 'part', 'paid', 'leaveType'];

/** Holidays from `from` to `to` (inclusive), by date: [{ id, date, name }]. */
export async function listHolidays(from, to, trx = db) {
  const rows = await trx('holidays')
    .select('id', 'holidayDate', 'name')
    .whereBetween('holidayDate', [from, to])
    .orderBy('holidayDate', 'asc');
  return rows.map((row) => ({ id: row.id, date: row.holidayDate, name: row.name }));
}

/** The first holiday on or after `from` up to `to`, or null. */
export async function findNextHoliday(from, to, trx = db) {
  const row = await trx('holidays')
    .select('id', 'holidayDate', 'name')
    .whereBetween('holidayDate', [from, to])
    .orderBy('holidayDate', 'asc')
    .first();
  return row ? { id: row.id, date: row.holidayDate, name: row.name } : null;
}

/**
 * Leave entries sharing a day with `from`..`to` (of `userIds` when given), without the note.
 * With `withMarkedBy` each row also carries `markedByName` (who marked it).
 */
export function listLeave({ from, to, userIds, withMarkedBy = false }, trx = db) {
  if (userIds && userIds.length === 0) return Promise.resolve([]);
  const query = trx('leaveEntries as l')
    .select(LEAVE_COLUMNS.map((column) => `l.${column}`))
    .where('l.fromDate', '<=', to)
    .where('l.toDate', '>=', from)
    .orderBy('l.fromDate', 'asc')
    .orderBy('l.id', 'asc');
  if (userIds) query.whereIn('l.userId', userIds);
  if (withMarkedBy) {
    query.leftJoin('users as c', 'c.id', 'l.createdBy').select('c.name as markedByName');
  }
  return query;
}

/** Approved WFH requests sharing a day with `from`..`to` (of `userIds` when given). */
export function listApprovedWfh({ from, to, userIds }, trx = db) {
  if (userIds && userIds.length === 0) return Promise.resolve([]);
  const query = trx('wfhRequests')
    .select('userId', 'fromDate', 'toDate')
    .where({ status: 'approved' })
    .where('fromDate', '<=', to)
    .where('toDate', '>=', from);
  if (userIds) query.whereIn('userId', userIds);
  return query;
}

const DAY_ROW_COLUMNS = ['id', 'userId', 'workDate', 'checkInAt', 'lateMinutes', 'isWorkingDay'];

/**
 * Attendance rows from `from` to `to` (of `userIds` when given) with what the day rules read,
 * oldest day first; `since` keeps only rows created at or after it.
 */
export function listDayRows({ from, to, userIds, since }, trx = db) {
  if (userIds && userIds.length === 0) return Promise.resolve([]);
  const query = trx('attendance')
    .select(DAY_ROW_COLUMNS)
    .whereBetween('workDate', [from, to])
    .orderBy('workDate', 'asc')
    .orderBy('userId', 'asc');
  if (userIds) query.whereIn('userId', userIds);
  if (since) query.where('createdAt', '>=', since);
  return query;
}

/** One row locked by primary key, read again under the lock (undefined when it is gone). */
export function lockDayRow(id, trx) {
  return trx('attendance').select(DAY_ROW_COLUMNS).where({ id }).first().forUpdate();
}

/** Saves the day rules' late minutes and flag for one row. */
export function updateDayRow(id, { lateMinutes, isWorkingDay, updatedAt }, trx) {
  return trx('attendance').where({ id }).update({ lateMinutes, isWorkingDay, updatedAt });
}
