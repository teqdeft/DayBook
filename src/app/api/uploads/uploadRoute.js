// Small helpers of the four upload routes (CONTRACT 27, Uploads "Routes"): the per-person rate
// limits (these routes skip the proxy, so they never use the client IP), the Start body read
// with a size cap, the optional `thumb` part of Finish, and the `Retry-After` answer of
// UPLOAD_BUSY (a thrown AppError carries no headers).
import { AppError } from '@/lib/errors';
import { checkRateLimit } from '@/lib/route';
import { retryResponse } from '@/modules/projectFiles/errors';

const MINUTE = 60_000;

/** Per person per minute (Limits). */
export const UPLOAD_LIMITS = Object.freeze({
  start: { key: 'uploads-start', limit: 60, windowMs: MINUTE },
  status: { key: 'uploads-status', limit: 120, windowMs: MINUTE },
  pieces: { key: 'uploads-pieces', limit: 300, windowMs: MINUTE },
  finish: { key: 'uploads-finish', limit: 60, windowMs: MINUTE },
  cancel: { key: 'uploads-cancel', limit: 120, windowMs: MINUTE },
});

/**
 * Counts one request of the person against its route's limit (first, in every handler).
 * @param {keyof typeof UPLOAD_LIMITS} kind
 * @param {{ id: number }} user
 * @throws RATE_LIMITED (429)
 */
export function countRequest(kind, user) {
  checkRateLimit(UPLOAD_LIMITS[kind], `/api/uploads:${kind}`, `user:${user.id}`);
}

// A Start body is a name of at most 1,000 characters and a few numbers.
const MAX_START_BYTES = 16_384;

function tooLarge() {
  return new AppError('PAYLOAD_TOO_LARGE', { status: 413, message: 'That request is too large.' });
}

/**
 * The Start body, read here rather than by withRoute: the rate limit counts the request first, and
 * a body far bigger than any Start is refused before it is parsed.
 * @param {Request} request
 * @returns {Promise<unknown>} the parsed JSON ({} for an empty body)
 * @throws PAYLOAD_TOO_LARGE (413), BAD_REQUEST (not JSON)
 */
export async function readStartBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_START_BYTES) throw tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_START_BYTES) throw tooLarge();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}

// A thumbnail is at most 512 KB; the rest of the body is the multipart framing.
const MAX_FINISH_BYTES = 512 * 1024 + 65_536;

/**
 * The `thumb` part of a Finish body, or null: no body, not multipart, no size, too big, not
 * readable, or no `thumb` file part. Anything else about `thumb` is ignored, never an error.
 * @param {Request} request
 * @returns {Promise<Blob | null>}
 */
export async function readThumb(request) {
  const type = request.headers.get('content-type') ?? '';
  const length = Number(request.headers.get('content-length'));
  if (!type.toLowerCase().startsWith('multipart/form-data')) return null;
  if (!Number.isFinite(length) || length <= 0 || length > MAX_FINISH_BYTES) return null;
  try {
    const thumb = (await request.formData()).get('thumb');
    return thumb && typeof thumb !== 'string' ? thumb : null;
  } catch {
    return null;
  }
}

/**
 * Runs a pieces or Finish call and **returns** the `Retry-After` answer for UPLOAD_BUSY; every
 * other error goes on to withRoute.
 * @template T
 * @param {() => Promise<T>} run
 * @param {string} requestId
 * @returns {Promise<T | Response>}
 */
export async function answerBusy(run, requestId) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError && error.code === 'UPLOAD_BUSY') {
      return retryResponse(error, requestId, error.retryAfter ?? 2);
    }
    throw error;
  }
}
