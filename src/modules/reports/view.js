// Shapes stored rows into the report objects the API and pages use, and the lock rule.
import { createHash } from 'node:crypto';
import { dayjs, now } from '@/lib/time';
import * as repo from './repo';

/** A task line's part of the version; the priority link only when there is one. */
function taskVersion(task) {
  const line = [Number(task.id), task.title, task.status];
  return task.projectTaskId ? [...line, Number(task.projectTaskId)] : line;
}

/**
 * A fingerprint of everything a save overwrites: the status and every entry and task (ids,
 * project, minutes, title, status, priority task link) in order. The report page sends back the
 * version it last loaded or saved, so a save from a tab that missed a change made elsewhere
 * (another tab or device, or a PM moving entries off a project request) is refused instead of
 * undoing it. A line without a link hashes as it did before links existed, so pages opened
 * before them keep saving.
 * @param {string} status
 * @param {Array<{ id: number, projectId?: number|null, projectRequestId?: number|null,
 *   minutes: number, tasks: Array<{ id: number, title: string, status: string,
 *   projectTaskId?: number|null }> }>} entries
 * @returns {string}
 */
export function contentVersion(status, entries) {
  const content = entries.map((entry) => [
    Number(entry.id),
    entry.projectId ? Number(entry.projectId) : null,
    entry.projectRequestId ? Number(entry.projectRequestId) : null,
    Number(entry.minutes) || 0,
    entry.tasks.map(taskVersion),
  ]);
  return createHash('sha256')
    .update(JSON.stringify([status, content]))
    .digest('base64url')
    .slice(0, 24);
}

/**
 * A report is editable while now < locks_at, or while an approved edit keeps it open
 * (now < unlocked_until). Report locking needs no job; this runs on every save.
 * @param {{ locksAt: Date, unlockedUntil?: Date | null } | null} report
 * @param {import('dayjs').Dayjs} [at]
 */
export function isEditable(report, at = now()) {
  if (!report) return false;
  if (at.isBefore(dayjs(report.locksAt))) return true;
  return Boolean(report.unlockedUntil) && at.isBefore(dayjs(report.unlockedUntil));
}

/** Minutes -> hours for inputs and the API (90 -> 1.5). */
export function minutesToHoursNumber(minutes) {
  return Math.round((Number(minutes) / 60) * 100) / 100;
}

/**
 * One task line. `projectTaskId` links it to a priority task (CONTRACT section 13); `priority`
 * ('p1' | 'p2' | 'p3') and `projectTaskTitle` describe that task for display, null without one.
 */
function taskView(task) {
  const linked = Boolean(task.projectTaskId);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    firstReportedOn: task.firstReportedOn,
    carriedFromTaskId: task.carriedFromTaskId ?? null,
    projectTaskId: linked ? Number(task.projectTaskId) : null,
    priority: linked ? (task.projectTaskPriority ?? null) : null,
    projectTaskTitle: linked ? (task.projectTaskTitle ?? null) : null,
  };
}

/** One entry (a project in a report) with its tasks. */
export function entryView(entry, tasks) {
  const isRequest = !entry.projectId;
  const minutes = Number(entry.minutes) || 0;
  return {
    id: entry.id,
    projectId: entry.projectId ?? null,
    projectRequestId: entry.projectRequestId ?? null,
    projectName: (isRequest ? entry.requestName : entry.projectName) ?? '',
    projectColor: isRequest ? null : (entry.projectColor ?? null),
    isUrgent: !isRequest && Boolean(entry.projectIsUrgent),
    projectStatus: isRequest ? null : (entry.projectStatus ?? null),
    waitingForApproval: isRequest && entry.requestStatus === 'pending',
    minutes,
    hours: minutesToHoursNumber(minutes),
    carried: tasks.some((task) => Boolean(task.carriedFromTaskId)),
    tasks: tasks.map(taskView),
  };
}

/**
 * Entries with tasks for many reports at once (two queries in total).
 * @returns {Promise<Map<number, ReturnType<typeof entryView>[]>>} report id -> entries
 */
export async function loadEntriesFor(reportIds, trx) {
  const entries = await repo.listEntries(reportIds, trx);
  const tasks = await repo.listTasks(
    entries.map((entry) => entry.id),
    trx,
  );
  const tasksByEntry = new Map();
  for (const task of tasks) {
    if (!tasksByEntry.has(task.entryId)) tasksByEntry.set(task.entryId, []);
    tasksByEntry.get(task.entryId).push(task);
  }
  const byReport = new Map(reportIds.map((id) => [id, []]));
  for (const entry of entries) {
    byReport.get(entry.reportId)?.push(entryView(entry, tasksByEntry.get(entry.id) ?? []));
  }
  return byReport;
}

/** The report object returned by the API: the row, its entries, and whether it can change. */
export function reportView(report, entries, { pendingEditRequest = null, at } = {}) {
  const editable = isEditable(report, at);
  return {
    id: report.id,
    userId: report.userId,
    workDate: report.workDate,
    status: report.status,
    totalMinutes: Number(report.totalMinutes) || 0,
    revision: Number(report.revision) || 0,
    firstSubmittedAt: report.firstSubmittedAt ?? null,
    submittedAt: report.submittedAt ?? null,
    locksAt: report.locksAt,
    unlockedUntil: report.unlockedUntil ?? null,
    editable,
    locked: !editable,
    entries,
    pendingEditRequest,
    version: contentVersion(report.status, entries),
  };
}

/** Loads one report with entries, tasks and any pending edit request of its owner. */
export async function loadReportView(report, trx) {
  const [byReport, pending] = await Promise.all([
    loadEntriesFor([report.id], trx),
    repo.findPendingEditRequest(report.userId, report.workDate, trx),
  ]);
  return reportView(report, byReport.get(report.id) ?? [], {
    pendingEditRequest: pending ? pendingView(pending) : null,
  });
}

export function pendingView(request) {
  return {
    id: request.id,
    workDate: request.workDate,
    reason: request.reason,
    createdAt: request.createdAt,
  };
}

/**
 * Snapshot of entries for report_revisions and the Slack post. Each task keeps its priority task
 * link (`projectTaskId`, null without one); the Slack text uses only title and status.
 */
export function snapshotOf(entries) {
  return {
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    entries: entries.map((entry) => ({
      projectId: entry.projectId,
      projectRequestId: entry.projectRequestId,
      projectName: entry.projectName,
      minutes: entry.minutes,
      tasks: entry.tasks.map((task) => ({
        title: task.title,
        status: task.status,
        projectTaskId: task.projectTaskId ?? null,
      })),
    })),
  };
}
