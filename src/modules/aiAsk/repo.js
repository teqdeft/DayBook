// Read model for Ask Daybook (CONTRACT 20): read-only queries across projects, reports, priority
// tasks and attendance, like the dashboards' read model (CONTRACT 4). Nothing here writes, and
// nothing here decides who may see what: the service passes the viewer's scope in (project ids,
// person ids) and every query keeps to it.
import { db } from '@/lib/db';

/** More task lines than this in one range are not read (the newest are kept). */
export const MAX_TASK_LINES = 5000;

/** `whereIn` for a scope list; null = no limit (Admin). An empty list matches nothing. */
function within(query, column, ids) {
  if (ids) query.whereIn(column, ids.length > 0 ? ids : [0]);
}

/** Every project with its client and PM: [{ id, name, clientName, pmId, pmName, status, isUrgent }]. */
export function listProjects() {
  return db('projects as p')
    .join('clients as c', 'c.id', 'p.clientId')
    .join('users as m', 'm.id', 'p.pmId')
    .select(
      'p.id',
      'p.name',
      'c.name as clientName',
      'p.pmId',
      'm.name as pmName',
      'p.status',
      'p.isUrgent',
    )
    .orderBy('p.name');
}

/** Everyone in Daybook: [{ id, name, role, designation, departmentName, status, tracksAttendance, joinedOn }]. */
export function listPeople() {
  return db('users as u')
    .join('departments as d', 'd.id', 'u.departmentId')
    .select(
      'u.id',
      'u.name',
      'u.role',
      'u.designation',
      'd.name as departmentName',
      'u.status',
      'u.tracksAttendance',
      'u.joinedOn',
    )
    .orderBy('u.name');
}

/**
 * The people on some projects: members, and anyone who logged hours on them in a submitted
 * report (someone removed from a project still worked on it).
 * @param {number[]} projectIds
 * @returns {Promise<number[]>} user ids
 */
export async function listProjectPeopleIds(projectIds) {
  if (projectIds.length === 0) return [];
  const reporters = db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .whereIn('e.projectId', projectIds)
    .where('r.status', 'submitted')
    .select('r.userId');
  const rows = await db('projectMembers')
    .whereIn('projectId', projectIds)
    .select('userId')
    .union(reporters);
  return [...new Set(rows.map((row) => Number(row.userId)))];
}

/** Submitted report entries in a date range, kept to the scope. */
function submittedEntries({ from, to, projectIds, userIds, withRequests }) {
  return db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as pr', 'pr.id', 'e.projectRequestId')
    .where('r.status', 'submitted')
    .whereBetween('r.workDate', [from, to])
    .modify((query) => {
      // A project-scoped viewer (a PM) sees real projects only, never requested ones.
      if (projectIds || !withRequests) query.whereNotNull('e.projectId');
      within(query, 'e.projectId', projectIds);
      within(query, 'r.userId', userIds);
    });
}

/**
 * Minutes per project from submitted reports, largest first.
 * @param {{ from: string, to: string, projectIds: number[] | null, userIds?: number[] | null,
 *   withRequests: boolean }} scope projectIds null = every project (and, with withRequests,
 *   hours logged on pending project requests)
 * @returns {Promise<Array<{ projectId: number | null, name: string, requested: boolean,
 *   minutes: number, people: number, days: number }>>}
 */
export async function hoursByProject(scope) {
  const rows = await submittedEntries(scope)
    .groupBy('e.projectId', 'e.projectRequestId', 'p.name', 'pr.name')
    .havingRaw('SUM(e.minutes) > 0')
    .select(
      'e.projectId',
      'p.name as projectName',
      'pr.name as requestName',
      db.raw('SUM(e.minutes) as minutes'),
      db.raw('COUNT(DISTINCT r.user_id) as people'),
      db.raw('COUNT(DISTINCT r.work_date) as days'),
    )
    .orderBy([{ column: 'minutes', order: 'desc' }, { column: 'projectName' }]);
  return rows.map((row) => ({
    projectId: row.projectId,
    name: row.projectName ?? row.requestName,
    requested: !row.projectId,
    minutes: Number(row.minutes),
    people: Number(row.people),
    days: Number(row.days),
  }));
}

