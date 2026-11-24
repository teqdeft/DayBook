// Helpers shared by the projectTasks service files: row mapping, input parsing, errors, the latest
// report line, and the manage checks and audit line every write uses (writes.js, taskFiles.js).
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { initials } from '@/lib/text';
import { audit } from '@/modules/audit';
import { projects } from '@/modules/projects';
import * as repo from './repo';

export const PRIORITY_LABELS = { p1: 'P1', p2: 'P2', p3: 'P3' };

export function taskNotFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that priority task." });
}

export function projectNotFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that project." });
}

export function forbidden() {
  return new AppError('FORBIDDEN', {
    message: 'Only the project manager or Admin can change priority tasks.',
  });
}

/** A project_tasks row (joined with people) as the contract's task, without latestReport. */
export function toTask(row) {
  if (!row) return null;
  const assignee = row.assigneeId
    ? {
        id: row.assigneeId,
        name: row.assigneeName,
        initials: initials(row.assigneeName ?? ''),
        role: row.assigneeRole ?? null,
        status: row.assigneeStatus ?? null,
        avatarUrl: row.assigneeAvatarUrl ?? null,
        isMember: Number(row.assigneeIsMember ?? 1) === 1,
      }
    : null;
  const task = {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    details: row.details ?? null,
    priority: row.priority,
    status: row.status,
    assigneeId: row.assigneeId ?? null,
    assignee,
    createdBy: row.createdBy,
    createdByName: row.createdByName ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    doneAt: row.doneAt ?? null,
    doneBy: row.doneBy ?? null,
    doneByName: row.doneByName ?? null,
  };
  // Only the reads that ask for them have these (migration 015; repo.js, PLAN_COLUMNS).
  if (row.phase !== undefined) {
    task.phase = row.phase;
    task.dueDate = row.dueDate;
  }
  if (row.projectName !== undefined) {
    task.project = {
      id: row.projectId,
      name: row.projectName,
      color: row.projectColor,
      isUrgent: Boolean(row.projectIsUrgent),
    };
  }
  return task;
}

/** What the audit log keeps of a task. */
export function snapshot(task) {
  return {
    title: task.title,
    details: task.details,
    priority: task.priority,
    assigneeId: task.assigneeId,
    status: task.status,
    phase: task.phase ?? null,
    dueDate: task.dueDate ?? null,
  };
}

/**
 * Validates service input with a zod schema (routes validate too; services are also called from
 * tests and other modules).
 * @throws VALIDATION_FAILED with a fields map
 */
export function parseInput(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

/** A positive whole id, or null. */
export function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Adds `latestReport` ({ status, userId, userName, workDate } | null) to each task. With
 * `ownOnlyFor` (a viewer who can't see everyone's reports), a line someone else reported is left
 * out: employees see their own report data only.
 */
export async function withLatestReports(tasks, { ownOnlyFor = null } = {}) {
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

// ---------- the writes' checks (the project's PM or Admin) ----------

/** The project, when the user may manage it. @throws NOT_FOUND, FORBIDDEN */
export async function manageableProject(user, projectId) {
  if (!can(user, 'project.manage')) throw forbidden();
  const project = await projects.findById(projectId);
  if (!project) throw projectNotFound();
  if (!projects.canManage(user, project)) throw forbidden();
  return project;
}

/**
 * Locks the task row (always the first lock of a task write: the task row, then upload rows, then
 * file rows, CONTRACT 27) and checks the user may manage its project.
 * @returns {Promise<{ project: object, before: object }>} before: the task with its plan columns
 * @throws FORBIDDEN, NOT_FOUND
 */
export async function lockForManage(user, id, trx) {
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
export async function teamOf(project, trx) {
  const members = await repo.listProjectMembers(project.id, trx);
  const isMember = members.some((member) => member.id === project.pmId);
  const manager = isMember ? null : await repo.findPerson(project.pmId, trx);
  return { members, manager: manager ?? null };
}

/** One project_task audit line, in the write's transaction. */
export async function logTask({ user, action, task, before, after, ip }, trx) {
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
