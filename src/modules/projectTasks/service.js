// Priority tasks (CONTRACT 13): reads for the project page, Today, My projects and the daily
// report's suggestions. Writes live in writes.js and taskFiles.js (files on tasks, CONTRACT 27),
// the task window's read in taskDetails.js; CONTRACT 28 adds assignees.js, bulk.js, mine.js and
// updates.js. This file re-exports them so the module has one service object. Order everywhere
// but My tasks: P1, P2, P3, then oldest first.
import { can } from '@/lib/permissions';
import { PHASE_KEYS } from '@/modules/projectPlan/phases';
import * as repo from './repo';
import { readableProject, toId, toTask, withLatestReports } from './shared';

export { create, remove, setStatus, update } from './writes';
export { attachFiles } from './taskFiles';
export { getForViewer } from './taskDetails';
// CONTRACT 28: the people a task can be for, the Table's bulk save, My tasks and the badge, and
// the report lines per viewer.
export { listAssigneeOptions } from './assignees';
export { bulkUpdate } from './bulk';
export { countMineDue, listMine } from './mine';
export { latestLinesFor, updateCountsFor } from './updates';

/** The member filter of a viewer without team.view (their own and Anyone tasks), else null. */
function memberFilterFor(viewer) {
  return can(viewer, 'team.view') ? null : viewer.id;
}

/**
 * A project's priority tasks, open and done (or one status), P1 first then oldest. A viewer
 * without team.view (a member of the project) gets only the tasks for them and for anyone on the
 * project (CONTRACT 27); progress numbers still count every task (progressByProject).
 * `latestReport` is the newest submitted report line linked to the task; a viewer without
 * team.view gets null when that line is someone else's.
 * @param {{ viewer: object, projectId: number, status?: 'open'|'done', limit?: number,
 *   offset?: number }} args members of the project, PMs and Admin may read; limit is optional
 *   (all tasks without it), at most 100 when given
 * @returns {Promise<Array<{ id, projectId, title, details, priority, status, assigneeId,
 *   assignee: { id, name, initials, role, status, avatarUrl, isMember } | null, phase, dueDate,
 *   createdBy, createdByName, createdAt, updatedAt, doneAt, doneBy, doneByName,
 *   latestReport: { status, userId, userName, workDate } | null }>>} phase and dueDate are null
 *   when not set, and on every task before migration 015
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function listForProject({ viewer, projectId, status, limit, offset = 0 }) {
  const project = await readableProject(viewer, projectId);
  const size = limit ? Math.min(Math.max(Math.trunc(Number(limit)) || 100, 1), 100) : undefined;
  const ownOnlyFor = memberFilterFor(viewer);
  const rows = await repo.listForProject({
    projectId: project.id,
    status,
    memberId: ownOnlyFor,
    limit: size,
    offset: Math.max(Math.trunc(Number(offset)) || 0, 0),
  });
  return withLatestReports(rows.map(toTask), { ownOnlyFor });
}

/**
 * One page of a project's tasks with the total (GET /api/projects/:id/tasks). For a member the
 * total counts the same rows as the list: their own and Anyone tasks (CONTRACT 27).
 * @param {{ viewer: object, projectId: number, status?: 'open'|'done', limit?: number,
 *   offset?: number }} args
 * @returns {Promise<{ rows: object[], total: number }>}
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function pageForProject({ viewer, projectId, status, limit = 100, offset = 0 }) {
  const rows = await listForProject({ viewer, projectId, status, limit, offset });
  const total = await repo.countForProject({
    projectId: toId(projectId),
    status,
    memberId: memberFilterFor(viewer),
  });
  return { rows, total };
}

/**
 * All and done tasks per phase of one project, in one query (the member's band, CONTRACT 27). No
 * access check and no names: counts only. Every phase is listed, with zeros when it has no tasks;
 * `none` counts the tasks without a phase (every task before migration 015).
 * @param {number} projectId
 * @returns {Promise<Record<string, { total: number, done: number }>>} keyed by PHASE_KEYS and
 *   'none'
 */
export async function countsByPhase(projectId) {
  const counts = { none: { total: 0, done: 0 } };
  for (const key of PHASE_KEYS) counts[key] = { total: 0, done: 0 };
  const id = toId(projectId);
  if (!id) return counts;
  for (const row of await repo.countsByPhase(id)) {
    const key = row.phase && Object.hasOwn(counts, row.phase) ? row.phase : 'none';
    counts[key].total += Number(row.total ?? 0);
    counts[key].done += Number(row.done ?? 0);
  }
  return counts;
}

/**
 * Task counts of several projects in one query, for the forecast (CONTRACT 22). No access check.
 * It reads no column of migration 015, so it needs no fallback before it.
 * @param {number[]} projectIds
 * @param {{ weeks: Array<{ from: Date, to: Date }> }} options UTC bounds, newest first, `to` not
 *   included: lastFullWeeks(today, timezone) from '@/modules/projectPlan/weeks'
 * @returns {Promise<Record<number, { total: number, done: number, doneByWeek: number[] }>>} every
 *   project asked for, with zeros when it has no tasks; doneByWeek in the order of `weeks`, by
 *   done_at, so reopening a task takes it out
 */
export async function progressByProject(projectIds, { weeks = [] } = {}) {
  const ids = [...new Set((projectIds ?? []).map(toId).filter(Boolean))];
  const progress = {};
  for (const id of ids) progress[id] = { total: 0, done: 0, doneByWeek: weeks.map(() => 0) };
  if (ids.length === 0) return progress;
  for (const row of await repo.progressByProject({ projectIds: ids, weeks })) {
    progress[row.projectId] = {
      total: Number(row.total),
      done: Number(row.done),
      doneByWeek: weeks.map((_, index) => Number(row[`week${index}`])),
    };
  }
  return progress;
}

/**
 * Today's Priority tasks (CONTRACT 28, Today): open tasks on active projects that are for the user
 * or for anyone on a project they are a member of, plus the ones they took on a project they
 * manage without being a member (a tracked Admin), P1 first.
 * @param {object | number} user the user (an id still works: the role is read in the query)
 * @returns {Promise<object[]>} tasks with `phase`, `dueDate` (null before migration 015),
 *   `project: { id, name, color, isUrgent }` and `latestReport` (null when the newest line on the
 *   task is someone else's)
 */
export async function listOpenForUser(user) {
  const id = toId(user?.id ?? user);
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
