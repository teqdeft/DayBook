// Saving a report's entries and tasks (build guide 7.4.4): the project checks, the stale-save
// check and the row writes shared by autosave and submit, and autosave itself.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { timers } from '@/modules/timers';
import * as repo from './repo';
import { assertEditable, getOwnReport } from './drafts';
import { checkPriorityLinks } from './links';
import { contentVersion, loadReportView } from './view';

/**
 * The projects the person timed on a day (CONTRACT 15), read once and only when needed.
 * @returns {() => Promise<Set<number>>}
 */
function timedProjectsOn(userId, workDate) {
  let timed = null;
  return async () => {
    if (!timed) {
      const summary = workDate ? await timers.getDaySummary(userId, workDate) : null;
      timed = new Set((summary?.projects ?? []).map((project) => Number(project.projectId)));
    }
    return timed;
  };
}

/**
 * Checks the projects of incoming entries. A project already in the saved report may stay even
 * if it stopped being active; a newly picked one must be active, unless the person timed it on
 * the report's day (CONTRACT 15: completed or put on hold after the timer ran, it still belongs
 * in that day's report, and required timer mode asks for it). A project request must be the
 * person's own pending request.
 * @param {{ user: object, reportId: number | null, workDate?: string, entries: object[] }} input
 *   workDate: the report's day (without it no timed project is let in)
 * @throws PROJECT_NOT_ACTIVE with a field error on entries.N.project
 */
export async function checkProjects({ user, reportId, workDate, entries }) {
  const stored = reportId ? await repo.listEntries([reportId]) : [];
  const knownProjects = new Set(stored.map((entry) => entry.projectId).filter(Boolean));
  const knownRequests = new Set(stored.map((entry) => entry.projectRequestId).filter(Boolean));
  const timedProjects = timedProjectsOn(user.id, workDate);
  const checked = new Map();
  for (const [index, entry] of entries.entries()) {
    const field = `entries.${index}.project`;
    if (entry.projectId) {
      if (knownProjects.has(entry.projectId)) continue;
      if (!checked.has(entry.projectId)) {
        const allowed =
          (await projects.isActive(entry.projectId)) ||
          (await timedProjects()).has(Number(entry.projectId));
        checked.set(entry.projectId, allowed);
      }
      if (!checked.get(entry.projectId)) {
        throw new AppError('PROJECT_NOT_ACTIVE', {
          fields: { [field]: 'Only active projects can be picked.' },
        });
      }
    } else if (!knownRequests.has(entry.projectRequestId)) {
      const request = await projects.findPendingRequestForUser(entry.projectRequestId, user.id);
      if (!request) throw requestHandled(index);
    }
  }
}

function requestHandled(index) {
  const message = 'That project request was already handled. Reload the page to see it.';
  return new AppError('PROJECT_NOT_ACTIVE', {
    message,
    fields: { [`entries.${index}.project`]: message },
  });
}

/**
 * Inside a save's transaction, before any entry is written: locks the project requests the
 * entries point at, then checks again that each is still the person's pending request. A PM's
 * approve or decline locks the same row first, so it either finished before this check (the save
 * is refused, nothing is left on a handled request) or waits until the save commits (and then
 * moves the saved entries with the rest).
 * @throws PROJECT_NOT_ACTIVE with a field error on entries.N.project
 */
export async function confirmRequests({ user, entries }, trx) {
  const ids = [...new Set(entries.map((entry) => entry.projectRequestId).filter(Boolean))];
  if (ids.length === 0) return;
  await repo.shareLockProjectRequests(ids, trx);
  const pending = new Map();
  for (const [index, entry] of entries.entries()) {
    const requestId = entry.projectRequestId;
    if (!requestId) continue;
    if (!pending.has(requestId)) {
      pending.set(requestId, Boolean(await projects.findPendingRequestForUser(requestId, user.id)));
    }
    if (!pending.get(requestId)) throw requestHandled(index);
  }
}

const STALE_MESSAGE =
  "This report changed since you opened it, so your latest changes weren't saved. Reload the page to see the latest version.";

/**
 * The report's stored entries and tasks, locked until the transaction ends.
 * @throws CONFLICT when `baseVersion` is given and the stored rows are no longer the ones the
 *   person's page loaded or last saved (see contentVersion)
 */
export async function lockStoredRows(report, trx, { baseVersion } = {}) {
  const entries = await repo.lockEntries(report.id, trx);
  const tasks = await repo.lockTasks(
    entries.map((entry) => entry.id),
    trx,
  );
  if (baseVersion !== undefined && baseVersion !== null) {
    const shaped = entries.map((entry) => ({
      ...entry,
      tasks: tasks.filter((task) => task.entryId === entry.id),
    }));
    if (contentVersion(report.status, shaped) !== baseVersion) {
      throw new AppError('CONFLICT', { message: STALE_MESSAGE });
    }
  }
  return { entries, tasks };
}

