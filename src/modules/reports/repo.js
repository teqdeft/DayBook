// Queries for daily_reports, report_entries, report_tasks, report_revisions and
// report_edit_requests. Read queries join projects, project_requests and users for display
// fields only (names, colours), so lists never need one query per row.
import { db } from '@/lib/db';

const REPORT_COLUMNS = [
  'id',
  'userId',
  'workDate',
  'status',
  'totalMinutes',
  'firstSubmittedAt',
  'submittedAt',
  'locksAt',
  'unlockedUntil',
  'revision',
  'slackChannelId',
  'slackTs',
  'createdAt',
  'updatedAt',
];

// ---------- daily_reports ----------

export function findById(id, trx = db) {
  return trx('dailyReports').where({ id }).first(REPORT_COLUMNS);
}

/** Locks the report row until the transaction ends (submit, save and approve use it). */
export function findByIdForUpdate(id, trx) {
  return trx('dailyReports').where({ id }).forUpdate().first(REPORT_COLUMNS);
}

export function findByUserAndDate(userId, workDate, trx = db) {
  return trx('dailyReports').where({ userId, workDate }).first(REPORT_COLUMNS);
}

export async function insertReport(row, trx = db) {
  const [id] = await trx('dailyReports').insert(row);
  return id;
}

export function updateReport(id, changes, trx = db) {
  return trx('dailyReports').where({ id }).update(changes);
}

/** A person's reports between two dates (inclusive), newest first. */
export function listByUserRange(userId, from, to, trx = db) {
  return trx('dailyReports')
    .where({ userId })
    .whereBetween('workDate', [from, to])
    .orderBy('workDate', 'desc')
    .select(REPORT_COLUMNS);
}

/** A page of a person's reports (GET /api/reports), newest first, with the total count. */
export async function pageByUser({ userId, from, to, limit, offset }, trx = db) {
  const base = trx('dailyReports').where({ userId });
  if (from) base.where('workDate', '>=', from);
  if (to) base.where('workDate', '<=', to);
  const [rows, countRow] = await Promise.all([
    base.clone().orderBy('workDate', 'desc').limit(limit).offset(offset).select(REPORT_COLUMNS),
    base.clone().count({ count: '*' }).first(),
  ]);
  return { rows, total: Number(countRow?.count ?? 0) };
}

/** The person's latest submitted report on a day before `beforeDate` (the carry-over source). */
export function findLatestSubmittedBefore(userId, beforeDate, trx = db) {
  return trx('dailyReports')
    .where({ userId, status: 'submitted' })
    .where('workDate', '<', beforeDate)
    .orderBy('workDate', 'desc')
    .first(REPORT_COLUMNS);
}

/** User ids (of the given ones) that submitted a report for the day. */
export async function listSubmittedUserIds(userIds, workDate, trx = db) {
  if (userIds.length === 0) return [];
  const rows = await trx('dailyReports')
    .whereIn('userId', userIds)
    .where({ workDate, status: 'submitted' })
    .select('userId');
  return rows.map((row) => row.userId);
}

/** { 'YYYY-MM-DD': minutes } of submitted reports. */
export async function submittedMinutesByDay(userId, from, to, trx = db) {
  const rows = await trx('dailyReports')
    .where({ userId, status: 'submitted' })
    .whereBetween('workDate', [from, to])
    .select('workDate', 'totalMinutes');
  return Object.fromEntries(rows.map((row) => [row.workDate, Number(row.totalMinutes)]));
}

// ---------- report_entries and report_tasks ----------

/**
 * Entries of the given reports in their order, with the project's (or pending request's)
 * display fields.
 */
export function listEntries(reportIds, trx = db) {
  if (reportIds.length === 0) return Promise.resolve([]);
  return trx('reportEntries as e')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as r', 'r.id', 'e.projectRequestId')
    .whereIn('e.reportId', reportIds)
    .orderBy([
      { column: 'e.reportId', order: 'asc' },
      { column: 'e.sortOrder', order: 'asc' },
      { column: 'e.id', order: 'asc' },
    ])
    .select(
      'e.id',
      'e.reportId',
      'e.projectId',
      'e.projectRequestId',
      'e.minutes',
      'e.sortOrder',
      'p.name as projectName',
      'p.color as projectColor',
      'p.isUrgent as projectIsUrgent',
      'p.status as projectStatus',
      'r.name as requestName',
      'r.status as requestStatus',
    );
}

