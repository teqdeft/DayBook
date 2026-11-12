// Priority task changes: create, edit, mark done / reopen and delete. Only the project's PM or
// Admin (the same rule as editing the project), each in one transaction with its audit line and
// notifications.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { guardPlanWrite } from '@/modules/projectPlan/migrationGuard';
import { projects } from '@/modules/projects';
import { sendAdded, sendChanged } from './messages';
import * as repo from './repo';
import {
  projectTaskCreateSchema,
  projectTaskStatusSchema,
  projectTaskUpdateSchema,
} from './schemas';
import {
  forbidden,
  parseInput,
  projectNotFound,
  snapshot,
  taskNotFound,
  toId,
  toTask,
} from './shared';

const ASSIGNEE_MESSAGE = 'Pick someone who is on this project, or anyone on the project.';

/** The project, when the user may manage it. @throws NOT_FOUND, FORBIDDEN */
async function manageableProject(user, projectId) {
  if (!can(user, 'project.manage')) throw forbidden();
  const project = await projects.findById(projectId);
  if (!project) throw projectNotFound();
  if (!projects.canManage(user, project)) throw forbidden();
  return project;
}

/** Locks the task and checks the user may manage its project. */
async function lockForManage(user, id, trx) {
  if (!can(user, 'project.manage')) throw forbidden();
  const taskId = toId(id);
  const locked = taskId ? await repo.lockById(taskId, trx) : null;
  if (!locked) throw taskNotFound();
  const project = await manageableProject(user, locked.projectId);
  return { project, before: toTask(await repo.findWithPlan(taskId, trx)) };
}

/**
 * The project's members, and its PM when they aren't one of them: a task can be for the PM, but
 * tasks for anyone only reach members.
 */
async function teamOf(project, trx) {
  const members = await repo.listProjectMembers(project.id, trx);
  const isMember = members.some((member) => member.id === project.pmId);
  const manager = isMember ? null : await repo.findPerson(project.pmId, trx);
  return { members, manager: manager ?? null };
}

/** @throws VALIDATION_FAILED unless the person is an active member or the project's PM. */
function assertAssignee(assigneeId, { members, manager }) {
  if (assigneeId === null) return;
  const person =
    manager?.id === assigneeId ? manager : members.find((row) => row.id === assigneeId);
  if (!person || person.status !== 'active') {
    throw validationError({ assigneeId: ASSIGNEE_MESSAGE }, ASSIGNEE_MESSAGE);
  }
}

async function log({ user, action, task, before, after, ip }, trx) {
  await audit.log(
    {
      actorId: user.id,
      action,
      entityType: 'project_task',
      entityId: task.id,
      before: before ? snapshot(before) : null,
      after: after ? { projectId: task.projectId, ...snapshot(after) } : null,
      ip,
    },
    trx,
  );
}

/**
 * Adds a priority task to a project. The assignee (or, for anyone, every active member) is
 * notified, except the person adding it.
 * @param {{ user: object, projectId: number, input: { title: string, details?: string | null,
 *   priority?: 'p1'|'p2'|'p3', assigneeId?: number | null, phase?: string | null,
 *   dueDate?: string | null }, ip?: string | null }} args priority defaults to p2; assigneeId null
 *   means anyone on the project; phase is one of the list; dueDate is 'YYYY-MM-DD'
 * @returns {Promise<object>} the task (listForProject shape without latestReport)
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND, VALIDATION_FAILED (title 2-200,
 *   details up to 1000, assignee not an active member or the PM, phase or due date not valid),
 *   PROJECT_NOT_ACTIVE (completed project), PLAN_UNAVAILABLE (503, a phase or due date before
 *   migration 015)
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
      const task = toTask(await repo.findWithPlan(id, trx));
      await log({ user, action: 'project_task.create', task, after: task, ip }, trx);
      await sendAdded({ task, project, ...team, actor: user }, trx);
      return task;
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
 * Edits a task's title, details, priority, assignee, phase or due date (only the fields sent). A
 * new priority or assignee on an open task notifies the (new) assignee, or every active member when
 * it is for anyone. Keeping a removed member as the assignee is allowed; picking one is not.
 * @param {{ user: object, id: number, input: object, ip?: string | null }} args input as
 *   projectTaskUpdateSchema
 * @returns {Promise<object>} the task
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, PLAN_UNAVAILABLE (503, a phase or due date
 *   before migration 015)
 */
export async function update({ user, id, input, ip = null }) {
  if (!can(user, 'project.manage')) throw forbidden();
  const values = parseInput(projectTaskUpdateSchema, input);
  return guardPlanWrite(() =>
    db.transaction(async (trx) => {
      const { project, before } = await lockForManage(user, id, trx);
      const team = await teamOf(project, trx);
      const changes = editChanges(before, values, team);
      if (Object.keys(changes).length === 0) return before;
      await repo.update(before.id, { ...changes, updatedBy: user.id, updatedAt: nowDate() }, trx);
      const task = toTask(await repo.findWithPlan(before.id, trx));
      await log({ user, action: 'project_task.update', task, before, after: task, ip }, trx);
      if (task.status === 'open' && ('priority' in changes || 'assigneeId' in changes)) {
        await sendChanged({ before, task, project, ...team, actor: user }, trx);
      }
      return task;
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
 * Deletes a task. Report lines linked to it keep their text and lose the link (ON DELETE SET
 * NULL).
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<{ id: number, deleted: true }>}
 * @throws FORBIDDEN, NOT_FOUND
 */
export async function remove({ user, id, ip = null }) {
  return db.transaction(async (trx) => {
    const { before } = await lockForManage(user, id, trx);
    await repo.remove(before.id, trx);
    await log({ user, action: 'project_task.delete', task: before, before, ip }, trx);
    return { id: before.id, deleted: true };
  });
}
