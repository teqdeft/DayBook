// Reads and updates of `project_files` (CONTRACT 27): the Files tab, task windows, counts, chips,
// the picker, downloads and the management routes (links to tasks are in linkRepo.js). A1's
// uploadRepo.js writes the rows at Finish and attach. `project_tasks`, `projects`,
// `project_members` and `users` are read only here (the task's person and phase, the creator's
// name, the member rule) and never written; `project_documents` is never touched (E's service
// does, through syncFileDocument).
import { db } from '@/lib/db';

// One file and who added it, in the row shape fileView.toProjectFile reads (linkRepo.js reads a
// linked file with these too).
export const FILE_BASE_COLUMNS = Object.freeze([
  'f.id',
  'f.projectId',
  'f.scope',
  'f.taskId',
  'f.phase',
  'f.visibility',
  'f.status',
  'f.name',
  'f.ext',
  'f.sizeBytes',
  'f.storageKey',
  'f.isPicture',
  'f.width',
  'f.height',
  'f.hasThumb',
  'f.createdBy',
  'f.createdAt',
  'f.updatedAt',
  'u.name as creatorName',
]);

// The same with its task (only a task on the same project counts).
const FILE_COLUMNS = [
  ...FILE_BASE_COLUMNS,
  't.id as taskRowId',
  't.title as taskTitle',
  't.phase as taskPhase',
  't.assigneeId as taskAssigneeId',
];

/** project_files as f, with its task (same project only) and its creator. */
function filesQuery(trx = db) {
  return trx('projectFiles as f')
    .leftJoin('projectTasks as t', function sameProjectTask() {
      this.on('t.id', '=', 'f.taskId').andOn('t.projectId', '=', 'f.projectId');
    })
    .leftJoin('users as u', 'u.id', 'f.createdBy')
    .select(FILE_COLUMNS);
}

/**
 * One file row (any status) with its task and creator, or undefined.
 * @param {number} id
 * @param {import('knex').Knex} [trx]
 */
export function findFile(id, trx = db) {
  return filesQuery(trx).where('f.id', id).first();
}

/**
 * Locks only the file row (`FOR UPDATE` on project_files; a join would lock the task row too),
 * then reads it with its task and creator. A file edit or delete locks only its file row.
 * @param {number} id
 * @param {import('knex').Knex.Transaction} trx
 */
export async function lockFile(id, trx) {
  const locked = await trx('projectFiles').where({ id }).forUpdate().first('id');
  return locked ? findFile(id, trx) : undefined;
}

/**
 * Every active file of a project, project and task files, newest first.
 * @param {number} projectId
 */
export function listActiveForProject(projectId) {
  return filesQuery()
    .where({ 'f.projectId': projectId, 'f.status': 'active' })
    .orderBy([
      { column: 'f.createdAt', order: 'desc' },
      { column: 'f.id', order: 'desc' },
    ]);
}

/**
 * The active files of one task, in the order they were added.
 * @param {{ projectId: number, taskId: number }} args
 */
export function listActiveForTask({ projectId, taskId }) {
  return filesQuery()
    .where({
      'f.projectId': projectId,
      'f.taskId': taskId,
      'f.scope': 'task',
      'f.status': 'active',
    })
    .orderBy([
      { column: 'f.createdAt', order: 'asc' },
      { column: 'f.id', order: 'asc' },
    ]);
}

/**
 * The active files of these tasks (own files, `scope 'task'`), in the order they were added: the
 * board's chips (linkReads.chipsForTasks).
 * @param {number[]} taskIds
 */
export function listActiveForTasks(taskIds) {
  if (taskIds.length === 0) return Promise.resolve([]);
  return filesQuery()
    .whereIn('f.taskId', taskIds)
    .where({ 'f.scope': 'task', 'f.status': 'active' })
    .orderBy([
      { column: 'f.createdAt', order: 'asc' },
      { column: 'f.id', order: 'asc' },
    ]);
}

/**
 * The project's active project files (`scope 'project'`, never a task's), newest first, at most
 * `limit` (the "From project files" picker).
 * @param {number} projectId
 * @param {number} limit
 */