/**
 * Tasks of the given entries in their order, with the linked priority task's priority and title
 * for display (CONTRACT section 13).
 */
export function listTasks(entryIds, trx = db) {
  if (entryIds.length === 0) return Promise.resolve([]);
  return trx('reportTasks as t')
    .leftJoin('projectTasks as pt', 'pt.id', 't.projectTaskId')
    .whereIn('t.entryId', entryIds)
    .orderBy([
      { column: 't.entryId', order: 'asc' },
      { column: 't.sortOrder', order: 'asc' },
      { column: 't.id', order: 'asc' },
    ])
    .select(
      't.id',
      't.entryId',
      't.title',
      't.status',
      't.firstReportedOn',
      't.carriedFromTaskId',
      't.projectTaskId',
      't.sortOrder',
      'pt.priority as projectTaskPriority',
      'pt.title as projectTaskTitle',
    );
}

/**
 * A report's entry rows in their order, locked until the transaction ends. A save compares and
 * writes these, so a PM moving entries off a project request at the same moment waits for the
 * save, or finishes first and the save sees the move.
 */
export function lockEntries(reportId, trx) {
  return trx('reportEntries')
    .where({ reportId })
    .orderBy([
      { column: 'sortOrder', order: 'asc' },
      { column: 'id', order: 'asc' },
    ])
    .forUpdate()
    .select('id', 'reportId', 'projectId', 'projectRequestId', 'minutes', 'sortOrder');
}

/** The task rows of the given entries in their order, locked until the transaction ends. */
export function lockTasks(entryIds, trx) {
  if (entryIds.length === 0) return Promise.resolve([]);
  return trx('reportTasks')
    .whereIn('entryId', entryIds)
    .orderBy([
      { column: 'entryId', order: 'asc' },
      { column: 'sortOrder', order: 'asc' },
      { column: 'id', order: 'asc' },
    ])
    .forUpdate()
    .select('id', 'entryId', 'title', 'status', 'projectTaskId', 'sortOrder');
}

/**
 * Takes a shared lock on project request rows (in id order) until the transaction ends; reads
 * nothing from them. Approving or declining a request locks its row first (projects module), so
 * while a report save holds this lock the request can't be handled, and a save that waited for
 * a decision sees it. Whether a request is still pending is asked of the projects service.
 */
export function shareLockProjectRequests(ids, trx) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('projectRequests')
    .whereIn(
      'id',
      [...ids].sort((a, b) => a - b),
    )
    .orderBy('id')
    .forShare()
    .select('id');
}

export async function insertEntry(row, trx = db) {
  const [id] = await trx('reportEntries').insert(row);
  return id;
}

export function updateEntry(id, changes, trx = db) {
  return trx('reportEntries').where({ id }).update(changes);
}

export function deleteEntries(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve(0);
  return trx('reportEntries').whereIn('id', ids).delete();
}

export async function insertTask(row, trx = db) {
  const [id] = await trx('reportTasks').insert(row);
  return id;
}

export function updateTask(id, changes, trx = db) {
  return trx('reportTasks').where({ id }).update(changes);
}

export function deleteTasks(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve(0);
  return trx('reportTasks').whereIn('id', ids).delete();
}

/**
 * Every task of a person's reports (draft or submitted) between two dates, with its report day
 * and project, newest day first.
 */
