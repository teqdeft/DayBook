// The Knex queries of the projectTasks module. People, projects and members are read with joins;
// other modules' data is changed only through their services. CONTRACT 28 keeps this file at its
// size: the report-line reads live in updates.js, My tasks' in mine.js and the bulk lock in bulk.js,
// each reusing taskQuery, withPlanColumns and ORDER from here.
import { db } from '@/lib/db';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';

// Today, the daily report's picker, My projects and timers read these. They must keep working on a
// deploy that runs before migration 015, so phase and due_date are not in this list (PLAN_COLUMNS).
export const TASK_COLUMNS = [
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

// Migration 015's columns, only for the reads that show them.
const PLAN_COLUMNS = ['pt.phase', 'pt.dueDate'];

const PERSON_COLUMNS = [
  'u.id',
  'u.name',
  'u.role',
  'u.status',
  'u.designation',
  'u.avatarUrl',
  'u.tracksAttendance',
];

// Whether the assignee is still on the project's team: a member, its PM, or an Admin (who may
// take a task on any project without being a member, CONTRACT 28). A removed member keeps their
// tasks and reads 0 ("Not on the project"); a deactivated Admin still reads 1 (the card says
// "Deactivated" from the status).
const ASSIGNEE_IS_MEMBER =
  'CASE WHEN pt.assignee_id IS NULL THEN 1 WHEN EXISTS (SELECT 1 FROM project_members m ' +
  'WHERE m.project_id = pt.project_id AND m.user_id = pt.assignee_id) THEN 1 ' +
  'WHEN EXISTS (SELECT 1 FROM projects pm WHERE pm.id = pt.project_id ' +
  'AND pm.pm_id = pt.assignee_id) THEN 1 ' +
  "WHEN EXISTS (SELECT 1 FROM users au WHERE au.id = pt.assignee_id AND au.role = 'admin') " +
  'THEN 1 ELSE 0 END AS assignee_is_member';

// P1, P2, P3 (the enum's order), then oldest first.
export const ORDER = [
  { column: 'pt.priority', order: 'asc' },
  { column: 'pt.createdAt', order: 'asc' },
  { column: 'pt.id', order: 'asc' },
];

export function taskQuery(trx = db) {
  return trx('projectTasks as pt')
    .leftJoin('users as a', 'a.id', 'pt.assigneeId')
    .leftJoin('users as cb', 'cb.id', 'pt.createdBy')
    .leftJoin('users as du', 'du.id', 'pt.doneBy')
    .select(TASK_COLUMNS)
    .select(trx.raw(ASSIGNEE_IS_MEMBER));
}

/** The query's rows with their phase and due date; both null before migration 015. */
export function withPlanColumns(query) {
  return guardPlanRead(
    () => query.clone().select(PLAN_COLUMNS),
    async () => (await query).map((row) => ({ ...row, phase: null, dueDate: null })),
  );
}

/**
 * Open tasks on active projects for Today (CONTRACT 28, Today): on a project the user is a member
 * of, the ones for them or for anyone; and the ones they took on a project they manage without
 * being a member (its PM, or an Admin; the role is read here, so an id is enough).
 */
function openForUser(trx, userId) {
  const memberRow = trx('projectMembers as m')
    .select(trx.raw('1'))
    .whereRaw('m.project_id = pt.project_id')
    .where('m.userId', userId);
  const isAdmin = trx('users as me')
    .select(trx.raw('1'))
    .where('me.id', userId)
    .where('me.role', 'admin');
  return trx('projectTasks as pt')
    .join('projects as p', 'p.id', 'pt.projectId')
    .where('pt.status', 'open')
    .where('p.status', 'active')
    .where((rule) =>
      rule
        .where((own) =>
          own
            .whereExists(memberRow)
            .where((who) => who.whereNull('pt.assigneeId').orWhere('pt.assigneeId', userId)),
        )
        .orWhere((taken) =>
          taken
            .where('pt.assigneeId', userId)
            .where((manages) => manages.where('p.pmId', userId).orWhereExists(isAdmin)),
        ),
    );
}

// ---------- tasks ----------

export function findById(id, trx = db) {
  return taskQuery(trx).where('pt.id', id).first();
}

/** One task with its phase and due date, for the writes. */
export async function findWithPlan(id, trx = db) {
  const rows = await withPlanColumns(taskQuery(trx).where('pt.id', id).limit(1));
  return rows[0];
}

/** Locks one project_tasks row for the rest of the transaction. */
export function lockById(id, trx) {
  return trx('projectTasks').where({ id }).forUpdate().first('id', 'projectId');
}

/** Only the tasks for this person or for anyone on the project (a member's reads, CONTRACT 27). */
function forMemberOnly(query, memberId, column = 'assigneeId') {
  if (!memberId) return query;
  return query.where((where) => where.whereNull(column).orWhere(column, memberId));
}

/**
 * A project's tasks with their phase and due date, optionally one status, P1 first then oldest.
 * With `memberId`, only the tasks for that person or for anyone.
 */
export function listForProject({ projectId, status, memberId, limit, offset = 0 }, trx = db) {
  const query = taskQuery(trx).where('pt.projectId', projectId).orderBy(ORDER);
  if (status) query.where('pt.status', status);
  forMemberOnly(query, memberId, 'pt.assigneeId');
  if (limit) query.limit(limit).offset(offset);
  return withPlanColumns(query);
}

/**
 * Task counts per project in one query: all, done, and done inside each window (by done_at; a
 * reopened task has none). Projects without tasks are left out.
 * @param {{ projectIds: number[], weeks: Array<{ from: Date, to: Date }> }} input
 * @returns {Promise<Array<{ projectId, total, done, week0, week1, week2 }>>} one weekN per window
 */
export function progressByProject({ projectIds, weeks }, trx = db) {
  const query = trx('projectTasks')
    .whereIn('projectId', projectIds)
    .groupBy('projectId')
    .select('projectId')
    .count({ total: '*' })
    .select(trx.raw("SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done"));
  weeks.forEach(({ from, to }, index) => {
    query.select(
      trx.raw(
        "SUM(CASE WHEN status = 'done' AND done_at >= ? AND done_at < ? THEN 1 ELSE 0 END) " +
          `AS week${index}`,
        [from, to],
      ),
    );
  });
  return query;
}

/** How many tasks listForProject finds with the same filters (without paging). */
export async function countForProject({ projectId, status, memberId }, trx = db) {
  const query = trx('projectTasks').where({ projectId });
  if (status) query.where({ status });
  forMemberOnly(query, memberId);
  const row = await query.count({ total: '*' }).first();
  return Number(row?.total ?? 0);
}

/**
 * All and done tasks per phase of one project in one query: `{ phase, total, done }` rows, phase
 * null for tasks without one. Before migration 015 every task counts as without a phase.
 */
export function countsByPhase(projectId, trx = db) {
  const counts = (query) =>
    query
      .count({ total: '*' })
      .select(trx.raw("SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done"));
  return guardPlanRead(
    () => counts(trx('projectTasks').where({ projectId }).groupBy('phase').select('phase')),
    async () =>
      (await counts(trx('projectTasks').where({ projectId }))).map((row) => ({
        ...row,
        phase: null,
      })),
  );
}

/**
 * Open tasks for the user across their active projects (the Today rule), with the project's name
 * and colour, and the phase and due date (null before migration 015).
 */
export function listOpenForUser(userId, trx = db) {
  const query = openForUser(trx, userId)
    .leftJoin('users as a', 'a.id', 'pt.assigneeId')
    .leftJoin('users as cb', 'cb.id', 'pt.createdBy')
    .leftJoin('users as du', 'du.id', 'pt.doneBy')
    .select(TASK_COLUMNS)
    .select(trx.raw(ASSIGNEE_IS_MEMBER))
    .select('p.name as projectName', 'p.color as projectColor', 'p.isUrgent as projectIsUrgent')
    .orderBy(ORDER);
  return withPlanColumns(query);
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

// ---------- members ----------

/** A project's members (active and deactivated people), by name. */
export function listProjectMembers(projectId, trx = db) {
  return trx('projectMembers as m')
    .join('users as u', 'u.id', 'm.userId')
    .where('m.projectId', projectId)
    .select(PERSON_COLUMNS)
    .orderBy([
      { column: 'u.name', order: 'asc' },
      { column: 'u.id', order: 'asc' },
    ]);
}

/** One person, with the same columns as listProjectMembers (a project's PM). */
export function findPerson(id, trx = db) {
  return trx('users as u').where('u.id', id).first(PERSON_COLUMNS);
}

/** Several people with the same columns (teamOf's Admins who aren't on the project). */
export function findPeople(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('users as u').whereIn('u.id', ids).select(PERSON_COLUMNS).orderBy('u.id');
}

/** True when the person has a member row on the project. */
export async function isMember(projectId, userId, trx = db) {
  const row = await trx('projectMembers').where({ projectId, userId }).first('userId');
  return Boolean(row);
}
