// Read model for the dashboards (Team dashboard, Employee detail, Company overview, hours export).
// The only repo allowed to read across other modules' tables (CONTRACT section 4): every function
// is read-only and runs one query for one widget, never a query per row.
import { db, parseJson } from '@/lib/db';

// ---------- sidebar badges ----------

/**
 * Pending counts for the sidebar in one query. Parts that are not asked for count as 0.
 * @param {{ edits: false | 'all' | number, projects: boolean, corrections: boolean,
 *   selfId?: number }} scope
 *   `edits`: false, 'all' (Admin) or the PM's user id (requests from people who report to them);
 *   `selfId`: the viewer, whose own edit and correction requests never count (nobody decides on
 *   their own).
 */
export async function countNavBadges({ edits, projects, corrections, selfId }) {
  const zero = db.raw('0');
  const editsQuery =
    edits === false
      ? zero
      : db('reportEditRequests as r')
          .count('*')
          .where('r.status', 'pending')
          .modify((q) => {
            if (selfId) q.whereNot('r.requestedBy', selfId);
            if (edits !== 'all') {
              q.whereExists(
                db('users as u').select(db.raw('1')).whereRaw('u.id = r.requested_by').where({
                  'u.reportsToId': edits,
                }),
              );
            }
          });
  const projectsQuery = projects
    ? db('projectRequests').count('*').where('status', 'pending')
    : zero;
  const correctionsQuery = corrections
    ? db('attendanceCorrections')
        .count('*')
        .where('status', 'pending')
        .modify((q) => {
          if (selfId) q.whereNot('userId', selfId);
        })
    : zero;
  const row = await db
    .select({ edits: editsQuery, projects: projectsQuery, corrections: correctionsQuery })
    .first();
  return {
    edits: Number(row?.edits ?? 0),
    projects: Number(row?.projects ?? 0),
    corrections: Number(row?.corrections ?? 0),
  };
}

// ---------- one day for everyone (Team board, KPIs, donut) ----------

/**
 * Every active person with tracks_attendance = 1 who had joined by that day (or checked in on it
 * anyway), with their attendance row and report for the day (nulls when missing), in the order
 * people were added. The same people the Attendance screen lists for the day.
 * @param {string} date 'YYYY-MM-DD'
 */
export function listTrackedPeopleDay(date) {
  return db('users as u')
    .leftJoin('attendance as a', (join) => {
      join.on('a.userId', 'u.id').andOnVal('a.workDate', date);
    })
    .leftJoin('dailyReports as r', (join) => {
      join.on('r.userId', 'u.id').andOnVal('r.workDate', date);
    })
    .where({ 'u.status': 'active', 'u.tracksAttendance': true })
    .where((q) => {
      q.whereNull('u.joinedOn').orWhere('u.joinedOn', '<=', date).orWhereNotNull('a.id');
    })
    .select(
      'u.id',
      'u.name',
      'u.designation',
      'u.role',
      'u.avatarUrl',
      'u.status',
      'u.joinedOn',
      'a.id as attendanceId',
      'a.checkInAt',
      'a.checkOutAt',
      'a.location',
      'a.officeVerified',
      'a.lateMinutes',
      'r.id as reportId',
      'r.status as reportStatus',
      'r.totalMinutes',
    )
    .orderBy('u.id');
}

/**
 * Project labels of every submitted report on one day, in report order.
 * @param {string} date
 * @returns {Promise<{ reportId: number, name: string, color: string|null }[]>}
 */
export function listSubmittedReportProjects(date) {
  return db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as pr', 'pr.id', 'e.projectRequestId')
    .where({ 'r.workDate': date, 'r.status': 'submitted' })
    .select('e.reportId', db.raw('COALESCE(p.name, pr.name) as name'), 'p.color')
    .orderBy([{ column: 'e.reportId' }, { column: 'e.sortOrder' }, { column: 'e.id' }]);
}

// ---------- hours ----------

