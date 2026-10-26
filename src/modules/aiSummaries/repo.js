// Read model for the AI summaries (CONTRACT 20): today's submitted report lines on the PMs'
// projects, the priority tasks marked done today, and the week's correction requests and
// submitted reports for HR's notes. Like modules/dashboard/repo.js it only reads, across other
// modules' tables, with one query per kind of data (never one per person).
import { db } from '@/lib/db';

/**
 * Active projects managed by these people, by name.
 * @param {number[]} pmIds
 * @returns {Promise<Array<{ id: number, name: string, pmId: number }>>}
 */
export async function listActiveProjectsOf(pmIds) {
  if (pmIds.length === 0) return [];
  return db('projects')
    .whereIn('pmId', pmIds)
    .where('status', 'active')
    .select('id', 'name', 'pmId')
    .orderBy([{ column: 'name' }, { column: 'id' }]);
}

/**
 * Every task line of the reports submitted on one day for these projects (an entry without
 * tasks gives one row with taskId null), with the writer and the linked priority task's priority.
 * @param {string} date 'YYYY-MM-DD'
 * @param {number[]} projectIds
 * @returns {Promise<Array<{ entryId: number, projectId: number, minutes: number, userId: number,
 *   userName: string, taskId: number | null, title: string | null, status: string | null,
 *   firstReportedOn: string | null, priority: 'p1' | 'p2' | 'p3' | null }>>}
 */
export async function listSubmittedLines(date, projectIds) {
  if (projectIds.length === 0) return [];
  return db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .join('users as u', 'u.id', 'r.userId')
    .leftJoin('reportTasks as t', 't.entryId', 'e.id')
    .leftJoin('projectTasks as pt', 'pt.id', 't.projectTaskId')
    .where({ 'r.workDate': date, 'r.status': 'submitted' })
    .whereIn('e.projectId', projectIds)
    .select(
      'e.id as entryId',
      'e.projectId',
      'e.minutes',
      'r.userId',
      'u.name as userName',
      't.id as taskId',
      't.title',
      't.status',
      't.firstReportedOn',
      'pt.priority',
    )
    .orderBy([
      { column: 'r.userId' },
      { column: 'e.sortOrder' },
      { column: 'e.id' },
      { column: 't.sortOrder' },
      { column: 't.id' },
    ]);
}

/**
 * Priority tasks of these projects marked done in [from, to).
 * @param {number[]} projectIds
 * @param {{ from: Date, to: Date }} bounds UTC
 * @returns {Promise<Array<{ projectId: number, title: string, priority: string }>>}
 */
export async function listPriorityDone(projectIds, { from, to }) {
  if (projectIds.length === 0) return [];
  return db('projectTasks')
    .whereIn('projectId', projectIds)
    .where('status', 'done')
    .where('doneAt', '>=', from)
    .andWhere('doneAt', '<', to)
    .select('projectId', 'title', 'priority')
    .orderBy([{ column: 'priority' }, { column: 'doneAt' }, { column: 'id' }]);
}

/**
 * Attendance correction requests each person sent in [from, to), whatever happened to them.
 * @param {number[]} userIds
 * @param {{ from: Date, to: Date }} bounds UTC
 * @returns {Promise<Record<number, number>>} user id → count (people without any are missing)
 */
export async function countCorrectionsByUser(userIds, { from, to }) {
  if (userIds.length === 0) return {};
  const rows = await db('attendanceCorrections')
    .whereIn('userId', userIds)
    .where('createdAt', '>=', from)
    .andWhere('createdAt', '<', to)
    .groupBy('userId')
    .select('userId', db.raw('COUNT(*) as count'));
  return Object.fromEntries(rows.map((row) => [row.userId, Number(row.count)]));
}

/**
 * The days each person has a submitted report for, from `from` to `to` (both included).
 * @param {number[]} userIds
 * @param {{ from: string, to: string }} range 'YYYY-MM-DD'
 * @returns {Promise<Array<{ userId: number, workDate: string }>>}
 */
export async function listSubmittedReportDays(userIds, { from, to }) {
  if (userIds.length === 0) return [];
  return db('dailyReports')
    .whereIn('userId', userIds)
    .where('status', 'submitted')
    .whereBetween('workDate', [from, to])
    .select('userId', 'workDate');
}
