// Every Knex query of the projectTasks module. People, projects, members and report lines are read
// with joins; other modules' data is changed only through their services.
import { db } from '@/lib/db';

const TASK_COLUMNS = [
  'pt.id',
  'pt.projectId',
  'pt.title',
  'pt.details',
  'pt.priority',
  'pt.status',
  'pt.assigneeId',
  'a.name as assigneeName',
  'a.role as assigneeRole',
  'a.status as assigneeStatus',
  'a.avatarUrl as assigneeAvatarUrl',
  'pt.createdBy',
  'cb.name as createdByName',
  'pt.updatedBy',
  'pt.doneAt',
  'pt.doneBy',
  'du.name as doneByName',
  'pt.createdAt',
  'pt.updatedAt',
];

// Whether the assignee is still on the project's team (a removed member keeps their tasks).
const ASSIGNEE_IS_MEMBER =
  'CASE WHEN pt.assignee_id IS NULL THEN 1 WHEN EXISTS (SELECT 1 FROM project_members m ' +
  'WHERE m.project_id = pt.project_id AND m.user_id = pt.assignee_id) THEN 1 ELSE 0 END ' +
  'AS assignee_is_member';

// P1, P2, P3 (the enum's order), then oldest first.
const ORDER = [
  { column: 'pt.priority', order: 'asc' },
  { column: 'pt.createdAt', order: 'asc' },
  { column: 'pt.id', order: 'asc' },
];

function taskQuery(trx) {
  return trx('projectTasks as pt')
    .leftJoin('users as a', 'a.id', 'pt.assigneeId')
    .leftJoin('users as cb', 'cb.id', 'pt.createdBy')
    .leftJoin('users as du', 'du.id', 'pt.doneBy')
    .select(TASK_COLUMNS)
    .select(trx.raw(ASSIGNEE_IS_MEMBER));
}

/** Open tasks on active projects the user is a member of, for them or for anyone. */
function openForUser(trx, userId) {
  return trx('projectTasks as pt')
    .join('projects as p', 'p.id', 'pt.projectId')
    .where('pt.status', 'open')
    .where('p.status', 'active')
    .whereExists(
      trx('projectMembers as m')
        .select(trx.raw('1'))
        .whereRaw('m.project_id = pt.project_id')
        .where('m.userId', userId),
    )
    .where((where) => where.whereNull('pt.assigneeId').orWhere('pt.assigneeId', userId));
}

// ---------- tasks ----------

export function findById(id, trx = db) {
  return taskQuery(trx).where('pt.id', id).first();
}

/** Locks one project_tasks row for the rest of the transaction. */
export function lockById(id, trx) {
  return trx('projectTasks').where({ id }).forUpdate().first();
}

/** A project's tasks, optionally one status, P1 first then oldest. */
export function listForProject({ projectId, status, limit, offset = 0 }, trx = db) {
  const query = taskQuery(trx).where('pt.projectId', projectId).orderBy(ORDER);
  if (status) query.where('pt.status', status);
  if (limit) query.limit(limit).offset(offset);
  return query;
}

export async function countForProject({ projectId, status }, trx = db) {
  const query = trx('projectTasks').where({ projectId });
  if (status) query.where({ status });
  const row = await query.count({ total: '*' }).first();
  return Number(row?.total ?? 0);
}

/** Open tasks for the user across their active projects, with the project's name and colour. */
export function listOpenForUser(userId, trx = db) {
  return openForUser(trx, userId)
    .leftJoin('users as a', 'a.id', 'pt.assigneeId')
    .leftJoin('users as cb', 'cb.id', 'pt.createdBy')
    .leftJoin('users as du', 'du.id', 'pt.doneBy')
    .select(TASK_COLUMNS)
    .select(trx.raw(ASSIGNEE_IS_MEMBER))
    .select('p.name as projectName', 'p.color as projectColor', 'p.isUrgent as projectIsUrgent')
    .orderBy(ORDER);
}

