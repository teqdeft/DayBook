// Helpers shared by the projectSummaries service files: who may do what, input parsing and the error
// a write answers before migration 015. Everything in this module is only for people who can manage
// the project: reads answer NOT_FOUND to anyone else, writes FORBIDDEN.
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { guardPlanWrite } from '@/modules/projectPlan/migrationGuard';
import { projects } from '@/modules/projects';

export function projectNotFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that project." });
}

export function documentNotFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that file or note." });
}

export function forbidden() {
  return new AppError('FORBIDDEN', {
    message: 'Only the project manager or Admin can change files, notes and summaries.',
  });
}

/** A positive whole id, or null. */
export function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Validates service input with a zod schema. @throws VALIDATION_FAILED with a fields map */
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

/**
 * The project, for a read. Anyone who can't manage it gets the same answer as for no project at all.
 * @throws NOT_FOUND
 */
export async function readableProject(user, projectId) {
  const id = toId(projectId);
  const project = id ? await projects.findById(id) : null;
  if (!project || !projects.canManage(user, project)) throw projectNotFound();
  return project;
}

/** The project, for a write. @throws FORBIDDEN, NOT_FOUND */
export async function manageableProject(user, projectId) {
  if (!can(user, 'project.manage')) throw forbidden();
  const id = toId(projectId);
  const project = id ? await projects.findById(id) : null;
  if (!project) throw projectNotFound();
  if (!projects.canManage(user, project)) throw forbidden();
  return project;
}

/**
 * Runs a write; before migration 015 it throws a clear error instead of a database one.
 * @template T
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 * @throws PLAN_UNAVAILABLE (503)
 */
export async function guardDocumentWrite(write) {
  try {
    return await guardPlanWrite(write);
  } catch (error) {
    if (error?.code !== 'PLAN_UNAVAILABLE') throw error;
    throw new AppError('PLAN_UNAVAILABLE', {
      status: 503,
      message: "Files and notes can't be saved yet. Please try again later.",
    });
  }
}
