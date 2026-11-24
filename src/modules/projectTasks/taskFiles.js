// Files on tasks (CONTRACT 27, Task files): the attach, remove and limit steps of a task save, and
// POST /api/project-tasks/[id]/files. Every step runs inside the caller's transaction after the
// task row lock (lock order: the task row, then upload rows, then file rows). The files are
// projectFiles' own rows: this file only calls its functions, which return [] for an empty list
// without a query, answer UPDATE_NEEDED for a list before migration 019, and write the
// project_file.add and project_file.delete audit lines (ids and sizes, never a name).
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { projectFiles } from '@/modules/projectFiles';
import { sendFilesAdded, toldOf } from './messages';
import { MAX_TASK_FILES, projectTaskFilesSchema, TASK_FILES_MESSAGE } from './schemas';
import { lockForManage, parseInput, teamOf } from './shared';

function tooManyFiles() {
  return new AppError('TOO_MANY_FILES', { status: 409, message: TASK_FILES_MESSAGE });
}

/** The list without repeats (one upload or file sent twice counts once). */
function unique(values) {
  return [...new Set(values ?? [])];
}

/**
 * Attaches held uploads to a locked task and refuses the save past 20 active files. The count is
 * a locking read after the task row lock (and after the attach, so this save's own files count),
 * so a snapshot taken earlier can't hide another save's files; a refusal rolls the whole save back.
 * @returns {Promise<object[]>} the new ProjectFile rows
 * @throws VALIDATION_FAILED (`fields.uploadKeys`, from projectFiles), TOO_MANY_FILES (409),
 *   UPDATE_NEEDED (503, before migration 019)
 */
async function addFiles({ user, projectId, taskId, uploadKeys, ip }, trx) {
  const keys = unique(uploadKeys);
  if (keys.length === 0) return [];
  if (keys.length > MAX_TASK_FILES) throw tooManyFiles();
  const files = await projectFiles.attachUploads(
    { user, projectId, taskId, uploadKeys: keys, ip },
    trx,
  );
  if ((await projectFiles.countActiveForTask(taskId, trx)) > MAX_TASK_FILES) throw tooManyFiles();
  return files;
}

/**
 * The files of a task just inserted in the create transaction.
 * @param {{ user: object, projectId: number, taskId: number, uploadKeys: string[],
 *   ip?: string | null }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<object[]>} the ProjectFile rows
 * @throws as addFiles
 */
export function attachToNewTask({ user, projectId, taskId, uploadKeys, ip = null }, trx) {
  return addFiles({ user, projectId, taskId, uploadKeys, ip }, trx);
}

/**
 * An edit's file changes on a locked task: first the removes (soft delete; an id already deleted
 * on this task is skipped by projectFiles), then the adds.
 * @param {{ user: object, task: { id: number, projectId: number }, addUploadKeys?: string[],
 *   removeFileIds?: number[], ip?: string | null }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<{ added: object[], removed: object[] }>} ProjectFile rows
 * @throws VALIDATION_FAILED (`fields.uploadKeys`, `fields.removeFileIds`), TOO_MANY_FILES (409),
 *   UPDATE_NEEDED (503, a list before migration 019)
 */
export async function changeFiles({ user, task, addUploadKeys, removeFileIds, ip = null }, trx) {
  const fileIds = unique(removeFileIds);
  const removed =
    fileIds.length > 0
      ? await projectFiles.removeTaskFiles({ user, taskId: task.id, fileIds, ip }, trx)
      : [];
  const added = await addFiles(
    { user, projectId: task.projectId, taskId: task.id, uploadKeys: addUploadKeys, ip },
    trx,
  );
  return { added, removed };
}

/**
 * Adds held uploads to an existing task (the task window's "Add files" and a drop on a card), then
 * tells the task's person, or every active member for a task for anyone (never the actor; nobody
 * for a done task).
 * @param {{ user: object, id: number, uploadKeys: string[], ip?: string | null }} args 1 to 20
 *   upload keys, each the user's own `ready` upload for this task or a new one, not expired
 * @returns {Promise<{ files: object[], told: 'person' | 'members' | null,
 *   toldName: string | null }>} files: the new ProjectFile rows
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND, VALIDATION_FAILED
 *   (`fields.uploadKeys` "brief.pdf couldn't be added. Add it again."), TOO_MANY_FILES (409),
 *   UPDATE_NEEDED (503, before migration 019)
 */
export async function attachFiles({ user, id, uploadKeys, ip = null }) {
  const values = parseInput(projectTaskFilesSchema, { uploadKeys });
  return db.transaction(async (trx) => {
    const { project, before } = await lockForManage(user, id, trx);
    const files = await addFiles(
      { user, projectId: project.id, taskId: before.id, uploadKeys: values.uploadKeys, ip },
      trx,
    );
    const reached =
      before.status === 'open'
        ? await sendFilesAdded(
            { task: before, project, ...(await teamOf(project, trx)), actor: user, files },
            trx,
          )
        : [];
    return { files, ...toldOf(reached, before) };
  });
}
