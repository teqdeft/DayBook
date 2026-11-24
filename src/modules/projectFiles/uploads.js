// Start, Status and Cancel of an upload (CONTRACT 27, Uploads). Start checks the project, the
// person, the size, the running uploads, the free disk and the storage limit, then holds the room
// with a `receiving` row and its empty `.part`. Pieces are receive.js, Finish is finish.js.
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { now, nowDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { diskProblem, createPart, freeBytes, removeQuietly } from './disk';
import {
  alreadyAdded,
  cantAddFiles,
  fileError,
  projectNotFound,
  taskNotFound,
  uploadNotFound,
} from './errors';
import { guard019Write } from './migration019';
import { extOf, cleanFileName } from './names';
import { parseInput, uploadKeySchema, uploadStartSchema } from './schemas';
import { markDiskFull, reserveUpload } from './space';
import {
  FREE_DISK_MARGIN,
  MAX_RUNNING_UPLOADS,
  fileTooBigMessage,
  maxFileBytesOf,
} from './spaceRules';
import { settings } from '@/modules/settings';
import {
  ensureReady,
  forgetStorageCheck,
  newUploadKey,
  partPath,
  storedPath,
  thumbPath,
} from './storage';
import * as uploadRepo from './uploadRepo';

/** A receiving upload lives 2 hours after Start or its last piece. */
export const RECEIVING_HOURS = 2;

let pieceBytesForTests = null;

/**
 * Test seam: the piece size Start hands out (null puts back `env.filesPieceBytes`).
 * @param {number | null} bytes
 */
export function setPieceBytesForTests(bytes) {
  pieceBytesForTests = bytes ?? null;
}

/** The piece size Start hands out now. */
export const pieceBytesNow = () => pieceBytesForTests ?? env.filesPieceBytes;

/** The person's upload by its key: 404 for a malformed, unknown or someone else's key. */
export async function ownUpload(user, key, { trx, lock = false } = {}) {
  if (!uploadKeySchema.safeParse(key).success) throw uploadNotFound();
  const row = await uploadRepo.findByKey(key, { trx, lock });
  if (!row || Number(row.createdBy) !== Number(user?.id)) throw uploadNotFound();
  return row;
}

/**
 * The answer for a disk error while making or writing an upload's files (Storage, Disk-full
 * handling); the caller has stopped the upload where that applies. Unknown errors pass through.
 * @param {unknown} error
 * @param {{ uploadId?: number }} [ids] for the log (ids only, never a name)
 * @returns {Promise<Error>}
 */
export async function storageFailure(error, { uploadId } = {}) {
  const problem = diskProblem(error);
  if (problem === 'disk_full') {
    await markDiskFull();
    logger.error({ uploadId, code: error?.code }, 'The server ran out of disk space for files');
    return fileError('FILES_DISK_FULL');
  }
  if (problem === 'unavailable') {
    forgetStorageCheck();
    return fileError('FILES_UNAVAILABLE');
  }
  if (problem === 'busy') return fileError('UPLOAD_BUSY');
  return error;
}

/** Start's checks of the project and the task; returns nothing or throws. */
async function checkPlace(user, input) {
  const project = await uploadRepo.findProject(input.projectId);
  if (!project) throw projectNotFound();
  if (!projects.canManage(user, project)) throw cantAddFiles();
  if (input.target === 'task' && input.taskId !== null) {
    const task = await uploadRepo.findTask(input.taskId);
    if (!task || Number(task.projectId) !== Number(project.id)) throw taskNotFound();
  }
}

/** Start's size and running-upload checks, then the free disk. */
async function checkRoom(root, user, size) {
  const maxBytes = maxFileBytesOf(await settings.getAll());
  if (size > maxBytes) {
    throw fileError('FILE_TOO_BIG', { message: fileTooBigMessage({ sizeBytes: size, maxBytes }) });
  }
  if ((await uploadRepo.countReceivingFor(user.id, nowDate())) >= MAX_RUNNING_UPLOADS) {
    throw fileError('TOO_MANY_UPLOADS');
  }
  if ((await freeBytes(root)) < size + FREE_DISK_MARGIN) {
    await markDiskFull();
    throw fileError('FILES_DISK_FULL');
  }
}

/** The new upload row (target project: its place and who sees it; target task: its task). */
function uploadRow(user, input, name) {
  const at = nowDate();
  const isProject = input.target === 'project';
  return {
    uploadKey: newUploadKey(),
    projectId: input.projectId,
    target: input.target,
    taskId: isProject ? null : input.taskId,
    phase: isProject ? input.phase : null,
    visibility: isProject ? input.visibility : 'managers',
    name,
    ext: extOf(name),
    sizeBytes: input.size,
    receivedBytes: 0,
    pieceBytes: pieceBytesNow(),
    status: 'receiving',
    expiresAt: now().add(RECEIVING_HOURS, 'hour').toDate(),
    createdBy: user.id,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Start (`POST /api/uploads`).
 * @param {{ user: object, input: object }} args input: `uploadStartSchema`
 * @returns {Promise<{ key: string, pieceSize: number, offset: 0, name: string, size: number,
 *   expiresAt: Date }>} name: the cleaned name the server keeps
 * @throws VALIDATION_FAILED, NOT_FOUND, FORBIDDEN, FILE_TOO_BIG (413), TOO_MANY_UPLOADS (429),
 *   FILES_UNAVAILABLE (503), UPDATE_NEEDED (503), FILES_SPACE_FULL (507), FILES_DISK_FULL (507)
 */
export async function startUpload({ user, input }) {
  const data = parseInput(uploadStartSchema, input);
  const root = await ensureReady();
  return guard019Write('files', async () => {
    await checkPlace(user, data);
    await checkRoom(root, user, data.size);
    const row = uploadRow(user, data, cleanFileName(data.name));
    const id = await reserveUpload({ user, row });
    try {
      await createPart(partPath(root, row.uploadKey));
    } catch (error) {
      await uploadRepo.setStatus({ id, status: 'cancelled' });
      throw await storageFailure(error, { uploadId: id });
    }
    return {
      key: row.uploadKey,
      pieceSize: row.pieceBytes,
      offset: 0,
      name: row.name,
      size: row.sizeBytes,
      expiresAt: row.expiresAt,
    };
  });
}

/** A `receiving` upload past its time reads as expired. */
const statusOf = (row) =>
  row.status === 'receiving' && new Date(row.expiresAt) <= nowDate() ? 'expired' : row.status;

/**
 * Status (`GET /api/uploads/[key]`) of the person's own upload. `busy`: a lease is held now.
 * `status` tells a cancelled upload from an expired one (a `receiving` one past its time reads
 * `expired`).
 * @param {{ user: object, key: string }} args
 * @returns {Promise<{ key: string, offset: number, size: number, status: string, busy: boolean,
 *   expiresAt: Date }>}
 * @throws NOT_FOUND, UPDATE_NEEDED (503)
 */
export async function uploadStatus({ user, key }) {
  return guard019Write('files', async () => {
    const row = await ownUpload(user, key);
    return {
      key: row.uploadKey,
      offset: Number(row.receivedBytes),
      size: Number(row.sizeBytes),
      status: statusOf(row),
      busy: Boolean(row.busyUntil && new Date(row.busyUntil) > nowDate()),
      expiresAt: row.expiresAt,
    };
  });
}

/** Deletes an upload's disk files (the `.part`, a file at its storage key and its `.t`). */
export async function removeUploadFiles(root, row) {
  const targets = [partPath(root, row.uploadKey)];
  if (row.storageKey)
    targets.push(storedPath(root, row.storageKey), thumbPath(root, row.storageKey));
  await removeQuietly(...targets);
}

/** The files folder when it is usable, else null (a cancel still stops the upload). */
async function rootOrNull() {
  try {
    return await ensureReady();
  } catch {
    return null;
  }
}

/**
 * Cancel (`DELETE /api/uploads/[key]`), one statement: the person's `receiving` or `ready` upload
 * becomes `cancelled`, then its disk files go. A cancel that meets a running Finish or task save
 * waits on that row lock and then sees `attached`, so a committed file never loses its disk file.
 * @param {{ user: object, key: string }} args
 * @returns {Promise<{ cancelled: true }>}
 * @throws NOT_FOUND, CONFLICT ("This file is already added."), UPDATE_NEEDED (503)
 */
export async function cancelUpload({ user, key }) {
  if (!uploadKeySchema.safeParse(key).success) throw uploadNotFound();
  return guard019Write('files', async () => {
    const changed = await uploadRepo.cancelByKey({ uploadKey: key, userId: user.id });
    const row = await ownUpload(user, key);
    if (changed) {
      const root = await rootOrNull();
      if (root) await removeUploadFiles(root, row);
      return { cancelled: true };
    }
    if (row.status === 'attached') throw alreadyAdded();
    return { cancelled: true };
  });
}