/**
 * Minutes per project (or pending project request) on submitted reports in a date range,
 * largest first. Project requests that are not projects yet are grouped under their name.
 * @param {{ from: string, to: string, userId?: number }} range
 * @returns {Promise<{ projectId: number|null, requestId: number|null, name: string, color: string|null, minutes: number }[]>}
 */
export async function hoursByProject({ from, to, userId }) {
  const rows = await db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as pr', 'pr.id', 'e.projectRequestId')
    .where('r.status', 'submitted')
    .whereBetween('r.workDate', [from, to])
    .modify((q) => {
      if (userId) q.where('r.userId', userId);
    })
    .groupBy('e.projectId', 'e.projectRequestId', 'p.name', 'pr.name', 'p.color')
    .havingRaw('SUM(e.minutes) > 0')
    .select(
      'e.projectId',
      'e.projectRequestId as requestId',
      'p.name as projectName',
      'pr.name as requestName',
      'p.color',
      db.raw('SUM(e.minutes) as minutes'),
    )
    .orderBy([{ column: 'minutes', order: 'desc' }, { column: 'projectName' }]);
  return rows.map((row) => ({
    projectId: row.projectId,
    requestId: row.requestId,
    name: row.projectName ?? row.requestName,
    color: row.color,
    minutes: Number(row.minutes),
  }));
}

// ---------- urgent projects ----------

/**
 * Active projects marked urgent, oldest mark first, with who marked them and how many active
 * people are members.
 */
export function listUrgentProjects() {
  const members = db('projectMembers as pm')
    .join('users as mu', 'mu.id', 'pm.userId')
    .whereRaw('pm.project_id = p.id')
    .where('mu.status', 'active')
    .count('*');
  return db('projects as p')
    .leftJoin('users as m', 'm.id', 'p.urgentMarkedBy')
    .where({ 'p.isUrgent': true, 'p.status': 'active' })
    .select(
      'p.id',
      'p.name',
      'p.color',
      'p.urgentNote',
      'p.urgentMarkedAt',
      'm.name as urgentMarkedByName',
      members.as('memberCount'),
    )
    .orderBy([{ column: 'p.urgentMarkedAt' }, { column: 'p.id' }]);
}

// ---------- one person (Employee detail) ----------

/** The person with department and manager names, or undefined. */
export function findPerson(userId) {
  return db('users as u')
    .leftJoin('departments as d', 'd.id', 'u.departmentId')
    .leftJoin('users as m', 'm.id', 'u.reportsToId')
    .where('u.id', userId)
    .select(
      'u.id',
      'u.name',
      'u.email',
      'u.designation',
      'u.role',
      'u.avatarUrl',
      'u.status',
      'u.tracksAttendance',
      'u.shiftStart',
      'u.shiftEnd',
      'u.joinedOn',
      'u.deactivatedAt',
      'd.name as departmentName',
      'm.name as reportsToName',
    )
    .first();
}

/** The person's attendance rows between two dates, oldest first. */
export function listAttendance(userId, from, to) {
  return db('attendance')
    .where({ userId })
    .whereBetween('workDate', [from, to])
    .select(
      'id',
      'workDate',
      'checkInAt',
      'checkOutAt',
      'location',
      'officeVerified',
      'lateMinutes',
      'isWorkingDay',
      'checkoutStatus',
    )
    .orderBy('workDate');
}

/** The person's reports between two dates (any status), oldest first. */
export function listReports(userId, from, to) {
  return db('dailyReports')
    .where({ userId })
    .whereBetween('workDate', [from, to])
    .select('id', 'workDate', 'status', 'totalMinutes', 'revision', 'submittedAt')
    .orderBy('workDate');
}

/**
 * Entries and their tasks for the person's reports between two dates, one row per task (an
 * entry without tasks comes back once with null task columns).
 */
