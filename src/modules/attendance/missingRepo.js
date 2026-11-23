// Queries for missing check-outs (CONTRACT 25, items B and 7): HR's full list with paging, the
// person's own rows for Today's pop-up, "Not now", the pending check_out corrections beside the
// listed rows, and closing a missing row. The entered-by and prompt columns of migration 018 are
// read and written only here and in checkoutEntered.js, never through ROW_COLUMNS.
import { db } from '@/lib/db';

/**
 * Rows still marked missing (not fixed yet) of active people who track attendance: the set
 * repo.listMissing and repo.countMissing read. `hideAdmins` leaves out Admins' rows.
 */
function unfixedOfTracked(trx, { hideAdmins = false } = {}) {
  const query = trx('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    .where({ 'a.checkoutStatus': 'missing', 'u.status': 'active', 'u.tracksAttendance': true });
  if (hideAdmins) query.whereNot('u.role', 'admin');
  return query;
}

/** Leaves out rows whose person has a pending check_out correction for that date. */
function withoutPendingCheckout(query, trx, table = 'a') {
  return query.whereNotExists(
    trx('attendanceCorrections as c')
      .select('c.id')
      .whereColumn('c.userId', `${table}.userId`)
      .whereColumn('c.workDate', `${table}.workDate`)
      .where({ 'c.type': 'check_out', 'c.status': 'pending' }),
  );
}

/**
 * One page of missing rows (see unfixedOfTracked): newest day first, then the person's name.
 * @returns {Promise<number[]>} attendance ids in that order
 */
export async function listMissingIds({ limit, offset = 0, hideAdmins = false }, trx = db) {
  const rows = await unfixedOfTracked(trx, { hideAdmins })
    .select('a.id')
    .orderBy('a.workDate', 'desc')
    .orderBy('u.name', 'asc')
    .orderBy('a.id', 'asc')
    .limit(limit)
    .offset(offset);
  return rows.map((row) => Number(row.id));
}

/**
 * Unfixed rows of these people without a pending check_out correction, newest first.
 * @param {number[]} userIds
 * @returns {Promise<Array<{ id: number, userId: number, workDate: string }>>}
 */
export function listUnfixedFor(userIds, trx = db) {
  if (userIds.length === 0) return Promise.resolve([]);
  const query = unfixedOfTracked(trx).whereIn('a.userId', userIds);
  return withoutPendingCheckout(query, trx)
    .select('a.id', 'a.userId', 'a.workDate')
    .orderBy('a.workDate', 'desc')
    .orderBy('a.id', 'desc');
}

/**
 * The person's own missing rows from `from` to `to` without a pending check_out correction,
 * newest first, with the day "Not now" was pressed (a migration 018 column: 1054 before it).
 * @returns {Promise<Array<{ id: number, userId: number, workDate: string, checkInAt: Date,
 *   location: string, checkoutPromptHiddenOn: string | null }>>}
 */
export function listOwnMissing({ userId, from, to, limit }, trx = db) {
  const query = trx('attendance as a')
    .where({ 'a.userId': userId, 'a.checkoutStatus': 'missing' })
    .whereBetween('a.workDate', [from, to]);
  return withoutPendingCheckout(query, trx)
    .select(
      'a.id',
      'a.userId',
      'a.workDate',
      'a.checkInAt',
      'a.location',
      'a.checkoutPromptHiddenOn',
    )
    .orderBy('a.workDate', 'desc')
    .limit(limit);
}

/**
 * "Not now": one UPDATE of the rows listOwnMissing() lists (a migration 018 column).
 * @returns {Promise<number>} rows changed
 */
export function hideOwnPrompt({ userId, from, to, hiddenOn }, trx = db) {
  const query = trx('attendance')
    .where({ userId, checkoutStatus: 'missing' })
    .whereBetween('workDate', [from, to]);
  return withoutPendingCheckout(query, trx, 'attendance').update({
    checkoutPromptHiddenOn: hiddenOn,
  });
}

/**
 * Pending check_out corrections of these people on these dates (match them by userId and
 * workDate).
 * @returns {Promise<Array<{ id: number, userId: number, workDate: string, requestedTime: Date }>>}
 */
export function listPendingCheckouts({ userIds, dates }, trx = db) {
  if (userIds.length === 0 || dates.length === 0) return Promise.resolve([]);
  return trx('attendanceCorrections')
    .select('id', 'userId', 'workDate', 'requestedTime')
    .where({ type: 'check_out', status: 'pending' })
    .whereIn('userId', userIds)
    .whereIn('workDate', dates);
}

/**
 * The day "Not now" was pressed on one row: a cheap read of a migration 018 column (1054 before
 * it), so the pop-up's Save can answer UPDATE_NEEDED before it writes anything.
 * @returns {Promise<{ checkoutPromptHiddenOn: string | null } | undefined>}
 */
export function findPromptHiddenOn(id, trx = db) {
  return trx('attendance').where({ id }).first('checkoutPromptHiddenOn');
}

/**
 * Closes a row that is still missing (HR's fix, or the person's own with the entered-by columns);
 * 0 when someone fixed it first.
 * @returns {Promise<number>} rows changed
 */
export function closeMissingRow(id, changes, trx = db) {
  return trx('attendance').where({ id, checkoutStatus: 'missing' }).update(changes);
}
