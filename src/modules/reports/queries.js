// Read functions other modules and pages rely on (CONTRACT section 6), stuck tasks (guide 7.5),
// report lists for the API, and the entry move used when a project request is decided.
import { db, parseJson } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { addDays, nowDate, workDate, workingDaysBetween } from '@/lib/time';
import { settings } from '@/modules/settings';
import * as repo from './repo';
import { loadEntriesFor, loadReportView, reportView } from './view';

/**
 * A person's report state for a day.
 * @returns {Promise<{ reportId: number | null, status: 'none' | 'draft' | 'submitted',
 *   totalMinutes: number }>}
 */
export async function getDayStatus(userId, day) {
  const report = await repo.findByUserAndDate(userId, day);
  if (!report) return { reportId: null, status: 'none', totalMinutes: 0 };
  return {
    reportId: report.id,
    status: report.status,
    totalMinutes: Number(report.totalMinutes) || 0,
  };
}

/** @returns {Promise<Record<string, number>>} { 'YYYY-MM-DD': minutes } of submitted reports */
export function getSubmittedMinutesByDay(userId, from, to) {
  return repo.submittedMinutesByDay(userId, from, to);
}

/**
 * The latest version of each task a person reported between two days (drafts included), newest
 * first. A carried task replaces the one it continues, so each chain shows once.
 * @returns {Promise<Array<{ taskId, title, status, projectId, projectName, projectColor,
 *   workDate, firstReportedOn }>>}
 */
export async function listRecentTasks(userId, from, to) {
  const rows = await repo.listTasksInRange(userId, from, to);
  const continued = new Set(rows.map((row) => row.carriedFromTaskId).filter(Boolean));
  return rows
    .filter((row) => !continued.has(row.taskId) && row.title.trim())
    .map((row) => ({
      taskId: row.taskId,
      title: row.title,
      status: row.status,
      projectId: row.projectId ?? null,
      projectName: (row.projectId ? row.projectName : row.requestName) ?? '',
      projectColor: row.projectId ? (row.projectColor ?? null) : null,
      workDate: row.workDate,
      firstReportedOn: row.firstReportedOn,
    }));
}

/**
 * Stuck tasks (guide 7.5): tasks still in progress in the person's latest submitted report
 * whose first report was at least `stuckTaskDays` working days ago.
 * @param {number} userId
 * @param {{ today?: string }} [options]
 * @returns {Promise<Array<{ taskId, title, status, projectId, projectName, projectColor,
 *   firstReportedOn, workingDays }>>} oldest first
 */
export async function listStuckTasks(userId, { today } = {}) {
  const current = await settings.getAll();
  const day = today ?? workDate(current.timezone);
  const latest = await repo.findLatestSubmittedBefore(userId, addDays(day, 1));
  if (!latest) return [];
  const entries = (await loadEntriesFor([latest.id])).get(latest.id) ?? [];
  const stuck = [];
  for (const entry of entries) {
    for (const task of entry.tasks) {
      if (task.status !== 'in_progress') continue;
      const days = workingDaysBetween(task.firstReportedOn, day, current.workingDays);
      if (days < current.stuckTaskDays) continue;
      stuck.push({
        taskId: task.id,
        title: task.title,
        status: task.status,
        projectId: entry.projectId,
        projectName: entry.projectName,
        projectColor: entry.projectColor,
        firstReportedOn: task.firstReportedOn,
        workingDays: days,
      });
    }
  }
  return stuck.sort((a, b) => a.firstReportedOn.localeCompare(b.firstReportedOn));
}

/** True when any report entry points at the project request (hours were logged to it). */
export function hasEntriesForProjectRequest(projectRequestId) {
  return repo.hasEntriesForProjectRequest(projectRequestId);
}

/**
 * Moves report entries from a project request to a project (request approved, or declined with
 * a project picked). When a report already has that project, the minutes and tasks merge into
 * its entry. Report totals don't change.
 * @param {{ projectRequestId: number, projectId: number }} input
 * @param {import('knex').Knex} trx
 * @returns {Promise<number>} how many entries moved
 */