export function listReportEntries(userId, from, to) {
  return db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as pr', 'pr.id', 'e.projectRequestId')
    .leftJoin('reportTasks as t', 't.entryId', 'e.id')
    .where('r.userId', userId)
    .whereBetween('r.workDate', [from, to])
    .select(
      'e.id as entryId',
      'e.reportId',
      'e.minutes',
      db.raw('COALESCE(p.name, pr.name) as project_name'),
      'p.color',
      't.id as taskId',
      't.title',
      't.status',
    )
    .orderBy([
      { column: 'r.workDate' },
      { column: 'e.sortOrder' },
      { column: 'e.id' },
      { column: 't.sortOrder' },
      { column: 't.id' },
    ]);
}

/** Submit history (report_revisions) of the person's reports between two dates. */
export async function listRevisions(userId, from, to) {
  const rows = await db('reportRevisions as rv')
    .join('dailyReports as r', 'r.id', 'rv.reportId')
    .leftJoin('users as u', 'u.id', 'rv.editedBy')
    .where('r.userId', userId)
    .whereBetween('r.workDate', [from, to])
    .select(
      'rv.reportId',
      'rv.revision',
      'rv.reason',
      'rv.createdAt',
      'rv.snapshot',
      'u.name as editedByName',
    )
    .orderBy([{ column: 'rv.reportId' }, { column: 'rv.revision' }]);
  return rows.map(({ snapshot, ...row }) => {
    let totalMinutes = null;
    try {
      totalMinutes = Number(parseJson(snapshot)?.totalMinutes ?? null);
    } catch {
      totalMinutes = null;
    }
    return { ...row, totalMinutes: Number.isFinite(totalMinutes) ? totalMinutes : null };
  });
}

/**
 * The person's report edit requests still waiting or declined, for report days between two dates,
 * oldest first (approved ones show as the revision they led to).
 */
export function listOpenEditRequests(userId, from, to) {
  return db('reportEditRequests as q')
    .leftJoin('users as h', 'h.id', 'q.handledBy')
    .where('q.requestedBy', userId)
    .whereIn('q.status', ['pending', 'declined'])
    .whereBetween('q.workDate', [from, to])
    .select(
      'q.id',
      'q.workDate',
      'q.reason',
      'q.status',
      'q.createdAt',
      'q.handledAt',
      'q.declineReason',
      'h.name as handledByName',
    )
    .orderBy([{ column: 'q.createdAt' }, { column: 'q.id' }]);
}

/**
 * The person's tasks whose latest submitted version is still in progress (the version no later
 * submitted task was carried from), reported on or after `since`. Oldest first report first.
 */
export function listOpenTasks(userId, since) {
  const carriedLater = db('reportTasks as t2')
    .join('reportEntries as e2', 'e2.id', 't2.entryId')
    .join('dailyReports as r2', 'r2.id', 'e2.reportId')
    .whereRaw('t2.carried_from_task_id = t.id')
    .where('r2.status', 'submitted')
    .select(db.raw('1'));
  return db('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as pr', 'pr.id', 'e.projectRequestId')
    .where({ 'r.userId': userId, 'r.status': 'submitted', 't.status': 'in_progress' })
    .where('r.workDate', '>=', since)
    .whereNotExists(carriedLater)
    .select(
      't.id',
      't.title',
      't.firstReportedOn',
      'r.workDate',
      db.raw('COALESCE(p.name, pr.name) as project_name'),
      'p.color',
    )
    .orderBy([{ column: 't.firstReportedOn' }, { column: 't.id' }]);
}

// ---------- company (Overview) ----------

/** { active, urgent } project counts. */
export async function countProjects() {
  const row = await db('projects')
    .select(
      db.raw("SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active"),
      db.raw("SUM(CASE WHEN status = 'active' AND is_urgent = 1 THEN 1 ELSE 0 END) as urgent"),
    )
    .first();
  return { active: Number(row?.active ?? 0), urgent: Number(row?.urgent ?? 0) };
}

/**
 * Pending report edit, project and attendance correction requests, plus how many of each were
 * created since `since` (a Date) and already handled.
 */
