// Priority task changes: create, edit, mark done / reopen and delete. Only the project's PM or
// Admin (the same rule as editing the project), each in one transaction with its audit line and
// notifications. Files and links on tasks (CONTRACT 27, 28) go through taskFiles.js in the same
// transaction; who a task can be for is assignees.js (CONTRACT 28, The assignee rule). An edit, a
// tick and a delete that lose a deadlock run again (retry.js).
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { guardPlanWrite } from '@/modules/projectPlan/migrationGuard';
import { projectFiles } from '@/modules/projectFiles';
import { assertAssignee } from './assignees';
import {
  sendAdded,
  sendChanged,
  sendFilesAdded,
  sendReassigned,
  toldEarlierOf,
  toldOf,
} from './messages';
import * as repo from './repo';
import { withDeadlockRetry } from './retry';
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
  personOf,
  teamOf,
  toId,
  toTask,
} from './shared';
import { attachToNewTask, changeFiles, checkReassignShare } from './taskFiles';

export { ASSIGNEE_MESSAGE, assertAssignee } from './assignees';

/**
 * Adds a priority task to a project, with its held uploads as its files and the picked project
 * files linked (CONTRACT 27, 28). The assignee (or, for anyone, every active member) is notified,
 * except the person adding it; the body names the uploads and the links together.
 * @param {{ user: object, projectId: number, input: { title: string, details?: string | null,
 *   priority?: 'p1'|'p2'|'p3', assigneeId?: number | null, phase?: string | null,
 *   dueDate?: string | null, uploadKeys?: string[], linkFileIds?: number[],
 *   shareConfirmed?: boolean, shareWith?: number | '' | null }, ip?: string | null }} args
 *   priority defaults to p2; assigneeId null means anyone on the project (an Admin may give it to
 *   themself on any project); phase is one of the list; dueDate is 'YYYY-MM-DD'; uploadKeys: 0 to
 *   20 of the user's held uploads for a new task; linkFileIds: 0 to 20 files of the project's Files
 *   tab; shareConfirmed with shareWith (the person the confirm named, '' for anyone) for an "Only
 *   PM and Admins" file and a person who isn't a manager
 * @returns {Promise<object>} the task (listForProject shape without latestReport) plus `told`
 *   ('person' | 'members' | null), `toldName` (the person's name, or null) and
 *   `toldEarlierName: null`
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND, VALIDATION_FAILED (title 2-200,
 *   details up to 1000, `fields.assigneeId` (The assignee rule), phase or due date not valid,
 *   `fields.uploadKeys`, `fields.linkFileIds`, `fields.shareConfirmed`), TOO_MANY_FILES (409),
 *   PROJECT_NOT_ACTIVE (completed project), PLAN_UNAVAILABLE (503, a phase or due date before
 *   migration 015), UPDATE_NEEDED (503, upload keys before migration 019, links before 020)
 */
export async function create({ user, projectId, input, ip = null }) {
  const project = await manageableProject(user, toId(projectId));
  const values = parseInput(projectTaskCreateSchema, input);
  if (project.status === 'completed') {
    throw new AppError('PROJECT_NOT_ACTIVE', {
      message: "This project is completed, so it can't get new priority tasks.",
    });
  }
  return guardPlanWrite(() =>
    db.transaction(async (trx) => {
      const team = await teamOf(project, trx, { alsoIds: [user.id, values.assigneeId] });
      assertAssignee(values.assigneeId, team, { actor: user });
      const person = await personOf(team, values.assigneeId, trx);
      const id = await insertTask({ user, project, values }, trx);
      const { uploadKeys, linkFileIds, shareConfirmed, shareWith } = values;
      const files = await attachToNewTask(
        {
          user,
          project,
          taskId: id,
          person,
          uploadKeys,
          linkFileIds,
          shareConfirmed,
          shareWith,
          ip,
        },
        trx,
      );
      const task = toTask(await repo.findWithPlan(id, trx));
      await log({ user, action: 'project_task.create', task, after: task, ip }, trx);
      const reached = await sendAdded({ task, project, ...team, actor: user, files }, trx);
      return { ...task, ...toldOf(reached, task), toldEarlierName: null };
    }),
  );
}

/** Inserts the new task's row; @returns its id. */
function insertTask({ user, project, values }, trx) {
  const at = nowDate();
  return repo.insert(
    {
      projectId: project.id,
      title: values.title,
      details: values.details,
      priority: values.priority,
      assigneeId: values.assigneeId,
      // Empty ones stay out of the insert: both default to NULL, and before migration 015 they
      // don't exist yet.
      ...(values.phase ? { phase: values.phase } : {}),
      ...(values.dueDate ? { dueDate: values.dueDate } : {}),
      status: 'open',
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: at,
      updatedAt: at,
    },
    trx,
  );
}

/** The column changes an edit makes; a new person is checked first (The assignee rule). */
function editChanges(before, values, team, actor) {
  const changes = {};
  if (values.assigneeId !== undefined && values.assigneeId !== before.assigneeId) {
    assertAssignee(values.assigneeId, team, { actor, before });
    changes.assigneeId = values.assigneeId;
  }
  for (const key of ['title', 'details', 'priority', 'phase', 'dueDate']) {
    if (values[key] !== undefined && values[key] !== before[key]) changes[key] = values[key];
  }
  return changes;
}

