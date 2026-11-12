// A project's files and notes (CONTRACT 22). The text is stored, the file never: the browser reads a
// PDF, and a file's pages arrive joined by a form feed. Audit rows hold ids and numbers, never a title
// or any text.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';
import { projects } from '@/modules/projects';
import * as repo from './repo';
import { documentCreateSchema, documentUpdateSchema, MAX_DOCUMENTS } from './schemas';
import {
  documentNotFound,
  forbidden,
  guardDocumentWrite,
  manageableProject,
  parseInput,
  readableProject,
  toId,
} from './shared';

/** A row as the contract's document, with its text only when the row has it. */
function toDocument(row) {
  const document = {
    id: row.id,
    projectId: row.projectId,
    phase: row.phase,
    kind: row.kind,
    title: row.title,
    pages: row.pages ?? null,
    pagesTotal: row.pagesTotal ?? null,
    charCount: row.charCount,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return row.body === undefined ? document : { ...document, body: row.body };
}

/** What the audit log keeps of a document. */
function snapshot(row) {
  return {
    projectId: row.projectId,
    phase: row.phase,
    kind: row.kind,
    pages: row.pages ?? null,
    pagesTotal: row.pagesTotal ?? null,
    charCount: row.charCount,
  };
}

function log({ user, action, id, before, after, ip }, trx) {
  return audit.log(
    { actorId: user.id, action, entityType: 'project_document', entityId: id, before, after, ip },
    trx,
  );
}

/**
 * A project's files and notes, newest first, without their text. Empty before migration 015.
 * @param {{ user: object, projectId: number }} args
 * @returns {Promise<Array<{ id, projectId, phase, kind, title, pages, pagesTotal, charCount,
 *   createdBy, updatedBy, createdAt, updatedAt }>>}
 * @throws NOT_FOUND (also for anyone who can't manage the project)
 */
export async function listDocuments({ user, projectId }) {
  const project = await readableProject(user, projectId);
  const rows = await guardPlanRead(
    () => repo.listDocuments(project.id),
    () => [],
  );
  return rows.map(toDocument);
}

/**
 * One file or note with its text (a file's pages are separated by \f).
 * @param {{ user: object, id: number }} args
 * @returns {Promise<object>} the listDocuments shape plus `body`
 * @throws NOT_FOUND (also for anyone who can't manage its project, and before migration 015)
 */
export async function getDocument({ user, id }) {
  const documentId = toId(id);
  const row = documentId
    ? await guardPlanRead(
        () => repo.findDocument(documentId),
        () => null,
      )
    : null;
  const project = row ? await projects.findById(row.projectId) : null;
  if (!project || !projects.canManage(user, project)) throw documentNotFound();
  return toDocument(row);
}

/**
 * Adds a file's text or a note to a phase of the project.
 * @param {{ user: object, projectId: number, input: { phase: string, kind: 'file' | 'note',
 *   title: string, text: string, pages?: number | null, pagesTotal?: number | null },
 *   ip?: string | null }} args title 1-200, text 1-200,000 characters; pages and pagesTotal are
 *   for a PDF (the pages read, at most 100, and the pages it has)
 * @returns {Promise<object>} the document without its text
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND, VALIDATION_FAILED,
 *   TOO_MANY_DOCUMENTS (409, already 40), PLAN_UNAVAILABLE (503, migration 015 hasn't run)
 */
export async function addDocument({ user, projectId, input, ip = null }) {
  const project = await manageableProject(user, projectId);
  const values = parseInput(documentCreateSchema, input);
  return guardDocumentWrite(() =>
    db.transaction(async (trx) => {
      await repo.lockProject(project.id, trx);
      if ((await repo.countDocuments(project.id, trx)) >= MAX_DOCUMENTS) {
        throw new AppError('TOO_MANY_DOCUMENTS', {
          status: 409,
          message: 'This project has too many files and notes. Delete some first.',
        });
      }
      const at = nowDate();
      const id = await repo.insertDocument(
        {
          projectId: project.id,
          phase: values.phase,
          kind: values.kind,
          title: values.title,
          body: values.text,
          pages: values.pages,
          pagesTotal: values.pagesTotal,
          charCount: values.text.length,
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: at,
          updatedAt: at,
        },
        trx,
      );
      const row = await repo.findDocument(id, trx);
      const action = 'project_document.create';
      await log({ user, action, id, before: null, after: snapshot(row), ip }, trx);
      const { body: _body, ...document } = toDocument(row);
      return document;
    }),
  );
}

/** Locks a document and checks the user may change it. @throws FORBIDDEN, NOT_FOUND */
async function lockForManage(user, id, trx) {
  if (!can(user, 'project.manage')) throw forbidden();
  const documentId = toId(id);
  const row = documentId ? await repo.lockDocument(documentId, trx) : null;
  if (!row) throw documentNotFound();
  await manageableProject(user, row.projectId);
  return row;
}

/**
 * Edits a note's title or text (only the fields sent). The same words again change nothing, so a
 * summary doesn't go stale for it. A file can't be edited.
 * @param {{ user: object, id: number, input: { title?: string, text?: string },
 *   ip?: string | null }} args
 * @returns {Promise<object>} the document without its text
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED (also for a file), PLAN_UNAVAILABLE (503)
 */
export async function updateDocument({ user, id, input, ip = null }) {
  if (!can(user, 'project.manage')) throw forbidden();
  return guardDocumentWrite(() =>
    db.transaction(async (trx) => {
      const before = await lockForManage(user, id, trx);
      const values = parseInput(documentUpdateSchema, input);
      if (before.kind !== 'note') {
        const message = 'Only notes can be edited.';
        throw validationError({ kind: message }, message);
      }
      const changes = {};
      if (values.title !== undefined && values.title !== before.title) changes.title = values.title;
      if (values.text !== undefined && values.text !== before.body) {
        changes.body = values.text;
        changes.charCount = values.text.length;
      }
      if (Object.keys(changes).length > 0) {
        await repo.updateDocument(
          before.id,
          { ...changes, updatedBy: user.id, updatedAt: nowDate() },
          trx,
        );
      }
      const row = await repo.findDocument(before.id, trx);
      if (Object.keys(changes).length > 0) {
        const action = 'project_document.update';
        const logged = { before: snapshot(before), after: snapshot(row) };
        await log({ user, action, id: before.id, ...logged, ip }, trx);
      }
      const { body: _body, ...document } = toDocument(row);
      return document;
    }),
  );
}

/**
 * Deletes a file or note.
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<{ id: number, deleted: true }>}
 * @throws FORBIDDEN, NOT_FOUND, PLAN_UNAVAILABLE (503)
 */
export async function removeDocument({ user, id, ip = null }) {
  return guardDocumentWrite(() =>
    db.transaction(async (trx) => {
      const before = await lockForManage(user, id, trx);
      await repo.deleteDocument(before.id, trx);
      const action = 'project_document.delete';
      await log({ user, action, id: before.id, before: snapshot(before), after: null, ip }, trx);
      return { id: before.id, deleted: true };
    }),
  );
}
