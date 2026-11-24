// Queries of the storage limit and Settings → Files (CONTRACT 27, Storage limit check): the
// `file_space` lock row and the byte sums, all from the database (no disk scan).
import { db } from '@/lib/db';

const RUNNING = ['receiving', 'ready'];

/** `SELECT id FROM file_space WHERE id = 1 FOR UPDATE`: the lock two Starts take in turn. */
export function lockSpaceRow(trx) {
  return trx('fileSpace').where({ id: 1 }).forUpdate().first('id');
}

/** Puts the lock row back (after `reset` or `seed:demo` emptied the table): INSERT IGNORE. */
export function insertSpaceRow(at, trx) {
  return trx('fileSpace').insert({ id: 1, updatedAt: at }).onConflict().ignore();
}

/** Bytes of every active file. */
export async function activeFileBytes(trx = db) {
  const row = await trx('projectFiles')
    .where({ status: 'active' })
    .sum({ total: 'sizeBytes' })
    .first();
  return Number(row?.total ?? 0);
}

/** Bytes held by `receiving` and `ready` uploads that haven't expired at `at`. */
export async function heldUploadBytes(at, trx = db) {
  const row = await trx('fileUploads')
    .whereIn('status', RUNNING)
    .where('expiresAt', '>', at)
    .sum({ total: 'sizeBytes' })
    .first();
  return Number(row?.total ?? 0);
}

/** Deleted files whose disk file waits for the nightly cleanup. */
export async function deletedFileBytes(trx = db) {
  const row = await trx('projectFiles')
    .where({ status: 'deleted' })
    .sum({ total: 'sizeBytes' })
    .first();
  return Number(row?.total ?? 0);
}

/** How many active files, on how many projects. */
export async function activeFileCounts(trx = db) {
  const row = await trx('projectFiles')
    .where({ status: 'active' })
    .count({ files: '*' })
    .countDistinct({ projects: 'projectId' })
    .first();
  return { fileCount: Number(row?.files ?? 0), projectCount: Number(row?.projects ?? 0) };
}

/** The last time the server refused a write for lack of disk, or null. */
export async function diskFullAt(trx = db) {
  const row = await trx('fileSpace').where({ id: 1 }).first('diskFullAt');
  return row?.diskFullAt ?? null;
}

/** Remembers that the server ran out of disk now (the row is put back when missing). */
export async function setDiskFullAt(at, trx = db) {
  const changed = await trx('fileSpace').where({ id: 1 }).update({ diskFullAt: at, updatedAt: at });
  if (!changed) {
    await trx('fileSpace')
      .insert({ id: 1, diskFullAt: at, updatedAt: at })
      .onConflict()
      .merge(['diskFullAt', 'updatedAt']);
  }
}
