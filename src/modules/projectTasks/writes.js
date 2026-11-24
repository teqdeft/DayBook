// Priority task changes: create, edit, mark done / reopen and delete. Only the project's PM or
// Admin (the same rule as editing the project), each in one transaction with its audit line and
// notifications. Files on tasks (CONTRACT 27) go through taskFiles.js in the same transaction.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { guardPlanWrite } from '@/modules/projectPlan/migrationGuard';
import { projectFiles } from '@/modules/projectFiles';
import { sendAdded, sendChanged, sendFilesAdded, toldOf } from './messages';
import * as repo from './repo';
import {
  projectTaskCreateSchema,
  projectTaskStatusSchema,
  projectTaskUpdateSchema,
} from './schemas';
import {
  forbidden,
  lockForManage,
  logTask as log,
  manageableProject,
  parseInput,
  teamOf,
  toId,
  toTask,
} from './shared';
import { attachToNewTask, changeFiles } from './taskFiles';

const ASSIGNEE_MESSAGE = 'Pick someone who is on this project, or anyone on the project.';

/** @throws VALIDATION_FAILED unless the person is an active member or the project's PM. */
function assertAssignee(assigneeId, { members, manager }) {
  if (assigneeId === null) return;
  const person =
    manager?.id === assigneeId ? manager : members.find((row) => row.id === assigneeId);
  if (!person || person.status !== 'active') {
    throw validationError({ assigneeId: ASSIGNEE_MESSAGE }, ASSIGNEE_MESSAGE);
  }
}

/**
 * Adds a priority task to a project, with its held uploads as its files (CONTRACT 27). The assignee
 * (or, for anyone, every active member) is notified, except the person adding it; the body names
 * the files.
 * @param {{ user: object, projectId: number, input: { title: string, details?: string | null,
 *   priority?: 'p1'|'p2'|'p3', assigneeId?: number | null, phase?: string | null,
 *   dueDate?: string | null, uploadKeys?: string[] }, ip?: string | null }} args priority
 *   defaults to p2; assigneeId null means anyone on the project; phase is one of the list; dueDate
 *   is 'YYYY-MM-DD'; uploadKeys: 0 to 20 of the user's held uploads for a new task
 * @returns {Promise<object>} the task (listForProject shape without latestReport) plus `told`
 *   ('person' | 'members' | null) and `toldName` (the person's name, or null)
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND, VALIDATION_FAILED (title 2-200,
 *   details up to 1000, assignee not an active member or the PM, phase or due date not valid,
 *   `fields.uploadKeys`), PROJECT_NOT_ACTIVE (completed project), PLAN_UNAVAILABLE (503, a phase
 *   or due date before migration 015), UPDATE_NEEDED (503, upload keys before migration 019)
 */
export async function create({ user, projectId, input, ip = null }) {
  const project = await manageableProject(user, toId(projectId));
  const values = parseInput(projectTaskCreateSchema, input);
  if (project.status === 'completed') {
    throw new AppError('PROJECT_NOT_ACTIVE', {
      message: "This project is completed, so it can't get new priority tasks.",
    });
  }
  // Empty ones stay out of the insert: both default to NULL, and before migration 015 they don't
  // exist yet.
  const plan = {
    ...(values.phase ? { phase: values.phase } : {}),
    ...(values.dueDate ? { dueDate: values.dueDate } : {}),
  };
  return guardPlanWrite(() =>
    db.transaction(async (trx) => {
      const team = await teamOf(project, trx);
      assertAssignee(values.assigneeId, team);
      const at = nowDate();
      const id = await repo.insert(
        {
          projectId: project.id,
          title: values.title,
          details: values.details,
          priority: values.priority,
          assigneeId: values.assigneeId,
          ...plan,
          status: 'open',
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: at,
          updatedAt: at,
        },
        trx,
      );
      const { uploadKeys } = values;
      const files = await attachToNewTask(
        { user, projectId: project.id, taskId: id, uploadKeys, ip },
        trx,
      );
      const task = toTask(await repo.findWithPlan(id, trx));
      await log({ user, action: 'project_task.create', task, after: task, ip }, trx);
      const reached = await sendAdded({ task, project, ...team, actor: user, files }, trx);
      return { ...task, ...toldOf(reached, task) };
    }),
  );
}

/** The column changes an edit makes. */
function editChanges(before, values, team) {
  const changes = {};
  for (const key of ['title', 'details', 'priority', 'phase', 'dueDate']) {
    if (values[key] !== undefined && values[key] !== before[key]) changes[key] = values[key];
  }
  if (values.assigneeId !== undefined && values.assigneeId !== before.assigneeId) {
    assertAssignee(values.assigneeId, team);
    changes.assigneeId = values.assigneeId;
  }
  return changes;
}

