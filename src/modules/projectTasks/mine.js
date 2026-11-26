// My tasks (CONTRACT 28, My tasks and the badge): the open tasks whose person is the viewer, on the
// Active and On hold projects they are a member of or manage (its PM, or any project for an
// Admin), for the /my-tasks page, the home cards and the sidebar badge. PMs and Admins only
// (project.manage); everyone else keeps Today's Priority tasks card and gets nothing here. Its own
// queries (repo.js is at its size cap), on the (assignee_id, status) index.
import { db } from '@/lib/db';
import { can } from '@/lib/permissions';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';
import { projects } from '@/modules/projects';
import { ORDER } from './repo';

/** The most rows listMine gives (`more` says when there were others). */
export const MINE_LIMIT = 200;

/**
 * @typedef {{ id: number, projectId: number, title: string, priority: 'p1' | 'p2' | 'p3',
 *   status: 'open', assigneeId: number, phase: string | null, dueDate: string | null,
 *   project: { id: number, name: string, color: string, status: 'active' | 'on_hold' },
 *   canManage: boolean }} MineTask
 */

/** The viewer's id when My tasks is theirs (an active PM or Admin), else null. */
function mineFor(viewer) {
  if (!viewer || (viewer.status && viewer.status !== 'active')) return null;
  if (!can(viewer, 'project.manage')) return null;
  const id = Number(viewer.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The viewer's open tasks on Active and On hold projects they are on or manage. */
function mineQuery(viewer, userId, trx = db) {
  const query = trx('projectTasks as pt')
    .join('projects as p', 'p.id', 'pt.projectId')
    .where('pt.assigneeId', userId)
    .where('pt.status', 'open')
    .whereIn('p.status', ['active', 'on_hold']);
  if (viewer.role === 'admin') return query; // an Admin manages every project
  return query.where((on) =>
    on
      .where('p.pmId', userId)
      .orWhereExists(
        trx('projectMembers as m')
          .select(trx.raw('1'))
          .whereRaw('m.project_id = pt.project_id')
          .where('m.userId', userId),
      ),
  );
}

const COLUMNS = [
  'pt.id',
  'pt.projectId',
  'pt.title',
  'pt.priority',
  'pt.status',
  'pt.assigneeId',
  'pt.createdAt',
  'p.name as projectName',
  'p.color as projectColor',
  'p.status as projectStatus',
  'p.pmId as projectPmId',
];

/** The rows by due date (none last), then P1 to P3, then oldest; no dates before migration 015. */
function listRows(viewer, userId, limit) {
  const base = () => mineQuery(viewer, userId).select(COLUMNS).limit(limit);
  return guardPlanRead(
    () =>
      base()
        .select('pt.phase', 'pt.dueDate')
        .orderByRaw('pt.due_date IS NULL')
        .orderBy('pt.dueDate', 'asc')
        .orderBy(ORDER),
    async () =>
      (await base().orderBy(ORDER)).map((row) => ({ ...row, phase: null, dueDate: null })),
  );
}

/** A row as a MineTask. */
function toMineTask(viewer, row) {
  const project = { id: row.projectId, pmId: row.projectPmId };
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    priority: row.priority,
    status: row.status,
    assigneeId: row.assigneeId,
    phase: row.phase ?? null,
    dueDate: row.dueDate ?? null,
    project: {
      id: row.projectId,
      name: row.projectName,
      color: row.projectColor,
      status: row.projectStatus,
    },
    canManage: projects.canManage(viewer, project),
  };
}

/**
 * The viewer's open tasks, by due date (none last), then P1 to P3, then oldest first.
 * @param {{ viewer: object, today?: string, limit?: number }} args today: 'YYYY-MM-DD', the
 *   company's date (the grouping is the browser's, `myTasksView.whenOf`); limit 1 to 200
 * @returns {Promise<{ tasks: MineTask[], more: boolean }>} more: there were over `limit`;
 *   nothing for anyone but an active PM or Admin
 */
export async function listMine({ viewer, today, limit = MINE_LIMIT }) {
  const userId = mineFor(viewer);
  if (!userId) return { tasks: [], more: false };
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || MINE_LIMIT, 1), MINE_LIMIT);
  const rows = await listRows(viewer, userId, size + 1);
  return {
    tasks: rows.slice(0, size).map((row) => toMineTask(viewer, row)),
    more: rows.length > size,
  };
}

/**
 * The same tasks due today or before (overdue plus due today): the sidebar badge. One indexed
 * count; 0 before migration 015 (no due dates yet).
 * @param {{ viewer: object, today: string }} args today: 'YYYY-MM-DD', the company's date
 * @returns {Promise<number>} 0 for anyone but an active PM or Admin
 */
export async function countMineDue({ viewer, today }) {
  const userId = mineFor(viewer);
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(String(today ?? ''))) return 0;
  return guardPlanRead(
    async () => {
      const row = await mineQuery(viewer, userId)
        .where('pt.dueDate', '<=', today)
        .count({ total: '*' })
        .first();
      return Number(row?.total ?? 0);
    },
    () => 0,
  );
}
