// The errors of project and task files (CONTRACT 27, API "Error codes"). None is added to
// `@/lib/errors`: each is `new AppError(code, { status, message })` from here. Messages never hold
// a file name (the browser adds its own copy of the name, fileMessages.js); a 5xx is written to the
// error log by withRoute with its requestId.
import { AppError } from '@/lib/errors';

/** Every code of section 27 with its status and sentence. */
export const FILE_ERRORS = Object.freeze({
  FILES_UNAVAILABLE: { status: 503, message: "File storage isn't set up yet. Ask an Admin." },
  UPDATE_NEEDED: { status: 503, message: 'This needs the latest database update. Ask an Admin.' },
  FILES_SPACE_FULL: {
    status: 507,
    message: "There isn't enough space for this file. Ask an Admin to make room.",
  },
  FILES_DISK_FULL: { status: 507, message: 'The server is out of space for files. Ask an Admin.' },
  FILE_TOO_BIG: { status: 413, message: 'This file is too big.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'That part of the file is too large.' },
  LENGTH_REQUIRED: { status: 411, message: 'That part of the file came without its size.' },
  UPLOAD_GONE: {
    status: 410,
    message: 'This upload stopped because it was left too long. Add the file again.',
  },
  UPLOAD_LOST: {
    status: 410,
    message:
      'This file was removed from the server while it uploaded. Add it again. If it happens ' +
      'again, ask an Admin.',
  },
  UPLOAD_OFFSET: { status: 409, message: 'Daybook has a different part of this file.' },
  UPLOAD_INCOMPLETE: { status: 409, message: 'Some of this file is still missing.' },
  TOO_MANY_FILES: {
    status: 409,
    message: 'A task can have up to 20 files. Remove one to add more.',
  },
  TOO_MANY_UPLOADS: {
    status: 429,
    message: 'You have 10 files uploading. Wait for some to finish.',
  },
  UPLOAD_BUSY: { status: 429, message: 'Daybook is busy with other files. Trying again.' },
  PIECE_BAD: { status: 400, message: "That part of the file didn't arrive whole." },
  PIECE_CHECKSUM: {
    status: 422,
    message: 'That part of the file changed on the way. Daybook will send it again.',
  },
  FILE_MISSING: { status: 404, message: 'This file is missing. Ask your PM to add it again.' },
});

/** The plain "no" sentences that use the general codes (NOT_FOUND, FORBIDDEN, CONFLICT). */
export const FILE_SENTENCES = Object.freeze({
  fileNotFound: "We couldn't find that file.",
  uploadNotFound: "We couldn't find that upload.",
  projectNotFound: "We couldn't find that project.",
  taskNotFound: "We couldn't find that task.",
  cantAdd: "You can't add files to this project.",
  cantChange: "You can't change files on this project.",
  alreadyAdded: 'This file is already added.',
  notShown: "This file can't be shown here. Download it instead.",
});

/**
 * An AppError for one code of section 27 with its own status and sentence.
 * @param {keyof typeof FILE_ERRORS} code
 * @param {{ message?: string, fields?: Record<string, string>, cause?: unknown }} [options]
 * @returns {AppError}
 */
export function fileError(code, { message, fields, cause } = {}) {
  const known = FILE_ERRORS[code];
  if (!known) throw new Error(`Unknown file error code ${code}`);
  return new AppError(code, {
    status: known.status,
    message: message ?? known.message,
    fields,
    cause,
  });
}

/** 404 NOT_FOUND "We couldn't find that file." (every "no" on a read, Who sees and does what). */
export const fileNotFound = () =>
  new AppError('NOT_FOUND', { message: FILE_SENTENCES.fileNotFound });

/** 404 NOT_FOUND "We couldn't find that upload." (unknown, malformed or someone else's key). */
export const uploadNotFound = () =>
  new AppError('NOT_FOUND', { message: FILE_SENTENCES.uploadNotFound });

/** 404 NOT_FOUND "We couldn't find that project." */
export const projectNotFound = () =>
  new AppError('NOT_FOUND', { message: FILE_SENTENCES.projectNotFound });

/** 404 NOT_FOUND "We couldn't find that task." */
export const taskNotFound = () =>
  new AppError('NOT_FOUND', { message: FILE_SENTENCES.taskNotFound });

/** 403 FORBIDDEN "You can't add files to this project." (Start, Finish). */
export const cantAddFiles = () => new AppError('FORBIDDEN', { message: FILE_SENTENCES.cantAdd });

/** 403 FORBIDDEN "You can't change files on this project." (a viewer who can see the file). */
export const cantChangeFiles = () =>
  new AppError('FORBIDDEN', { message: FILE_SENTENCES.cantChange });

/** 409 CONFLICT "This file is already added." (Cancel of an attached upload). */
export const alreadyAdded = () =>
  new AppError('CONFLICT', { message: FILE_SENTENCES.alreadyAdded });

/**
 * The JSON error answer with `Retry-After` (a thrown AppError carries no headers, route.js
 * `errorResponse`): the pieces and Finish routes return it for UPLOAD_BUSY.
 * @param {AppError} error
 * @param {string} requestId
 * @param {number} seconds
 * @returns {Response}
 */
export function retryResponse(error, requestId, seconds) {
  return Response.json(
    { error: { code: error.code, message: error.message, requestId } },
    {
      status: error.status,
      headers: { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' },
    },
  );
}

/**
 * UPLOAD_BUSY (429) that remembers how many seconds to wait, for `retryResponse`.
 * @param {number} seconds 1 to 120
 * @returns {AppError & { retryAfter: number }}
 */
export function uploadBusy(seconds = 2) {
  const error = fileError('UPLOAD_BUSY');
  error.retryAfter = Math.min(120, Math.max(1, Math.ceil(seconds)));
  return error;
}
