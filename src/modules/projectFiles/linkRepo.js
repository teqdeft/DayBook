// Reads and writes of `task_file_links` (CONTRACT 28, Data and Modules "Repo"): a link names a task
// and a project file of the same project. Every read joins the link to its task row (the person and
// the project come from there, never from a caller's copy) and counts only a task on the file's own
// project, so a link whose task is on another project never counts. Grouped reads select only their
// GROUP BY columns and aggregates (MySQL 8.4's ONLY_FULL_GROUP_BY); locking reads use knex's
// `.forShare()` and `.forUpdate()`, and the link rows of a save are read under the task row lock
// (linkRows says why that read is a plain one). Before migration 020 every query here fails with
// errno 1146: the callers wrap them in `guard020Read` / `guard020Write` (migration020.js).
import { db } from '@/lib/db';
import { FILE_BASE_COLUMNS } from './repo';

/** task_file_links as l with its task (t) and its active project file (f) on the task's project. */
function linkedFiles(query, { file = 'f', task = 't' } = {}) {
  return query
    .join(`projectTasks as ${task}`, `${task}.id`, 'l.taskId')
    .join(`projectFiles as ${file}`, function sameProject() {
      this.on(`${file}.id`, '=', 'l.fileId').andOn(`${file}.projectId`, '=', `${task}.projectId`);
    })
    .where({ [`${file}.status`]: 'active', [`${file}.scope`]: 'project' });
}

/** A link as `canSeeFile` reads it. */
const toLink = (row) => ({
  taskId: Number(row.taskId),
  assigneeId: row.assigneeId === null ? null : Number(row.assigneeId),
  projectId: Number(row.projectId),
});

/**
 * The links of these files whose task is on `projectId`, oldest first (the access rule's `links`).
 * @param {number[]} fileIds
 * @param {number} projectId
 * @returns {Promise<Map<number, Array<{ taskId: number, assigneeId: number | null,
 *   projectId: number }>>>}
 */
export async function linksForFiles(fileIds, projectId) {
  const links = new Map();
  if (fileIds.length === 0) return links;
  const rows = await db('taskFileLinks as l')
    .join('projectTasks as t', 't.id', 'l.taskId')
    .whereIn('l.fileId', fileIds)
    .where('t.projectId', projectId)
    .orderBy([{ column: 'l.createdAt' }, { column: 'l.taskId' }])
    .select('l.fileId', 'l.taskId', 't.assigneeId', 't.projectId');
  for (const row of rows) {
    const id = Number(row.fileId);
    if (!links.has(id)) links.set(id, []);
    links.get(id).push(toLink(row));
  }
  return links;
}

/**
 * Every link of the project's active project files, oldest first, with its task and the task's
 * person (the Files tab: "On 2 tasks", "On tasks", "Shared with you", Edit details' line).
 * @param {number} projectId
 * @returns {Promise<Array<{ fileId: number, taskId: number, taskTitle: string,
 *   taskPhase: string | null, assigneeId: number | null, projectId: number,
 *   assigneeName: string | null, assigneeRole: string | null,
 *   assigneeStatus: string | null }>>}
 */
export function linksForProject(projectId) {
  return linkedFiles(db('taskFileLinks as l'))
    .leftJoin('users as u', 'u.id', 't.assigneeId')
    .where('t.projectId', projectId)
    .orderBy([{ column: 'l.createdAt' }, { column: 'l.taskId' }, { column: 'l.fileId' }])
    .select(
      'l.fileId',
      'l.taskId',
      't.title as taskTitle',
      't.phase as taskPhase',
      't.assigneeId',
      't.projectId',
      'u.name as assigneeName',
      'u.role as assigneeRole',
      'u.status as assigneeStatus',
    );
}

/**
 * The active project files linked to these tasks, each with its link (`linkTaskId`,
 * `linkCreatedAt`) and the linked task's person and project, oldest link first.
 * @param {number[]} taskIds
 */
export function listLinkedForTasks(taskIds) {
  if (taskIds.length === 0) return Promise.resolve([]);
  return linkedFiles(db('taskFileLinks as l'), { task: 'lt' })
    .leftJoin('users as u', 'u.id', 'f.createdBy')
    .whereIn('l.taskId', taskIds)
    .orderBy([{ column: 'l.createdAt' }, { column: 'l.fileId' }])
    .select([
      ...FILE_BASE_COLUMNS,
      'l.taskId as linkTaskId',
      'l.createdAt as linkCreatedAt',
      'lt.assigneeId as linkAssigneeId',
      'lt.projectId as linkProjectId',
    ]);
}

/**
 * One row per link of these tasks to an active project file, with what the access rule needs.
 * @param {number[]} taskIds
 * @returns {Promise<Array<{ taskId: number, projectId: number, assigneeId: number | null,
 *   fileId: number, visibility: string }>>}
 */
export async function countLinkedByTask(taskIds) {
  if (taskIds.length === 0) return [];
  const rows = await linkedFiles(db('taskFileLinks as l'))
    .whereIn('l.taskId', taskIds)
    .select('l.taskId', 't.projectId', 't.assigneeId', 'l.fileId', 'f.visibility');
  return rows.map((row) => ({
    ...toLink(row),
    fileId: Number(row.fileId),
    visibility: row.visibility,
  }));
}

/**
 * Links to active "Only PM and Admins" files per task; inside `trx` a shared locking read.
 * @param {number[]} taskIds
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<Array<{ taskId: number, count: number }>>}
 */
export async function countPrivateByTask(taskIds, trx) {
  if (taskIds.length === 0) return [];
  const query = linkedFiles((trx ?? db)('taskFileLinks as l'))
    .whereIn('l.taskId', taskIds)
    .where('f.visibility', 'managers')
    .groupBy('l.taskId')
    .select('l.taskId')
    .count({ count: '*' });
  const rows = await (trx ? query.forShare() : query);
  return rows.map((row) => ({ taskId: Number(row.taskId), count: Number(row.count) }));
}

