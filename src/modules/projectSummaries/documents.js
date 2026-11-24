// A project's notes and texts for the AI summary (CONTRACT 22 and 27): notes typed in Daybook, the
// text of a project file (read in the PM's browser after its upload) and text-only documents kept
// from before 1.12. Writes are for the project's PM and Admins; members read Everyone notes and
// text-only documents (fileDocuments.js has their reads). Audit rows hold ids and numbers, never a
// title or any text.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { projectFiles } from '@/modules/projectFiles';
import { guard019Write, updateNeededError } from '@/modules/projectFiles/migration019';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';
import * as repo from './repo';
import {
  documentCreateSchema,
  documentUpdateSchema,
  MAX_DOCUMENTS,
  MAX_TITLE_LENGTH,
  cutText,
} from './schemas';
import {
  documentNotFound,
  forbidden,
  guardDocumentWrite,
  manageableProject,
  parseInput,
  readableProject,
  toDocument,
  toId,
  withFileColumns,
} from './shared';

const TOO_MANY = `This project has ${MAX_DOCUMENTS} files and notes with text. Delete some first.`;
const FOLLOWS_FILE = 'This text follows its file. Change the file instead.';
const ONLY_PROJECT_FILES = 'Only project files are read for the AI summary.';
const ALREADY_SAVED = "This file's text is already saved.";
const DUPLICATE = 1062;

