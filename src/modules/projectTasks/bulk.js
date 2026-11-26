// Bulk actions in the Table (CONTRACT 28, Bulk actions in the Table): `POST
// /api/projects/[id]/tasks/bulk` gives 1 to 100 tasks to one person (or back to each earlier one,
// an Undo) or moves them to a phase, in one transaction, all or nothing. The task rows are locked
// in ascending id order by the primary key alone, so two saves over the same tasks wait instead of
// deadlocking, and a tick of one of them (it holds the row, then changes the row's entry in
// `(project_id, status, priority)`) goes first; a deadlock that still happens is retried up to 3
// times (retry.js). Each change follows the single PATCH's rules; one notification per person per
// kind (bulkMessages.js); moves never notify.
import { AppError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import { guardPlanWrite } from '@/modules/projectPlan/migrationGuard';
import { assertAssignee } from './assignees';
import { sendBulkChanged, sendBulkReassigned } from './bulkMessages';
import * as repo from './repo';
import { withDeadlockRetry } from './retry';
import { projectTaskBulkSchema } from './schemas';
import { logTask, manageableProject, parseInput, personOf, teamOf, toId, toTask } from './shared';
import { checkReassignShare } from './taskFiles';

function notOnProject() {
  return new AppError('NOT_FOUND', {
    message: "A task you picked was deleted or isn't on this project. Nothing was changed.",
  });
}

/**
 * Locks the tasks in ascending id order and reads them with their plan columns. The hint (the same
 * on MySQL and MariaDB) keeps the lock on the rows themselves: left to choose, the optimizer may
 * read them through `(project_id, status, priority)` and lock entries a tick needs.
 * @returns {Promise<Map<number, object>>} the tasks by id
 * @throws NOT_FOUND when any id is missing or on another project
 */
async function lockTasks(projectId, ids, trx) {
  const sorted = [...ids].sort((a, b) => a - b);
  const locked = await trx(trx.raw('?? FORCE INDEX (PRIMARY)', ['projectTasks']))
    .whereIn('id', sorted)
    .orderBy('id')
    .forUpdate()
    .select('id', 'projectId');
  const here = locked.filter((row) => Number(row.projectId) === Number(projectId));
  if (here.length !== sorted.length) throw notOnProject();
  return readTasks(sorted, trx);
}

/** The tasks by id, with their people and plan columns. */
async function readTasks(ids, trx) {
  const rows = await repo.withPlanColumns(
    repo.taskQuery(trx).whereIn('pt.id', ids).orderBy('pt.id'),
  );
  return new Map(rows.map((row) => [Number(row.id), toTask(row)]));
}

/** The changes that change something, each with its task before; a new person checked first. */
function realChanges(changes, tasks, team, actor) {
  const real = [];
  for (const change of changes) {
    const before = tasks.get(change.id);
    if (Object.hasOwn(change, 'assigneeId')) {
      if (change.assigneeId === before.assigneeId) continue; // already theirs: skipped silently
      assertAssignee(change.assigneeId, team, { actor, before });
      real.push({ before, key: 'assigneeId', value: change.assigneeId });
    } else if (change.phase !== (before.phase ?? null)) {
      real.push({ before, key: 'phase', value: change.phase });
    }
  }
  return real;
}

/**
 * Writes each change by its task's id: one UPDATE of many of the table's rows may scan the whole
 * table and lock the tasks of every project.
 */
async function writeChanges(real, user, trx) {
  const at = nowDate();
  for (const { before, key, value } of real) {
    const changes = { [key]: value ?? null, updatedBy: user.id, updatedAt: at };
    await repo.update(before.id, changes, trx);
  }
}

/** The grouped sends of a person change, and who they reached. */
async function tellPeople({ pairs, project, team, actor }, trx) {
  const changed = await sendBulkChanged({ changes: pairs, project, team, actor }, trx);
  const earlier = await sendBulkReassigned({ changes: pairs, project, team, actor }, trx);
  const names = [...changed.people, ...earlier].map((person) => person.name);
  return { people: [...new Set(names)], members: changed.members };
}

/**
 * @param {{ user: object, projectId: number,
 *   changes: Array<{ id: number, assigneeId: number | null } | { id: number,
 *     phase: string | null }>, shareConfirmed?: boolean, ip?: string | null }} args 1 to 100
 *   changes of one kind, each task once; assigneeId '' or null = anyone on the project; phase one
 *   of PHASE_KEYS or null (No phase yet, an Undo)
 * @returns {Promise<{ tasks: Array<{ id: number, assigneeId: number | null,
 *   phase: string | null }>, changed: number,
 *   told: { people: string[], members: boolean } }>} tasks: only the tasks this save changed (a
 *   change to what a task already has is skipped); told: the names the sends reached, and
 *   whether members were told about tasks now for anyone
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND (the project; a task deleted or on
 *   another project), VALIDATION_FAILED (the schema's messages, `fields.assigneeId` (The assignee
 *   rule), `fields.shareConfirmed` "A task you picked has a file only for PM and Admins. Confirm to
 *   share it with the new person."), CONFLICT (409, a deadlock after 3 tries), PLAN_UNAVAILABLE
 *   (503, a phase before migration 015)
 */
export async function bulkUpdate({ user, projectId, changes, shareConfirmed = false, ip = null }) {
  const project = await manageableProject(user, toId(projectId));
  const values = parseInput(projectTaskBulkSchema, { changes, shareConfirmed });
  const ids = values.changes.map((change) => change.id);
  return guardPlanWrite(() =>
    withDeadlockRetry(async (trx) => {
      const tasks = await lockTasks(project.id, ids, trx);
      const people = values.changes.map((change) => change.assigneeId);
      const current = [...tasks.values()].map((task) => task.assigneeId);
      const team = await teamOf(project, trx, { alsoIds: [user.id, ...current, ...people] });
      const real = realChanges(values.changes, tasks, team, user);
      const empty = { tasks: [], changed: 0, told: { people: [], members: false } };
      if (real.length === 0) return empty;
      const personChange = real[0].key === 'assigneeId';
      if (personChange) {
        const reassign = [];
        for (const { before, value } of real) {
          reassign.push({ taskId: before.id, person: await personOf(team, value, trx) });
        }
        const confirmed = values.shareConfirmed;
        await checkReassignShare(
          { project, changes: reassign, shareConfirmed: confirmed, bulk: true },
          trx,
        );
      }
      await writeChanges(real, user, trx);
      const after = await readTasks(
        real.map(({ before }) => before.id),
        trx,
      );
      const pairs = real.map(({ before }) => ({ before, task: after.get(before.id) }));
      for (const { before, task } of pairs) {
        await logTask({ user, action: 'project_task.update', task, before, after: task, ip }, trx);
      }
      const told = personChange
        ? await tellPeople({ pairs, project, team, actor: user }, trx)
        : empty.told;
      const changedTasks = pairs.map(({ task }) => ({
        id: task.id,
        assigneeId: task.assigneeId,
        phase: task.phase ?? null,
      }));
      return { tasks: changedTasks, changed: changedTasks.length, told };
    }),
  );
}
