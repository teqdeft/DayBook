// Helpers shared by the projectTasks service files: row mapping, input parsing and errors.
import { AppError, validationError } from '@/lib/errors';
import { initials } from '@/lib/text';

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