/**
 * Who a saved edit tells: a new priority or person on an open task sends `changed` (with the files
 * line when files were added too); files added alone send `files_added`; a new person also tells
 * the earlier one (`reassigned`, CONTRACT 28). Nothing for a done task.
 * @returns {Promise<{ reached: object[], earlier: object[] }>}
 */
async function tellAboutEdit({ before, task, changes, added, project, team, actor }, trx) {
  if (task.status !== 'open') return { reached: [], earlier: [] };
  const person = 'assigneeId' in changes;
  const sent = { project, ...team, actor, files: added };
  const reached =
    person || 'priority' in changes
      ? await sendChanged({ before, task, ...sent }, trx)
      : await sendFilesAdded({ task, ...sent }, trx);
  const earlier = person ? await sendReassigned({ before, task, project, team, actor }, trx) : [];
  return { reached, earlier };
}

/**
 * Edits a task's title, details, priority, assignee, phase or due date (only the fields sent), and
 * its files, in this order (CONTRACT 28, The assignee rule): the task row lock, the new person
 * checked, own files removed (soft delete), links removed, uploads attached, project files linked
 * (judged against the new person), the reassign share check, then the row. A new priority or
 * assignee on an open task notifies the (new) assignee, or every active member when it is for
 * anyone, and a new person tells the earlier one; files added without such a change send
 * `files_added`. Keeping a removed member as the assignee is allowed; picking one is not. Assign
 * to me is `{ assigneeId: <the user's id> }`.
 * @param {{ user: object, id: number, input: object, ip?: string | null }} args input as
 *   projectTaskUpdateSchema (also addLinkFileIds, removeLinkFileIds, shareConfirmed, shareWith)
 * @returns {Promise<object>} the task plus `told`, `toldName` (as create) and `toldEarlierName`
 *   (the earlier person's name when `reassigned` reached them, else null)
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED (also `fields.assigneeId`, `fields.uploadKeys`,
 *   `fields.removeFileIds`, `fields.linkFileIds`, `fields.shareConfirmed`), TOO_MANY_FILES (409,
 *   past 20 files), PLAN_UNAVAILABLE (503, a phase or due date before migration 015),
 *   UPDATE_NEEDED (503, file changes before migration 019, links before 020), CONFLICT (409, a
 *   deadlock after 3 tries)
 */
export async function update({ user, id, input, ip = null }) {
  if (!can(user, 'project.manage')) throw forbidden();
  const { shareConfirmed, shareWith, ...edit } = parseInput(projectTaskUpdateSchema, input);
  const { addUploadKeys, removeFileIds, addLinkFileIds, removeLinkFileIds, ...values } = edit;
  const fileChanges = { addUploadKeys, removeFileIds, addLinkFileIds, removeLinkFileIds };
  return guardPlanWrite(() =>
    withDeadlockRetry(async (trx) => {
      const { project, before } = await lockForManage(user, id, trx);
      const alsoIds = [user.id, before.assigneeId, values.assigneeId];
      const team = await teamOf(project, trx, { alsoIds });
      const changes = editChanges(before, values, team, user);
      const newPerson = 'assigneeId' in changes ? changes.assigneeId : before.assigneeId;
      const person = await personOf(team, newPerson, trx);
      const files = await changeFiles(
        { user, project, task: before, person, ...fileChanges, shareConfirmed, shareWith, ip },
        trx,
      );
      if ('assigneeId' in changes) {
        const reassign = [{ taskId: before.id, person }];
        await checkReassignShare({ project, changes: reassign, shareConfirmed, shareWith }, trx);
      }
      const fieldsChanged = Object.keys(changes).length > 0;
      const filesChanged = files.added.length + files.removed.length + files.unlinked.length > 0;
      if (!fieldsChanged && !filesChanged) {
        return { ...before, ...toldOf([], before), toldEarlierName: null };
      }
      let task = before;
      if (fieldsChanged) {
        await repo.update(before.id, { ...changes, updatedBy: user.id, updatedAt: nowDate() }, trx);
        task = toTask(await repo.findWithPlan(before.id, trx));
        await log({ user, action: 'project_task.update', task, before, after: task, ip }, trx);
      }
      const { added } = files;
      const { reached, earlier } = await tellAboutEdit(
        { before, task, changes, added, project, team, actor: user },
        trx,
      );
      return { ...task, ...toldOf(reached, task), toldEarlierName: toldEarlierOf(earlier) };
    }),
  );
}

/**
 * Marks a task done or reopens it. Setting the status it already has changes nothing.
 * @param {{ user: object, id: number, status: 'open'|'done', ip?: string | null }} args
 * @returns {Promise<object>} the task
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, CONFLICT (409, a deadlock after 3 tries)
 */
export async function setStatus({ user, id, status, ip = null }) {
  if (!can(user, 'project.manage')) throw forbidden();
  const values = parseInput(projectTaskStatusSchema, { status });
  return withDeadlockRetry(async (trx) => {
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
 * @throws FORBIDDEN, NOT_FOUND, CONFLICT (409, a deadlock after 3 tries)
 */
export async function remove({ user, id, ip = null }) {
  return withDeadlockRetry(async (trx) => {
    const { before } = await lockForManage(user, id, trx);
    // Its files are marked deleted first (purged at night); 0 and no write before migration 019.
    await projectFiles.deleteFilesOfTask({ user, taskId: before.id }, trx);
    await repo.remove(before.id, trx);
    await log({ user, action: 'project_task.delete', task: before, before, ip }, trx);
    return { id: before.id, deleted: true };
  });
}