/**
 * How many tasks of the project each file is linked to (the picker's "On 1 task").
 * @param {number} projectId
 * @returns {Promise<Map<number, number>>}
 */
export async function linkCountsForProject(projectId) {
  const rows = await db('taskFileLinks as l')
    .join('projectTasks as t', 't.id', 'l.taskId')
    .where('t.projectId', projectId)
    .groupBy('l.fileId')
    .select('l.fileId')
    .count({ count: '*' });
  return new Map(rows.map((row) => [Number(row.fileId), Number(row.count)]));
}

/**
 * The ids of the files linked to one task (the picker's "Already on this task").
 * @param {number} taskId
 * @returns {Promise<Set<number>>}
 */
export async function fileIdsOnTask(taskId) {
  const rows = await db('taskFileLinks').where({ taskId }).select('fileId');
  return new Set(rows.map((row) => Number(row.fileId)));
}

/**
 * Links on a person's own and Anyone tasks per project (each link once), only on projects where
 * they are an active member (My projects "3 files").
 * @param {{ userId: number, projectIds: number[] }} args
 * @returns {Promise<Array<{ projectId: number, count: number }>>}
 */
export async function countOnMemberTasks({ userId, projectIds }) {
  if (projectIds.length === 0) return [];
  const rows = await linkedFiles(db('taskFileLinks as l'))
    .join('projectMembers as m', function ownMembership() {
      this.on('m.projectId', '=', 't.projectId').andOnVal('m.userId', '=', userId);
    })
    .join('users as u', 'u.id', 'm.userId')
    .whereIn('t.projectId', projectIds)
    .where('u.status', 'active')
    .where((where) => where.where('t.assigneeId', userId).orWhereNull('t.assigneeId'))
    .groupBy('t.projectId')
    .select('t.projectId')
    .count({ count: '*' });
  return rows.map((row) => ({ projectId: Number(row.projectId), count: Number(row.count) }));
}

// ---------- inside a save (the caller's transaction; lock order: task, uploads, files, links) ----

/**
 * The picked files with a shared lock (so none is deleted or moved under the new links), in id
 * order, with what the link rules check.
 * @param {number[]} fileIds
 * @param {import('knex').Knex.Transaction} trx
 */
export function lockPickedFiles(fileIds, trx) {
  return trx('projectFiles')
    .whereIn('id', fileIds)
    .orderBy('id')
    .forShare()
    .select('id', 'projectId', 'scope', 'status', 'visibility');
}

/**
 * The task's link rows (all of them or only `fileIds`): a plain read inside the caller's
 * transaction, never a locking one. Every link save locks the task row first (B's lockForManage,
 * unlinkFile's lockTaskRow), so no other save of this task runs meanwhile, and the transaction's
 * read view starts after that lock, so this read sees every committed link. A locking read
 * (`FOR UPDATE`) would add InnoDB gap locks, and two saves linking files to neighbouring tasks at
 * the same moment would deadlock on each other's gap (errno 1213, seen on MariaDB 10.4).
 * @param {number} taskId
 * @param {number[] | null} fileIds
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<number[]>} the linked file ids
 */
export async function linkRows(taskId, fileIds, trx) {
  const query = trx('taskFileLinks').where({ taskId });
  if (fileIds) query.whereIn('fileId', fileIds);
  const rows = await query.orderBy('fileId').select('fileId');
  return rows.map((row) => Number(row.fileId));
}

/**
 * How many of these files are active (a plain read, after the task row lock).
 * @param {number[]} fileIds
 * @param {import('knex').Knex.Transaction} trx
 */
export async function countActiveAmong(fileIds, trx) {
  if (fileIds.length === 0) return 0;
  const row = await trx('projectFiles')
    .whereIn('id', fileIds)
    .where({ status: 'active' })
    .count({ count: '*' })
    .first();
  return Number(row?.count ?? 0);
}

/**
 * One multi-row INSERT of new links.
 * @param {Array<{ taskId: number, fileId: number, createdBy: number, createdAt: Date }>} rows
 * @param {import('knex').Knex.Transaction} trx
 */
export function insertLinks(rows, trx) {
  return trx('taskFileLinks').insert(rows);
}

/**
 * Deletes the task's links to these files (rows linkRows found: each by its whole primary key, so
 * InnoDB locks only those rows).
 * @param {number} taskId
 * @param {number[]} fileIds
 * @param {import('knex').Knex.Transaction} trx
 */
export function deleteLinks(taskId, fileIds, trx) {
  return trx('taskFileLinks').where({ taskId }).whereIn('fileId', fileIds).delete();
}

/**
 * Locks the task row (`FOR UPDATE`, read only: nothing here writes the task) for an unlink.
 * @param {number} taskId
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<{ id: number, projectId: number, assigneeId: number | null } | undefined>}
 */
export function lockTaskRow(taskId, trx) {
  return trx('projectTasks')
    .where({ id: taskId })
    .forUpdate()
    .first('id', 'projectId', 'assigneeId');
}

/**
 * A task's project and phase (the picker's `taskPhase`), or undefined.
 * @param {number} taskId
 * @param {import('knex').Knex} [trx]
 */
export function findTask(taskId, trx = db) {
  return trx('projectTasks').where({ id: taskId }).first('id', 'projectId', 'phase');
}

/**
 * The person the share confirm judges (`{ id, role, status }`), or undefined.
 * @param {number} id
 * @param {import('knex').Knex} [trx]
 */
export function findPerson(id, trx = db) {
  return trx('users').where({ id }).first('id', 'role', 'status');
}
