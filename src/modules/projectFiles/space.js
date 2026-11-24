// The storage limit (CONTRACT 27, Storage limit check) and Settings → Files: Start holds its room
// in one transaction that locks the `file_space` row first, and Space used is read by bytes from
// the database (no disk scan).
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import { fileError } from './errors';
import { guard019Read } from './migration019';
import * as spaceRepo from './spaceRepo';
import {
  MAX_TASK_FILES,
  PICK_MAX,
  isOverLimit,
  limitBytesOf,
  maxFileBytesOf,
  spaceFullMessage,
} from './spaceRules';
import { storageStatus } from './storage';
import * as uploadRepo from './uploadRepo';

const RETRY_ERRNOS = new Set([1213, 1205]); // deadlock, lock wait timeout
const ATTEMPTS = 3;

/**
 * The limits the uploaders check before sending (Settings, Limits).
 * @returns {Promise<{ maxFileBytes: number, maxTaskFiles: number, pickMax: number }>}
 */
export async function limits() {
  const current = await settings.getAll();
  return { maxFileBytes: maxFileBytesOf(current), maxTaskFiles: MAX_TASK_FILES, pickMax: PICK_MAX };
}

/**
 * Locks the `file_space` row (the first statement of the transaction, so the plain reads after
 * it see every upload another Start committed while this one waited). Only when the row is gone
 * (after `reset` or `seed:demo`) is it put back with INSERT IGNORE and locked again: an INSERT
 * IGNORE on every Start would take a shared lock that deadlocks two Starts sent together.
 */
async function lockSpace(trx, at) {
  if (await spaceRepo.lockSpaceRow(trx)) return;
  await spaceRepo.insertSpaceRow(at, trx);
  await spaceRepo.lockSpaceRow(trx);
}

/**
 * Holds the room of a new upload: under the `file_space` lock, Space used plus this file must stay
 * within the storage limit, and the upload row is inserted in the same transaction. Tried again
 * up to 3 times on a deadlock or a lock wait timeout.
 * @param {{ user: object, row: object }} args row: the new `file_uploads` row
 * @returns {Promise<number>} the upload's id
 * @throws FILES_SPACE_FULL (507), UPLOAD_BUSY (429) when it still can't get the lock
 */
export async function reserveUpload({ user, row }) {
  const limitBytes = limitBytesOf(await settings.getAll());
  const admin = can(user, 'settings.manage');
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(
        async (trx) => {
          const at = nowDate();
          await lockSpace(trx, at);
          const usedBytes =
            (await spaceRepo.activeFileBytes(trx)) + (await spaceRepo.heldUploadBytes(at, trx));
          if (isOverLimit({ usedBytes, sizeBytes: Number(row.sizeBytes), limitBytes })) {
            const message = spaceFullMessage({ admin, usedBytes, limitBytes });
            throw fileError('FILES_SPACE_FULL', { message });
          }
          return uploadRepo.insertUpload(row, trx);
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      if (!RETRY_ERRNOS.has(error?.errno)) throw error;
      if (attempt >= ATTEMPTS) throw fileError('UPLOAD_BUSY', { cause: error });
    }
  }
}

/** Remembers that the server refused a write for lack of disk (Settings shows the day). */
export async function markDiskFull() {
  try {
    await spaceRepo.setDiskFullAt(nowDate());
  } catch (error) {
    logger.warn({ errno: error?.errno }, "Couldn't note that the disk is full");
  }
}

const NO_NUMBERS = Object.freeze({
  usedBytes: 0,
  heldBytes: 0,
  deletedBytes: 0,
  fileCount: 0,
  projectCount: 0,
  diskFullAt: null,
  updateNeeded: true,
});

/**
 * Space used for Settings → Files, by bytes from the database (no disk scan). `usedBytes` is what
 * the storage limit check counts: every active file plus every running or held upload that hasn't
 * expired; `heldBytes` is the uploads' share of it; `deletedBytes` (not in `usedBytes`) waits for
 * the nightly cleanup. Before 019 every number is 0 and `updateNeeded` is true.
 * @returns {Promise<{ usedBytes: number, heldBytes: number, deletedBytes: number,
 *   limitBytes: number, fileCount: number, projectCount: number, diskFullAt: Date | null,
 *   updateNeeded: boolean, storage: { ready: boolean, problem: string | null } }>} diskFullAt:
 *   the last refusal for lack of disk, whenever it was (Settings shows it within 7 days)
 */
export async function spaceUsage() {
  const [storage, current] = await Promise.all([storageStatus(), settings.getAll()]);
  const numbers = await guard019Read(
    'files',
    async () => {
      const at = nowDate();
      const fileBytes = await spaceRepo.activeFileBytes();
      const heldBytes = await spaceRepo.heldUploadBytes(at);
      const deletedBytes = await spaceRepo.deletedFileBytes();
      const counts = await spaceRepo.activeFileCounts();
      const diskFullAt = await spaceRepo.diskFullAt();
      return {
        usedBytes: fileBytes + heldBytes,
        heldBytes,
        deletedBytes,
        ...counts,
        diskFullAt,
        updateNeeded: false,
      };
    },
    () => ({ ...NO_NUMBERS }),
  );
  return { ...numbers, limitBytes: limitBytesOf(current), storage };
}

export { storageStatus };
