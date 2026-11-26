// Updates per viewer (CONTRACT 28, Task number, status chip, time and updates per viewer): the
// submitted daily-report lines linked to tasks, for the cards' counts and status chips, the
// Table's line under the title, and the task window's Updates and Latest report. One rule for all
// of them: lines of submitted reports on an entry with minutes (CONTRACT 24: a planned project's
// 0-minute lines aren't reports of work), and for a viewer without team.view only their own lines,
// kept **before** the newest is picked; newest first by day, submit time, then line. To-do lines
// (drafts) never count. The report-line queries live here (repo.js is at its size cap); no access
// check: callers pass only tasks the viewer may see.
import { db } from '@/lib/db';
import { can } from '@/lib/permissions';
import { initials } from '@/lib/text';

/** Most lines the task window lists. */
export const UPDATES_LIMIT = 10;

/** The viewer whose lines alone count, or null for a viewer with team.view (PMs, Admins). */
export function ownOnlyFor(viewer) {
  return can(viewer, 'team.view') ? null : (viewer?.id ?? 0);
}

/** A positive whole id, or null. */
function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The ids as unique positive ids. */
function idsOf(taskIds) {
  return [...new Set((taskIds ?? []).map(toId).filter(Boolean))];
}

/** The lines that count, joined to their entry and report; only one person's with `ownOnlyFor`. */
function countedLines(trx, taskIds, ownOnly, alias = { rt: 'rt', re: 're', dr: 'dr' }) {
  const query = trx(`reportTasks as ${alias.rt}`)
    .join(`reportEntries as ${alias.re}`, `${alias.re}.id`, `${alias.rt}.entryId`)
    .join(`dailyReports as ${alias.dr}`, `${alias.dr}.id`, `${alias.re}.reportId`)
    .whereIn(`${alias.rt}.projectTaskId`, taskIds)
    .where(`${alias.dr}.status`, 'submitted')
    .where(`${alias.re}.minutes`, '>', 0);
  if (ownOnly !== null && ownOnly !== undefined) query.where(`${alias.dr}.userId`, ownOnly);
  return query;
}

const NEWEST_FIRST = [
  { column: 'dr.workDate', order: 'desc' },
  { column: 'dr.submittedAt', order: 'desc' },
  { column: 'rt.id', order: 'desc' },
];

/**
 * The counted lines of these tasks on each task's latest counted day only (a task carried over for
 * weeks has a line every day; only the last day can hold the newest), newest first. The caller
 * keeps the first line per task. Grouped part portable: it selects only its GROUP BY column and an
 * aggregate (MySQL 8.4's ONLY_FULL_GROUP_BY).
 * @param {number[]} taskIds
 * @param {{ ownOnlyFor?: number | null }} [options] a viewer without team.view: only their lines
 * @returns {Promise<Array<{ projectTaskId, status, userId, userName, workDate, title }>>}
 */
export function listReportLines(taskIds, { ownOnlyFor: ownOnly = null } = {}, trx = db) {
  if (taskIds.length === 0) return Promise.resolve([]);
  const lastDays = countedLines(trx, taskIds, ownOnly, { rt: 'lt', re: 'le', dr: 'ld' })
    .groupBy('lt.projectTaskId')
    .select('lt.projectTaskId')
    .max({ lastDate: 'ld.workDate' })
    .as('last');
  return countedLines(trx, taskIds, ownOnly)
    .join('users as u', 'u.id', 'dr.userId')
    .join(lastDays, (join) =>
      join.on('last.projectTaskId', 'rt.projectTaskId').andOn('last.lastDate', 'dr.workDate'),
    )
    .select(
      'rt.projectTaskId',
      'rt.status',
      'dr.userId',
      'u.name as userName',
      'dr.workDate',
      'rt.title',
    )
    .orderBy(NEWEST_FIRST);
}

/** `{ projectTaskId, total }` counted lines per task, in one grouped query. */
export function countReportLines(taskIds, { ownOnlyFor: ownOnly = null } = {}, trx = db) {
  if (taskIds.length === 0) return Promise.resolve([]);
  return countedLines(trx, taskIds, ownOnly)
    .groupBy('rt.projectTaskId')
    .select('rt.projectTaskId')
    .count({ total: '*' });
}

/** The newest counted lines of one task, with the person's face, newest first. */
export function listUpdates(taskId, { ownOnlyFor: ownOnly = null, limit = UPDATES_LIMIT } = {}) {
  return countedLines(db, [taskId], ownOnly)
    .join('users as u', 'u.id', 'dr.userId')
    .select(
      'dr.userId',
      'u.name as userName',
      'u.avatarUrl',
      'dr.workDate',
      'rt.status',
      'rt.title',
    )
    .orderBy(NEWEST_FIRST)
    .limit(limit);
}

/**
 * The number of report lines on each task that the viewer may see (the cards' "2 updates").
 * @param {{ viewer: object, taskIds: number[] }} args
 * @returns {Promise<Record<number, number>>} task id → lines; tasks without any are left out
 */
export async function updateCountsFor({ viewer, taskIds }) {
  const ids = idsOf(taskIds);
  if (!viewer || ids.length === 0) return {};
  const rows = await countReportLines(ids, { ownOnlyFor: ownOnlyFor(viewer) });
  return Object.fromEntries(rows.map((row) => [Number(row.projectTaskId), Number(row.total)]));
}

/**
 * The newest report line on each task that the viewer may see: the status chip and the Table's
 * line under the title.
 * @param {{ viewer: object, taskIds: number[] }} args
 * @returns {Promise<Record<number, { status: 'in_progress' | 'blocked' | 'done',
 *   workDate: string, userId: number, userName: string }>>} tasks without a line are left out
 */
export async function latestLinesFor({ viewer, taskIds }) {
  const ids = idsOf(taskIds);
  if (!viewer || ids.length === 0) return {};
  const latest = {};
  for (const line of await listReportLines(ids, { ownOnlyFor: ownOnlyFor(viewer) })) {
    const id = Number(line.projectTaskId);
    if (latest[id]) continue;
    latest[id] = {
      status: line.status,
      workDate: line.workDate,
      userId: line.userId,
      userName: line.userName,
    };
  }
  return latest;
}

/**
 * @typedef {{ userId: number, userName: string, initials: string, avatarUrl: string | null,
 *   workDate: string, status: 'in_progress' | 'blocked' | 'done', title: string }} Update
 */

/**
 * The task window's Updates: the newest 10 lines the viewer may see and how many there are.
 * @param {{ viewer: object, taskId: number }} args
 * @returns {Promise<{ updates: Update[], updateCount: number }>}
 */
export async function updatesFor({ viewer, taskId }) {
  const id = toId(taskId);
  if (!viewer || !id) return { updates: [], updateCount: 0 };
  const ownOnly = ownOnlyFor(viewer);
  const [rows, counts] = await Promise.all([
    listUpdates(id, { ownOnlyFor: ownOnly }),
    countReportLines([id], { ownOnlyFor: ownOnly }),
  ]);
  const updates = rows.map((row) => ({
    userId: row.userId,
    userName: row.userName,
    initials: initials(row.userName ?? ''),
    avatarUrl: row.avatarUrl ?? null,
    workDate: row.workDate,
    status: row.status,
    title: row.title,
  }));
  return { updates, updateCount: Number(counts[0]?.total ?? 0) };
}
