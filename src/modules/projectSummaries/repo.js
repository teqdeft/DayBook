// Every Knex query of the projectSummaries module: project_documents and project_summaries. Reading
// the team's names and locking a project row are the two steps outside them: the names only feed the
// AI's prompt (CONTRACT 4 allows that for read-only queries), and the lock only counts documents.
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

// ---------- documents ----------

/** A project's documents without their text, newest first. */
export function listDocuments(projectId, trx = db) {
  return trx('projectDocuments')
    .where({ projectId })
    .orderBy([
      { column: 'createdAt', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .select(DOCUMENT_COLUMNS);
}

/** The text of these documents of a project. */
export function listDocumentBodies(projectId, ids, trx = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('projectDocuments').where({ projectId }).whereIn('id', ids).select('id', 'body');
}

/** One document with its text, or undefined. */
export function findDocument(id, trx = db) {
  return trx('projectDocuments')
    .where({ id })
    .first(...DOCUMENT_COLUMNS, 'body');
}

/** Locks one document for the rest of the transaction, and returns it with its text. */
export function lockDocument(id, trx) {
  return trx('projectDocuments')
    .where({ id })
    .forUpdate()
    .first(...DOCUMENT_COLUMNS, 'body');
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
