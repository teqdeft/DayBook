// Finish of an upload (CONTRACT 27, Uploads "Finish"), safe to repeat at every stage (its answer
// can be lost to a host timeout): a lease of 5 minutes, the `.part` synced and renamed to its
// storage key, the picture header, the browser's thumbnail, then one transaction that locks the
// upload row and either attaches a project file (the person must still manage the project) or
// holds a task file's upload (`ready`) for the task save or the attach call.
import { db } from '@/lib/db';
import { now, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { projects } from '@/modules/projects';
import { canManageFiles, canSeeFile } from './access';
import { isOnDisk, removeQuietly, syncAndMove, withReader, writeThumb } from './disk';
import { cantAddFiles, fileError, uploadBusy } from './errors';
import { projectFileFor, toProjectFile } from './fileView';
import { guard019Write } from './migration019';
import { readPicture } from './pictures';
import { accessShape, viewerContext } from './reads';
import { secondsUntil } from './receive';
import * as repo from './repo';
import { ensureReady, newStorageKey, partPath, storedPath, thumbPath } from './storage';
import * as uploadRepo from './uploadRepo';
import { ownUpload, storageFailure } from './uploads';

const FINISH_LEASE_MS = 5 * 60_000;
const HELD_HOURS = 24;
const MAX_THUMB_BYTES = 512 * 1024;
const DUPLICATE = 1062;

/** The held upload as the browser gets it. */
function heldAnswer(row) {
  return {
    upload: {
      key: row.uploadKey,
      status: 'ready',
      name: row.name,
      size: Number(row.sizeBytes),
      ext: row.ext,
      isPicture: Boolean(row.isPicture),
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * An attached upload answers its file while the person may still see it (`canSeeFile`, as every
 * read); a file deleted since, or one they may no longer see (taken off the project, another PM
 * now), answers UPLOAD_GONE, so a repeat Finish says nothing about the file as it is now.
 */
async function attachedAnswer(user, row) {
  const file = row.fileId ? await repo.findFile(row.fileId) : null;
  const project = file ? await projects.findById(file.projectId) : null;
  if (!project) throw fileError('UPLOAD_GONE');
  const ctx = await viewerContext({ viewer: user, project });
  if (!canSeeFile(ctx, accessShape(file))) throw fileError('UPLOAD_GONE');
  return { file: toProjectFile(file, { canManage: canManageFiles(ctx) }) };
}

/** Step 1 when the lease wasn't claimed: answer what an earlier Finish did, or why not. */
async function answerWithoutLease(user, row) {
  if (row.status === 'ready') return heldAnswer(row);
  if (row.status === 'attached') return attachedAnswer(user, row);
  if (row.status !== 'receiving') throw fileError('UPLOAD_GONE');
  if (Number(row.receivedBytes) < Number(row.sizeBytes)) throw fileError('UPLOAD_INCOMPLETE');
  throw uploadBusy(row.busyUntil ? secondsUntil(row.busyUntil) : 2);
}

/** Step 2: the `.part` into place, or an earlier Finish already moved it. */
async function moveIntoPlace(root, row) {
  const part = partPath(root, row.uploadKey);
  const final = storedPath(root, row.storageKey);
  if (await isOnDisk(part)) {
    try {
      await syncAndMove(part, final);
    } catch (error) {
      const failure = await storageFailure(error, { uploadId: row.id });
      if (failure.code === 'FILES_DISK_FULL') {
        await uploadRepo.setStatus({ id: row.id, status: 'cancelled', from: ['receiving'] });
        await removeQuietly(part, final);
      }
      throw failure;
    }
  } else if (!(await isOnDisk(final))) {
    await uploadRepo.setStatus({ id: row.id, status: 'expired', from: ['receiving'] });
    throw fileError('UPLOAD_GONE');
  }
  return final;
}

/** Step 3: the picture header of the final file. */
async function pictureOf(final, ext) {
  try {
    return await withReader(final, (read) => readPicture(read, ext));
  } catch (error) {
    if (error?.code === 'ENOENT') throw fileError('UPLOAD_GONE');
    throw error;
  }
}

/** Step 4: a JPEG of at most 512 KB for a picture becomes its thumbnail; anything else is ignored. */
async function keepThumb(root, row, thumb, isPicture) {
  if (!isPicture || !thumb || typeof thumb === 'string' || !(thumb.size > 0)) return false;
  if (thumb.size > MAX_THUMB_BYTES) return false;
  const bytes = Buffer.from(await thumb.arrayBuffer());
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
  try {
    await writeThumb(thumbPath(root, row.storageKey), bytes);
    return true;
  } catch {
    return false; // no thumbnail, no error
  }
}

/** The new project file row of a project upload. */
function fileRow(row, picture, hasThumb) {
  const at = nowDate();
  return {
    projectId: row.projectId,
    scope: 'project',
    taskId: null,
    phase: row.phase,
    visibility: row.visibility,
    status: 'active',
    name: row.name,
    ext: row.ext,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    isPicture: picture.isPicture,
    width: picture.width,
    height: picture.height,
    hasThumb,
    createdBy: row.createdBy,
    createdAt: at,
    updatedAt: at,
  };
}

/** The audit fields of a file (never its name or any text). */
export function auditFields(file) {
  return {
    projectId: Number(file.projectId),
    scope: file.scope,
    taskId: file.taskId === null || file.taskId === undefined ? null : Number(file.taskId),
    phase: file.phase ?? null,
    visibility: file.visibility,
    sizeBytes: Number(file.sizeBytes),
    ext: file.ext,
  };
}

/** Step 5, target project: the file row, the upload attached, the audit row. */
async function attachProjectFile(user, row, picture, hasThumb, trx) {
  const project = await uploadRepo.findProject(row.projectId, trx);
  if (!project || !projects.canManage(user, project)) {
    await uploadRepo.setStatus({ id: row.id, status: 'cancelled' }, trx);
    return { refused: true };
  }
  const values = fileRow(row, picture, hasThumb);
  const fileId = await uploadRepo.insertFile(values, trx);
  await uploadRepo.markAttached({ id: row.id, fileId }, trx);
  await audit.log(
    {
      actorId: user.id,
      action: 'project_file.add',
      entityType: 'project_file',
      entityId: fileId,
      after: auditFields(values),
      ip: null,
    },
    trx,
  );
  return { fileId };
}

/** Step 5: one transaction that locks the upload row and goes on only while it is receiving. */
async function settle(user, row, picture, hasThumb) {
  return db.transaction(async (trx) => {
    const locked = await uploadRepo.findByKey(row.uploadKey, { trx, lock: true });
    if (!locked || locked.status !== 'receiving') return { lost: locked?.status ?? 'cancelled' };
    if (row.target === 'project') return attachProjectFile(user, locked, picture, hasThumb, trx);
    const expiresAt = now().add(HELD_HOURS, 'hour').toDate();
    const { isPicture, width, height } = picture;
    await uploadRepo.markReady({ id: row.id, isPicture, width, height, hasThumb, expiresAt }, trx);
    return { held: true };
  });
}

/** Finish once the lease is held: steps 2 to 5 and the answer. */
async function finishLeased(root, user, row, thumb) {
  const final = await moveIntoPlace(root, row);
  const picture = await pictureOf(final, row.ext);
  const hasThumb = await keepThumb(root, row, thumb, picture.isPicture);
  let outcome;
  try {
    outcome = await settle(user, row, picture, hasThumb);
  } catch (error) {
    // A second Finish after an expired lease: the first one's file row is there.
    if (error?.errno !== DUPLICATE) throw error;
    return answerWithoutLease(user, await ownUpload(user, row.uploadKey));
  }
  if (outcome.lost) {
    if (outcome.lost === 'cancelled' || outcome.lost === 'expired') {
      await removeQuietly(final, thumbPath(root, row.storageKey)); // a Cancel won the race
      throw fileError('UPLOAD_GONE');
    }
    return answerWithoutLease(user, await ownUpload(user, row.uploadKey));
  }
  if (outcome.refused) {
    await removeQuietly(final, thumbPath(root, row.storageKey));
    throw cantAddFiles();
  }
  if (outcome.held) return heldAnswer(await ownUpload(user, row.uploadKey));
  return { file: await projectFileFor({ viewer: user, id: outcome.fileId }) };
}

/**
 * Finish (`POST /api/uploads/[key]/finish`), safe to repeat: a project file is attached at once,
 * a task file's upload is held (`ready`) for 24 hours for the task save or the attach call.
 * @param {{ user: object, key: string, thumb?: Blob | null }} args thumb: the browser's JPEG
 * @returns {Promise<{ file: import('./service').ProjectFile } | { upload: { key: string,
 *   status: 'ready', name: string, size: number, ext: string, isPicture: boolean,
 *   expiresAt: Date } }>} `file` answers 201, `upload` 200
 * @throws NOT_FOUND, FORBIDDEN ("You can't add files to this project."), UPLOAD_INCOMPLETE (409),
 *   UPLOAD_GONE (410), UPLOAD_BUSY (429, with `retryAfter`), FILES_UNAVAILABLE (503),
 *   UPDATE_NEEDED (503), FILES_DISK_FULL (507)
 */
export async function finishUpload({ user, key, thumb = null }) {
  const root = await ensureReady();
  return guard019Write('files', async () => {
    const row = await ownUpload(user, key);
    if (row.status === 'receiving' && new Date(row.expiresAt) <= nowDate()) {
      await uploadRepo.setStatus({ id: row.id, status: 'expired', from: ['receiving'] });
      throw fileError('UPLOAD_GONE');
    }
    const at = nowDate();
    const until = new Date(at.getTime() + FINISH_LEASE_MS);
    const storageKey = newStorageKey(at);
    const claimed = await uploadRepo.claimFinishLease({
      id: row.id,
      userId: user.id,
      until,
      at,
      storageKey,
    });
    if (!claimed) return answerWithoutLease(user, await ownUpload(user, key));
    const leased = await ownUpload(user, key);
    try {
      return await finishLeased(root, user, leased, thumb);
    } finally {
      await uploadRepo.releaseLease(leased.id).catch(() => {});
    }
  });
}
