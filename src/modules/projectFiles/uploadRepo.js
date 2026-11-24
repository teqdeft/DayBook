// Queries of uploads on their way in (`file_uploads`, CONTRACT 27 Uploads) and the inserts of new
// file rows. Reads `projects` and `project_tasks` read-only (the PM, the task's project) and never
// writes them. Times are the app clock (`nowDate()`): every status change writes `updated_at`
// itself, so the nightly cleanup's 7 days follow the app clock too.
import { db } from '@/lib/db';
import { nowDate } from '@/lib/time';

const UPLOAD_COLUMNS = [
  'id',
  'uploadKey',
  'projectId',
  'target',
  'taskId',
  'phase',
  'visibility',
  'name',
  'ext',
  'sizeBytes',
  'receivedBytes',
  'pieceBytes',
  'status',
  'storageKey',
  'isPicture',
  'width',
  'height',
  'hasThumb',
  'fileId',
  'busyUntil',
  'expiresAt',
  'createdBy',
  'createdAt',
];

/** The project's id, PM and status (for canManageProject), or undefined. */
export function findProject(projectId, trx = db) {
  return trx('projects').where({ id: projectId }).first('id', 'pmId', 'status');
}

/** The task's id and project, or undefined. */
export function findTask(taskId, trx = db) {
  return trx('projectTasks').where({ id: taskId }).first('id', 'projectId');
}

/** One upload by its key (`FOR UPDATE` with `lock`), or undefined. */
export function findByKey(uploadKey, { trx = db, lock = false } = {}) {
  const query = trx('fileUploads').where({ uploadKey }).first(UPLOAD_COLUMNS);
  return lock ? query.forUpdate() : query;
}

/** Uploads by their keys, oldest first, locked (`FOR UPDATE`) for an attach. */
export function lockByKeys(uploadKeys, trx) {
  return trx('fileUploads')
    .whereIn('uploadKey', uploadKeys)
    .orderBy('id')
    .forUpdate()
    .select(UPLOAD_COLUMNS);
}

/** The person's `receiving` uploads that haven't expired. */
export async function countReceivingFor(userId, at, trx = db) {
  const row = await trx('fileUploads')
    .where({ createdBy: userId, status: 'receiving' })
    .where('expiresAt', '>', at)
    .count({ n: '*' })
    .first();
  return Number(row?.n ?? 0);
}

/** Inserts an upload row; returns its id. */
export async function insertUpload(row, trx = db) {
  const [id] = await trx('fileUploads').insert(row);
  return id;
}

/**
 * Claims the lease of a piece in one statement: only the person's `receiving` upload at this
 * offset whose lease is free or over. Returns how many rows changed (0 or 1).
 */
export function claimPieceLease({ id, userId, offset, until, at }, trx = db) {
  return trx('fileUploads')
    .where({ id, createdBy: userId, status: 'receiving', receivedBytes: offset })
    .where((where) => where.whereNull('busyUntil').orWhere('busyUntil', '<', at))
    .update({ busyUntil: until });
}

/**
 * Claims the Finish lease when every byte is in, and sets the storage key in the same statement
 * when there is none yet (so the row always names any disk file Finish makes).
 */
export function claimFinishLease({ id, userId, until, at, storageKey }, trx = db) {
  return trx('fileUploads')
    .where({ id, createdBy: userId, status: 'receiving' })
    .whereRaw('received_bytes = size_bytes')
    .where((where) => where.whereNull('busyUntil').orWhere('busyUntil', '<', at))
    .update({ busyUntil: until, storageKey: trx.raw('COALESCE(storage_key, ?)', [storageKey]) });
}

/** Lets go of a lease (any status: a cancel may have changed it meanwhile). */
export function releaseLease(id, trx = db) {
  return trx('fileUploads').where({ id }).update({ busyUntil: null });
}

/** A whole piece is in: the new offset, the lease freed, two more hours. 0 rows: cancelled. */
export function savePiece({ id, receivedBytes, expiresAt }, trx = db) {
  return trx('fileUploads')
    .where({ id, status: 'receiving' })
    .update({ receivedBytes, busyUntil: null, expiresAt, updatedAt: nowDate() });
}

/** The `.part` lost data: the offset goes back to its last whole piece. */
export function setReceived({ id, receivedBytes }, trx = db) {
  return trx('fileUploads')
    .where({ id, status: 'receiving' })
    .update({ receivedBytes, updatedAt: nowDate() });
}

/** Marks an upload `expired` or `cancelled` (and frees its lease). */
export function setStatus({ id, status, from = null }, trx = db) {
  const query = trx('fileUploads').where({ id });
  if (from) query.whereIn('status', from);
  return query.update({ status, busyUntil: null, updatedAt: nowDate() });
}

/** Cancel in one statement: the person's `receiving` or `ready` upload. Rows changed. */
export function cancelByKey({ uploadKey, userId }, trx = db) {
  return trx('fileUploads')
    .where({ uploadKey, createdBy: userId })
    .whereIn('status', ['receiving', 'ready'])
    .update({ status: 'cancelled', busyUntil: null, updatedAt: nowDate() });
}

/** A task file's upload is held: `ready`, its picture fields, 24 hours to be attached. */
export function markReady({ id, isPicture, width, height, hasThumb, expiresAt }, trx = db) {
  return trx('fileUploads').where({ id, status: 'receiving' }).update({
    status: 'ready',
    isPicture,
    width,
    height,
    hasThumb,
    expiresAt,
    busyUntil: null,
    updatedAt: nowDate(),
  });
}

/** The upload became a file row. */
export function markAttached({ id, fileId }, trx = db) {
  return trx('fileUploads')
    .where({ id })
    .update({ status: 'attached', fileId, busyUntil: null, updatedAt: nowDate() });
}

/** Inserts a `project_files` row; returns its id. */
export async function insertFile(row, trx = db) {
  const [id] = await trx('projectFiles').insert(row);
  return id;
}

/** The id and status of the file a storage key belongs to, or undefined. */
export function findFileByStorageKey(storageKey, trx = db) {
  return trx('projectFiles').where({ storageKey }).first('id', 'status');
}