export function listTasksInRange(userId, from, to, trx = db) {
  return trx('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .leftJoin('projects as p', 'p.id', 'e.projectId')
    .leftJoin('projectRequests as r', 'r.id', 'e.projectRequestId')
    .where('d.userId', userId)
    .whereBetween('d.workDate', [from, to])
    .orderBy([
      { column: 'd.workDate', order: 'desc' },
      { column: 'e.sortOrder', order: 'asc' },
      { column: 't.sortOrder', order: 'asc' },
      { column: 't.id', order: 'asc' },
    ])
    .select(
      't.id as taskId',
      't.title',
      't.status',
      't.firstReportedOn',
      't.carriedFromTaskId',
      'd.workDate',
      'd.status as reportStatus',
      'e.projectId',
      'e.projectRequestId',
      'p.name as projectName',
      'p.color as projectColor',
      'r.name as requestName',
    );
}

/** The task lines of a report that are linked to a priority task: [{ id, projectTaskId }]. */
export function listTaskLinks(reportId, trx = db) {
  return trx('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .where('e.reportId', reportId)
    .whereNotNull('t.projectTaskId')
    .select('t.id', 't.projectTaskId');
}

/**
 * Task lines of submitted reports on a project between two dates that are linked to a priority
 * task, with that task's priority (the project report's Priority column).
 */
export function listPriorityLinks(projectId, from, to, trx = db) {
  return trx('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .join('projectTasks as pt', 'pt.id', 't.projectTaskId')
    .where({ 'e.projectId': projectId, 'd.status': 'submitted' })
    .whereBetween('d.workDate', [from, to])
    .select('t.id', 't.projectTaskId', 'pt.priority', 'pt.title');
}

/** Minutes per project from submitted reports in a date range (optionally one person). */
export function minutesByProject({ from, to, userId }, trx = db) {
  const query = trx('reportEntries as e')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .join('projects as p', 'p.id', 'e.projectId')
    .where('d.status', 'submitted')
    .whereBetween('d.workDate', [from, to])
    .groupBy('e.projectId', 'p.name', 'p.color')
    .select('e.projectId', 'p.name', 'p.color')
    .sum({ minutes: 'e.minutes' });
  if (userId) query.where('d.userId', userId);
  return query;
}

/** The latest submitted report day per project for a person. */
export function lastReportDateByProject(userId, trx = db) {
  return trx('reportEntries as e')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .where('d.userId', userId)
    .where('d.status', 'submitted')
    .whereNotNull('e.projectId')
    .groupBy('e.projectId')
    .select('e.projectId')
    .max({ lastDate: 'd.workDate' });
}

export async function hasEntriesForProjectRequest(projectRequestId, trx = db) {
  const row = await trx('reportEntries').where({ projectRequestId }).first('id');
  return Boolean(row);
}

/** Entries logged against a project request, locked for the move. */
export function listEntriesForProjectRequest(projectRequestId, trx) {
  return trx('reportEntries')
    .where({ projectRequestId })
    .forUpdate()
    .select('id', 'reportId', 'minutes');
}

/** The entry of a report that already points at a project (for merging moved entries). */
export function findEntryForProject(reportId, projectId, trx = db) {
  return trx('reportEntries').where({ reportId, projectId }).first('id', 'minutes');
}

export function moveTasks(fromEntryId, toEntryId, sortOffset, trx) {
  return trx('reportTasks')
    .where({ entryId: fromEntryId })
    .update({ entryId: toEntryId, sortOrder: trx.raw('sort_order + ?', [sortOffset]) });
}

export async function maxTaskSortOrder(entryId, trx = db) {
  const row = await trx('reportTasks').where({ entryId }).max({ max: 'sortOrder' }).first();
  return row?.max === null || row?.max === undefined ? -1 : Number(row.max);
}

// ---------- report_revisions ----------

export function insertRevision(row, trx = db) {
  return trx('reportRevisions').insert(row);
}

export function listRevisions(reportId, trx = db) {
  return trx('reportRevisions as v')
    .leftJoin('users as u', 'u.id', 'v.editedBy')
    .where('v.reportId', reportId)
    .orderBy('v.revision', 'desc')
    .select(
      'v.id',
      'v.revision',
      'v.snapshot',
      'v.editedBy',
      'u.name as editedByName',
      'v.reason',
      'v.createdAt',
    );
}

// ---------- report_edit_requests ----------

const REQUEST_COLUMNS = [
  'q.id',
  'q.reportId',
  'q.workDate',
  'q.requestedBy',
  'q.reason',
  'q.status',
  'q.handledBy',
  'q.handledAt',
  'q.declineReason',
  'q.createdAt',
  'u.name as requesterName',
  'u.designation as requesterDesignation',
  'u.role as requesterRole',
  'u.status as requesterStatus',
  'u.avatarUrl as requesterAvatarUrl',
  'u.slackUserId as requesterSlackUserId',
  'u.reportsToId as requesterReportsToId',
  'h.name as handledByName',
];

function requestsQuery(trx) {
  return trx('reportEditRequests as q')
    .join('users as u', 'u.id', 'q.requestedBy')
    .leftJoin('users as h', 'h.id', 'q.handledBy');
}

export async function insertEditRequest(row, trx = db) {
  const [id] = await trx('reportEditRequests').insert(row);
  return id;
}

export function findEditRequest(id, trx = db) {
  return requestsQuery(trx).where('q.id', id).first(REQUEST_COLUMNS);
}

export function lockEditRequest(id, trx) {
  return trx('reportEditRequests').where({ id }).forUpdate().first('id', 'status');
}

export function updateEditRequest(id, changes, trx = db) {
  return trx('reportEditRequests').where({ id }).update(changes);
}

export function findPendingEditRequest(userId, workDate, trx = db) {
  return trx('reportEditRequests')
    .where({ requestedBy: userId, workDate, status: 'pending' })
    .first('id', 'reportId', 'workDate', 'reason', 'createdAt');
}

/**
 * The person's pending request for a day, read with a lock inside a transaction. The locking read
 * also locks the gap where a new request of this person would go, so two requests sent at the
 * same moment can't both be saved (the second one waits, or fails as a deadlock).
 */
export function findPendingEditRequestForUpdate(userId, workDate, trx) {
  return trx('reportEditRequests')
    .where({ requestedBy: userId, workDate, status: 'pending' })
    .forUpdate()
    .first('id');
}

/**
 * Edit requests an approver may handle. `reportsToId` limits them to people who report to that
 * PM; null means everyone (Admin). `excludeUserId` leaves out the approver's own requests.
 * `status` is 'pending' or 'handled'.
 */
function approverScope({ status, reportsToId, excludeUserId }, trx) {
  const query = requestsQuery(trx);
  if (status === 'pending') query.where('q.status', 'pending');
  else query.whereIn('q.status', ['approved', 'declined']);
  if (reportsToId) query.where('u.reportsToId', reportsToId);
  if (excludeUserId) query.whereNot('q.requestedBy', excludeUserId);
  return query;
}

export async function pageEditRequests(
  { status, reportsToId, excludeUserId, limit, offset },
  trx = db,
) {
  const base = approverScope({ status, reportsToId, excludeUserId }, trx);
  const order =
    status === 'pending'
      ? [
          { column: 'q.createdAt', order: 'desc' },
          { column: 'q.id', order: 'desc' },
        ]
      : [
          { column: 'q.handledAt', order: 'desc' },
          { column: 'q.id', order: 'desc' },
        ];
  const [rows, countRow] = await Promise.all([
    base.clone().orderBy(order).limit(limit).offset(offset).select(REQUEST_COLUMNS),
    base.clone().count({ count: '*' }).first(),
  ]);
  return { rows, total: Number(countRow?.count ?? 0) };
}

/** A person's own edit requests for report days in a range, newest request first. */
export function listEditRequestsByUser(userId, { from, to, limit }, trx = db) {
  return requestsQuery(trx)
    .where('q.requestedBy', userId)
    .whereBetween('q.workDate', [from, to])
    .orderBy([
      { column: 'q.createdAt', order: 'desc' },
      { column: 'q.id', order: 'desc' },
    ])
    .limit(limit)
    .select(REQUEST_COLUMNS);
}

/** The latest approved edit request of a report (its reason goes on the next revision). */
export function findLatestApprovedRequest(reportId, trx = db) {
  return trx('reportEditRequests')
    .where({ reportId, status: 'approved' })
    .orderBy('handledAt', 'desc')
    .first('id', 'reason');
}
