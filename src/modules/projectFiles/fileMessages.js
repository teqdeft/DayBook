// Every upload message, word for word (CONTRACT 27, Upload states and every message). Server
// messages never name a file, so the browser shows these with its own copy of the name, also for
// the server's error codes (`forCode`). Each function takes the file name, or an object with
// `name` and the numbers its message needs. Pure and browser-safe (kinds.js only).
import { formatSize } from './kinds';

const nameOf = (info) => (typeof info === 'string' ? info : (info?.name ?? 'This file'));
const numberOf = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** "notes.txt is empty." */
export const empty = (info) => `${nameOf(info)} is empty.`;

/** "site-video.mov is 1.2 GB. Each file can be up to 500 MB." */
export const tooBig = (info) =>
  `${nameOf(info)} is ${formatSize(info?.size)}. Each file can be up to ${formatSize(info?.maxBytes)}.`;

/** Task uploaders: "card-payment-error.png is already attached." */
export const alreadyAttached = (info) => `${nameOf(info)} is already attached.`;

/** The Files tab: "card-payment-error.png is already in the list." */
export const alreadyInList = (info) => `${nameOf(info)} is already in the list.`;

/** The 21st file on a task: "A task can have up to 20 files. Remove one to add more." */
export const taskFull = (info) =>
  `A task can have up to ${numberOf(info?.maxTaskFiles, 20)} files. Remove one to add more.`;

/** More than 50 picked or dropped at once: "Pick up to 50 files at a time." */
export const pickMax = (info) => `Pick up to ${numberOf(info?.pickMax, 50)} files at a time.`;

/**
 * Space full: an Admin reads the numbers, anyone else the file's name.
 * @param {{ admin?: boolean, name?: string, usedBytes?: number, limitBytes?: number,
 *   message?: string }} info `message`: the server's own (Admin) sentence, used without numbers
 */
export function spaceFull(info = {}) {
  if (!info.admin) {
    return `There isn't enough space for ${nameOf(info)}. Ask an Admin to make room.`;
  }
  if (info.usedBytes == null || info.limitBytes == null) {
    return (
      info.message ??
      "Daybook's file space is full. Delete old files or raise the limit in Settings."
    );
  }
  const used = formatSize(info.usedBytes);
  const limit = formatSize(info.limitBytes);
  return `Daybook's file space is full (${used} of ${limit}). Delete old files or raise the limit in Settings.`;
}

/** "The server is out of space for files. Ask an Admin." */
export const diskFull = () => 'The server is out of space for files. Ask an Admin.';

/** "File storage isn't set up yet. Ask an Admin." */
export const storageOff = () => "File storage isn't set up yet. Ask an Admin.";

/** Before migration 019: "This needs the latest database update. Ask an Admin." */
export const updateNeeded = () => 'This needs the latest database update. Ask an Admin.';

/** "You can't add files to this project." */
export const noPermission = () => "You can't add files to this project.";

/** An upload left too long (expired). */
export const expired = () =>
  'This upload stopped because it was left too long. Add the file again.';

/** An upload stopped elsewhere (cancelled). */
export const stopped = () => 'This upload was stopped. Add the file again.';

/** `UPLOAD_LOST`: removed on the server mid-upload. */
export const removedOnServer = (info) =>
  `${nameOf(info)} was removed from the server while it uploaded. Add it again. If it happens again, ask an Admin.`;

/** 401: "You were signed out. Sign in again, then press Retry." */
export const signedOut = () => 'You were signed out. Sign in again, then press Retry.';

/** The file changed or moved on the computer (`NotReadableError`). */
export const notReadable = (info) =>
  `Couldn't read ${nameOf(info)}. It may have been moved or changed. Choose it again.`;

/** Any 4xx whose body isn't Daybook's JSON (the host's firewall). */
export const hostRefused = (info) =>
  `The server refused part of ${nameOf(info)}. Ask an Admin to check the hosting limits.`;

/** `TOO_MANY_UPLOADS`: "You have 10 files uploading. Wait for some to finish." */
export const tooManyUploads = (info) =>
  `You have ${numberOf(info?.maxUploads, 10)} files uploading. Wait for some to finish.`;

/** A held file expired before Save: "brief.pdf couldn't be added. Add it again." */
export const heldExpired = (info) => `${nameOf(info)} couldn't be added. Add it again.`;

/** The Paused state line (after the sixth try). */
export const paused = (info) =>
  `Couldn't upload ${nameOf(info)}. Check your connection, then press Retry.`;