function sameFields(row, fields) {
  return Object.entries(fields).every(([key, value]) => key === 'updatedAt' || row[key] === value);
}

/**
 * Replaces a report's entries and tasks with the given ones, keeping ids (so carry-over links
 * from later reports survive): known ids are updated, new rows inserted, missing rows deleted.
 * Keeps total_minutes in sync. Call inside a transaction with the report row locked.
 * @param {{ id: number, workDate: string, status: string }} report
 * @param {Array<{ id?: number, projectId?: number, projectRequestId?: number, hours: number,
 *   tasks: Array<{ id?: number, title: string, status: string, projectTaskId?: number }> }>}
 *   entries (links checked with checkPriorityLinks first)
 * @param {import('knex').Knex} trx
 * @param {{ baseVersion?: string }} [options] the version the person's page last saw
 * @returns {Promise<number>} the new total in minutes
 * @throws CONFLICT when the stored report changed since `baseVersion`
 */
export async function writeEntries(report, entries, trx, { baseVersion } = {}) {
  const { entries: storedEntries, tasks: storedTasks } = await lockStoredRows(report, trx, {
    baseVersion,
  });
  const entryById = new Map(storedEntries.map((entry) => [entry.id, entry]));
  const taskById = new Map(storedTasks.map((task) => [task.id, task]));
  const keptEntries = new Set();
  const keptTasks = new Set();
  const at = nowDate();
  let total = 0;
  for (const [sortOrder, entry] of entries.entries()) {
    const minutes = Math.round(entry.hours * 60);
    total += minutes;
    const fields = {
      projectId: entry.projectId ?? null,
      projectRequestId: entry.projectRequestId ?? null,
      minutes,
      sortOrder,
      updatedAt: at,
    };
    let entryId = entry.id;
    if (entryId && entryById.has(entryId) && !keptEntries.has(entryId)) {
      if (!sameFields(entryById.get(entryId), fields)) await repo.updateEntry(entryId, fields, trx);
    } else {
      entryId = await repo.insertEntry({ reportId: report.id, ...fields, createdAt: at }, trx);
    }
    keptEntries.add(entryId);
    for (const [taskOrder, task] of entry.tasks.entries()) {
      const taskFields = {
        entryId,
        title: task.title.trim(),
        status: task.status,
        projectTaskId: task.projectTaskId ?? null,
        sortOrder: taskOrder,
        updatedAt: at,
      };
      if (task.id && taskById.has(task.id) && !keptTasks.has(task.id)) {
        if (!sameFields(taskById.get(task.id), taskFields))
          await repo.updateTask(task.id, taskFields, trx);
        keptTasks.add(task.id);
      } else {
        const taskId = await repo.insertTask(
          {
            ...taskFields,
            firstReportedOn: report.workDate,
            carriedFromTaskId: null,
            createdAt: at,
          },
          trx,
        );
        keptTasks.add(taskId);
      }
    }
  }
  await repo.deleteTasks(
    storedTasks.filter((task) => !keptTasks.has(task.id)).map((task) => task.id),
    trx,
  );
  await repo.deleteEntries(
    storedEntries.filter((entry) => !keptEntries.has(entry.id)).map((entry) => entry.id),
    trx,
  );
  await repo.updateReport(report.id, { totalMinutes: total, updatedAt: at }, trx);
  return total;
}

/**
 * Autosave: saves a draft's entries and tasks (hours 0 or more in 0.25 steps, empty task rows
 * allowed). After the first submit every save is a new revision, so saving a submitted report
 * runs the submit rules instead.
 * @param {{ user: object, reportId: number, entries: object[], baseVersion?: string }} input
 *   entries from saveReportSchema; baseVersion is the report version the page last saw
 * @returns {Promise<object>} the saved report view
 * @throws NOT_FOUND, FORBIDDEN, REPORT_LOCKED, PROJECT_NOT_ACTIVE, CONFLICT, VALIDATION_FAILED
 *   (also for a priority task link that can't be saved, see checkPriorityLinks)
 */
export async function saveDraft({ user, reportId, entries, baseVersion }) {
  const report = await getOwnReport(user, reportId);
  assertEditable(report);
  await checkProjects({ user, reportId, workDate: report.workDate, entries });
  await db.transaction(async (trx) => {
    const locked = await repo.findByIdForUpdate(reportId, trx);
    assertEditable(locked);
    if (locked.status !== 'draft') {
      throw new AppError('CONFLICT', {
        message: 'This report was just submitted. Reload the page to see it.',
      });
    }
    // Before the entry and task rows are locked: deleting a linked task waits for this save.
    await checkPriorityLinks({ reportId, entries }, trx);
    await confirmRequests({ user, entries }, trx);
    await writeEntries(locked, entries, trx, { baseVersion });
  });
  return loadReportView(await repo.findById(reportId));
}
