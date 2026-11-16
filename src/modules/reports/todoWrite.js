// The write flow every change to today's to-do shares (CONTRACT 24, "Write flow"), so the first
// adds of the day can't deadlock or make two drafts: today's draft is opened outside the
// transaction (openForDate: insert, a duplicate key means another request made it); then, in the
// transaction (READ COMMITTED, see writeTx.js), the report row is locked and its entries and
// tasks are read again under the lock. A deadlock (errno 1213) runs the whole write once more.
// Every write changes the stored lines, so the report's version changes as with a save: an open
// report tab is told "This report changed somewhere else" on its next save, and re-reads when it
// becomes visible.
import { AppError } from '@/lib/errors';
import { workDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import * as repo from './repo';
import { openForDate } from './drafts';
import { lockStoredRows } from './save';
import { isEditable } from './view';
import { lineTransaction, retryOnDeadlock } from './writeTx';

export { retryOnDeadlock };

/** REPORT_LOCKED for a report submitted today: its lines change in the report from now on. */
export function reportIsIn() {
  return new AppError('REPORT_LOCKED', {
    message: 'Your report is in. Change tasks in the report.',
  });
}

/**
 * @throws REPORT_LOCKED ("Your report is in. Change tasks in the report." once submitted, the
 *   default message once the report has locked)
 */
export function assertTodoWritable(report) {
  if (report?.status === 'submitted') throw reportIsIn();
  if (!isEditable(report)) throw new AppError('REPORT_LOCKED');
}

export function lineNotFound() {
  return new AppError('NOT_FOUND', {
    message: "We couldn't find that task in today's to-do. Reload the page to see the latest.",
  });
}

export function projectNotFound() {
  return new AppError('NOT_FOUND', {
    message: "We couldn't find that project in today's to-do. Reload the page to see the latest.",
  });
}

/**
 * Today in the company time zone and the person's report for it (null when there is none yet).
 * @returns {Promise<{ today: string, report: object | null }>}
 */
export async function findTodayReport(user) {
  const today = workDate((await settings.getAll()).timezone);
  return { today, report: (await repo.findByUserAndDate(user.id, today)) ?? null };
}

/**
 * Opens today's draft (empty, CONTRACT 24) outside any transaction and returns its id.
 * @throws REPORT_LOCKED when today's report can't be created any more (past its lock)
 */
export async function openToday(user, today) {
  const view = await openForDate({ user, workDate: today });
  if (!view.id) throw new AppError('REPORT_LOCKED');
  return view.id;
}

/** In the transaction: the report row, locked, still taking to-do changes. */
export async function lockTodayReport(reportId, trx) {
  const locked = await repo.findByIdForUpdate(reportId, trx);
  assertTodoWritable(locked);
  return locked;
}

/**
 * Changes lines already in today's report: the report row and then its entries and tasks locked,
 * in one transaction (READ COMMITTED, writeTx.js), retried once on a deadlock.
 * @param {{ user: object, notFound: () => AppError }} options notFound: the error when there is
 *   no report today
 * @param {(rows: { report: object, entries: object[], tasks: object[] },
 *   trx: import('knex').Knex.Transaction) => Promise<T>} change
 * @returns {Promise<T>}
 * @template T
 * @throws the notFound error, REPORT_LOCKED
 */
export function changeToday({ user, notFound }, change) {
  return retryOnDeadlock(async () => {
    const { report } = await findTodayReport(user);
    if (!report) throw notFound();
    assertTodoWritable(report);
    return lineTransaction(async (trx) => {
      const locked = await lockTodayReport(report.id, trx);
      const rows = await lockStoredRows(locked, trx);
      return change({ report: locked, ...rows }, trx);
    });
  });
}

/**
 * Validates service input with a to-do schema (the routes validate too; tests and pages call the
 * services directly).
 * @throws VALIDATION_FAILED with the fields named
 */
export function parseTodoInput(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw new AppError('VALIDATION_FAILED', { message: Object.values(fields)[0], fields });
}

/**
 * Runs a check written for the report save and names its field errors the to-do's way
 * (entries.0.project -> groups.0.projectId, for example).
 * @param {() => Promise<T>} check
 * @param {(key: string) => string} rename
 * @returns {Promise<T>}
 * @template T
 */
export async function withFieldNames(check, rename) {
  try {
    return await check();
  } catch (error) {
    if (!(error instanceof AppError) || !error.fields) throw error;
    error.fields = Object.fromEntries(
      Object.entries(error.fields).map(([key, message]) => [rename(key), message]),
    );
    throw error;
  }
}
