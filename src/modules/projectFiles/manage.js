// Managing files (CONTRACT 27, Modules "Management"): rename any file by its base name (the stored
// extension is kept, so a rename never changes the type, `is_picture` or the download headers),
// move a project file or change who sees it, and delete (a soft delete: the disk file and the row
// leave in the nightly cleanup). Each change locks only its file row, renames, moves or deletes the
// file's text with E's syncFileDocument and writes its audit row, all in one transaction. Audit
// rows never hold the file name.
import { db } from '@/lib/db';
import { validationError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { projects } from '@/modules/projects';
import { projectSummaries } from '@/modules/projectSummaries';
import { canManageFiles, canSeeFile } from './access';
import { cantChangeFiles, fileNotFound } from './errors';
import { guard019Write } from './migration019';
import { renamedFileName } from './names';
import { toProjectFile } from './fileView';
import { accessShape, textFileIds, viewerContext } from './reads';
import * as repo from './repo';
import { fileUpdateSchema, parseInput } from './schemas';

const TASK_PLACE = "A task's files go where the task goes.";

/** A positive whole id, or null. */
const toId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/**
 * Locks the active file row and checks the person may change it: 404 to anyone who can't see it
 * (so an id says nothing), 403 to a viewer who can see it but doesn't manage the project.
 * @returns {Promise<object>} the locked row, with its task and creator
 */
async function lockForManage(user, id, trx) {
  const fileId = toId(id);
  const row = fileId ? await repo.lockFile(fileId, trx) : null;
  const project = row ? await projects.findById(row.projectId) : null;
  if (!project) throw fileNotFound();
  const ctx = await viewerContext({ viewer: user, project });
  if (!canSeeFile(ctx, accessShape(row))) throw fileNotFound();
  if (!canManageFiles(ctx)) throw cantChangeFiles();
  return row;
}

/** The changes a valid input makes to the row (only what differs). */
function changesFor(row, input) {
  if (row.scope === 'task' && (input.phase !== undefined || input.visibility !== undefined)) {
    const fields = {};
    if (input.phase !== undefined) fields.phase = TASK_PLACE;
    if (input.visibility !== undefined) fields.visibility = TASK_PLACE;
    throw validationError(fields, TASK_PLACE);
  }
  const changes = {};
  if (input.name !== undefined) {
    const name = renamedFileName(input.name, row.ext ?? '');
    if (name !== row.name) changes.name = name;
  }
  if (input.phase !== undefined && input.phase !== (row.phase ?? null)) changes.phase = input.phase;
  if (input.visibility !== undefined && input.visibility !== row.visibility) {
    changes.visibility = input.visibility;
  }
  return changes;
}

/** The audit fields of a change: the place and who sees it, and only whether the name changed. */
function auditPlace(row, changes, side) {
  const source = side === 'after' ? { ...row, ...changes } : row;
  const place = { phase: source.phase ?? null, visibility: source.visibility };
  return changes.name === undefined ? place : { ...place, nameChanged: true };
}

/**
 * Renames any file (by its base name; the extension stays), and moves a project file or changes
 * who sees it. The file's text, when a document holds it, is renamed or moved with it.
 * @param {{ user: object, id: number, input: { name?: string, phase?: string | null,
 *   visibility?: 'everyone' | 'managers' }, ip?: string | null }} args input: fileUpdateSchema
 *   (`name` = the base name)
 * @returns {Promise<import('./service').ProjectFile>}
 * @throws VALIDATION_FAILED ("Write a name.", "Nothing to change.", 400 "A task's files go where
 *   the task goes." for a task file's place or visibility), NOT_FOUND ("We couldn't find that
 *   file.", also for anyone who can't see it), FORBIDDEN ("You can't change files on this
 *   project."), UPDATE_NEEDED (503) before migration 019
 */
export async function updateFile({ user, id, input, ip = null }) {
  const parsed = parseInput(fileUpdateSchema, input);
  const row = await guard019Write('files', () =>
    db.transaction(async (trx) => {
      const current = await lockForManage(user, id, trx);
      const changes = changesFor(current, parsed);
      if (Object.keys(changes).length === 0) return current;
      await repo.updateFile(
        current.id,
        { ...changes, updatedBy: user.id, updatedAt: nowDate() },
        trx,
      );
      if (current.scope === 'project' && (changes.name || changes.phase !== undefined)) {
        await projectSummaries.syncFileDocument(
          { fileId: current.id, title: changes.name, phase: changes.phase },
          trx,
        );
      }
      await audit.log(
        {
          actorId: user.id,
          action: 'project_file.update',
          entityType: 'project_file',
          entityId: current.id,
          before: auditPlace(current, changes, 'before'),
          after: auditPlace(current, changes, 'after'),
          ip,
        },
        trx,
      );
      return repo.findFile(current.id, trx);
    }),
  );
  const withText = row.scope === 'project' ? await textFileIds(user, row.projectId) : new Set();
  return toProjectFile(row, { canManage: true, hasText: withText.has(Number(row.id)) });
}

/**
 * Deletes a file: from now on it is never listed, counted or served; its text (a project file's
 * document) is deleted in the same transaction, so the AI summary stops reading it at once. The
 * disk file and the row leave in the nightly cleanup (no restore: Undo never reaches the server).
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<{ id: number }>}
 * @throws NOT_FOUND ("We couldn't find that file."), FORBIDDEN ("You can't change files on this
 *   project."), UPDATE_NEEDED (503) before migration 019
 */
export async function removeFile({ user, id, ip = null }) {
  return guard019Write('files', () =>
    db.transaction(async (trx) => {
      const row = await lockForManage(user, id, trx);
      const at = nowDate();
      await repo.updateFile(
        row.id,
        { status: 'deleted', deletedAt: at, deletedBy: user.id, updatedBy: user.id, updatedAt: at },
        trx,
      );
      if (row.scope === 'project') {
        await projectSummaries.syncFileDocument({ fileId: row.id, remove: true }, trx);
      }
      await audit.log(
        {
          actorId: user.id,
          action: 'project_file.delete',
          entityType: 'project_file',
          entityId: row.id,
          before: {
            projectId: Number(row.projectId),
            scope: row.scope,
            taskId: row.taskId == null ? null : Number(row.taskId),
            phase: row.phase ?? null,
            visibility: row.visibility,
            sizeBytes: Number(row.sizeBytes),
            ext: row.ext ?? '',
          },
          ip,
        },
        trx,
      );
      return { id: Number(row.id) };
    }),
  );
}