/** What the audit log keeps of a document: ids, kinds and numbers. */
function snapshot(row) {
  return {
    projectId: row.projectId,
    phase: row.phase,
    kind: row.kind,
    visibility: row.visibility ?? 'managers',
    fileId: row.fileId ?? null,
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

/** A document as the routes answer it after a write: everything but the text. */
async function written(id, trx) {
  const row = await withFileColumns((fileColumns) => repo.findDocument(id, { fileColumns }, trx));
  const { body: _body, ...document } = toDocument(row);
  return { row, document };
}

/**
 * A project's notes and texts, newest first, without their text. Empty before migration 015.
 * @param {{ user: object, projectId: number }} args
 * @returns {Promise<Array<{ id, projectId, phase, kind, title, pages, pagesTotal, charCount,
 *   visibility, fileId, createdBy, updatedBy, createdAt, updatedAt }>>} phase null = Whole project
 * @throws NOT_FOUND (also for anyone who can't manage the project)
 */
export async function listDocuments({ user, projectId }) {
  const project = await readableProject(user, projectId);
  const rows = await guardPlanRead(
    () => withFileColumns((fileColumns) => repo.listDocuments(project.id, { fileColumns })),
    () => [],
  );
  return rows.map(toDocument);
}

/** The file a text is for: an active project file of this project (locked to share). */
async function fileFor(projectId, fileId, trx) {
  const file = await projectFiles.fileForDocument({ projectId, fileId }, trx);
  if (!file) throw new AppError('NOT_FOUND', { message: "We couldn't find that file." });
  if (file.scope !== 'project') throw validationError({ fileId: ONLY_PROJECT_FILES });
  return file;
}

/** The row to insert: a file's text takes its place and name from the file, always managers. */
async function rowFor({ user, project, values, trx }) {
  const at = nowDate();
  const row = {
    projectId: project.id,
    phase: values.phase ?? null,
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
  };
  if (values.fileId !== undefined) {
    // The file of this project first (UPDATE_NEEDED before migration 019), then a second text:
    // another project's file answers 404 whether or not it has a text, so an id says nothing.
    const file = await fileFor(project.id, values.fileId, trx);
    if (await repo.findFileDocument(file.id, trx)) {
      throw new AppError('CONFLICT', { message: ALREADY_SAVED });
    }
    const title = cutText(file.name, MAX_TITLE_LENGTH);
    return { ...row, phase: file.phase ?? null, title, visibility: 'managers', fileId: file.id };
  }
  // Without the new choices the row is written without the new columns, so it saves the same
  // before and after migration 019 (the column default is 'managers').
  if (values.visibility === 'everyone' || values.phase === null) {
    return { ...row, visibility: values.visibility ?? 'managers' };
  }
  return row;
}

/** True when the input needs migration 019 (a place of Whole project, Everyone, or a file). */
const needs019 = (values) =>
  values.visibility === 'everyone' || values.phase === null || values.fileId !== undefined;

/**
 * Adds a note, the text of a project file, or a text-only document.
 * @param {{ user: object, projectId: number, input: { phase?: string | null,
 *   kind: 'file' | 'note', title: string, text: string, pages?: number | null,
 *   pagesTotal?: number | null, visibility?: 'everyone' | 'managers', fileId?: number },
 *   ip?: string | null }} args title 1-200, text 1-200,000 characters; phase null = Whole project;
 *   visibility left out = 'managers'; fileId: the project file this is the text of (its place and
 *   name are taken from the file, and its visibility is always 'managers')
 * @returns {Promise<object>} the document without its text
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND (also a file deleted meanwhile),
 *   VALIDATION_FAILED (`fields.fileId` for a task's file), CONFLICT (409, the file's text is already
 *   saved), TOO_MANY_DOCUMENTS (409, already 100), PLAN_UNAVAILABLE (503, before migration 015),
 *   UPDATE_NEEDED (503, Whole project, Everyone or a file before migration 019)
 */
export async function addDocument({ user, projectId, input, ip = null }) {
  const project = await manageableProject(user, projectId);
  const values = parseInput(documentCreateSchema, input);
  const write = () =>
    db.transaction(async (trx) => {
      await repo.lockProject(project.id, trx);
      if ((await repo.countDocuments(project.id, trx)) >= MAX_DOCUMENTS) {
        throw new AppError('TOO_MANY_DOCUMENTS', { status: 409, message: TOO_MANY });
      }
      const row = await rowFor({ user, project, values, trx });
      const id = await repo.insertDocument(row, trx).catch((error) => {
        if (error?.errno !== DUPLICATE) throw error;
        throw new AppError('CONFLICT', { message: ALREADY_SAVED });
      });
      const saved = await written(id, trx);
      const action = 'project_document.create';
      await log({ user, action, id, before: null, after: snapshot(saved.row), ip }, trx);
      return saved.document;
    });
  return guardDocumentWrite(needs019(values) ? () => guard019Write('documents', write) : write);
}

/** Locks a document and checks the user may change it. @throws FORBIDDEN, NOT_FOUND */
async function lockForManage(user, id, trx) {
  if (!can(user, 'project.manage')) throw forbidden();
  const documentId = toId(id);
  const row = documentId
    ? await withFileColumns((fileColumns) => repo.lockDocument(documentId, { fileColumns }, trx))
    : null;
  if (!row) throw documentNotFound();
  await manageableProject(user, row.projectId);
  return row;
}

/** Refuses what a document can't take: a file's text follows its file; only a note's text changes. */
function checkEdit(before, values) {
  if (before.fileId !== null && before.fileId !== undefined) {
    throw validationError({ fileId: FOLLOWS_FILE });
  }
  if (values.text !== undefined && before.kind !== 'note') {
    const message = 'Only notes can be edited.';
    throw validationError({ kind: message }, message);
  }
  const wants019 = values.visibility === 'everyone' || values.phase === null;
  if (before.has019 === false && wants019) throw updateNeededError();
}

/**
 * What an edit changes. A new title or text is a change of words (`updatedAt` now, so a summary goes
 * stale); a new place or who sees it keeps `updatedAt` as it was, which the column's ON UPDATE would
 * otherwise restamp.
 */
function changesFor(before, values, user) {
  const words = {};
  if (values.title !== undefined && values.title !== before.title) words.title = values.title;
  if (values.text !== undefined && values.text !== before.body) {
    words.body = values.text;
    words.charCount = values.text.length;
  }
  const other = {};
  if (values.phase !== undefined && values.phase !== before.phase) other.phase = values.phase;
  if (values.visibility !== undefined && values.visibility !== before.visibility) {
    other.visibility = values.visibility;
  }
  if (Object.keys(words).length > 0) {
    return { ...words, ...other, updatedBy: user.id, updatedAt: nowDate() };
  }
  if (Object.keys(other).length > 0) {
    return { ...other, updatedBy: user.id, updatedAt: before.updatedAt };
  }
  return null;
}

/**
 * Edits a note's title or text, a text-only document's title, and for both the place and who sees
 * it (only the fields sent). The same words again change nothing, so a summary doesn't go stale
 * for it; a new place or who sees it doesn't either. A file's text follows its file.
 * @param {{ user: object, id: number, input: { title?: string, text?: string,
 *   phase?: string | null, visibility?: 'everyone' | 'managers' }, ip?: string | null }} args
 * @returns {Promise<object>} the document without its text
 * @throws FORBIDDEN, NOT_FOUND, VALIDATION_FAILED (`fields.kind` for a text that isn't a note's,
 *   `fields.fileId` "This text follows its file. Change the file instead."), PLAN_UNAVAILABLE (503),
 *   UPDATE_NEEDED (503, Whole project or Everyone before migration 019)
 */
export async function updateDocument({ user, id, input, ip = null }) {
  if (!can(user, 'project.manage')) throw forbidden();
  return guardDocumentWrite(() =>
    db.transaction(async (trx) => {
      const before = await lockForManage(user, id, trx);
      const values = parseInput(documentUpdateSchema, input);
      checkEdit(before, values);
      const changes = changesFor(before, values, user);
      if (changes) await repo.updateDocument(before.id, changes, trx);
      const saved = await written(before.id, trx);
      if (changes) {
        const action = 'project_document.update';
        const logged = { before: snapshot(before), after: snapshot(saved.row) };
        await log({ user, action, id: before.id, ...logged, ip }, trx);
      }
      return saved.document;
    }),
  );
}

/**
 * Deletes a note or a text. Deleting a file's text keeps the file ("Read text for AI" comes back).
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
