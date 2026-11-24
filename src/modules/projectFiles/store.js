// storeFile (CONTRACT 27, Modules "Worker and scripts"): bytes already in memory become a file
// through the same steps as a browser upload (Start, the bytes, Finish, and the attach for a task),
// so db/demo and the tests never copy storage code. Server only, never a route.
import fsp from 'node:fs/promises';
import { db } from '@/lib/db';
import { attachUploads } from './attach';
import { finishUpload } from './finish';
import { ensureReady, partPath } from './storage';
import * as uploadRepo from './uploadRepo';
import { startUpload } from './uploads';

/**
 * Stores bytes as a project file, as a held task upload (target 'task' with no `taskId`, or
 * `hold`), or as a file of an existing task (attached at once).
 * @param {{ user: object, projectId: number, target: 'project' | 'task', taskId?: number | null,
 *   phase?: string | null, visibility?: 'everyone' | 'managers', name: string,
 *   bytes: Buffer | Uint8Array | string, thumb?: Buffer | null, hold?: boolean }} args
 *   visibility: project files only, 'managers' when left out (fails closed); thumb: a JPEG kept
 *   as the picture's thumbnail
 * @returns {Promise<import('./service').ProjectFile | { key: string }>}
 * @throws what Start, Finish and attachUploads throw (VALIDATION_FAILED, NOT_FOUND, FORBIDDEN,
 *   FILE_TOO_BIG, FILES_SPACE_FULL, FILES_UNAVAILABLE, UPDATE_NEEDED, ...)
 */
export async function storeFile({
  user,
  projectId,
  target,
  taskId = null,
  phase = null,
  visibility = 'managers',
  name,
  bytes,
  thumb = null,
  hold = false,
}) {
  const buffer = Buffer.from(bytes);
  const input =
    target === 'project'
      ? { projectId, target, phase, visibility, name, size: buffer.length }
      : { projectId, target, taskId: taskId ?? null, name, size: buffer.length };
  const { key } = await startUpload({ user, input });
  const root = await ensureReady();
  const row = await uploadRepo.findByKey(key);
  await fsp.writeFile(partPath(root, key), buffer);
  await uploadRepo.savePiece({
    id: row.id,
    receivedBytes: buffer.length,
    expiresAt: row.expiresAt,
  });
  const finished = await finishUpload({ user, key, thumb: thumb ? new Blob([thumb]) : null });
  if (target === 'project') return finished.file;
  if (taskId === null || taskId === undefined || hold) return { key };
  const [file] = await db.transaction((trx) =>
    attachUploads({ user, projectId, taskId, uploadKeys: [key] }, trx),
  );
  return file;
}
