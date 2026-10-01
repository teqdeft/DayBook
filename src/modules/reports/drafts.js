// Opening a report: draft creation with carry-over (build guide 7.4, 7.5). Saving is in save.js.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { dayjs, locksAtFor, now, nowDate, workDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { settings } from '@/modules/settings';
import * as repo from './repo';
import { isEditable, loadReportView, pendingView } from './view';

const CARRIED_STATUSES = new Set(['in_progress', 'blocked']);

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
 * What a new draft carries over: every in_progress or blocked task from the person's latest
 * submitted report before `forDate`, grouped by project, only for projects that are still active
 * (or project requests still pending).
 * @returns {Promise<Array<{ projectId: number|null, projectRequestId: number|null,
 *   tasks: Array<{ id: number, title: string, status: string, firstReportedOn: string,
 *   projectTaskId: number|null }> }>>}
 */
export async function planCarryOver(userId, forDate) {
  const source = await repo.findLatestSubmittedBefore(userId, forDate);
  if (!source) return [];
  const entries = await repo.listEntries([source.id]);
  const tasks = await repo.listTasks(entries.map((entry) => entry.id));
  const plan = [];
  const seen = new Set();
  for (const entry of entries) {
    const open = tasks.filter(
      (task) => task.entryId === entry.id && CARRIED_STATUSES.has(task.status),
    );
    const key = entry.projectId ? `p${entry.projectId}` : `r${entry.projectRequestId}`;
    if (open.length === 0 || seen.has(key)) continue;
    const stillOpen = entry.projectId
      ? await projects.isActive(entry.projectId)
      : Boolean(await projects.findPendingRequestForUser(entry.projectRequestId, userId));
    if (!stillOpen) continue;
    seen.add(key);
    plan.push({
      projectId: entry.projectId ?? null,
      projectRequestId: entry.projectRequestId ?? null,
      tasks: open,
    });
  }
  return plan;
}

/**
 * Inserts a draft report with its carried-over entries (0 hours; tasks keep first_reported_on and
 * their priority task link, and link back with carried_from_task_id).
 * @returns {Promise<number>} the new report id
 */
export async function insertDraft(
  { userId, workDate: day, locksAt, unlockedUntil = null, plan },
  trx,
) {
  const at = nowDate();
  const reportId = await repo.insertReport(
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
  for (const [sortOrder, group] of plan.entries()) {
    const entryId = await repo.insertEntry(
      {
        reportId,
        projectId: group.projectId,
        projectRequestId: group.projectRequestId,
        minutes: 0,
        sortOrder,
        createdAt: at,
        updatedAt: at,
      },
      trx,
    );
    for (const [taskOrder, task] of group.tasks.entries()) {
      await repo.insertTask(
        {
          entryId,
          title: task.title,
          status: task.status,
          firstReportedOn: task.firstReportedOn,
          carriedFromTaskId: task.id,
          // The carried line keeps working on the same priority task (CONTRACT section 13).
          projectTaskId: task.projectTaskId ?? null,
          sortOrder: taskOrder,
          createdAt: at,
          updatedAt: at,
        },
        trx,
      );
    }
  }
  return reportId;
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
 * The person's report for a day, as the report page opens it. Creates the day's draft (with
 * carry-over) when there is none and the day hasn't locked yet. A missing day after its lock
 * comes back with id null and status 'none' (only an approved edit request can create it).
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
  const plan = await planCarryOver(user.id, day);
  try {
    await db.transaction((trx) =>
      insertDraft({ userId: user.id, workDate: day, locksAt, plan }, trx),
    );
  } catch (error) {
    // Two tabs opened the page at once: the other one created it.
    if (!isDuplicateKey(error)) throw error;
  }
  return loadReportView(await repo.findByUserAndDate(user.id, day));
}