export async function moveProjectRequestEntries({ projectRequestId, projectId }, trx = db) {
  const entries = await repo.listEntriesForProjectRequest(projectRequestId, trx);
  const at = nowDate();
  for (const entry of entries) {
    const target = await repo.findEntryForProject(entry.reportId, projectId, trx);
    if (target) {
      const offset = (await repo.maxTaskSortOrder(target.id, trx)) + 1;
      await repo.moveTasks(entry.id, target.id, offset, trx);
      await repo.updateEntry(
        target.id,
        { minutes: Number(target.minutes) + Number(entry.minutes), updatedAt: at },
        trx,
      );
      await repo.deleteEntries([entry.id], trx);
    } else {
      await repo.updateEntry(entry.id, { projectId, projectRequestId: null, updatedAt: at }, trx);
    }
  }
  return entries.length;
}

/**
 * Called by the Slack outbox after a report post succeeds, so later submits update the same
 * message.
 * @param {{ reportId: number, channelId: string, ts: string }} input
 */
export async function saveSlackMessage({ reportId, channelId, ts }) {
  await repo.updateReport(reportId, { slackChannelId: channelId, slackTs: ts });
}

/**
 * Minutes per project from submitted reports in a date range (optionally one person).
 * @returns {Promise<Record<number, number>>} { [projectId]: minutes }
 */
export async function getMinutesByProject({ from, to, userId } = {}) {
  const rows = await repo.minutesByProject({ from, to, userId });
  return Object.fromEntries(rows.map((row) => [row.projectId, Number(row.minutes) || 0]));
}

/**
 * Minutes per project with the project's name and colour, largest first (My log).
 * @returns {Promise<Array<{ projectId: number, name: string, color: string, minutes: number }>>}
 */
export async function listMinutesByProject({ from, to, userId }) {
  const rows = await repo.minutesByProject({ from, to, userId });
  return rows
    .map((row) => ({
      projectId: row.projectId,
      name: row.name,
      color: row.color,
      minutes: Number(row.minutes) || 0,
    }))
    .filter((row) => row.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/** @returns {Promise<Record<number, string>>} { [projectId]: 'YYYY-MM-DD' } of the last report */
export async function getLastReportDateByProject(userId) {
  const rows = await repo.lastReportDateByProject(userId);
  return Object.fromEntries(rows.map((row) => [row.projectId, row.lastDate]));
}

/** Owner or team.view may read a report. @throws NOT_FOUND, FORBIDDEN */
async function readableReport(user, reportId) {
  const report = await repo.findById(reportId);
  if (!report) throw new AppError('NOT_FOUND', { message: "We couldn't find that report." });
  if (Number(report.userId) !== Number(user.id) && !can(user, 'team.view')) {
    throw new AppError('FORBIDDEN');
  }
  return report;
}

/**
 * One report with its entries and tasks (GET /api/reports/:id).
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function getReport({ user, reportId }) {
  return loadReportView(await readableReport(user, reportId));
}

/**
 * The edit history of a report, newest revision first (GET /api/reports/:id/revisions).
 * @returns {Promise<Array<{ revision, snapshot: { totalMinutes, entries }, editedBy: { id, name },
 *   reason, createdAt }>>}
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function listRevisions({ user, reportId }) {
  await readableReport(user, reportId);
  const rows = await repo.listRevisions(reportId);
  return rows.map((row) => ({
    id: row.id,
    revision: row.revision,
    snapshot: parseJson(row.snapshot),
    editedBy: { id: row.editedBy, name: row.editedByName },
    reason: row.reason ?? null,
    createdAt: row.createdAt,
  }));
}

/**
 * A page of a person's reports with their entries (GET /api/reports). Other people's reports
 * need team.view.
 * @returns {Promise<{ rows: object[], total: number }>}
 * @throws FORBIDDEN
 */
export async function listReports({ user, userId, from, to, limit = 50, offset = 0 }) {
  const owner = userId ?? user.id;
  const own = Number(owner) === Number(user.id);
  if (!can(user, 'team.view') && !(own && can(user, 'report.self'))) {
    throw new AppError('FORBIDDEN', { message: 'You can only see your own reports.' });
  }
  const page = await repo.pageByUser({ userId: owner, from, to, limit, offset });
  const entries = await loadEntriesFor(page.rows.map((row) => row.id));
  return {
    rows: page.rows.map((row) => reportView(row, entries.get(row.id) ?? [])),
    total: page.total,
  };
}
