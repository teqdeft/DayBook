// Every Knex query of the projectSummaries module: project_documents and project_summaries. Reading
// the team's names and locking a project row are the two steps outside them: the names only feed the
// AI's prompt (CONTRACT 4 allows that for read-only queries), and the lock only counts documents.
// Reads that name `visibility` and `file_id` (migration 019) take `fileColumns`, so the service can
// read again without them before 019 (`withFileColumns`, shared.js).
import { db } from '@/lib/db';

/** Everything but the text: lists never carry it. */
const DOCUMENT_COLUMNS = [
  'id',
  'projectId',
  'phase',
  'kind',
  'title',
  'pages',
  'pagesTotal',
  'charCount',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
];

/** The columns migration 019 adds (CONTRACT 27): who sees a document, and the file it is the text of. */
export const FILE_COLUMNS = Object.freeze(['visibility', 'fileId']);

const columnsOf = (fileColumns) =>
  fileColumns ? [...DOCUMENT_COLUMNS, ...FILE_COLUMNS] : DOCUMENT_COLUMNS;

// ---------- documents ----------

/**
 * A project's documents without their text, newest first.
 * @param {number} projectId
 * @param {{ fileColumns?: boolean, names?: boolean }} [options] fileColumns: also `visibility` and
 *   `fileId` (019); names: also `createdByName`, the name of who added it
 */
export function listDocuments(projectId, { fileColumns = false, names = false } = {}, trx = db) {
  const columns = columnsOf(fileColumns).map((column) => `d.${column}`);
  const query = trx('projectDocuments as d')
    .where('d.projectId', projectId)
    .orderBy([
      { column: 'd.createdAt', order: 'desc' },
      { column: 'd.id', order: 'desc' },
    ]);
  if (!names) return query.select(columns);
  return query
    .leftJoin('users as u', 'u.id', 'd.createdBy')
    .select(...columns, 'u.name as createdByName');
}

/** Reads no row; fails with errno 1054 (or 1146) until migration 019 has added its columns. */
export function probeFileColumns(trx = db) {
  return trx('projectDocuments').select(FILE_COLUMNS).limit(0);
}

/** The text of these documents of a project. */
export function listDocumentBodies(projectId, ids, trx = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('projectDocuments').where({ projectId }).whereIn('id', ids).select('id', 'body');
}

/** One document with its text, or undefined. */
export function findDocument(id, { fileColumns = false } = {}, trx = db) {
  return trx('projectDocuments')
    .where({ id })
    .first(...columnsOf(fileColumns), 'body');
}

/** Locks one document for the rest of the transaction, and returns it with its text. */
export function lockDocument(id, { fileColumns = false } = {}, trx) {
  return trx('projectDocuments')
    .where({ id })
    .forUpdate()
    .first(...columnsOf(fileColumns), 'body');
}

/** The id of the document holding a file's text, or undefined (019). */
export function findFileDocument(fileId, trx = db) {
  return trx('projectDocuments').where({ fileId }).first('id');
}

/** Locks the document holding a file's text, when there is one (019). */
export function lockFileDocument(fileId, trx) {
  return trx('projectDocuments')
    .where({ fileId })
    .forUpdate()
    .first('id', 'phase', 'title', 'updatedAt');
}

export function countDocuments(projectId, trx = db) {
  return trx('projectDocuments')
    .where({ projectId })
    .count({ total: '*' })
    .first()
    .then((row) => Number(row?.total ?? 0));
}

/**
 * Locks the project's row, so documents added at the same time count each other. Counting rows with
 * a lock instead would take gap locks, and two inserts into the same gap deadlock.
 */
export function lockProject(projectId, trx) {
  return trx('projects').where({ id: projectId }).forUpdate().first('id');
}

export async function insertDocument(row, trx) {
  const [id] = await trx('projectDocuments').insert(row);
  return id;
}

export function updateDocument(id, changes, trx) {
  return trx('projectDocuments').where({ id }).update(changes);
}

export function deleteDocument(id, trx) {
  return trx('projectDocuments').where({ id }).del();
}

// ---------- summaries ----------

/** A project's summary and who last wrote it, or undefined. */
export function findSummary(projectId, trx = db) {
  return trx('projectSummaries as s')
    .leftJoin('users as u', 'u.id', 's.updatedBy')
    .where('s.projectId', projectId)
    .first('s.body', 's.sourceKey', 's.truncated', 's.updatedAt', 'u.name as updatedByName');
}

/** Locks a project's summary for the rest of the transaction, when it has one. */
export function lockSummary(projectId, trx) {
  return trx('projectSummaries').where({ projectId }).forUpdate().first('body', 'updatedAt');
}

/**
 * Creates the project's summary row if it has none and locks it, so two rewrites wait their turn.
 * The upsert takes the exclusive lock straight away with or without a row: locking a missing row
 * first deadlocks two first summaries that arrive together.
 * @param {object} row the whole row, used only when there is none yet
 * @returns {Promise<{ body: string, updatedAt: Date }>} the row as it now stands
 */
export async function lockOrCreateSummary(row, trx) {
  await trx('projectSummaries')
    .insert(row)
    .onConflict('projectId')
    .merge({ projectId: row.projectId });
  return lockSummary(row.projectId, trx);
}

export function updateSummary(projectId, changes, trx) {
  return trx('projectSummaries').where({ projectId }).update(changes);
}

// ---------- the team, for the prompt ----------

/** The people on a project's team, active or not: a former member's name can be in a document. */
export function listTeam(projectId, trx = db) {
  return trx('projectMembers as m')
    .join('users as u', 'u.id', 'm.userId')
    .where('m.projectId', projectId)
    .orderBy('u.id', 'asc')
    .select('u.id', 'u.name');
}