/**
 * Who a saved edit tells: a new priority or person on an open task sends `changed` (with the files
 * line when files were added too); files added alone send `files_added`. Nothing for a done task.
 */
function tellAboutEdit({ before, task, changes, added, project, team, actor }, trx) {
  if (task.status !== 'open') return [];
  if ('priority' in changes || 'assigneeId' in changes) {
    return sendChanged({ before, task, project, ...team, actor, files: added }, trx);
  }
  return sendFilesAdded({ task, project, ...team, actor, files: added }, trx);
}

/**
 * Edits a task's title, details, priority, assignee, phase or due date (only the fields sent), and
 * its files: `removeFileIds` are removed first (soft delete), then `addUploadKeys` are attached
 * (CONTRACT 27). A new priority or assignee on an open task notifies the (new) assignee, or every
 * active member when it is for anyone; files added without such a change send `files_added`.
 * Keeping a removed member as the assignee is allowed; picking one is not.
 * @param {{ user: object, id: number, input: object, ip?: string | null }} args input as
 *   projectTaskUpdateSchema
 * @returns {Promise<object>} the task plus `told` and `toldName` (as create)
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED (also `fields.uploadKeys` and
 *   `fields.removeFileIds`), TOO_MANY_FILES (409, past 20 files), PLAN_UNAVAILABLE (503, a phase
 *   or due date before migration 015), UPDATE_NEEDED (503, file changes before migration 019)
 */
export async function update({ user, id, input, ip = null }) {
  if (!can(user, 'project.manage')) throw forbidden();
  const { addUploadKeys, removeFileIds, ...values } = parseInput(projectTaskUpdateSchema, input);
  return guardPlanWrite(() =>
    db.transaction(async (trx) => {
      const { project, before } = await lockForManage(user, id, trx);
      const files = await changeFiles(
        { user, task: before, addUploadKeys, removeFileIds, ip },
        trx,
      );
      const team = await teamOf(project, trx);
      const changes = editChanges(before, values, team);
      const fieldsChanged = Object.keys(changes).length > 0;
      if (!fieldsChanged && files.added.length === 0 && files.removed.length === 0) {
        return { ...before, ...toldOf([], before) };
      }
      let task = before;
      if (fieldsChanged) {
        await repo.update(before.id, { ...changes, updatedBy: user.id, updatedAt: nowDate() }, trx);
        task = toTask(await repo.findWithPlan(before.id, trx));
        await log({ user, action: 'project_task.update', task, before, after: task, ip }, trx);
      }
      const { added } = files;
      const reached = await tellAboutEdit(
        { before, task, changes, added, project, team, actor: user },
        trx,
      );
      return { ...task, ...toldOf(reached, task) };
    }),
  );
}

/**
 * Marks a task done or reopens it. Setting the status it already has changes nothing.
 * @param {{ user: object, id: number, status: 'open'|'done', ip?: string | null }} args
 * @returns {Promise<object>} the task
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED
 */
export async function setStatus({ user, id, status, ip = null }) {
  if (!can(user, 'project.manage')) throw forbidden();
  const values = parseInput(projectTaskStatusSchema, { status });
  return db.transaction(async (trx) => {
    const { before } = await lockForManage(user, id, trx);
    if (before.status === values.status) return before;
    const at = nowDate();
    const done = values.status === 'done';
    await repo.update(
      before.id,
      {
        status: values.status,
        doneAt: done ? at : null,
        doneBy: done ? user.id : null,
        updatedBy: user.id,
        updatedAt: at,
      },
      trx,
    );
    const task = toTask(await repo.findWithPlan(before.id, trx));
    const action = done ? 'project_task.done' : 'project_task.reopen';
    await log({ user, action, task, before, after: task, ip }, trx);
    return task;
  });
}

/**
 * Deletes a task and its files (marked deleted in the same transaction, CONTRACT 27). Report lines
 * linked to it keep their text and lose the link (ON DELETE SET NULL).
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<{ id: number, deleted: true }>}
 * @throws FORBIDDEN, NOT_FOUND
 */
export async function remove({ user, id, ip = null }) {
  return db.transaction(async (trx) => {
    const { before } = await lockForManage(user, id, trx);
    // Its files are marked deleted first (purged at night); 0 and no write before migration 019.
    await projectFiles.deleteFilesOfTask({ user, taskId: before.id }, trx);
    await repo.remove(before.id, trx);
    await log({ user, action: 'project_task.delete', task: before, before, ip }, trx);
    return { id: before.id, deleted: true };
  });
}