export async function countRequests(since) {
  const pending = (table) => db(table).count('*').where('status', 'pending');
  const handled = (table) =>
    db(table).count('*').whereNot('status', 'pending').where('createdAt', '>=', since);
  const row = await db
    .select({
      edits: pending('reportEditRequests'),
      projects: pending('projectRequests'),
      corrections: pending('attendanceCorrections'),
      editsHandled: handled('reportEditRequests'),
      projectsHandled: handled('projectRequests'),
      correctionsHandled: handled('attendanceCorrections'),
    })
    .first();
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]));
}

/** Check-outs the midnight job marked missing and nobody fixed yet, per day, newest first. */
export async function countMissingCheckouts() {
  const rows = await db('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    // Same people as the Attendance screen: active and tracked (guide 7.10).
    .where({ 'a.checkoutStatus': 'missing', 'u.status': 'active', 'u.tracksAttendance': true })
    .groupBy('a.workDate')
    .select('a.workDate', db.raw('COUNT(*) as count'))
    .orderBy('a.workDate', 'desc');
  return rows.map((row) => ({ workDate: row.workDate, count: Number(row.count) }));
}

/**
 * Check-ins per day and location for active tracked people between two dates. `joined` counts
 * the check-ins of people who had joined by that day (the rest checked in before their joining
 * date).
 */
export async function countAttendanceByDay(from, to) {
  const rows = await db('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    .where({ 'u.status': 'active', 'u.tracksAttendance': true })
    .whereBetween('a.workDate', [from, to])
    .groupBy('a.workDate', 'a.location')
    .select(
      'a.workDate',
      'a.location',
      db.raw('COUNT(*) as count'),
      db.raw(
        'SUM(CASE WHEN u.joined_on IS NULL OR u.joined_on <= a.work_date THEN 1 ELSE 0 END) as joined',
      ),
    );
  return rows.map((row) => ({ ...row, count: Number(row.count), joined: Number(row.joined) }));
}

/** Active people per department (departments with nobody left out), largest first. */
export async function countPeopleByDepartment() {
  const rows = await db('departments as d')
    .join('users as u', 'u.departmentId', 'd.id')
    .where('u.status', 'active')
    .groupBy('d.id', 'd.name')
    .select('d.id', 'd.name', db.raw('COUNT(u.id) as count'))
    .orderBy([{ column: 'count', order: 'desc' }, { column: 'd.id' }]);
  return rows.map((row) => ({ ...row, count: Number(row.count) }));
}

/** Every department id in creation order (stable bar colours). */
export function listDepartmentIds() {
  return db('departments').orderBy('id').pluck('id');
}

// ---------- hours export ----------

/**
 * One row per report entry (or one row for a report without entries) between two dates, with the
 * person and department. Ordered by date, person, entry order.
 */
export function listExportEntries({ from, to, userId }) {
  return db('dailyReports as r')
    .join('users as u', 'u.id', 'r.userId')
    .leftJoin('departments as d', 'd.id', 'u.departmentId')
    .leftJoin('reportEntries as e', 'e.reportId', 'r.id')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as pr', 'pr.id', 'e.projectRequestId')
    .whereBetween('r.workDate', [from, to])
    .modify((q) => {
      if (userId) q.where('r.userId', userId);
    })
    .select(
      'r.workDate',
      'r.status',
      'r.revision',
      'u.id as userId',
      'u.name as personName',
      'd.name as departmentName',
      'e.id as entryId',
      'e.minutes',
      'p.name as projectName',
      'pr.name as requestName',
    )
    .orderBy([
      { column: 'r.workDate' },
      { column: 'u.name' },
      { column: 'u.id' },
      { column: 'e.sortOrder' },
      { column: 'e.id' },
    ]);
}

/** Tasks of the report entries between two dates, in entry order. */
export function listExportTasks({ from, to, userId }) {
  return db('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .whereBetween('r.workDate', [from, to])
    .modify((q) => {
      if (userId) q.where('r.userId', userId);
    })
    .select('t.entryId', 't.title', 't.status')
    .orderBy([{ column: 't.entryId' }, { column: 't.sortOrder' }, { column: 't.id' }]);
}

/** Attendance days between two dates that have no report at all (the report is missing). */
export function listExportDaysWithoutReport({ from, to, userId }) {
  return db('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    .leftJoin('departments as d', 'd.id', 'u.departmentId')
    .leftJoin('dailyReports as r', (join) => {
      join.on('r.userId', 'a.userId').andOn('r.workDate', 'a.workDate');
    })
    .whereNull('r.id')
    .whereBetween('a.workDate', [from, to])
    .modify((q) => {
      if (userId) q.where('a.userId', userId);
    })
    .select('a.workDate', 'u.id as userId', 'u.name as personName', 'd.name as departmentName');
}

// ---------- project report (CONTRACT section 12) ----------
// Submitted reports only (build guide 7.10). Entries still under a pending project request are
// not part of the project yet; approving the request moves them onto it.

/**
 * First and last day with a submitted report entry on the project (all time).
 * @param {number} projectId
 * @returns {Promise<{ firstOn: string|null, lastOn: string|null }>}
 */
export async function projectReportSpan(projectId) {
  const row = await db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .where({ 'e.projectId': projectId, 'r.status': 'submitted' })
    .select(db.raw('MIN(r.work_date) as first_on'), db.raw('MAX(r.work_date) as last_on'))
    .first();
  return { firstOn: dateOrNull(row?.firstOn), lastOn: dateOrNull(row?.lastOn) };
}

/**
 * Everyone with a submitted entry on the project on one day, latest submit first.
 * @param {number} projectId
 * @param {string} date
 */
export function listProjectReportersOn(projectId, date) {
  return db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .join('users as u', 'u.id', 'r.userId')
    .where({ 'e.projectId': projectId, 'r.status': 'submitted', 'r.workDate': date })
    .groupBy('u.id', 'u.name', 'r.submittedAt')
    .select('u.id', 'u.name', 'r.submittedAt')
    .orderBy([{ column: 'r.submittedAt', order: 'desc' }, { column: 'u.name' }]);
}

/**
 * The project's submitted entries between two dates, one row per entry, with the person.
 * Newest day first, then people A to Z.
 */
export function listProjectEntries(projectId, from, to) {
  return db('reportEntries as e')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .join('users as u', 'u.id', 'r.userId')
    .where({ 'e.projectId': projectId, 'r.status': 'submitted' })
    .whereBetween('r.workDate', [from, to])
    .select(
      'e.id as entryId',
      'e.reportId',
      'e.minutes',
      'r.workDate',
      'r.userId',
      'u.name',
      'u.designation',
      'u.role',
      'u.status',
      'u.avatarUrl',
    )
    .orderBy([
      { column: 'r.workDate', order: 'desc' },
      { column: 'u.name' },
      { column: 'r.userId' },
      { column: 'e.sortOrder' },
      { column: 'e.id' },
    ]);
}

/** Tasks of the project's submitted entries between two dates, oldest day first, entry order. */
export function listProjectTasks(projectId, from, to) {
  return db('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as r', 'r.id', 'e.reportId')
    .where({ 'e.projectId': projectId, 'r.status': 'submitted' })
    .whereBetween('r.workDate', [from, to])
    .select(
      't.id',
      't.entryId',
      't.title',
      't.status',
      't.firstReportedOn',
      't.carriedFromTaskId',
      'e.reportId',
      'r.workDate',
      'r.userId',
    )
    .orderBy([
      { column: 'r.workDate' },
      { column: 't.entryId' },
      { column: 't.sortOrder' },
      { column: 't.id' },
    ]);
}

/** The project's members (any status, tracked or not), in the order they were added. */
export function listProjectMembers(projectId) {
  return db('projectMembers as m')
    .join('users as u', 'u.id', 'm.userId')
    .where('m.projectId', projectId)
    .select(
      'u.id',
      'u.name',
      'u.designation',
      'u.role',
      'u.status',
      'u.avatarUrl',
      'u.tracksAttendance',
    )
    .orderBy([{ column: 'm.addedAt' }, { column: 'u.id' }]);
}

/** MIN()/MAX() of a DATE column as 'YYYY-MM-DD' (drivers may hand back a Date or a string). */
function dateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}
