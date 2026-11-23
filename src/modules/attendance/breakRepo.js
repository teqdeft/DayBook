// Queries on the attendance_breaks columns migration 018 adds (CONTRACT 25 A and item 2): source,
// away_entry_id, changed_by_id and changed_at. They are never part of repo.js BREAK_COLUMNS, so
// every 1.09 read keeps working before the migration; the reads here go through
// readWithBreakColumns, which falls back to the 1.09 columns on errno 1054. Never write the
// generated open_user_id.
import { db } from '@/lib/db';

const NO_SUCH_COLUMN = 1054;

/** The 1.09 columns (repo.js BREAK_COLUMNS). */
export const BASE_COLUMNS = [
  'id',
  'userId',
  'attendanceId',
  'workDate',
  'startedAt',
  'endedAt',
  'endReason',
  'pausedEntryId',
];

/** BREAK_COLUMNS plus the 1.10 detail columns: a BreakDetail. */
export const DETAIL_COLUMNS = [
  ...BASE_COLUMNS,
  'source',
  'awayEntryId',
  'changedById',
  'changedAt',
];

/** What a row read without the 1.10 columns stands for: a 1.09 break, the person's own. */
const BEFORE_018 = { source: 'self', awayEntryId: null, changedById: null, changedAt: null };

/**
 * Runs a read with the detail columns; before migration 018 (errno 1054) it runs it again with
 * the 1.09 columns and gives every row source 'self' and no changes.
 * @template T
 * @param {(columns: string[]) => Promise<T[]>} read
 * @returns {Promise<{ rows: T[], available: boolean }>} available: false before 018
 */
export async function readWithBreakColumns(read) {
  try {
    return { rows: await read(DETAIL_COLUMNS), available: true };
  } catch (error) {
    if (error?.errno !== NO_SUCH_COLUMN) throw error;
    const rows = await read(BASE_COLUMNS);
    return { rows: rows.map((row) => ({ ...row, ...BEFORE_018 })), available: false };
  }
}

/** One person's breaks of a work date with the given columns, oldest first (at most `limit`). */
export function listByUserDate(columns, { userId, workDate, limit = 200 }, trx = db) {
  return trx('attendanceBreaks')
    .select(columns)
    .where({ userId, workDate })
    .orderBy('startedAt', 'asc')
    .orderBy('id', 'asc')
    .limit(limit);
}

/** One person's away breaks of a work date (detail columns), oldest first. */
export function listAwayByUserDate({ userId, workDate }, trx = db) {
  return trx('attendanceBreaks')
    .select(DETAIL_COLUMNS)
    .where({ userId, workDate, source: 'away' })
    .orderBy('startedAt', 'asc')
    .orderBy('id', 'asc');
}

/**
 * One break with the detail columns, locked for the rest of the caller's transaction (errno 1054
 * before 018: the caller guards it).
 */
export function lockDetail(id, trx) {
  return trx('attendanceBreaks').select(DETAIL_COLUMNS).where({ id }).first().forUpdate();
}

/**
 * Saves an away break (source 'away', end_reason 'away'). Before 018 the insert fails with errno
 * 1054 on `source`, never with an ENUM error: the caller guards it.
 * @returns {Promise<number>} the new break id
 */
export async function insertAwayBreak(row, trx) {
  const [id] = await trx('attendanceBreaks').insert({ ...row, source: 'away', endReason: 'away' });
  return id;
}

/** HR's new end (end_reason 'hr' with who changed it, so it fails with 1054 before 018). */
export function setEndByHr(id, { endedAt, changedById, changedAt }, trx) {
  return trx('attendanceBreaks')
    .where({ id })
    .update({ endedAt, endReason: 'hr', changedById, changedAt, updatedAt: changedAt });
}

/** Deletes one break. @returns {Promise<number>} rows deleted */
export function deleteBreak(id, trx) {
  return trx('attendanceBreaks').where({ id }).del();
}
