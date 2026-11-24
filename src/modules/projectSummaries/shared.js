// Helpers shared by the projectSummaries service files: who may do what, input parsing, the error a
// write answers before migration 015 and the read before migration 019. Everything in this module is
// for people who can manage the project: reads answer NOT_FOUND to anyone else, writes FORBIDDEN;
// the one exception is members reading Everyone notes and text-only documents (CONTRACT 27).
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { guard019Read } from '@/modules/projectFiles/migration019';
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

/**
 * A row as the contract's document, with its text only when the row has it. Before migration 019 a
 * row has no `visibility` or `fileId`: it reads as "Only PM and Admins" with no file.
 */
export function toDocument(row) {
  const document = {
    id: row.id,
    projectId: row.projectId,
    phase: row.phase ?? null,
    kind: row.kind,
    title: row.title,
    pages: row.pages ?? null,
    pagesTotal: row.pagesTotal ?? null,
    charCount: row.charCount,
    visibility: row.visibility ?? 'managers',
    fileId: row.fileId ?? null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.createdByName !== undefined) document.createdByName = row.createdByName ?? null;
  return row.body === undefined ? document : { ...document, body: row.body };
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

/**
 * Runs a read of documents with the columns of migration 019 (`visibility`, `fileId`); before 019
 * (errno 1054) it reads again without them, and every row reads as "Only PM and Admins" with no
 * file, which is what each row was before 019 (CONTRACT 27, Deploy before migrate). Rows read the
 * second way carry `has019: false`.
 * @template T
 * @param {(fileColumns: boolean) => Promise<T>} read
 * @returns {Promise<T>} a row, rows, or undefined, as `read` answers
 */
export async function withFileColumns(read) {
  return guard019Read(
    'documents',
    () => read(true),
    async () => {
      const result = await read(false);
      const before019 = (row) => ({ ...row, visibility: 'managers', fileId: null, has019: false });
      if (Array.isArray(result)) return result.map(before019);
      return result ? before019(result) : result;
    },
  );
}
