// Opening a report: draft creation (build guide 7.4; since CONTRACT 24 drafts start empty and
// unfinished tasks are suggested instead, see suggestions.js). Saving is in save.js.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { dayjs, locksAtFor, now, nowDate, workDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import * as repo from './repo';
import { isEditable, loadReportView, pendingView } from './view';

export function isDuplicateKey(error) {
  return error?.errno === 1062 || error?.code === 'ER_DUP_ENTRY';
}

/**
 * The report if it belongs to the person.
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function getOwnReport(user, reportId, trx) {
  const report = await repo.findById(reportId, trx);
  if (!report) throw new AppError('NOT_FOUND', { message: "We couldn't find that report." });
  if (Number(report.userId) !== Number(user.id)) {
    throw new AppError('FORBIDDEN', { message: 'You can only change your own reports.' });
  }
  return report;
}

/** @throws REPORT_LOCKED when the report can no longer change */
export function assertEditable(report) {
  if (!isEditable(report)) throw new AppError('REPORT_LOCKED');
}

/**
 * Inserts an empty draft report (0 hours, no entries). Since CONTRACT 24 a new draft never starts
 * with copied unfinished tasks: they are suggested when their project is picked
 * (suggestions.js), and a line added from a suggestion links back through save.js.
 * @param {{ userId: number, workDate: string, locksAt: Date, unlockedUntil?: Date | null }} input
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<number>} the new report id
 */
export async function insertDraft({ userId, workDate: day, locksAt, unlockedUntil = null }, trx) {
  const at = nowDate();
  return repo.insertReport(
    {
      userId,
      workDate: day,
      status: 'draft',
      totalMinutes: 0,
      locksAt,
      unlockedUntil,
      revision: 0,
      createdAt: at,
      updatedAt: at,
    },
    trx,
  );
}

/** A day with no report after its lock: nothing to edit until an edit request is approved. */
async function missingDayView(userId, day, locksAt) {
  const pending = await repo.findPendingEditRequest(userId, day);
  return {
    id: null,
    userId,
    workDate: day,
    status: 'none',
    totalMinutes: 0,
    revision: 0,
    firstSubmittedAt: null,
    submittedAt: null,
    locksAt,
    unlockedUntil: null,
    editable: false,
    locked: true,
    entries: [],
    pendingEditRequest: pending ? pendingView(pending) : null,
    version: null,
  };
}

/**
 * The person's report for a day, as the report page opens it. Creates the day's draft (empty: no
 * copied lines, CONTRACT 24) when there is none and the day hasn't locked yet. A missing day after
 * its lock comes back with id null and status 'none' (only an approved edit request can create
 * it). Today's to-do calls it outside its own transaction for the first write of the day.
 * @param {{ user: { id: number }, workDate?: string }} input workDate defaults to today
 * @returns {Promise<object>} the report view (see view.reportView)
 * @throws REPORT_IN_FUTURE
 */
export async function openForDate({ user, workDate: date }) {
  const current = await settings.getAll();
  const today = workDate(current.timezone);
  const day = date ?? today;
  if (day > today) throw new AppError('REPORT_IN_FUTURE');
  const existing = await repo.findByUserAndDate(user.id, day);
  if (existing) return loadReportView(existing);
  const locksAt = locksAtFor(day, current.reportLock, current.timezone);
  if (!now().isBefore(dayjs(locksAt))) return missingDayView(user.id, day, locksAt);
  try {
    await db.transaction((trx) => insertDraft({ userId: user.id, workDate: day, locksAt }, trx));
  } catch (error) {
    // Two tabs opened the page at once: the other one created it.
    if (!isDuplicateKey(error)) throw error;
  }
  return loadReportView(await repo.findByUserAndDate(user.id, day));
}
