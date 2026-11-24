// Files on tasks inside the caller's transaction (CONTRACT 27, Task files; B's task save, the
// attach call and the task delete). Lock order everywhere: the task row (B), then upload rows,
// then file rows. Empty lists answer [] without a query; before 019 the reads answer 0 and a save
// that names upload keys or file ids answers UPDATE_NEEDED (Deploy before migrate).
import { validationError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { isOnDisk } from './disk';
import { fileError } from './errors';
import { auditFields } from './finish';
import { projectFilesFor } from './fileView';
import { guard019Read, guard019Write } from './migration019';
import { MAX_TASK_FILES } from './spaceRules';
import { ensureReady, storedPath } from './storage';
import * as uploadRepo from './uploadRepo';

const NOT_ON_TASK = "That file isn't on this task any more.";

/** "brief.pdf couldn't be added. Add it again." on `fields.uploadKeys` (a 4xx is never logged). */
function couldNotAdd(name) {
  const message = name
    ? `${name} couldn't be added. Add it again.`
    : "A file couldn't be added. Add it again.";
  return validationError({ uploadKeys: message }, message);
}

/** Why a held upload can't go on this task: its name when it is the person's own, else null. */
async function refusalOf(root, row, { user, projectId, taskId, at }) {
  if (!row || Number(row.createdBy) !== Number(user.id)) return { name: null };
  const fits =
    Number(row.projectId) === Number(projectId) &&
    row.target === 'task' &&
    (row.taskId === null || Number(row.taskId) === Number(taskId)) &&
    row.status === 'ready' &&
    new Date(row.expiresAt) > at &&
    row.storageKey &&
    (await isOnDisk(storedPath(root, row.storageKey)));
  return fits ? null : { name: row.name };
}

/** The task's active file rows, a locking read (after the task row lock). */
function lockActiveFiles(taskId, trx) {
  return trx('projectFiles').where({ taskId, status: 'active' }).forUpdate().select('id');
}

/** The new task file row of a held upload. */
function taskFileRow(row, taskId, at) {
  return {
    projectId: row.projectId,
    scope: 'task',
    taskId,
    phase: null,
    visibility: 'managers',
    status: 'active',
    name: row.name,
    ext: row.ext,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    isPicture: Boolean(row.isPicture),
    width: row.width,
    height: row.height,
    hasThumb: Boolean(row.hasThumb),
    createdBy: row.createdBy,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Turns held uploads into files of a task, inside the caller's transaction: each key must be the
 * person's own, on this project, for a task (none yet, or this one), `ready`, not expired, and
 * its file on disk; else the whole save is refused. Each upload row is locked (`FOR UPDATE`), so
 * two saves can't use one upload. Writes `project_file.add` for each file.
 * @param {{ user: object, projectId: number, taskId: number, uploadKeys: string[],
 *   ip?: string | null }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<import('./service').ProjectFile[]>} in the order of `uploadKeys`
 * @throws VALIDATION_FAILED (`fields.uploadKeys`: "brief.pdf couldn't be added. Add it again."),
 *   TOO_MANY_FILES (409), FILES_UNAVAILABLE (503), UPDATE_NEEDED (503)
 */
export async function attachUploads({ user, projectId, taskId, uploadKeys, ip = null }, trx) {
  const keys = [...new Set(uploadKeys ?? [])];
  if (!keys.length) return [];
  return guard019Write('files', async () => {
    const root = await ensureReady();
    const at = nowDate();
    const rows = await uploadRepo.lockByKeys(keys, trx);
    const byKey = new Map(rows.map((row) => [row.uploadKey, row]));
    for (const key of keys) {
      const refusal = await refusalOf(root, byKey.get(key), { user, projectId, taskId, at });
      if (refusal) throw couldNotAdd(refusal.name);
    }
    const active = await lockActiveFiles(taskId, trx);
    if (active.length + keys.length > MAX_TASK_FILES) throw fileError('TOO_MANY_FILES');
    const ids = [];
    for (const key of keys) {
      const row = byKey.get(key);
      const values = taskFileRow(row, Number(taskId), at);
      const fileId = await uploadRepo.insertFile(values, trx);
      await uploadRepo.markAttached({ id: row.id, fileId }, trx);
      await audit.log(
        {
          actorId: user.id,
          action: 'project_file.add',
          entityType: 'project_file',
          entityId: fileId,
          after: auditFields(values),
          ip,
        },
        trx,
      );
      ids.push(fileId);
    }
    return projectFilesFor({ viewer: user, ids }, trx);
  });
}

/**
 * Soft deletes files of one task inside the caller's transaction (the browser's Undo has passed):
 * an id already deleted on this task is skipped, as it is gone as asked; an id that is unknown or
 * on another task refuses the whole save. Writes `project_file.delete` for each.
 * @param {{ user: object, taskId: number, fileIds: number[], ip?: string | null }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<import('./service').ProjectFile[]>} the files removed now
 * @throws VALIDATION_FAILED (`fields.removeFileIds`: "That file isn't on this task any more."),
 *   UPDATE_NEEDED (503)
 */
export async function removeTaskFiles({ user, taskId, fileIds, ip = null }, trx) {
  const ids = [...new Set((fileIds ?? []).map(Number))];
  if (!ids.length) return [];
  return guard019Write('files', async () => {
    const rows = await trx('projectFiles').whereIn('id', ids).orderBy('id').forUpdate().select('*');
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row || row.scope !== 'task' || Number(row.taskId) !== Number(taskId)) {
        throw validationError({ removeFileIds: NOT_ON_TASK }, NOT_ON_TASK);
      }
    }
    const removing = ids.filter((id) => byId.get(id).status === 'active');
    if (!removing.length) return [];
    const files = await projectFilesFor({ viewer: user, ids: removing }, trx);
    const at = nowDate();
    await trx('projectFiles').whereIn('id', removing).update({
      status: 'deleted',
      deletedAt: at,
      deletedBy: user.id,
      updatedAt: at,
      updatedBy: user.id,
    });
    for (const id of removing) {
      await audit.log(
        {
          actorId: user.id,
          action: 'project_file.delete',
          entityType: 'project_file',
          entityId: id,
          before: auditFields(byId.get(id)),
          ip,
        },
        trx,
      );
    }
    return files;
  });
}

/**
 * Marks every active file of a task deleted, inside the task delete's transaction, before the row
 * delete (the disk files go in the nightly cleanup). Held uploads that named the task lose
 * `task_id` (SET NULL) and expire. Before 019: 0, nothing written.
 * @param {{ user: object, taskId: number }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<number>} how many
 */
export async function deleteFilesOfTask({ user, taskId }, trx) {
  return guard019Read(
    'files',
    async () => {
      const at = nowDate();
      return trx('projectFiles').where({ taskId, status: 'active' }).update({
        status: 'deleted',
        deletedAt: at,
        deletedBy: user.id,
        updatedAt: at,
        updatedBy: user.id,
      });
    },
    () => 0,
  );
}

/**
 * The task's active files, a locking read (`FOR UPDATE` on its file rows, after the task row
 * lock, so a snapshot taken earlier can't hide another save's files). Before 019: 0.
 * @param {number} taskId
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<number>}
 */
export async function countActiveForTask(taskId, trx) {
  return guard019Read(
    'files',
    async () => (await lockActiveFiles(taskId, trx)).length,
    () => 0,
  );
}