/** A paused chip blocks Save: "brief.pdf didn't finish uploading. Press Retry or remove it." */
export const notSaved = (info) =>
  `${nameOf(info)} didn't finish uploading. Press Retry or remove it.`;

/** A failed file of a card drop: "Couldn't upload brief.pdf. Check your connection, then drop it again." */
export const dropFailed = (info) =>
  `Couldn't upload ${nameOf(info)}. Check your connection, then drop it again.`;

/** Cancelled (polite): "Upload of brief.pdf cancelled." */
export const cancelled = (info) => `Upload of ${nameOf(info)} cancelled.`;

/** A download of a missing file: "This file is missing. Ask your PM to add it again." */
export const fileMissing = () => 'This file is missing. Ask your PM to add it again.';

const isAdminSpaceMessage = (message) =>
  typeof message === 'string' && message.startsWith("Daybook's file space is full");

/** `FILE_TOO_BIG` without the numbers: the server's "This file is ..." with the name. */
function tooBigFrom(info) {
  if (info.size != null && info.maxBytes != null) return tooBig(info);
  const message = info.message ?? '';
  return message.startsWith('This file ')
    ? `${nameOf(info)}${message.slice('This file'.length)}`
    : message || paused(info);
}

const BY_CODE = {
  FILE_TOO_BIG: tooBigFrom,
  FILES_SPACE_FULL: (info) =>
    spaceFull({ ...info, admin: info.admin ?? isAdminSpaceMessage(info.message) }),
  FILES_DISK_FULL: diskFull,
  FILES_UNAVAILABLE: storageOff,
  UPDATE_NEEDED: updateNeeded,
  FORBIDDEN: noPermission,
  UPLOAD_GONE: (info) => (info.uploadStatus === 'cancelled' ? stopped() : expired()),
  UPLOAD_LOST: removedOnServer,
  UNAUTHENTICATED: signedOut,
  TOO_MANY_UPLOADS: tooManyUploads,
  TOO_MANY_FILES: taskFull,
  FILE_MISSING: fileMissing,
  HOST_REFUSED: hostRefused,
  NOT_READABLE: notReadable,
  NETWORK: paused,
};

/**
 * The message for a server error code, with the file's name. Codes without a message of their own
 * here answer the server's own message (it never names a file), else the Paused line.
 * @param {string} code e.g. 'FILES_SPACE_FULL'; also 'HOST_REFUSED', 'NOT_READABLE', 'NETWORK'
 * @param {{ name?: string, admin?: boolean, usedBytes?: number, limitBytes?: number,
 *   size?: number, maxBytes?: number, maxTaskFiles?: number, uploadStatus?: string,
 *   message?: string }} [info] uploadStatus: from Status, to tell a cancelled upload ('cancelled')
 *   from an expired one on `UPLOAD_GONE`
 * @returns {string}
 */
export function forCode(code, info = {}) {
  const details = typeof info === 'string' ? { name: info } : (info ?? {});
  const message = Object.hasOwn(BY_CODE, code) ? BY_CODE[code](details) : null;
  return message ?? details.message ?? paused(details);
}

// ---------- Settings → Files and doctor (Admins read these, so never "Ask an Admin") ----------

const STORAGE_PROBLEMS = Object.freeze({
  not_set: 'Add FILES_DIR to the settings file on the server, then press Restart.',
  not_absolute:
    'FILES_DIR must be a full path that starts with /, for example /home/cpuser/daybook-files (not ~).',
  inside_app: 'FILES_DIR must be outside the daybook and public_html folders.',
  public: 'FILES_DIR must be outside the daybook and public_html folders.',
  not_empty: 'FILES_DIR must be a new, empty folder.',
  not_writable:
    "Daybook can't write to the FILES_DIR folder. Check it exists and its permissions are 700.",
});

/**
 * The sentence of a storage problem (Settings → Files; doctor uses the same words after
 * "✗ File storage isn't set up:").
 * @param {'not_set' | 'not_absolute' | 'inside_app' | 'public' | 'not_empty' | 'not_writable'
 *   | string | null} problem
 * @returns {string | null} null when there is no problem (or an unknown one)
 */
export const storageProblem = (problem) =>
  problem && Object.hasOwn(STORAGE_PROBLEMS, problem) ? STORAGE_PROBLEMS[problem] : null;

/** The server refused a write for lack of disk on that day ("Sat, 21 Nov"), within 7 days. */
export const diskRanOut = (day) =>
  `On ${day} the server ran out of disk space for files. Free space on the hosting account.`;

/** Settings → Files before migration 019, in place of the numbers. */
export const filesUpdateNeeded = () =>
  'Files need the latest database update. Run the migrate line in README, Updating.';