/** { projectId, total, p1 } per project for the user's open tasks. */
export function countOpenByProjectForUser(userId, trx = db) {
  return openForUser(trx, userId)
    .select('pt.projectId')
    .count({ total: '*' })
    .select(trx.raw("SUM(CASE WHEN pt.priority = 'p1' THEN 1 ELSE 0 END) AS p1"))
    .groupBy('pt.projectId');
}

/**
 * Open tasks of active projects that are for this user or for anyone (report suggestions), for
 * one project or several in one query.
 */
export function listOpenForPicker({ userId, projectIds }, trx = db) {
  if (projectIds.length === 0) return Promise.resolve([]);
  return taskQuery(trx)
    .join('projects as p', 'p.id', 'pt.projectId')
    .whereIn('pt.projectId', projectIds)
    .where('pt.status', 'open')
    .where('p.status', 'active')
    .where((where) => where.whereNull('pt.assigneeId').orWhere('pt.assigneeId', userId))
    .orderBy(ORDER);
}

/**
 * The bare rows of these tasks (no joins), for checking report links. With `lock`, the rows are
 * share-locked until the transaction ends, so a task can't be deleted or closed under a save.
 */
export function findManyByIds(ids, trx = db, { lock = false } = {}) {
  if (ids.length === 0) return Promise.resolve([]);
  const query = trx('projectTasks')
    .whereIn(
      'id',
      [...ids].sort((a, b) => a - b),
    )
    .orderBy('id')
    .select('id', 'projectId', 'title', 'priority', 'status', 'assigneeId');
  return lock ? query.forShare() : query;
}

export async function insert(row, trx) {
  const [id] = await trx('projectTasks').insert(row);
  return id;
}

export function update(id, changes, trx) {
  return trx('projectTasks').where({ id }).update(changes);
}

export function remove(id, trx) {
  return trx('projectTasks').where({ id }).del();
}

// ---------- report lines linked to tasks ----------

/**
 * Submitted report lines linked to these tasks on each task's latest reported day only (a task
 * carried over for weeks has a line every day; only the last day matters), newest first (submit
 * time, then line). The service keeps the first line per task.
 */
export function listReportLines(taskIds, trx = db) {
  if (taskIds.length === 0) return Promise.resolve([]);
  const lastDays = trx('reportTasks as lt')
    .join('reportEntries as le', 'le.id', 'lt.entryId')
    .join('dailyReports as ld', 'ld.id', 'le.reportId')
    .whereIn('lt.projectTaskId', taskIds)
    .where('ld.status', 'submitted')
    .groupBy('lt.projectTaskId')
    .select('lt.projectTaskId')
    .max({ lastDate: 'ld.workDate' })
    .as('last');
  return trx('reportTasks as rt')
    .join('reportEntries as re', 're.id', 'rt.entryId')
    .join('dailyReports as dr', 'dr.id', 're.reportId')
    .join('users as u', 'u.id', 'dr.userId')
    .join(lastDays, (join) =>
      join.on('last.projectTaskId', 'rt.projectTaskId').andOn('last.lastDate', 'dr.workDate'),
    )
    .whereIn('rt.projectTaskId', taskIds)
    .where('dr.status', 'submitted')
    .select('rt.projectTaskId', 'rt.status', 'dr.userId', 'u.name as userName', 'dr.workDate')
    .orderBy([
      { column: 'dr.workDate', order: 'desc' },
      { column: 'dr.submittedAt', order: 'desc' },
      { column: 'rt.id', order: 'desc' },
    ]);
}

// ---------- members ----------

/** A project's members (active and deactivated people), by name. */
export function listProjectMembers(projectId, trx = db) {
  return trx('projectMembers as m')
    .join('users as u', 'u.id', 'm.userId')
    .where('m.projectId', projectId)
    .select(
      'u.id',
      'u.name',
      'u.role',
      'u.status',
      'u.designation',
      'u.avatarUrl',
      'u.tracksAttendance',
    )
    .orderBy([
      { column: 'u.name', order: 'asc' },
      { column: 'u.id', order: 'asc' },
    ]);
}

/** True when the person has a member row on the project. */
export async function isMember(projectId, userId, trx = db) {
  const row = await trx('projectMembers').where({ projectId, userId }).first('userId');
  return Boolean(row);
}
