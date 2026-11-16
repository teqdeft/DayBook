// Queries for open tasks (CONTRACT 24): the unfinished-task suggestions, closing an open line
// ("Done already", "Not needed") and the checks on a line carried from one. Kept apart from
// repo.js, which holds every other reports query, only for its size.
//
// report_tasks.carry_closed_at and carry_closed_reason come with migration 017. Code that runs
// before `npm run migrate` reads without them (withClosedColumns); writes to them throw 1054,
// which suggestions.js turns into TODO_UNAVAILABLE.
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

const NO_SUCH_COLUMN = 1054;
let warnedNoClosed = false;

/** True when the error says a column of migration 017 doesn't exist yet. */
export function isClosedMissing(error) {
  return error?.errno === NO_SUCH_COLUMN;
}

/**
 * Runs a read with the carry_closed_* columns, and again without them before migration 017 (one
 * warning per process). As soon as the migration has run the columns are used, without a restart.
 * @template T
 * @param {(withClosed: boolean) => Promise<T>} read
 * @returns {Promise<T>}
 */
export async function withClosedColumns(read) {
  try {
    return await read(true);
  } catch (error) {
    if (!isClosedMissing(error)) throw error;
    if (!warnedNoClosed) {
      warnedNoClosed = true;
      logger.warn(
        'report_tasks.carry_closed_at is missing (run npm run migrate); closed tasks are not left out',
      );
    }
    return read(false);
  }
}

const closedColumns = (withClosed) => (withClosed ? ['t.carryClosedAt'] : []);

/**
 * Every task line of a person's reports on or after `from` (drafts included, no upper bound), with
 * its day, its report's status and lock times and its project or request, newest day first. Lines
 * carried from a task are always later than it, so this one query sees every line that continues
 * a task of the window. Project and request statuses come with the join (display fields; the
 * active check is the projects service's).
 * @param {number} userId
 * @param {string} from 'YYYY-MM-DD'
 * @param {{ withClosed: boolean }} options withClosed: also read carry_closed_at (migration 017)
 * @returns {Promise<Array<{ id, title, status, carriedFromTaskId, carryClosedAt?, workDate,
 *   reportStatus, locksAt, unlockedUntil, projectId, projectRequestId }>>}
 */
export function listLinesSince(userId, from, { withClosed }, trx = db) {
  return trx('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .where('d.userId', userId)
    .where('d.workDate', '>=', from)
    .orderBy([
      { column: 'd.workDate', order: 'desc' },
      { column: 'e.sortOrder', order: 'asc' },
      { column: 't.sortOrder', order: 'asc' },
      { column: 't.id', order: 'asc' },
    ])
    .select(
      't.id',
      't.title',
      't.status',
      't.carriedFromTaskId',
      ...closedColumns(withClosed),
      'd.workDate',
      'd.status as reportStatus',
      'd.locksAt',
      'd.unlockedUntil',
      'e.projectId',
      'e.projectRequestId',
    );
}

/**
 * Task lines with their report and project, locked until the transaction ends (the lines a save
 * carries from, or the line being closed). Locks the line's entry and report rows too.
 * @param {number[]} ids report_tasks ids
 * @param {{ withClosed: boolean, withTimerNote?: boolean }} options which optional columns to read
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<Array<{ id, status, firstReportedOn, projectTaskId, timerNote?,
 *   carryClosedAt?, carryClosedReason?, projectId, projectRequestId, userId, workDate,
 *   reportStatus }>>}
 */
export function lockLines(ids, { withClosed, withTimerNote = false }, trx) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .whereIn(
      't.id',
      [...ids].sort((a, b) => a - b),
    )
    .orderBy('t.id')
    .forUpdate()
    .select(
      't.id',
      't.status',
      't.firstReportedOn',
      't.projectTaskId',
      ...(withTimerNote ? ['t.timerNote'] : []),
      ...(withClosed ? ['t.carryClosedAt', 't.carryClosedReason'] : []),
      'e.projectId',
      'e.projectRequestId',
      'd.userId',
      'd.workDate',
      'd.status as reportStatus',
    );
}

/**
 * The lines carried from any of these tasks, in any report (drafts included), with their report's
 * status and lock times (a draft that locked unsubmitted doesn't count, see isLapsedDraft). A plain
 * read, no lock: call it in a READ COMMITTED transaction (writeTx.js) after locking the sources
 * with lockLines. Every claim and close locks its source line first, so a line carried at the same
 * moment has either committed (and is seen) or waits for this transaction. A share lock here took
 * gap locks under REPEATABLE READ and deadlocked two people carrying at once.
 * @param {number[]} ids report_tasks ids of the sources
 * @returns {Promise<Array<{ id, carriedFromTaskId, reportStatus, locksAt, unlockedUntil }>>}
 */
export function listCarriers(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .whereIn('t.carriedFromTaskId', ids)
    .select(
      't.id',
      't.carriedFromTaskId',
      'd.status as reportStatus',
      'd.locksAt',
      'd.unlockedUntil',
    );
}

/**
 * The ids among these lines that the person closed ("Done already", "Not needed"); none before
 * migration 017 (withClosedColumns).
 * @param {number[]} ids report_tasks ids
 * @returns {Promise<Set<number>>}
 */
export async function closedIdsAmong(ids, trx = db) {
  if (ids.length === 0) return new Set();
  const rows = await withClosedColumns((withClosed) =>
    withClosed
      ? trx('reportTasks').whereIn('id', ids).whereNotNull('carryClosedAt').select('id')
      : [],
  );
  return new Set(rows.map((row) => Number(row.id)));
}

/**
 * Closes a line or opens it again (carry_closed_at and carry_closed_reason only: nothing a report
 * version, a revision or Slack reads). Throws errno 1054 before migration 017.
 * @param {number} id
 * @param {{ carryClosedAt: Date | null, carryClosedReason: 'done' | 'dropped' | null }} changes
 */
export function setClosed(id, changes, trx = db) {
  return trx('reportTasks').where({ id }).update(changes);
}