export function listActiveProjectFiles(projectId, limit) {
  return filesQuery()
    .where({ 'f.projectId': projectId, 'f.scope': 'project', 'f.status': 'active' })
    .orderBy([
      { column: 'f.createdAt', order: 'desc' },
      { column: 'f.id', order: 'desc' },
    ])
    .limit(limit);
}

/**
 * Active file counts per task, with the task's project and current person (from the task row,
 * never the caller's copy), for the access rule.
 * @param {number[]} taskIds
 * @returns {Promise<Array<{ taskId: number, projectId: number, assigneeId: number | null,
 *   count: number }>>}
 */
export async function countActiveByTask(taskIds) {
  if (taskIds.length === 0) return [];
  const rows = await db('projectFiles as f')
    .join('projectTasks as t', function sameProjectTask() {
      this.on('t.id', '=', 'f.taskId').andOn('t.projectId', '=', 'f.projectId');
    })
    .whereIn('f.taskId', taskIds)
    .where({ 'f.scope': 'task', 'f.status': 'active' })
    .groupBy('f.taskId', 'f.projectId', 't.assigneeId')
    .select('f.taskId', 'f.projectId', 't.assigneeId')
    .count({ count: '*' });
  return rows.map((row) => ({ ...row, count: Number(row.count) }));
}

/**
 * Files on a person's own and Anyone tasks per project, only on projects where they are an active
 * member (an active `project_members` row and an active user).
 * @param {{ userId: number, projectIds: number[] }} args
 * @returns {Promise<Array<{ projectId: number, count: number }>>}
 */
export async function countOnMemberTasks({ userId, projectIds }) {
  if (projectIds.length === 0) return [];
  const rows = await db('projectFiles as f')
    .join('projectTasks as t', function sameProjectTask() {
      this.on('t.id', '=', 'f.taskId').andOn('t.projectId', '=', 'f.projectId');
    })
    .join('projectMembers as m', function ownMembership() {
      this.on('m.projectId', '=', 'f.projectId').andOnVal('m.userId', '=', userId);
    })
    .join('users as u', 'u.id', 'm.userId')
    .whereIn('f.projectId', projectIds)
    .where({ 'f.scope': 'task', 'f.status': 'active', 'u.status': 'active' })
    .where((where) => where.where('t.assigneeId', userId).orWhereNull('t.assigneeId'))
    .groupBy('f.projectId')
    .select('f.projectId')
    .count({ count: '*' });
  return rows.map((row) => ({ projectId: row.projectId, count: Number(row.count) }));
}

/**
 * True when the user has a `project_members` row for the project and is active (the same rule as
 * `projects.isMember`; read here so A doesn't wait for B).
 * @param {{ projectId: number, userId: number }} args
 */
export async function isActiveMember({ projectId, userId }) {
  const row = await db('projectMembers as m')
    .join('users as u', 'u.id', 'm.userId')
    .where({ 'm.projectId': projectId, 'm.userId': userId, 'u.status': 'active' })
    .first('m.userId');
  return Boolean(row);
}

/**
 * An active file of the project for E's text POST; a shared lock (`LOCK IN SHARE MODE` on both
 * servers) when `trx` is given, so the file can't be deleted under the new document.
 * @param {{ projectId: number, fileId: number }} args
 * @param {import('knex').Knex.Transaction} [trx]
 */
export function findActiveForDocument({ projectId, fileId }, trx) {
  const query = (trx ?? db)('projectFiles')
    .where({ id: fileId, projectId, status: 'active' })
    .first('id', 'scope', 'phase', 'visibility', 'name');
  return trx ? query.forShare() : query;
}

/**
 * Updates one file row (the caller writes `updatedAt`: the column has no ON UPDATE).
 * @param {number} id
 * @param {object} changes camelCase columns
 * @param {import('knex').Knex.Transaction} trx
 */
export function updateFile(id, changes, trx) {
  return trx('projectFiles').where({ id }).update(changes);
}