/**
 * Minutes per person and project from submitted reports.
 * @param {{ from: string, to: string, projectIds: number[] | null, userIds: number[] | null,
 *   withRequests: boolean }} scope
 * @returns {Promise<Array<{ userId: number, userName: string, projectId: number | null,
 *   projectName: string, requested: boolean, minutes: number, days: number }>>}
 */
export async function hoursByPerson(scope) {
  const rows = await submittedEntries(scope)
    .join('users as u', 'u.id', 'r.userId')
    .groupBy('r.userId', 'u.name', 'e.projectId', 'e.projectRequestId', 'p.name', 'pr.name')
    .havingRaw('SUM(e.minutes) > 0')
    .select(
      'r.userId',
      'u.name as userName',
      'e.projectId',
      'p.name as projectName',
      'pr.name as requestName',
      db.raw('SUM(e.minutes) as minutes'),
      db.raw('COUNT(DISTINCT r.work_date) as days'),
    )
    .orderBy([{ column: 'userName' }, { column: 'minutes', order: 'desc' }]);
  return rows.map((row) => ({
    userId: row.userId,
    userName: row.userName,
    projectId: row.projectId,
    projectName: row.projectName ?? row.requestName,
    requested: !row.projectId,
    minutes: Number(row.minutes),
    days: Number(row.days),
  }));
}

/**
 * Task lines of submitted reports, newest day first, with the priority task each is linked to.
 * Carry-over copies are all returned (the service keeps the latest of each chain).
 * @param {{ from: string, to: string, projectIds: number[] | null, userIds: number[] | null,
 *   withRequests: boolean }} scope
 */
export function listReportTasks(scope) {
  return submittedEntries(scope)
    .join('reportTasks as t', 't.entryId', 'e.id')
    .join('users as u', 'u.id', 'r.userId')
    .leftJoin('projectTasks as pt', 'pt.id', 't.projectTaskId')
    .select(
      't.id',
      't.carriedFromTaskId',
      't.title',
      't.status',
      't.firstReportedOn',
      'r.workDate',
      'u.name as userName',
      'p.name as projectName',
      'pr.name as requestName',
      'pt.priority',
    )
    .orderBy([
      { column: 'r.workDate', order: 'desc' },
      { column: 'u.name' },
      { column: 'e.sortOrder' },
      { column: 't.sortOrder' },
    ])
    .limit(MAX_TASK_LINES + 1);
}

/**
 * Priority tasks (CONTRACT 13) of some projects: P1 first, then oldest first.
 * @param {{ projectIds: number[] | null, status?: 'open' | 'done', limit: number }} scope
 */
export function listPriorityTasks({ projectIds, status, limit }) {
  return db('projectTasks as t')
    .join('projects as p', 'p.id', 't.projectId')
    .leftJoin('users as a', 'a.id', 't.assigneeId')
    .modify((query) => {
      within(query, 't.projectId', projectIds);
      if (status) query.where('t.status', status);
    })
    .select(
      't.title',
      't.priority',
      't.status',
      't.createdAt',
      't.doneAt',
      'p.name as projectName',
      'a.name as assigneeName',
    )
    .orderBy([{ column: 't.priority' }, { column: 't.createdAt' }, { column: 't.id' }])
    .limit(limit);
}

/** Attendance rows of some people in a date range (AttendanceRow fields the summary needs). */
export function listAttendance({ from, to, userIds }) {
  if (userIds.length === 0) return Promise.resolve([]);
  return db('attendance')
    .whereIn('userId', userIds)
    .whereBetween('workDate', [from, to])
    .select(
      'id',
      'userId',
      'workDate',
      'checkInAt',
      'checkOutAt',
      'location',
      'lateMinutes',
      'isWorkingDay',
      'checkoutStatus',
    )
    .orderBy([{ column: 'workDate' }, { column: 'userId' }]);
}

/** Breaks of some people in a date range. */
export function listBreaks({ from, to, userIds }) {
  if (userIds.length === 0) return Promise.resolve([]);
  return db('attendanceBreaks')
    .whereIn('userId', userIds)
    .whereBetween('workDate', [from, to])
    .select('userId', 'attendanceId', 'workDate', 'startedAt', 'endedAt');
}
