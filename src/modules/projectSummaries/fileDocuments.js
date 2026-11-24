// The documents of the Files tab (CONTRACT 27): who reads which, and the text of a project file
// following its file. Managers read every document; members (a PM who is a member included) read
// Everyone notes and Everyone text-only documents, never a file's text; anyone else reads nothing
// and gets the same NOT_FOUND as for no document at all. A's rename, move and delete of a project
// file call syncFileDocument inside their own transaction, so the AI summary never reads a deleted
// file's text and a move never makes a summary stale.
import { nowDate } from '@/lib/time';
import { projectFiles } from '@/modules/projectFiles';
import { canReadDocument } from '@/modules/projectFiles/access';
import { isMissing019 } from '@/modules/projectFiles/migration019';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';
import { projects } from '@/modules/projects';
import * as repo from './repo';
import { cutText, MAX_TITLE_LENGTH } from './schemas';
import { documentNotFound, toDocument, toId, withFileColumns } from './shared';

/** The viewer's file rights on a project (projectFiles.viewerContext, one per request). */
function contextFor(viewer, project) {
  return projectFiles.viewerContext({ viewer, project });
}

/**
 * The notes and texts this viewer may read on a project, newest first, without their text, with
 * the name of who added each. Empty before migration 015.
 * @param {{ viewer: object, projectId: number }} args
 * @returns {Promise<Array<{ id, projectId, phase, kind, title, pages, pagesTotal, charCount,
 *   visibility, fileId, createdBy, createdByName, updatedBy, createdAt, updatedAt }>>} managers:
 *   every document; members: Everyone notes and Everyone text-only documents; anyone else: []
 */
export async function listDocumentsFor({ viewer, projectId }) {
  const id = toId(projectId);
  const project = id ? await projects.findById(id) : null;
  if (!project) return [];
  const ctx = await contextFor(viewer, project);
  if (!ctx.active || (!ctx.manages && !ctx.member)) return [];
  const rows = await guardPlanRead(
    () =>
      withFileColumns((fileColumns) =>
        repo.listDocuments(project.id, { fileColumns, names: true }),
      ),
    () => [],
  );
  return rows.map(toDocument).filter((document) => canReadDocument(ctx, document));
}

/**
 * Whether migration 019 has run (the columns it adds to project_documents are there). Before it the
 * Files tab shows only "Files need the latest database update. Ask an Admin." (CONTRACT 27).
 * @returns {Promise<boolean>}
 */
export async function filesReady() {
  try {
    await repo.probeFileColumns();
    return true;
  } catch (error) {
    if (isMissing019(error)) return false;
    throw error;
  }
}

/**
 * One note or text with its text (a file's pages are separated by \f), for a viewer who may read
 * it: managers every document, members Everyone notes and Everyone text-only documents.
 * @param {{ user: object, id: number }} args
 * @returns {Promise<object>} the listDocuments shape plus `body`
 * @throws NOT_FOUND (also for anyone who may not read it, and before migration 015)
 */
export async function getDocument({ user, id }) {
  const documentId = toId(id);
  const row = documentId
    ? await guardPlanRead(
        () => withFileColumns((fileColumns) => repo.findDocument(documentId, { fileColumns })),
        () => null,
      )
    : null;
  const project = row ? await projects.findById(row.projectId) : null;
  if (!project) throw documentNotFound();
  const document = toDocument(row);
  if (projects.canManage(user, project)) return document;
  const ctx = await contextFor(user, project);
  if (!canReadDocument(ctx, document)) throw documentNotFound();
  return document;
}

/**
 * Renames, moves or deletes the document holding a project file's text (its visibility stays
 * 'managers'). A rename writes `updatedAt: nowDate()` (the summary goes stale, as an edit does); a
 * move keeps `updatedAt` as it was (the column's ON UPDATE would restamp it); no document for the
 * file is no change.
 * @param {{ fileId: number, title?: string, phase?: string | null, remove?: boolean }} change
 *   title: the file's new name; phase: its new place (null = Whole project); remove: delete it
 * @param {import('knex').Knex.Transaction} trx the caller's transaction
 * @returns {Promise<void>}
 */
export async function syncFileDocument({ fileId, title, phase, remove = false }, trx) {
  const id = toId(fileId);
  const row = id ? await repo.lockFileDocument(id, trx) : null;
  if (!row) return;
  if (remove) {
    await repo.deleteDocument(row.id, trx);
    return;
  }
  const changes = {};
  const name = title === undefined ? undefined : cutText(String(title), MAX_TITLE_LENGTH);
  if (name !== undefined && name !== row.title) changes.title = name;
  if (phase !== undefined && phase !== row.phase) changes.phase = phase;
  if (Object.keys(changes).length === 0) return;
  const updatedAt = changes.title === undefined ? row.updatedAt : nowDate();
  await repo.updateDocument(row.id, { ...changes, updatedAt }, trx);
}
