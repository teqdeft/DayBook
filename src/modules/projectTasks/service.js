// Priority tasks (CONTRACT 13): reads for the project page, Today, My projects and the daily
// report's suggestions. Writes live in writes.js; this file re-exports them so the module has one
// service object. Order everywhere: P1, P2, P3, then oldest first.
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { projects } from '@/modules/projects';
import * as repo from './repo';
import { projectNotFound, toId, toTask } from './shared';

export { create, remove, setStatus, update } from './writes';

/**
 * Adds `latestReport` ({ status, userId, userName, workDate } | null) to each task. With
 * `ownOnlyFor` (a viewer who can't see everyone's reports), a line someone else reported is left
 * out: employees see their own report data only.
 */
async function withLatestReports(tasks, { ownOnlyFor = null } = {}) {
  const lines = await repo.listReportLines(tasks.map((task) => task.id));
  const latest = new Map();
  for (const line of lines) {
    if (latest.has(line.projectTaskId)) continue;
    latest.set(line.projectTaskId, {
      status: line.status,
      userId: line.userId,
      userName: line.userName,
      workDate: line.workDate,
    });
  }
  return tasks.map((task) => {
    const line = latest.get(task.id) ?? null;
    const hidden = ownOnlyFor && line && Number(line.userId) !== Number(ownOnlyFor);
    return { ...task, latestReport: hidden ? null : line };
  });
}

/** PMs and Admin read every project's tasks; anyone else only their own projects'. */
async function canRead(viewer, projectId) {
  if (!viewer || (viewer.status && viewer.status !== 'active')) return false;
  if (can(viewer, 'team.view') || can(viewer, 'project.manage')) return true;
  return repo.isMember(projectId, viewer.id);
}

/** The project, when the viewer may read its tasks. @throws NOT_FOUND, FORBIDDEN */
async function readableProject(viewer, projectId) {
  const project = await projects.findById(toId(projectId));
  if (!project) throw projectNotFound();
  if (!(await canRead(viewer, project.id))) {
    throw new AppError('FORBIDDEN', {
      message: 'Only people on this project can see its priority tasks.',
    });
  }
  return project;
}

/**
 * A project's priority tasks, open and done (or one status), P1 first then oldest.
 * `latestReport` is the newest submitted report line linked to the task; a viewer without
 * team.view (an employee on the project) gets null when that line is someone else's.
 * @param {{ viewer: object, projectId: number, status?: 'open'|'done', limit?: number,
 *   offset?: number }} args members of the project, PMs and Admin may read; limit is optional
 *   (all tasks without it), at most 100 when given
 * @returns {Promise<Array<{ id, projectId, title, details, priority, status, assigneeId,
 *   assignee: { id, name, initials, role, status, avatarUrl, isMember } | null, createdBy,
 *   createdByName, createdAt, updatedAt, doneAt, doneBy, doneByName,
 *   latestReport: { status, userId, userName, workDate } | null }>>}
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function listForProject({ viewer, projectId, status, limit, offset = 0 }) {
  const project = await readableProject(viewer, projectId);
  const size = limit ? Math.min(Math.max(Math.trunc(Number(limit)) || 100, 1), 100) : undefined;
  const rows = await repo.listForProject({
    projectId: project.id,
    status,
    limit: size,
    offset: Math.max(Math.trunc(Number(offset)) || 0, 0),
  });
  const ownOnlyFor = can(viewer, 'team.view') ? null : viewer.id;
  return withLatestReports(rows.map(toTask), { ownOnlyFor });
}

/**
 * One page of a project's tasks with the total (GET /api/projects/:id/tasks).
 * @param {{ viewer: object, projectId: number, status?: 'open'|'done', limit?: number,
 *   offset?: number }} args
 * @returns {Promise<{ rows: object[], total: number }>}
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function pageForProject({ viewer, projectId, status, limit = 100, offset = 0 }) {
  const rows = await listForProject({ viewer, projectId, status, limit, offset });
  const total = await repo.countForProject({ projectId: toId(projectId), status });
  return { rows, total };
}

/**
 * Open tasks on the user's active projects (member) that are for them or for anyone, P1 first
 * (the "Priority tasks" card on Today).
 * @param {number} userId
 * @returns {Promise<object[]>} tasks with `project: { id, name, color, isUrgent }` and
 *   `latestReport` (null when the newest line on the task is someone else's)
 */
