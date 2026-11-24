// The size rules of uploads (CONTRACT 27, Storage limit check and Settings), pure: the largest file
// and the storage limit in bytes, what counts as Space used, and the two "no room" sentences, which
// never name the file (the browser adds its own copy of the name, fileMessages.js).
import { formatSize } from './kinds';

const MIB = 1_048_576;
const GIB = 1024 * MIB;

/** The defaults of `db/seeds/03_settings.js` (a missing row reads as the default). */
export const DEFAULT_FILE_MAX_MB = 500;
export const DEFAULT_STORAGE_LIMIT_GB = 10;

/** 20 files on a task, 50 files per pick or drop (Limits). */
export const MAX_TASK_FILES = 20;
export const PICK_MAX = 50;

/** 10 running uploads per person. */
export const MAX_RUNNING_UPLOADS = 10;

/** Start refuses when the disk has less than the file's size plus this much free (256 MiB). */
export const FREE_DISK_MARGIN = 256 * MIB;

/**
 * The largest single file in bytes (`fileMaxMb` × 1,048,576).
 * @param {{ fileMaxMb?: number }} settings
 */
export function maxFileBytesOf(settings) {
  return (Number(settings?.fileMaxMb) || DEFAULT_FILE_MAX_MB) * MIB;
}

/**
 * The company's room for files in bytes (`fileStorageLimitGb` × 1024³).
 * @param {{ fileStorageLimitGb?: number }} settings
 */
export function limitBytesOf(settings) {
  return (Number(settings?.fileStorageLimitGb) || DEFAULT_STORAGE_LIMIT_GB) * GIB;
}

/**
 * True when a row counts towards Space used at `at`: an active file, or a running (`receiving`)
 * or held (`ready`) upload that hasn't expired. Deleted files and attached, cancelled or expired
 * uploads don't (an attached upload's bytes are counted by its file).
 * @param {{ kind: 'file' | 'upload', status: string, expiresAt?: Date }} row
 * @param {Date} at
 */
export function countsTowardSpace(row, at) {
  if (row.kind === 'file') return row.status === 'active';
  if (row.status !== 'receiving' && row.status !== 'ready') return false;
  return new Date(row.expiresAt).getTime() > new Date(at).getTime();
}

/**
 * Space used from rows (the same rule as the database sums in spaceRepo.js).
 * @param {Array<{ kind: 'file' | 'upload', status: string, sizeBytes: number,
 *   expiresAt?: Date }>} rows
 * @param {Date} at
 */
export function usedBytesOf(rows, at) {
  return rows.reduce(
    (sum, row) => sum + (countsTowardSpace(row, at) ? Number(row.sizeBytes) : 0),
    0,
  );
}

/** True when a new file of `sizeBytes` would pass the limit. */
export function isOverLimit({ usedBytes, sizeBytes, limitBytes }) {
  return usedBytes + sizeBytes > limitBytes;
}

/**
 * The FILES_SPACE_FULL sentence: an Admin (`settings.manage`) reads the numbers, anyone else to ask
 * an Admin. Neither names the file.
 * @param {{ admin: boolean, usedBytes: number, limitBytes: number }} info
 */
export function spaceFullMessage({ admin, usedBytes, limitBytes }) {
  if (!admin) return "There isn't enough space for this file. Ask an Admin to make room.";
  return (
    `Daybook's file space is full (${formatSize(usedBytes)} of ${formatSize(limitBytes)}). ` +
    'Delete old files or raise the limit in Settings.'
  );
}

/**
 * The FILE_TOO_BIG sentence: "This file is 1.2 GB. Each file can be up to 500 MB."
 * @param {{ sizeBytes: number, maxBytes: number }} info
 */
export function fileTooBigMessage({ sizeBytes, maxBytes }) {
  return `This file is ${formatSize(sizeBytes)}. Each file can be up to ${formatSize(maxBytes)}.`;
}
