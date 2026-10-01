// Priority task links on task lines (CONTRACT section 13): a line may say which of its project's
// priority tasks it worked on. Every save checks the links through the projectTasks service.
import { AppError } from '@/lib/errors';
import { projectTasks } from '@/modules/projectTasks';
import * as repo from './repo';

const MESSAGES = {
  request: 'Priority tasks can be linked once the project is approved.',
  missing: 'That priority task was deleted. Unlink it to save this line.',
  otherProject: 'That priority task belongs to another project.',
  done: 'That priority task is already done. Pick an open one.',
};

/** What is wrong with one link, or null when it can be saved. */
function linkProblem({ entry, priorityTask, alreadyLinked }) {
  if (!entry.projectId) return MESSAGES.request;
  if (!priorityTask) return MESSAGES.missing;
  if (Number(priorityTask.projectId) !== Number(entry.projectId)) return MESSAGES.otherProject;
  if (priorityTask.status !== 'open' && !alreadyLinked) return MESSAGES.done;
  return null;
}

/**
 * Checks the priority task links of the task lines a save sends. A link must point at an open
 * priority task of the entry's project. A line keeps the task it is already linked to after that
 * task is marked done (a carried-over line, a report reopened by an edit request), as long as
 * the entry is still on that task's project. Reads every linked task in one query; inside the
 * save's transaction (`trx`) those rows stay share-locked until it ends, so a task deleted or
 * marked done at the same moment can't slip in between the check and the write.
 * @param {{ reportId: number | null, entries: Array<{ projectId?: number,
 *   projectRequestId?: number, tasks: Array<{ id?: number, projectTaskId?: number }> }> }} input
 *   entries as saveReportSchema parsed them
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<void>}
 * @throws VALIDATION_FAILED with a field error on entries.N.tasks.M.projectTaskId
 */
export async function checkPriorityLinks({ reportId, entries }, trx) {
  const ids = entries.flatMap((entry) =>
    entry.tasks.map((task) => Number(task.projectTaskId)).filter(Boolean),
  );
  if (ids.length === 0) return;
  const [stored, found] = await Promise.all([
    reportId ? repo.listTaskLinks(reportId, trx) : [],
    projectTasks.findByIds(ids, { trx, lock: Boolean(trx) }),
  ]);
  const linked = new Map(stored.map((row) => [Number(row.id), Number(row.projectTaskId)]));
  const fields = {};
  for (const [i, entry] of entries.entries()) {
    for (const [j, task] of entry.tasks.entries()) {
      const id = Number(task.projectTaskId);
      if (!id) continue;
      const problem = linkProblem({
        entry,
        priorityTask: found.get(id) ?? null,
        alreadyLinked: Boolean(task.id) && linked.get(Number(task.id)) === id,
      });
      if (problem) fields[`entries.${i}.tasks.${j}.projectTaskId`] = problem;
    }
  }
  const messages = Object.values(fields);
  if (messages.length) throw new AppError('VALIDATION_FAILED', { message: messages[0], fields });
}

/**
 * The priority task each linked task line of a project's submitted reports points at, between
 * two dates (the project report's Priority column).
 * @param {{ projectId: number, from: string, to: string }} input
 * @returns {Promise<Record<number, { projectTaskId: number, priority: 'p1'|'p2'|'p3',
 *   title: string }>>} report task id -> its priority task
 */
export async function getPriorityLinks({ projectId, from, to }) {
  const rows = await repo.listPriorityLinks(projectId, from, to);
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      { projectTaskId: Number(row.projectTaskId), priority: row.priority, title: row.title },
    ]),
  );
}