export async function listOpenForUser(userId) {
  const id = toId(userId);
  if (!id) return [];
  const rows = await repo.listOpenForUser(id);
  return withLatestReports(rows.map(toTask), { ownOnlyFor: id });
}

/**
 * Open task counts per project for the user (the same tasks as listOpenForUser): My projects cards
 * ("2 priority tasks · 1 P1").
 * @param {number} userId
 * @returns {Promise<Record<number, { total: number, p1: number }>>}
 */
export async function countOpenByProjectForUser(userId) {
  const id = toId(userId);
  if (!id) return {};
  const rows = await repo.countOpenByProjectForUser(id);
  return Object.fromEntries(
    rows.map((row) => [row.projectId, { total: Number(row.total), p1: Number(row.p1 ?? 0) }]),
  );
}

/**
 * Open tasks of an active project that the user can link a report line to: the ones for them and
 * the ones for anyone on the project. P1 first.
 * @param {{ userId: number, projectId: number }} args
 * @returns {Promise<object[]>} tasks (without latestReport)
 */
export async function findOpenForPicker({ userId, projectId }) {
  const user = toId(userId);
  const project = toId(projectId);
  if (!user || !project) return [];
  return (await repo.listOpenForPicker({ userId: user, projectIds: [project] })).map(toTask);
}

/**
 * findOpenForPicker for several projects in one query (the daily report preloads the
 * suggestions of every project it may show).
 * @param {{ userId: number, projectIds: number[] }} args
 * @returns {Promise<Record<number, object[]>>} project id -> its tasks, P1 first; projects
 *   without any are left out
 */
export async function findOpenForPickerByProject({ userId, projectIds }) {
  const user = toId(userId);
  const ids = [...new Set((projectIds ?? []).map(toId).filter(Boolean))];
  if (!user || ids.length === 0) return {};
  const byProject = {};
  for (const row of await repo.listOpenForPicker({ userId: user, projectIds: ids })) {
    (byProject[row.projectId] ??= []).push(toTask(row));
  }
  return byProject;
}

/**
 * One task, for other modules (no access check).
 * @param {number} id
 * @returns {Promise<object | null>} the task (without latestReport), or null
 */
export async function findById(id) {
  const taskId = toId(id);
  if (!taskId) return null;
  return toTask(await repo.findById(taskId));
}

/**
 * Several tasks at once, for other modules (no access check): reports checks the priority task
 * links of a save with it. Inside the caller's transaction with `lock`, the rows stay
 * share-locked until it ends, so a task can't be deleted or marked done under the save.
 * @param {number[]} ids
 * @param {{ trx?: import('knex').Knex.Transaction, lock?: boolean }} [options] lock needs trx
 * @returns {Promise<Map<number, { id, projectId, title, priority, status, assigneeId }>>} by id;
 *   unknown ids are missing
 */
export async function findByIds(ids, { trx, lock = false } = {}) {
  const taskIds = [...new Set((ids ?? []).map(toId).filter(Boolean))];
  const rows = await repo.findManyByIds(taskIds, trx, { lock: Boolean(trx) && lock });
  return new Map(
    rows.map((row) => [
      Number(row.id),
      {
        id: Number(row.id),
        projectId: Number(row.projectId),
        title: row.title,
        priority: row.priority,
        status: row.status,
        assigneeId: row.assigneeId ?? null,
      },
    ]),
  );
}

/**
 * Who a task can be for (the Edit dialog's select): the project's active members who are
 * tracked (they write daily reports), by name.
 * @param {{ viewer: object, projectId: number }} args
 * @returns {Promise<Array<{ id, name, designation, role }>>}
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function listAssigneeOptions({ viewer, projectId }) {
  const project = await readableProject(viewer, projectId);
  const members = await repo.listProjectMembers(project.id);
  return members
    .filter((member) => member.status === 'active' && member.tracksAttendance)
    .map((member) => ({
      id: member.id,
      name: member.name,
      designation: member.designation || null,
      role: member.role,
    }));
}
